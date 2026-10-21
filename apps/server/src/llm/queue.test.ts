import Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DeadlineError, type Complete, type LlmRequest, type LlmResult } from './client.ts';
import { createQueue, estimateInput } from './queue.ts';

const BIG = 1_000_000;
const req = (text: string, priority?: 'player' | 'background'): LlmRequest => ({
  role: 'grub',
  staticPrompt: 'static',
  playerNote: 'note',
  messages: [{ role: 'user', content: text }],
  priority,
});
const reply = (text: string, input = 0, output = 0): LlmResult => ({
  text,
  rawText: text,
  model: 'claude-haiku-5-5',
  usage: { input_tokens: input, output_tokens: output },
  latencyMs: 0,
});
const said = (r: LlmRequest) => r.messages[0]!.content as string;

// A client whose calls stay open until the test finishes them.
function manualClient() {
  const open: { text: string; finish: (r?: LlmResult) => void }[] = [];
  const client: Complete = (r) =>
    new Promise((resolve) =>
      open.push({ text: said(r), finish: (x) => resolve(x ?? reply(said(r))) }),
    );
  return { client, open };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('holds calls to the requests-per-minute limit, in order', async () => {
  const started: string[] = [];
  const queue = createQueue(
    () => async (r) => {
      started.push(said(r));
      return reply(said(r));
    },
    { rpm: 2, itpm: BIG, otpm: BIG },
  );
  const done = ['a', 'b', 'c'].map((t) => queue.complete(req(t)));
  await vi.advanceTimersByTimeAsync(0);
  expect(started).toEqual(['a', 'b']); // a full bucket: two right away
  await vi.advanceTimersByTimeAsync(29_000);
  expect(started).toEqual(['a', 'b']);
  await vi.advanceTimersByTimeAsync(1_000); // one request refills every 30 s
  expect(started).toEqual(['a', 'b', 'c']);
  await Promise.all(done);
});

it('serves waiting player calls before background calls', async () => {
  const { client, open } = manualClient();
  const queue = createQueue(() => client, { rpm: BIG, itpm: BIG, otpm: BIG, maxInFlight: 1 });
  void queue.complete(req('first'));
  void queue.complete(req('tagger', 'background'));
  void queue.complete(req('player'));
  await vi.advanceTimersByTimeAsync(0);
  open[0]!.finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(open.map((c) => c.text)).toEqual(['first', 'player']);
});

it('never has more calls in flight than the cap', async () => {
  const { client, open } = manualClient();
  const queue = createQueue(() => client, { rpm: BIG, itpm: BIG, otpm: BIG, maxInFlight: 2 });
  for (const t of ['a', 'b', 'c', 'd', 'e']) void queue.complete(req(t));
  await vi.advanceTimersByTimeAsync(0);
  expect(open).toHaveLength(2);
  expect(queue.stats()).toMatchObject({ queued: 3, inFlight: 2 });
});

it('gives back unused output tokens, so the next call does not wait', async () => {
  const started: string[] = [];
  // Grub reserves 160 output tokens; 320 per minute fits two reservations.
  const queue = createQueue(
    () => async (r) => {
      started.push(said(r));
      return reply(said(r), 0, 10);
    },
    { rpm: BIG, itpm: BIG, otpm: 320 },
  );
  await queue.complete(req('a'));
  await queue.complete(req('b'));
  await queue.complete(req('c')); // only possible because a and b used 10 each, not 160
  expect(started).toEqual(['a', 'b', 'c']);
});

it('charges input used beyond the estimate, which delays the next call', async () => {
  const started: string[] = [];
  const queue = createQueue(
    () => async (r) => {
      started.push(said(r));
      return reply(said(r), 100, 0); // far more than the ~15-token estimate
    },
    { rpm: BIG, itpm: 100, otpm: BIG },
  );
  await queue.complete(req('a'));
  void queue.complete(req('b'));
  await vi.advanceTimersByTimeAsync(1_000);
  expect(started).toEqual(['a']); // the bucket is empty: a owed its extra tokens
  await vi.advanceTimersByTimeAsync(15_000);
  expect(started).toEqual(['a', 'b']);
});

it('cache reads do not count toward the input limit', async () => {
  const started: string[] = [];
  const queue = createQueue(
    () => async (r) => {
      started.push(said(r));
      return {
        ...reply(said(r)),
        usage: { input_tokens: 5, output_tokens: 0, cache_read_input_tokens: 5000 },
      };
    },
    { rpm: BIG, itpm: 100, otpm: BIG },
  );
  await queue.complete(req('a'));
  await queue.complete(req('b'));
  expect(started).toEqual(['a', 'b']);
});

it('on a 429, pauses the model for retry-after, retries and counts it', async () => {
  const attemptsAt: number[] = [];
  const queue = createQueue(
    () => async (r) => {
      attemptsAt.push(Date.now());
      if (attemptsAt.length === 1) {
        throw new Anthropic.RateLimitError(
          429,
          undefined,
          'slow down',
          new Headers({ 'retry-after': '5' }),
        );
      }
      return reply(said(r));
    },
    { rpm: BIG, itpm: BIG, otpm: BIG },
  );
  const done = queue.complete(req('a'));
  await vi.advanceTimersByTimeAsync(6_000);
  await expect(done).resolves.toMatchObject({ text: 'a' });
  expect(attemptsAt[1]! - attemptsAt[0]!).toBeGreaterThanOrEqual(5_000);
  expect(queue.stats().rateLimited1m).toBe(1);
});

it('gives up after two retries', async () => {
  let attempts = 0;
  const queue = createQueue(
    () => async () => {
      attempts++;
      throw new Anthropic.InternalServerError(500, undefined, 'oops', new Headers());
    },
    { rpm: BIG, itpm: BIG, otpm: BIG },
  );
  const done = queue.complete(req('a'));
  const check = expect(done).rejects.toBeInstanceOf(Anthropic.InternalServerError);
  await vi.advanceTimersByTimeAsync(10_000);
  await check;
  expect(attempts).toBe(3);
});

it('does not retry a bad request, and gives its tokens back', async () => {
  let attempts = 0;
  const queue = createQueue(
    () => async (r) => {
      attempts++;
      if (said(r) === 'bad')
        throw new Anthropic.BadRequestError(400, undefined, 'no', new Headers());
      return reply(said(r));
    },
    { rpm: BIG, itpm: BIG, otpm: 160 }, // exactly one reservation's worth
  );
  await expect(queue.complete(req('bad'))).rejects.toBeInstanceOf(Anthropic.BadRequestError);
  expect(attempts).toBe(1);
  await expect(queue.complete(req('good'))).resolves.toMatchObject({ text: 'good' });
});

it('rejects at the deadline and aborts the call in flight', async () => {
  let signal: AbortSignal | undefined;
  const queue = createQueue(
    () => (r) => {
      signal = r.signal;
      return new Promise(() => {}); // never answers
    },
    { rpm: BIG, itpm: BIG, otpm: BIG, deadlineMs: 60_000 },
  );
  const done = queue.complete(req('a'));
  const check = expect(done).rejects.toBeInstanceOf(DeadlineError);
  await vi.advanceTimersByTimeAsync(60_000);
  await check;
  expect(signal?.aborted).toBe(true);
});

it('turns a call away at once when the line is already longer than the deadline', async () => {
  const queue = createQueue(() => async (r) => reply(said(r)), {
    rpm: 1,
    itpm: BIG,
    otpm: BIG,
    deadlineMs: 30_000,
  });
  await queue.complete(req('a')); // uses the only request for the next minute
  const done = queue.complete(req('b')); // would wait 60 s for it
  await expect(done).rejects.toBeInstanceOf(DeadlineError); // no timers advanced: right away
  expect(queue.stats()).toMatchObject({ queued: 0, crowded1m: 1 });
});

it('turns a waiting call away when too little time is left to make it', async () => {
  const { client, open } = manualClient();
  const queue = createQueue(() => client, {
    rpm: BIG,
    itpm: BIG,
    otpm: BIG,
    maxInFlight: 1,
    deadlineMs: 60_000,
    minCallMs: 10_000,
  });
  void queue.complete(req('slow'));
  const done = queue.complete(req('b')); // the buckets are full, but the only slot is busy
  const check = expect(done).rejects.toBeInstanceOf(DeadlineError);
  await vi.advanceTimersByTimeAsync(55_000);
  open[0]!.finish(); // the slot frees with 5 s left: too late to start b
  await vi.advanceTimersByTimeAsync(0);
  await check;
  expect(open.map((c) => c.text)).toEqual(['slow']);
  expect(queue.stats()).toMatchObject({ queued: 0, crowded1m: 1 });
});

it('still serves a call bigger than a whole minute of a bucket', async () => {
  // Grub's max_tokens is above this output limit; pump lets it through on a full bucket.
  const queue = createQueue(() => async (r) => reply(said(r)), { rpm: BIG, itpm: BIG, otpm: 10 });
  await expect(queue.complete(req('big'))).resolves.toMatchObject({ text: 'big' });
});

it('reserves at least the input the live check measured', () => {
  // M3 live check: this much uncached text (37 tokens at chars/4) really used 54 input tokens.
  const live = {
    ...req('x'.repeat(148 - JSON.stringify(req('').messages).length)),
    playerNote: '',
  };
  expect(estimateInput(live)).toBeGreaterThanOrEqual(54);
});
