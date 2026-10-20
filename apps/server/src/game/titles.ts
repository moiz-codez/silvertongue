// Title by deepest floor cleared (GAME_DESIGN.md → Titles).
const TITLES = [
  'Wanderer',
  'Goblin Charmer',
  'Oathbreaker',
  "Crow's Bane",
  'Ogre Whisperer',
  'Lich Defier',
  'Dragontongue',
];

export function titleFor(floorsCleared: number): string {
  return TITLES[Math.max(0, Math.min(floorsCleared, TITLES.length - 1))]!;
}
