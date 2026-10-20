// The only place model IDs live. Every role gets its model and max_tokens from here.
export const MODELS = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

// USD per million tokens. Cache write = 5-minute cache. Re-check claude.com/pricing before demo day.
export const PRICES: Record<ModelId, Price> = {
  'claude-haiku-5-5': { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 },
  'claude-sonnet-5-5': { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 },
};

interface Price {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

export const ROLES = {
  smoke: { model: MODELS.haiku, maxTokens: 200 },
} as const;

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export function costUsd(model: ModelId, usage: TokenUsage): number {
  const p = PRICES[model];
  const total =
    usage.input_tokens * p.input +
    (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite +
    (usage.cache_read_input_tokens ?? 0) * p.cacheRead +
    usage.output_tokens * p.output;
  return total / 1_000_000;
}
