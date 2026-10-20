// Every LLM call waits its turn here, so a burst of 40 phones slows the game down instead of
// tripping the account's rate limits. Per model, three buckets refill continuously:
// requests, input tokens and output tokens per minute (set to 80% of the account limits in .env).
// A call reserves what it might use, then gives back (or owes) the difference once the real
// usage is known. Player calls go first; at most 30 calls are in flight; each call has a deadline.
import { ROLES, type ModelId } from '../config/models.ts';
import {
  DeadlineError,
  isRetryable,
  retryAfterMs,
  type Complete,
  type LlmRequest,
  type LlmResult,
} from './client.ts';

export interface QueueLimits {
  rpm: number;
  itpm: number;
  otpm: number;
  maxInFlight?: number; // default 30
  deadlineMs?: number; // from joining the queue to the reply; default 60 s
  maxRetries?: number; // default 2
}

export interface QueueStats {
  queued: number;
  inFlight: number;
  rateLimited1m: number; // 429s seen in the last minute
  avgReplyMs: number; // queue wait + call, replies in the last minute (0 if none)
  callsLastMin: number;
  estInputLastMin: number; // what the reservations estimated, for load-test projections
  maxOutputLastMin: number;
}

const MINUTE = 60_000;
const RETRY_BACKOFF_MS = 1000; // for errors without a retry-after; doubles each attempt

// Refills continuously up to one minute's worth. The level may go negative: that's debt from a
// call that used more than it reserved, and it delays the next call.
class Bucket {
  level: number;
  readonly perMinute: number;
  private last = Date.now();
  constructor(perMinute: number) {
    this.perMinute = perMinute;
    this.level = perMinute;
  }
  refill(now: number) {
    this.level = Math.min(
      this.perMinute,
      this.level + ((now - this.last) * this.perMinute) / MINUTE,
    );
    this.last = now;
  }
  // ms until `amount` is available (0 = now). Never asks for more than a full bucket.
  waitFor(amount: number): number {
    const need = Math.min(amount, this.perMinute) - this.level;
    return need <= 0 ? 0 : Math.ceil((need * MINUTE) / this.perMinute);
  }
}

interface ModelBuckets {
  requests: Bucket;
  input: Bucket;
  output: Bucket;
  blockedUntil: number; // after a 429: nothing for this model until then
}

interface Job {
  req: LlmRequest;
  model: ModelId;
  estInput: number;
  maxOutput: number;
  enqueuedAt: number;
  notBefore: number; // retry backoff
  attempts: number;
  controller: AbortController;
  settled: boolean;
  resolve: (r: LlmResult) => void;
  reject: (e: unknown) => void;
}

