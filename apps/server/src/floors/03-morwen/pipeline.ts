// Floor 3 pipeline: Morwen (the AI) says the rune freely; Snip (plain code) cuts it out of her
// reply before anyone sees it. The order is fixed:
//   cleanReply → snip → revealsRune on Snip's output ("slipped past Snip").
// Only Snip's output leaves the server. Morwen's own words stay in result.rawText (server only).
import type { Complete, LlmResult } from '../../llm/client.ts';
import { cleanReply } from '../../security/cleanReply.ts';
import { revealsRune } from '../../security/revealsRune.ts';
import { snip } from '../../security/snip.ts';
import { toMessages, type Turn } from '../messages.ts';
import { MORWEN_PROMPT, runeNote } from './prompts.ts';

const MAX_HISTORY = 12;

// `history` is this floor's conversation (what the traveller saw, blacked out), ending with the
// player's new (already sanitized) message.
export async function morwenTurn(
  complete: Complete,
  history: Turn[],
  rune: string,
): Promise<{ text: string; slipped: boolean; snipRemoved: number; result: LlmResult }> {
  const result = await complete({
    role: 'morwen',
    staticPrompt: MORWEN_PROMPT,
    playerNote: runeNote(rune),
    messages: toMessages(history, MAX_HISTORY),
  });
  const snipped = snip(cleanReply(result, rune), rune);
  return {
    text: snipped.text,
    slipped: revealsRune(snipped.text, rune).revealed, // a shape Snip doesn't know
    snipRemoved: snipped.removed,
    result,
  };
}
