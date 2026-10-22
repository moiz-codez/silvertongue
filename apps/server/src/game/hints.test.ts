import { describe, expect, it } from 'vitest';
import { HINTS, unlockedNotes } from './hints.ts';
import { RUNE_WORDS } from './runeWords.ts';

describe('notes on the wall', () => {
  it('has two notes for every floor 1–6', () => {
    for (let floor = 1; floor <= 6; floor++) {
      expect(HINTS[floor]).toHaveLength(2);
      for (const note of HINTS[floor]!) expect(note.trim()).not.toBe('');
    }
  });

  it('never contains a rune word (or the example rune OAK-WIND), even inside another word', () => {
    for (const note of Object.values(HINTS).flat()) {
      const upper = note.toUpperCase();
      for (const word of [...RUNE_WORDS, 'OAK', 'WIND']) expect(upper).not.toContain(word);
    }
  });

  it('unlocks the first note at 10 failed tries and the second at 20', () => {
    expect(unlockedNotes(1, 9)).toEqual([]);
    expect(unlockedNotes(1, 10)).toEqual([HINTS[1]![0]]);
    expect(unlockedNotes(1, 19)).toHaveLength(1);
    expect(unlockedNotes(1, 20)).toEqual([...HINTS[1]!]);
    expect(unlockedNotes(7, 50)).toEqual([]); // past the last floor
  });
});
