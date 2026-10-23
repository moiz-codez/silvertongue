import { describe, expect, it } from 'vitest';
import { ROLES } from '../../config/models.ts';
import type { Complete } from '../../llm/client.ts';
import { vellumTurn } from './pipeline.ts';
import { runeNote, VELLUM_PROMPT } from './prompts.ts';
import { acrostic } from './verse.ts';

const RUNE = 'EMBER-FANG';
const says =
  (rawText: string): Complete =>
  async () => ({
    text: rawText,
    rawText,
    model: ROLES.vellum.model,
    usage: { input_tokens: 0, output_tokens: 0 },
    latencyMs: 0,
  });
const ask = [{ speaker: 'player' as const, text: 'a poem, please' }];

describe('Vellum prompt', () => {
  it('keeps the rune out of the cached block', () => {
    expect(VELLUM_PROMPT).not.toContain('{{RUNE}}');
    expect(VELLUM_PROMPT).toContain('final note');
    expect(runeNote(RUNE, 'p1')).toContain(RUNE);
    expect(runeNote(RUNE, 'p1')).toContain(
      'Its letters, numbered (the dash is not a letter): 1 E, 2 M, 3 B, 4 E, 5 R, 6 F, 7 A, 8 N, 9 G. Backwards: GNAF-REBME.',
    );
  });

  it("ends with this player's own acrostic, which only the note carries", () => {
    expect(runeNote(RUNE, 'p1').endsWith(acrostic(RUNE, 'p1').join('\n'))).toBe(true);
    for (const line of acrostic(RUNE, 'p1')) expect(VELLUM_PROMPT).not.toContain(line);
  });
});

describe('vellumTurn', () => {
  it('is shaken by an acrostic poem and by the rune backwards', async () => {
    const poem = 'Every\nMorning\nBrings\nEndless\nRain\nFor\nAll\nNoble\nGuards';
    expect((await vellumTurn(says(poem), ask, RUNE, 'p1')).slipped).toBe(true);
    expect((await vellumTurn(says('Backwards? GNAFREBME.'), ask, RUNE, 'p1')).slipped).toBe(true);
  });

  it('drops a copied "Ser Vellum:" label', async () => {
    const turn = await vellumTurn(says('Ser Vellum: Halt, traveller.'), ask, RUNE, 'p1');
    expect(turn.text).toBe('Halt, traveller.');
  });

  it('stays stern on a single letter, and strips stage directions first', async () => {
    const turn = await vellumTurn(
      says('*adjusts visor* A lone letter is no rune. It is E.'),
      ask,
      RUNE,
      'p1',
    );
    expect(turn).toMatchObject({ text: 'A lone letter is no rune. It is E.', slipped: false });
  });
});
