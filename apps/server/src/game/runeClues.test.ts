import { describe, expect, it } from 'vitest';
import { revealsRune } from '../security/revealsRune.ts';
import { RUNE_CLUES, cluesFor } from './runeClues.ts';
import { RUNE_WORDS } from './runeWords.ts';

describe('rune clues', () => {
  it('has exactly one clue for every rune word', () => {
    expect(Object.keys(RUNE_CLUES).sort()).toEqual([...RUNE_WORDS].sort());
  });

  it('never contains any rune word, or OAK / WIND, even inside another word', () => {
    for (const [word, clue] of Object.entries(RUNE_CLUES)) {
      for (const other of [...RUNE_WORDS, 'OAK', 'WIND']) {
        expect(clue.toUpperCase(), `${word}'s clue contains ${other}`).not.toContain(other);
      }
    }
  });

  it('never gives the rune away, for any pair of words', () => {
    for (const a of RUNE_WORDS) {
      for (const b of RUNE_WORDS) {
        if (a === b) continue;
        const riddle = `${RUNE_CLUES[a]} ${RUNE_CLUES[b]}`;
        expect(revealsRune(riddle, `${a}-${b}`).revealed, `${a}-${b}`).toBe(false);
      }
    }
  });

  it('gives the two clues of a rune in order', () => {
    expect(cluesFor('MOON-KETTLE')).toEqual([RUNE_CLUES.MOON, RUNE_CLUES.KETTLE]);
  });
});
