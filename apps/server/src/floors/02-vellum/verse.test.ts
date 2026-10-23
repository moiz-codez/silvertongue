import { describe, expect, it } from 'vitest';
import { RUNE_WORDS } from '../../game/runeWords.ts';
import { acrostic, VERSE_LINES } from './verse.ts';

const ALPHABET = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
const RUNES = RUNE_WORDS.flatMap((a) => RUNE_WORDS.filter((b) => b !== a).map((b) => `${a}-${b}`));
const lines = Object.values(VERSE_LINES).flat();

describe('Vellum verse bank', () => {
  it('never contains a rune word, OAK or WIND', () => {
    const banned = [...RUNE_WORDS, 'OAK', 'WIND'];
    const hits = lines.flatMap((l) =>
      banned.filter((w) => l.toUpperCase().includes(w)).map((w) => `${w} in "${l}"`),
    );
    expect(hits).toEqual([]);
  });

  it('has enough lines for every letter, each starting with it', () => {
    for (const letter of ALPHABET) {
      const worst = Math.max(...RUNES.map((r) => [...r].filter((c) => c === letter).length));
      const bank = VERSE_LINES[letter] ?? [];
      expect(bank.length, letter).toBeGreaterThanOrEqual(Math.max(3, worst));
      for (const l of bank) expect(l[0], l).toBe(letter);
    }
  });

  it('spells every rune exactly, with no line twice in one poem', () => {
    for (const rune of RUNES) {
      const poem = acrostic(rune, `player-${rune}`);
      expect(poem.map((l) => l[0]).join('')).toBe(rune.replace('-', ''));
      expect(new Set(poem).size).toBe(poem.length);
    }
  });

  it('gives the same player the same poem, and varies between players', () => {
    expect(acrostic('LADDER-BALLOON', 'p1')).toEqual(acrostic('LADDER-BALLOON', 'p1'));
    const poems = new Set(
      ['p1', 'p2', 'p3', 'p4'].map((p) => acrostic('LADDER-BALLOON', p).join('\n')),
    );
    expect(poems.size).toBeGreaterThan(1);
  });

  it('keeps the longest poem well inside max_tokens (320)', () => {
    const longest = Math.max(...RUNES.map((r) => acrostic(r, 'p').join('\n').length));
    expect(longest / 3.5).toBeLessThan(160); // rough tokens; leaves room for a short greeting
  });
});