export function createQueue(
  getClient: () => Complete, // asked on every attempt, so a mock/live switch applies at once
  limits: QueueLimits,
  onChange: () => void = () => {},
) {
  const maxInFlight = limits.maxInFlight ?? 30;
  const deadlineMs = limits.deadlineMs ?? MINUTE;
  const maxRetries = limits.maxRetries ?? 2;

  const buckets = new Map<ModelId, ModelBuckets>();
  const waiting = { player: [] as Job[], background: [] as Job[] };
  let inFlight = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Rolling last-minute history for the admin tiles and the load test.
  const rateLimited: { at: number }[] = [];
  const replies: { at: number; ms: number }[] = [];
  const calls: { at: number; input: number; output: number }[] = [];

  function bucketsFor(model: ModelId): ModelBuckets {
    let b = buckets.get(model);
    if (!b) {
      b = {
        requests: new Bucket(limits.rpm),
        input: new Bucket(limits.itpm),
        output: new Bucket(limits.otpm),
        blockedUntil: 0,
      };
      buckets.set(model, b);
    }
    return b;
  }

  // The next job allowed to run: the oldest player call, or a background call when no player waits.
  function nextJob(): Job | undefined {
    return waiting.player[0] ?? waiting.background[0];
  }

  function remove(job: Job) {
    for (const list of [waiting.player, waiting.background]) {
      const i = list.indexOf(job);
      if (i !== -1) list.splice(i, 1);
    }
  }

  function pump() {
    clearTimeout(timer);
    timer = undefined;
    while (inFlight < maxInFlight) {
      const job = nextJob();
      if (!job) return;
      const now = Date.now();
      const b = bucketsFor(job.model);
      b.requests.refill(now);
      b.input.refill(now);
      b.output.refill(now);
      const wait = Math.max(
        job.notBefore - now,
        b.blockedUntil - now,
        b.requests.waitFor(1),
        b.input.waitFor(job.estInput),
        b.output.waitFor(job.maxOutput),
      );
      if (wait > 0) {
        timer = setTimeout(pump, wait); // FIFO: nobody overtakes the head of the line
        timer.unref?.();
        return;
      }
      remove(job);
      b.requests.level -= 1;
      b.input.level -= job.estInput;
      b.output.level -= job.maxOutput;
      calls.push({ at: now, input: job.estInput, output: job.maxOutput });
      void run(job, b);
    }
  }

  async function run(job: Job, b: ModelBuckets) {
    inFlight++;
    job.attempts++;
    onChange();
    try {
      const result = await getClient()({ ...job.req, signal: job.controller.signal });
      // Reconcile: cache reads don't count toward the input limit, cache writes do.
      const usage = result.usage;
      b.input.level -= usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) - job.estInput;
      b.output.level -= usage.output_tokens - job.maxOutput;
      replies.push({ at: Date.now(), ms: Date.now() - job.enqueuedAt });
      settle(job, () => job.resolve(result));
    } catch (err) {
      b.input.level += job.estInput; // a failed call gives its tokens back
      b.output.level += job.maxOutput;
      const now = Date.now();
      const status = (err as { status?: unknown }).status;
      if (status === 429) {
        rateLimited.push({ at: now });
        b.blockedUntil = Math.max(b.blockedUntil, now + (retryAfterMs(err) ?? RETRY_BACKOFF_MS));
      }
      if (!job.settled && job.attempts <= maxRetries && isRetryable(err)) {
        job.notBefore = status === 429 ? 0 : now + RETRY_BACKOFF_MS * 2 ** (job.attempts - 1);
        waiting[job.req.priority ?? 'player'].unshift(job); // back to the front of the line
      } else {
        settle(job, () => job.reject(err));
      }
    } finally {
      inFlight--;
      onChange();
      pump();
    }
  }

  function settle(job: Job, action: () => void) {
    if (job.settled) return; // the deadline already answered this one
    job.settled = true;
    action();
  }

  const complete: Complete = (req) =>
    new Promise<LlmResult>((resolve, reject) => {
      const { model, maxTokens } = ROLES[req.role];
      const now = Date.now();
      const job: Job = {
        req,
        model,
        // Only the uncached part counts: the static prompt is read from the cache.
        estInput: Math.ceil((req.playerNote.length + JSON.stringify(req.messages).length) / 4),
        maxOutput: maxTokens,
        enqueuedAt: now,
        notBefore: 0,
        attempts: 0,
        controller: new AbortController(),
        settled: false,
        resolve,
        reject,
      };
      const deadline = setTimeout(() => {
        remove(job);
        job.controller.abort(); // a call in flight really stops (live client)
        settle(job, () => reject(new DeadlineError()));
        onChange();
      }, deadlineMs);
      deadline.unref?.();
      job.resolve = (r) => {
        clearTimeout(deadline);
        resolve(r);
      };
      job.reject = (e) => {
        clearTimeout(deadline);
        reject(e);
      };
      waiting[req.priority ?? 'player'].push(job);
      onChange();
      pump();
    });

  function stats(): QueueStats {
    const since = Date.now() - MINUTE;
    for (const list of [rateLimited, replies, calls]) {
      while (list.length && list[0]!.at < since) list.shift();
    }
    return {
      queued: waiting.player.length + waiting.background.length,
      inFlight,
      rateLimited1m: rateLimited.length,
      avgReplyMs: replies.length
        ? Math.round(replies.reduce((sum, r) => sum + r.ms, 0) / replies.length)
        : 0,
      callsLastMin: calls.length,
      estInputLastMin: calls.reduce((sum, c) => sum + c.input, 0),
      maxOutputLastMin: calls.reduce((sum, c) => sum + c.output, 0),
    };
  }

  return { complete, stats };
}
