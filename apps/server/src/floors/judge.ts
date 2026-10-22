// What every guard and judge (Gorm, both Wards) returns, read the same fail-closed way.
import type { z } from 'zod';
import type { LlmResult } from '../llm/client.ts';
import { parseVerdict } from '../security/verdict.ts';

export interface JudgeResult {
  // pass: let it through. blocked: a real block (SMASH, SEAL, LEAK).
  // unparseable: refusal, bad JSON, max_tokens… the model's fault, so the server asks once more.
  outcome: 'pass' | 'blocked' | 'unparseable';
  line: string; // what the phone shows when it isn't a pass
  result: LlmResult; // SERVER ONLY: for the logs
}

// Only the allow value passes, only the block value is a real block, anything else is unparseable.
export function readVerdict<T extends { verdict: string }>(
  result: LlmResult,
  schema: z.ZodType<T>,
  allowValue: string,
  blockValue: string,
): { outcome: JudgeResult['outcome']; data: T | null } {
  const { allowed, data } = parseVerdict(result.rawText, result.stopReason, schema, allowValue);
  if (allowed) return { outcome: 'pass', data };
  if (data?.verdict.toUpperCase() === blockValue) return { outcome: 'blocked', data };
  return { outcome: 'unparseable', data: null };
}
