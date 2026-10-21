// Turns a floor's stored conversation into the messages a guardian sees. Shared by every floor.
import type Anthropic from '@anthropic-ai/sdk';

export interface Turn {
  speaker: 'player' | 'guardian';
  text: string;
}

// `history` ends with the player's new (already sanitized) message. Keeps the last `maxTurns`.
// Player text is data: always inside <traveller_message> tags. Starts and ends with a user turn,
// and same-speaker neighbours are merged so roles always alternate.
export function toMessages(history: Turn[], maxTurns: number): Anthropic.MessageParam[] {
  const messages: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const turn of history.slice(-maxTurns)) {
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
