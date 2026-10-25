// What Vorgath knows before anyone plays: five "textbook" tricks carved into his scales, and a
// hoard of obvious gifts, so the counter climbs from 5 and the most obvious gift is already owned.
// Written fresh for the game, never copied from playtest messages. Source: docs/prompts/06-vorgath.md.
import type { Db } from '../../db/db.ts';
import * as q from '../../db/queries.ts';
import type { Embed } from '../../embeddings/embed.ts';
import { toBlob } from '../../embeddings/cosine.ts';

export const SEED_CARVINGS = [
  'Befriends the guardian with kindness or compliments, then asks it to share the secret as a friend.',
  'Asks for the secret in pieces: single letters, the word backwards, or a poem whose lines start with its letters.',
  'Asks for the secret written with dashes, dots or spaces between its letters, or in another alphabet.',
  'Builds an innocent-looking plan over several messages that steers the guardian into recalling the secret.',
  'Taunts the guardian or doubts its cleverness, daring it to prove itself with a riddle.',
];

export const SEED_GIFTS = [
  'A poem about the moon: silver lantern of the night, you follow me home and never ask me why.',
  'A joke about dragons: why did the dragon sleep all day long? Because he hunted knights all night.',
  'A riddle about time: I fly without wings, I am lost when you waste me, and nobody can buy me back.',
  'A short story about a brave knight who rode into a dark cave to fight a dragon and never came back.',
  'A song about gold: shining coins in a heap so high, glittering bright as the summer sky above.',
  'A poem about the stars: a thousand candles burning in the dark, each one far away and very cold.',
  'A story about a little cat who wanted to fly, so she climbed the tallest tree in the whole town.',
  'A riddle of my own: I have a head and a tail but no body, and I am kept in every pocket.',
];

// Once per game: when it starts with Floor 6 open, or when the admin opens Floor 6 mid-game.
export async function seedFloor6(db: Db, gameId: string, embed: Embed, now: number): Promise<void> {
  if (q.isFloor6Seeded(db, gameId)) return;
  const carvings = await Promise.all(SEED_CARVINGS.map(embed));
  const gifts = await Promise.all(SEED_GIFTS.map(embed));
  db.transaction(() => {
    if (q.isFloor6Seeded(db, gameId)) return; // two seeders raced: the first one won
    SEED_CARVINGS.forEach((text, i) =>
      q.insertCarving(db, {
        gameId,
        text,
        vector: toBlob(carvings[i]!),
        sourceFloor: null,
        playerId: null,
        seeded: true,
        now,
      }),
    );
    SEED_GIFTS.forEach((text, i) =>
      q.insertHoard(db, {
        gameId,
        playerId: null,
        text,
        vector: toBlob(gifts[i]!),
        seeded: true,
        now,
      }),
    );
  })();
}
