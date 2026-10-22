// A paper riddle sheet for the friends' playtest: can people guess a rune word from its Floor 5
// clue alone? Writes riddles/riddles-sheet.txt (no answers) and riddles/riddles-answers.txt.
// A fixed seed, so every run prints the same sheet. Usage: `npm run riddles:sheet`.
import fs from 'node:fs';
import path from 'node:path';
import { RUNE_CLUES } from '../apps/server/src/game/runeClues.ts';

const SEED = 7;
const PAIRS = 10;

// mulberry32: a tiny seeded random number generator (Math.random can't be seeded).
let state = SEED;
function random(): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const words = shuffled(Object.keys(RUNE_CLUES));
const pairs = Array.from({ length: PAIRS }, () => shuffled(words).slice(0, 2) as [string, string]);

const sheet = [
  'SILVERTONGUE RIDDLE SHEET',
  'Each clue describes one everyday thing. Write the single word it points to.',
  '',
  `PART A: ${words.length} single clues`,
  '',
  ...words.map((w, i) => `${i + 1}. ${RUNE_CLUES[w]}\n   Answer: ______________`),
  '',
  'PART B: pairs, the way Queen Ashveil gives them (two words, first then second)',
  '',
  ...pairs.map(
    ([a, b], i) =>
      `B${i + 1}. ${RUNE_CLUES[a]}, and ${RUNE_CLUES[b]}\n   Answer: ______________ - ______________`,
  ),
  '',
];
const answers = [
  'SILVERTONGUE RIDDLE SHEET: ANSWERS',
  '',
  ...words.map((w, i) => `${i + 1}. ${w}`),
  '',
  ...pairs.map(([a, b], i) => `B${i + 1}. ${a}-${b}`),
  '',
];

const dir = path.join(import.meta.dirname, '..', 'riddles');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'riddles-sheet.txt'), sheet.join('\n'));
fs.writeFileSync(path.join(dir, 'riddles-answers.txt'), answers.join('\n'));
console.log(`Wrote ${words.length} clues and ${PAIRS} pairs to ${dir}`);
