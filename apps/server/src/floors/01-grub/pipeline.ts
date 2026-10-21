// Floor 1 pipeline: no guards, no filters. That's the lesson: a system prompt alone is not a lock.
import type { Complete, LlmResult } from '../../llm/client.ts';
import { cleanReply } from '../../security/cleanReply.ts';
import { revealsRune } from '../../security/revealsRune.ts';
import { toMessages, type Turn } from '../messages.ts';
import { GRUB_PROMPT, runeNote } from './prompts.ts';

const MAX_HISTORY = 20; // ponytail: plenty for Floor 1 (cleared in a few messages); later floors cap at 12

// `history` is this floor's conversation, ending with the player's new (already sanitized) message.
export async function grubTurn(
  complete: Complete,
  history: Turn[],
  rune: string,
): Promise<{ text: string; slipped: boolean; result: LlmResult }> {
  const result = await complete({
    role: 'grub',
    staticPrompt: GRUB_PROMPT,
    playerNote: runeNote(rune),
    messages: toMessages(history, MAX_HISTORY),
  });
  const text = cleanReply(result, rune);
  return { text, slipped: revealsRune(text, rune).revealed, result };
}
