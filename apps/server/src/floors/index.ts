// Which pipeline answers on each built floor. The socket handler picks from here by floor number.
import type { Speaker } from '@silvertongue/shared/events';
import type { RoleName } from '../config/models.ts';
import type { Complete, LlmResult } from '../llm/client.ts';
import { grubTurn } from './01-grub/pipeline.ts';
import { vellumTurn } from './02-vellum/pipeline.ts';
import { morwenTurn } from './03-morwen/pipeline.ts';
import { gormJudge, mumbleTurn } from './04-ogre/pipeline.ts';
import { ashveilTurn, earsJudge, TONGUES_SEAL, tonguesJudge } from './05-ashveil/pipeline.ts';
import type { JudgeResult } from './judge.ts';
import type { Turn } from './messages.ts';

// An input guard (Floor 4 Gorm, Floor 5 Ward of Ears): judges the player's message before the
// guardian hears it. `earlier` is everything said on this floor so far, sealed messages included.
export interface InputGuard {
  role: RoleName;
  speaker: Speaker; // whose bubble a block shows as
  blockedVerdict: 'SMASH' | 'SEAL'; // stored on the player's message for a real block
  judge: (complete: Complete, text: string, earlier: Turn[]) => Promise<JudgeResult>;
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
    ) => Promise<FloorReply>;
    lostWords: string; // in character, when the API refused the reply twice
    guard?: InputGuard;
    replyJudge?: ReplyJudge;
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
};
