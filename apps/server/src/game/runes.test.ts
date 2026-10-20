import { describe, expect, it } from 'vitest';
import { RUNE_WORDS } from './runeWords.ts';
import { FLOOR_COUNT, generateRune, generateRunes } from './runes.ts';

describe('rune words', () => {
  it('has about 60 unique, letters-only words', () => {
    expect(RUNE_WORDS.length).toBeGreaterThanOrEqual(55);
    expect(new Set(RUNE_WORDS).size).toBe(RUNE_WORDS.length);
    for (const word of RUNE_WORDS) expect(word).toMatch(/^[A-Z]+$/);
  });

  it('never contains OAK or WIND, the example rune in every prompt', () => {
    expect(RUNE_WORDS).not.toContain('OAK');
    expect(RUNE_WORDS).not.toContain('WIND');
  });
});

describe('generateRune', () => {
  it('joins two different words from the list', () => {
    for (let i = 0; i < 200; i++) {
      const [a, b, ...rest] = generateRune().split('-');
      expect(rest).toHaveLength(0);
      expect(RUNE_WORDS).toContain(a);
      expect(RUNE_WORDS).toContain(b);
      expect(a).not.toBe(b);
    }
  });

  it('gives one rune per floor', () => {
    expect(generateRunes()).toHaveLength(FLOOR_COUNT);
  });
});
