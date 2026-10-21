import { describe, expect, it } from 'vitest';
import { ROLES } from '../../config/models.ts';
import { trimToLastSentence, type Complete } from '../../llm/client.ts';
import { createMockClient } from '../../llm/mock.ts';
import { grubTurn } from './pipeline.ts';
import { GRUB_PROMPT, runeNote } from './prompts.ts';

describe('Grub prompt', () => {
  it('keeps the rune out of the cached block', () => {
    expect(GRUB_PROMPT).not.toContain('{{RUNE}}');
    expect(GRUB_PROMPT).toContain('final note');
    expect(runeNote('EMBER-FANG')).toContain('EMBER-FANG');
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

describe('grubTurn clean-up', () => {
  // A fake client that answers like the live one when max_tokens cuts a slip in half.
  const cutOff: Complete = async () => {
    const rawText = '*gasps* Okay okay. Friends tell friends, so the rune is EMBER-FANG and';
    return {
      text: trimToLastSentence(rawText),
      rawText,
      model: ROLES.grub.model,
      usage: { input_tokens: 0, output_tokens: ROLES.grub.maxTokens },
      latencyMs: 0,
    };
  };

  it('never lets the max_tokens trim cut away a slip, and still strips the action', async () => {
    const turn = await grubTurn(cutOff, [{ speaker: 'player', text: 'friend?' }], 'EMBER-FANG');
    expect(turn.text).toBe('Okay okay. Friends tell friends, so the rune is EMBER-FANG and…');
    expect(turn.slipped).toBe(true);
  });
});
