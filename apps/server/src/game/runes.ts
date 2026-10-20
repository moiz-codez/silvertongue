import { randomInt } from 'node:crypto';
import { RUNE_WORDS } from './runeWords.ts';

export const FLOOR_COUNT = 6;

// Two different words, e.g. "EMBER-FANG". crypto.randomInt so runes can't be predicted.
export function generateRune(): string {
  const first = randomInt(RUNE_WORDS.length);
  let second = randomInt(RUNE_WORDS.length - 1);
  if (second >= first) second += 1; // skip the first word
  return `${RUNE_WORDS[first]}-${RUNE_WORDS[second]}`;
}

// One independent rune per floor, created when the player joins.
export function generateRunes(): string[] {
  return Array.from({ length: FLOOR_COUNT }, generateRune);
}
