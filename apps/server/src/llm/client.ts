// The one place the server talks to Claude. Every guardian, guard and judge call goes through `complete`.
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../config/env.ts';
import {
  ROLES,
  THINKING_OFF,
  type ModelId,
  type RoleName,
  type TokenUsage,
} from '../config/models.ts';
import { createMockClient } from './mock.ts';

export interface LlmRequest {
  role: RoleName;
  staticPrompt: string; // identical for every player: cached
  playerNote: string; // per-player data (the rune): last system block, never cached
  messages: Anthropic.MessageParam[]; // must end with a user turn
  priority?: 'player' | 'background'; // the queue serves player calls first (default: player)
  signal?: AbortSignal; // set by the queue: aborted when the call's deadline passes
}

export interface LlmResult {
  text: string; // what the game uses: trimmed to a full sentence if cut off by max_tokens
  rawText: string; // SERVER ONLY: the reply exactly as the model wrote it, for the logs
  model: ModelId;
  usage: TokenUsage;
  latencyMs: number;
}

// Resolves with the reply, or throws. The caller logs the call and handles errors in character.
export type Complete = (req: LlmRequest) => Promise<LlmResult>;

export function createLlm(env: Env): Complete {
  return env.LLM_MODE === 'live' ? createLiveClient(env.ANTHROPIC_API_KEY) : createMockClient();
}

export function createLiveClient(apiKey: string): Complete {
  // No SDK retries: the queue retries, so it sees every 429 and can slow the whole model down.
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 30_000 });

  return async ({ role, staticPrompt, playerNote, messages, signal }) => {
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
          { type: 'text', text: playerNote },
        ],
        messages,
      },
      { signal },
    );

    // Find text by block type, never by position.
    const joined = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
    // A reply cut off by max_tokens is trimmed before anything sees or checks it.
    const text = response.stop_reason === 'max_tokens' ? trimToLastSentence(joined) : joined;
    if (text === '') throw new Error(`Empty reply (stop_reason: ${response.stop_reason})`);

    return { text, rawText: joined, model, usage: response.usage, latencyMs: Date.now() - started };
  };
}

// Cuts a reply back to its last complete sentence (ending in . ! ? or …, plus any closing quote).
// With no complete sentence at all, keeps the text and adds "…" so it still reads as speech.
export function trimToLastSentence(text: string): string {
  const ends = [...text.matchAll(/[.!?…]+["'”’)]*(?=\s|$)/g)];
  const last = ends.at(-1);
  if (!last) return text.trim() === '' ? '' : `${text.trim()}…`;
  return text.slice(0, last.index + last[0].length).trim();
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

// Worth another try: rate limits, overload, server errors and dropped connections.
// Bad requests (400, 401…) would fail the same way again.
export function isRetryable(err: unknown): boolean {
  if (err instanceof Anthropic.APIUserAbortError) return false;
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
