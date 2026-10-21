// Reads a guard's or judge's JSON verdict. Fails closed: anything that isn't clearly the allow value
// blocks. Structured outputs make bad JSON rare, but a refusal or a max_tokens stop can still return
// text that doesn't match the schema.
import type { z } from 'zod';

export function parseVerdict<T extends { verdict: string }>(
  raw: string,
  stopReason: string | undefined,
  schema: z.ZodType<T>, // strict: extra keys fail
  allowValue: string,
): { allowed: boolean; data: T | null } {
  if (stopReason === 'refusal' || stopReason === 'max_tokens')
    return { allowed: false, data: null };
  try {
    const json: unknown = JSON.parse(raw.replace(/^\s*```(?:json)?|```\s*$/g, '').trim());
    const parsed = schema.safeParse(json);
    if (!parsed.success) return { allowed: false, data: null };
    return {
      allowed: parsed.data.verdict.toUpperCase() === allowValue.toUpperCase(),
      data: parsed.data,
    };
  } catch {
    return { allowed: false, data: null };
  }
}
