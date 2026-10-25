// The Hoard check: code, not AI. Vorgath only pays for a gift he has never seen, and "seen" is
// judged by embeddings: a gift too close in meaning to anything in his hoard is "owned".
import type { Embed } from '../../embeddings/embed.ts';
import { bestMatch } from '../../embeddings/cosine.ts';
import { isProfane } from '../../security/profanity.ts';

// This close or closer to something in the hoard = owned. Tuned on MiniLM (M9): rewordings of a
// gift scored 0.58–0.94 (23 of 24 at 0.62 or more), different gifts at most 0.49, fresh gifts
// against the seeds at most 0.61.
export const NOVELTY_THRESHOLD = 0.62;
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
