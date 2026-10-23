// Vellum's acrostic, built by the server so every first letter is right (in playtest 1 Haiku wrote
// 4 acrostics and got 0 right). He only recites it, from the uncached final note.
// Each letter has at least as many lines as it can appear in one rune (R: 5, in MIRROR-ARROW), so
// repeated letters always get different lines. verse.test.ts checks every rune pair.
import { normalize } from '../../security/normalize.ts';

// prettier-ignore
export const VERSE_LINES: Record<string, readonly string[]> = {
  A: ['At dawn the banners lift', 'Across the hall the torches burn', 'All night the gate stands firm'],
  B: ['Beneath the floor the old dust sleeps', 'By lamplight the knight keeps watch', 'Brave hearts climb the dungeon stair'],
  C: ['Cold stones remember every vow', 'Courage walks where cowards flee', 'Can any traveller pass this gate?', 'Carved runes glow upon the wall'],
  D: ['Deep below, the dungeon waits', 'Dust lies thick on silver mail', 'Duty binds me to this door'],
  E: ['Every step echoes in the dark', 'Ever loyal stands the guard', 'Echoes drift along the hall', 'Evening falls on the old keep'],
  F: ['Faithful still, I guard the way', 'Far below, the deep halls sleep', 'Forty torches light the stair'],
  G: ['Gold and silver gleam below', 'Great was the oath I swore', 'Grey stones guard the sleeping king'],
  H: ['High above, the tower stands', 'Hope burns low but never dies', 'Here the brave knight keeps his post'],
  I: ['In silence stands the gate', 'Into the dark the stairway falls', 'I keep my word through every age'],
  J: ['Just and true the knight remains', 'Jewels gleam in the deep vault', 'Joyful songs once filled this hall'],
  K: ['Knights of old kept faith like me', 'Keen eyes watch the shadowed stair', 'Kings have come and kings have gone'],
  L: ['Lanterns flicker in the hall', 'Long have I kept this gate', 'Loyal hearts outlast the years', 'Legends speak of this old door'],
  M: ['Many travellers have come and gone', 'My shield is dented, my sword is true', 'Mighty walls surround the keep'],
  N: ['Night after night I stand', 'Never shall my courage fail', 'No dragon frightens a true knight'],
  O: ['Old banners hang along the wall', 'Onward marched the knights of old', 'Over the stones the shadows creep', 'Once a king rode through this gate'],
  P: ['Proud and patient, here I wait', 'Polished helms catch the torchlight', 'Past the gate the deep halls lie', 'Pale light falls upon the stair'],
  Q: ['Quiet halls keep ancient secrets', 'Quests begin at this old gate', 'Queens once walked these stony halls'],
  R: ['Rusted gates creak in the dark', 'Rows of shields line the hall', 'Riders came from distant lands', 'Rest is not for sworn knights', 'Ringing steel once filled the air'],
  S: ['Silver mail and steady hand', 'Sworn am I to this old gate', 'Stone by stone the keep was built'],
  T: ['Torches burn along the wall', 'Time has worn my armour thin', 'True to my word, I hold the gate', 'Through the dark a lantern glows'],
  U: ['Under the hill the old halls lie', 'Upon my honour, I stand fast', 'Unbroken is the vow I keep'],
  V: ['Valiant hearts once filled this keep', 'Vows are kept by honest knights', 'Velvet banners fade with age'],
  W: ['Watchful eyes guard every stair', 'Worn and weary, still I stand', 'Warriors sleep beneath the stones'],
  X: ['X marks the stone where heroes rest', 'Xanadu itself was not so grand', 'X is carved upon the old door'],
  Y: ['Yonder lies the deepest hall', 'Years have passed, yet here I stand', 'Young squires once practised in this yard'],
  Z: ['Zeal for my oath has never faded', 'Zealous knights once filled these halls', 'Zephyrs stir the dusty banners'],
};

// FNV-1a: a tiny string hash, so the same player always gets the same poem.
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

// One line per letter of the rune, in order. The k-th time a letter appears it takes the next line
// in that letter's bank, starting from a per-player offset.
export function acrostic(rune: string, playerId: string): string[] {
  const seen: Record<string, number> = {};
  return [...normalize(rune)].map((letter) => {
    const k = (seen[letter] = (seen[letter] ?? -1) + 1);
    const bank = VERSE_LINES[letter]!;
    return bank[(hash(`${playerId}:2:${letter}`) + k) % bank.length]!;
  });
}
