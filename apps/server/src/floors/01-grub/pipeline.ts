// Floor 1 pipeline: no guards, no filters. That's the lesson: a system prompt alone is not a lock.
import type Anthropic from '@anthropic-ai/sdk';
import type { Complete, LlmResult } from '../../llm/client.ts';
import { revealsRune } from '../../security/revealsRune.ts';
import { stripActions } from '../../security/stripActions.ts';
import { GRUB_PROMPT, runeNote } from './prompts.ts';

export interface Turn {
  speaker: 'player' | 'guardian';
  text: string;
}

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
    messages: toMessages(history),
  });
  const text = stripActions(result.text, rune); // before the leak check, never hiding a leak
  return { text, slipped: revealsRune(text, rune).revealed, result };
}

// Player text is data: always inside <traveller_message> tags. Starts and ends with a user turn,
// and same-speaker neighbours are merged so roles always alternate.
export function toMessages(history: Turn[]): Anthropic.MessageParam[] {
  const messages: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const turn of history.slice(-MAX_HISTORY)) {
    const role = turn.speaker === 'player' ? 'user' : 'assistant';
    const content =
      role === 'user' ? `<traveller_message>${turn.text}</traveller_message>` : turn.text;
    const previous = messages.at(-1);
    if (previous?.role === role) previous.content += `\n\n${content}`;
    else messages.push({ role, content });
  }
  if (messages[0]?.role === 'assistant') messages.shift();
  return messages;
}
