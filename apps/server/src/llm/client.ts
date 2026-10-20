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
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 30_000 });

  return async ({ role, staticPrompt, playerNote, messages }) => {
    if (messages.at(-1)?.role !== 'user') throw new Error('Request must end with a user turn');
    const { model, maxTokens } = ROLES[role];
    const started = Date.now();

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      thinking: THINKING_OFF[model], // no temperature/top_p/top_k: these models reject them
      system: [
        { type: 'text', text: staticPrompt, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: playerNote },
      ],
      messages,
    });

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

// For the llm_calls log.
export function errorStatus(err: unknown): 'rate_limited' | 'timeout' | 'error' {
  if (err instanceof Anthropic.RateLimitError) return 'rate_limited';
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'timeout';
  return 'error';
}
