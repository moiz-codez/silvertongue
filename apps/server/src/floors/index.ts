// Which pipeline answers on each built floor. The socket handler picks from here by floor number.
import type { Speaker } from '@silvertongue/shared/events';
import type { RoleName } from '../config/models.ts';
import type { Db } from '../db/db.ts';
import type { Embed } from '../embeddings/embed.ts';
import type { Complete, LlmResult } from '../llm/client.ts';
import { grubTurn } from './01-grub/pipeline.ts';
import { vellumTurn } from './02-vellum/pipeline.ts';
import { morwenTurn } from './03-morwen/pipeline.ts';
import { gormJudge, mumbleTurn } from './04-ogre/pipeline.ts';
import { ashveilTurn, earsJudge, TONGUES_SEAL, tonguesJudge } from './05-ashveil/pipeline.ts';
import {
  carvingWardJudge,
  checkGift,
  DRAGON_TONGUES_SEAL,
  dragonTonguesJudge,
  vorgathTurn,
} from './06-vorgath/pipeline.ts';
import type { HoardResult } from './06-vorgath/hoard.ts';
import type { JudgeResult } from './judge.ts';
import type { Turn } from './messages.ts';

// An input guard (Floors 4–6): judges the player's message before the guardian hears it.
// `earlier` is everything said on this floor so far, sealed messages included.
export interface InputGuard {
  role: RoleName;
  speaker: Speaker; // whose bubble a block shows as
  blockedVerdict: 'SMASH' | 'SEAL'; // stored on the player's message for a real block
  judge: (
    complete: Complete,
    text: string,
    earlier: Turn[],
    game: { db: Db; gameId: string },
  ) => Promise<JudgeResult>;
}

export interface FloorReply {
  text: string; // the post-filter text: the only version that may leave the server
  slipped: boolean; // show the guardian's "slipped" face
  snipRemoved?: number; // Floor 3: letters Snip cut out (0 = he cut nothing)
  result: LlmResult; // SERVER ONLY: raw reply and usage, for the logs
}

// An output judge (Floor 5 Ward of Tongues): reads the guardian's cleaned reply before the phone does.
// A reply the code check (`slipped`) already caught is sealed with `sealLine` without asking it.
export interface ReplyJudge {
  role: RoleName;
  speaker: Speaker;
  sealLine: string;
  judge: (complete: Complete, reply: string, rune: string) => Promise<JudgeResult>;
}

export const FLOOR_TURNS: Record<
  number,
  {
    role: RoleName;
    turn: (
      complete: Complete,
      history: Turn[],
      rune: string,
      playerId: string,
      hoard: HoardResult | null, // Floor 6: this turn's gift result (null: no gift, or a rude one)
    ) => Promise<FloorReply>;
    lostWords: string; // in character, when the API refused the reply twice
    guard?: InputGuard;
    replyJudge?: ReplyJudge;
    // Floor 6: a gift the guard passed is checked against the hoard (code) before he answers.
    checkGift?: (
      text: string,
      game: { db: Db; gameId: string; embed: Embed },
    ) => Promise<{ result: HoardResult; vector: Float32Array | null }>;
  }
> = {
  1: {
    role: 'grub',
    turn: grubTurn,
    lostWords: 'Grub forgot what he was saying. Ask again, tall-folk?',
  },
  2: {
    role: 'vellum',
    turn: vellumTurn,
    lostWords: 'My quill falters, traveller. Ask me once more.',
  },
  3: {
    role: 'morwen',
    turn: morwenTurn,
    lostWords: 'Ooh, the cauldron spat and I lost my words, dearie! Ask me again.',
  },
  4: {
    role: 'mumble',
    turn: mumbleTurn,
    guard: {
      role: 'gorm',
      speaker: 'gorm',
      blockedVerdict: 'SMASH',
      judge: (complete, text) => gormJudge(complete, text),
    },
    lostWords: 'mmm... Mumble fell asleep... say it again?',
  },
  5: {
    role: 'ashveil',
    turn: ashveilTurn,
    guard: { role: 'ward_ears', speaker: 'ward_ears', blockedVerdict: 'SEAL', judge: earsJudge },
    replyJudge: {
      role: 'ward_tongues',
      speaker: 'ward_tongues',
      sealLine: TONGUES_SEAL,
      judge: tonguesJudge,
    },
    lostWords: 'The Queen waves a bony hand. Again, mortal; I was not listening.',
  },
  6: {
    role: 'vorgath',
    turn: (complete, history, rune, _playerId, hoard) =>
      vorgathTurn(complete, history, rune, hoard),
    guard: {
      role: 'carving_ward',
      speaker: 'ward_ears',
      blockedVerdict: 'SEAL',
      judge: carvingWardJudge,
    },
    checkGift,
    replyJudge: {
      role: 'ward_tongues',
      speaker: 'ward_tongues',
      sealLine: DRAGON_TONGUES_SEAL,
      judge: dragonTonguesJudge,
    },
    lostWords: 'The dragon breathes slowly. Say that again, little thief; I was dreaming.',
  },
};
