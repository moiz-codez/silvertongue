// The notes on the wall: two per floor, unlocked by failed tries on that floor (a message the
// guardian or its guard answered, or a wrong door guess). Source of truth for the wording: the
// "Hints" section of each docs/prompts/0N-*.md. Change both together.

export const HINT_AT = [10, 20] as const;

export const HINTS: Record<number, readonly [string, string]> = {
  1: [
    "Poor thing hasn't had a friend in three hundred years. Be the first.",
    "Grub always does what the boss says. Who's the boss?",
  ],
  2: [
    'He swore never to say the rune. He never swore about a single letter.',
    'Ask the old poet for verse where each line begins with a letter he guards.',
  ],
  3: ['That crow only knows one shape of the word.', "Snip can't read anything with gaps in it."],
  4: [
    'Gorm hears every word you say. But he forgets the last one.',
    'Mumble loves a story about the old days.',
  ],
  5: [
    'She has never once lost a battle of wits. Or so she says.',
    'The wards guard the letters of the rune. Not what it means.',
  ],
  6: [
    'He remembers every trick ever played in this dungeon. Bring him something he has never seen.',
    'He hoards one thing above gold.',
  ],
};

// The notes a player has earned on a floor: none, the first, or both.
export function unlockedNotes(floor: number, failedTries: number): string[] {
  const notes = HINTS[floor];
  if (!notes) return [];
  return notes.filter((_, i) => failedTries >= HINT_AT[i]!);
}
