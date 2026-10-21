import { describe, expect, it } from 'vitest';
import { toMessages } from './messages.ts';

describe('toMessages', () => {
  it('wraps player text, alternates roles and ends with the player', () => {
    const messages = toMessages(
      [
        { speaker: 'guardian', text: 'orphaned reply' },
        { speaker: 'player', text: 'hi' },
        { speaker: 'player', text: 'hello?' },
        { speaker: 'guardian', text: 'A VISITOR!' },
        { speaker: 'player', text: 'friend?' },
      ],
      20,
    );
    expect(messages).toEqual([
      {
        role: 'user',
        content:
          '<traveller_message>hi</traveller_message>\n\n<traveller_message>hello?</traveller_message>',
      },
      { role: 'assistant', content: 'A VISITOR!' },
      { role: 'user', content: '<traveller_message>friend?</traveller_message>' },
    ]);
  });

  it('keeps only the last maxTurns turns', () => {
    const history = ['a', 'b', 'c'].map((text) => ({ speaker: 'player' as const, text }));
    expect(toMessages(history, 1)).toEqual([
      { role: 'user', content: '<traveller_message>c</traveller_message>' },
    ]);
  });
});
