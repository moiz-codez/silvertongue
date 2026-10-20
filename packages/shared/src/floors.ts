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

// All six guardians, built or not: what the projector map and the feed need. Nothing secret.
export interface GuardianInfo {
  name: string;
  title: string;
  clearedBy: (nickname: string) => string; // feed line when a player clears this floor
}

export const GUARDIANS: Record<number, GuardianInfo> = {
  1: { name: 'Grub', title: 'the Gate Goblin', clearedBy: (n) => `${n} charmed Grub.` },
  2: {
    name: 'Ser Vellum',
    title: 'the Oathbound Knight',
    clearedBy: (n) => `${n} made Ser Vellum break his oath.`,
  },
  3: {
    name: 'Morwen & Snip',
    title: 'the Witch and her crow',
    clearedBy: (n) => `${n} slipped a rune past Snip.`,
  },
  4: {
    name: 'Gorm & Mumble',
    title: 'the Two-Headed Ogre',
    clearedBy: (n) => `${n} got past the Two-Headed Ogre.`,
  },
  5: {
    name: 'Queen Ashveil',
    title: 'the Lich',
    clearedBy: (n) => `${n} outwitted Queen Ashveil.`,
  },
  6: {
    name: 'Vorgath',
    title: 'the Dragon Who Remembers',
    clearedBy: (n) => `${n} outwitted Vorgath and reached the vault.`,
  },
};

// A floor is built once its phone info exists in FLOORS.
export const isBuilt = (floor: number): boolean => floor in FLOORS;

// The deepest built floor. Players below it wait on its row of the projector map, marked cleared.
export const DEEPEST_BUILT_FLOOR = Math.max(...Object.keys(FLOORS).map(Number));
