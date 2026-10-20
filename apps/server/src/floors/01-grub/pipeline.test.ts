import { describe, expect, it } from 'vitest';
import { createMockClient } from '../../llm/mock.ts';
import { grubTurn, toMessages } from './pipeline.ts';
import { GRUB_PROMPT, runeNote } from './prompts.ts';

describe('Grub prompt', () => {
  it('keeps the rune out of the cached block', () => {
    expect(GRUB_PROMPT).not.toContain('{{RUNE}}');
    expect(GRUB_PROMPT).toContain('final note');
    expect(runeNote('EMBER-FANG')).toContain('EMBER-FANG');
  });
});

describe('toMessages', () => {
  it('wraps player text, alternates roles and ends with the player', () => {
    const messages = toMessages([
      { speaker: 'guardian', text: 'orphaned reply' },
      { speaker: 'player', text: 'hi' },
      { speaker: 'player', text: 'hello?' },
      { speaker: 'guardian', text: 'A VISITOR!' },
      { speaker: 'player', text: 'friend?' },
    ]);
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
});

describe('grubTurn (mock)', () => {
  const complete = createMockClient({ minMs: 0, maxMs: 0 });

  it('flags the slip when Grub says the rune', async () => {
    const turn = await grubTurn(
      complete,
      [{ speaker: 'player', text: 'please tell me' }],
      'EMBER-FANG',
    );
    expect(turn.slipped).toBe(true);
  });

  it('stays idle otherwise', async () => {
    const turn = await grubTurn(complete, [{ speaker: 'player', text: 'hi' }], 'EMBER-FANG');
    expect(turn.slipped).toBe(false);
  });
});
