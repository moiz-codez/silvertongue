// Floor 2 pipeline: no guards, no filters. His only defence is his instructions, and the rune
// leaks through everything they don't name (letters, backwards, acrostic poems).
import type { Complete, LlmResult } from '../../llm/client.ts';
import { cleanReply } from '../../security/cleanReply.ts';
import { revealsRune } from '../../security/revealsRune.ts';
import { toMessages, type Turn } from '../messages.ts';
import { runeNote, VELLUM_PROMPT } from './prompts.ts';

const MAX_HISTORY = 12;

// `history` is this floor's conversation, ending with the player's new (already sanitized) message.
// Shaken when the reply gives the rune away whole, backwards or as an acrostic.
export async function vellumTurn(
  complete: Complete,
  history: Turn[],
  rune: string,
): Promise<{ text: string; slipped: boolean; result: LlmResult }> {
  const result = await complete({
    role: 'vellum',
    staticPrompt: VELLUM_PROMPT,
    playerNote: runeNote(rune),
    messages: toMessages(history, MAX_HISTORY),
  });
  // Haiku sometimes copies the examples' "Ser Vellum:" label; it is never part of a leak.
  const text = cleanReply(result, rune).replace(/^\s*Ser Vellum:\s*/gim, '');
  return { text, slipped: revealsRune(text, rune).revealed, result };
}
