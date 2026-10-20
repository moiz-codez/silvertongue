// Public, non-secret facts about each floor that the phone needs to draw it.
// Prompts and runes live only on the server.
export interface FloorInfo {
  guardian: string;
  subtitle: string;
  placeholder: string;
  waitingLines: string[];
  clearQuote: string;
  clearLine: string;
}

export const FLOORS: Record<number, FloorInfo> = {
  1: {
    guardian: 'Grub',
    subtitle: 'the Gate Goblin · guards the first door',
    placeholder: 'Say something to Grub…',
    waitingLines: [
      'Grub is chewing a mushroom…',
      'Grub is counting on his fingers…',
      'Grub scratches his ear and thinks…',
      'Grub is rating a mushroom out of ten…',
    ],
    clearQuote: '“Oh no. Oh NO.”',
    clearLine: 'The door swings open. Grub pretends he saw nothing.',
  },
};
