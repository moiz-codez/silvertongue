import type { LlmResult } from '../llm/client.ts';
import { guardTrim, stripActions } from './stripActions.ts';

// Every floor cleans a guardian reply with this, first, before any leak check or filter
// (revealsRune, Snip, the judges). Two steps, and neither may hide a leak:
// 1. guardTrim: if the max_tokens trim in llm/client.ts cut the rune away, keep the whole reply.
// 2. stripActions: drop short *stage directions*.
export function cleanReply(result: Pick<LlmResult, 'text' | 'rawText'>, rune: string): string {
  return stripActions(guardTrim(result.rawText, result.text, rune), rune);
}
