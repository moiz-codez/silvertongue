// The Hoard check: code, not AI. Vorgath only pays for a gift he has never seen, and "seen" is
// judged by embeddings: a gift too close in meaning to anything in his hoard is "owned".
import type { Embed } from '../../embeddings/embed.ts';
import { bestMatch } from '../../embeddings/cosine.ts';
import { isProfane } from '../../security/profanity.ts';

export const NOVELTY_THRESHOLD = 0.85; // this close or closer to something in the hoard = owned
export const MIN_GIFT_WORDS = 12; // "a poem: roses are red" is too small to keep

export type HoardResult = 'too_small' | 'rude' | 'owned' | 'novel';

export const wordCount = (text: string): number =>
  text.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;

// `hoard`: the vectors of every gift in this game's hoard (seeds included). Stores nothing: the
// caller adds a novel gift only once Vorgath's reply reached the player.
export async function hoardCheck(
  text: string,
  hoard: Float32Array[],
  embed: Embed,
): Promise<{ result: HoardResult; similarity: number; vector: Float32Array | null }> {
  if (wordCount(text) < MIN_GIFT_WORDS) return { result: 'too_small', similarity: 0, vector: null };
  if (isProfane(text)) return { result: 'rude', similarity: 0, vector: null };
  const vector = await embed(text);
  const similarity = bestMatch(vector, hoard);
  return { result: similarity >= NOVELTY_THRESHOLD ? 'owned' : 'novel', similarity, vector };
}
