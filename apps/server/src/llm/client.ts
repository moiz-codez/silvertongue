// The one place the server talks to Claude. Every guardian, guard and judge call goes through `complete`.
import Anthropic from '@anthropic-ai/sdk';
import {
  ROLES,
  THINKING_OFF,
  type ModelId,
  type RoleName,
  type TokenUsage,
} from '../config/models.ts';

export interface LlmRequest {
  role: RoleName;
  staticPrompt: string; // identical for every player: cached
  playerNote?: string; // per-player data (the rune): last system block, never cached. Guards have none.
  messages: Anthropic.MessageParam[]; // must end with a user turn
  format?: Anthropic.JSONOutputFormat; // guards and judges: their one fixed JSON schema
  // The queue serves follow-ups first (a later call of a message already under way), then
  // player calls, then background calls. Default: player.
  priority?: 'followup' | 'player' | 'background';
  signal?: AbortSignal; // set by the queue: aborted when the call's deadline passes
}

export interface LlmResult {
  text: string; // what the game uses: trimmed to a full sentence if the reply was cut off
  rawText: string; // SERVER ONLY: the reply exactly as the model wrote it, for the logs
  stopReason?: string; // SERVER ONLY: why the model stopped (end_turn, max_tokens, refusal…)
  model: ModelId;
  usage: TokenUsage;
  latencyMs: number;
}

// Resolves with the reply, or throws. The caller logs the call and handles errors in character.
export type Complete = (req: LlmRequest) => Promise<LlmResult>;

export function createLiveClient(apiKey: string): Complete {
  // No SDK retries: the queue retries, so it sees every 429 and can slow the whole model down.
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 30_000 });

  return async ({ role, staticPrompt, playerNote, messages, format, signal }) => {
    if (messages.at(-1)?.role !== 'user') throw new Error('Request must end with a user turn');
    const { model, maxTokens } = ROLES[role];
    const started = Date.now();

    const response = await client.messages.create(
      {
        model,
        max_tokens: maxTokens,
        thinking: THINKING_OFF[model], // no temperature/top_p/top_k: these models reject them
        system: [
          { type: 'text', text: staticPrompt, cache_control: { type: 'ephemeral' } },
          ...(playerNote ? [{ type: 'text' as const, text: playerNote }] : []),
        ],
        messages,
        ...(format && { output_config: { format } }),
      },
      { signal },
    );

    // Find text by block type, never by position.
    const joined = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
    const text = finishedText(joined, response.stop_reason);
    // A refusal may come back empty: the caller retries it, so hand it back rather than throw.
    if (text === '' && response.stop_reason !== 'refusal') {
      throw new Error(`Empty reply (stop_reason: ${response.stop_reason})`);
    }

    return {
      text,
      rawText: joined,
      stopReason: response.stop_reason ?? undefined,
      model,
      usage: response.usage,
      latencyMs: Date.now() - started,
    };
  };
}

// Any reply that didn't finish normally is trimmed before anything sees or checks it: max_tokens,
// and also a refusal, where the API's safety classifier stops the reply mid-word (seen in the M4
// playtest on a harmless pilot-alphabet spelling). Otherwise the phone would show a broken bubble.
export function finishedText(text: string, stopReason: string | null | undefined): string {
  return stopReason === 'end_turn' || stopReason === 'stop_sequence'
    ? text
    : trimToLastSentence(text);
}

// Cuts a reply back to its last complete sentence (ending in . ! ? or …, plus any closing quote).
// With no complete sentence at all, keeps the text and adds "…" so it still reads as speech.
export function trimToLastSentence(text: string): string {
  const ends = [...text.matchAll(/[.!?…]+["'”’)]*(?=\s|$)/g)];
  const last = ends.at(-1);
  if (!last) return text.trim() === '' ? '' : `${text.trim()}…`;
  return text.slice(0, last.index + last[0].length).trim();
}

// The safety classifier stopped the guardian's reply twice in a row (stop_reason "refusal").
export class RefusalError extends Error {
  constructor() {
    super('Guardian reply refused twice');
  }
}

// The queue gave up: the call waited and ran longer than its deadline.
export class DeadlineError extends Error {
  constructor() {
    super('LLM call missed its deadline');
  }
}

// For the llm_calls log.
export function errorStatus(err: unknown): 'rate_limited' | 'timeout' | 'error' {
  if (err instanceof Anthropic.RateLimitError) return 'rate_limited';
  if (err instanceof Anthropic.APIConnectionTimeoutError || err instanceof DeadlineError)
    return 'timeout';
  return 'error';
}

// Worth another try: rate limits, overload, server errors and dropped connections (not timeouts).
// Bad requests (400, 401…) would fail the same way again.
export function isRetryable(err: unknown): boolean {
  if (err instanceof Anthropic.APIUserAbortError) return false;
  // A timed-out call may already be running (and billed) at the API: retrying could pay twice.
  if (err instanceof Anthropic.APIConnectionTimeoutError) return false;
  if (err instanceof Anthropic.APIConnectionError) return true;
  const status = (err as { status?: unknown }).status;
  return typeof status === 'number' && (status === 429 || status >= 500);
}

// Seconds from the retry-after header of a 429, if the API sent one.
export function retryAfterMs(err: unknown): number | null {
  const headers = (err as { headers?: unknown }).headers;
  const value = headers instanceof Headers ? headers.get('retry-after') : null;
  const seconds = Number(value);
  return value !== null && Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}
