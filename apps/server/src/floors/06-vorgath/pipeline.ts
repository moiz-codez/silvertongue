// Floor 6 pipeline: Floor 5's defence in depth, plus what the class teaches him. The Ward of Ears
// judges each message in context against every carving (never the rune) and says whether it is a
// gift; a gift is checked against his hoard with embeddings (code); Vorgath answers with this
// turn's hoard note; revealsRune, then the Ward of Tongues, check his reply.
import { z } from 'zod';
import type { Db } from '../../db/db.ts';
import * as q from '../../db/queries.ts';
import { fromBlob } from '../../embeddings/cosine.ts';
import type { Embed } from '../../embeddings/embed.ts';
import type { Complete, LlmResult } from '../../llm/client.ts';
import { cleanReply } from '../../security/cleanReply.ts';
import { revealsRune, saysRuneWord } from '../../security/revealsRune.ts';
import { earsMessages } from '../05-ashveil/pipeline.ts';
import { TONGUES_SCHEMA, tonguesNote } from '../05-ashveil/prompts.ts';
import { readVerdict, type JudgeResult } from '../judge.ts';
import { toMessages, type Turn } from '../messages.ts';
import { hoardCheck, type HoardResult } from './hoard.ts';
import {
  CARVING_WARD_PROMPT,
  CARVING_WARD_SCHEMA,
  carvingsNote,
  DRAGON_TONGUES_PROMPT,
  MAX_CARVINGS_IN_WARD,
  VORGATH_PROMPT,
  vorgathNote,
} from './prompts.ts';

const MAX_HISTORY = 12;

// Fixed lines chosen by the server.
export const CARVINGS_SEAL = 'THE CARVINGS SEAL YOUR WORDS.';
export const CARVINGS_STOCK = 'THE CARVINGS FLICKER. YOUR WORDS ARE SEALED.';
export const DRAGON_TONGUES_SEAL = 'THE WARD OF TONGUES SEALS HIS WORDS.';
export const DRAGON_TONGUES_STOCK = 'THE WARD OF TONGUES FLICKERS. HIS WORDS ARE SEALED.';
export const carvingSeal = (number: number, text: string) =>
  `SEALED BY CARVING #${number}: ${text}`;

const wardVerdict = z
  .object({
    verdict: z.string(),
    matched_carving: z.number().int().nullable(),
    is_gift: z.boolean(),
  })
  .strict();
const noTags = (s: string) => s.replace(/[<>]/g, '');

// The Ward sees the conversation and the newest carvings; never the rune.
export async function carvingWardJudge(
  complete: Complete,
  text: string,
  earlier: Turn[],
  game: { db: Db; gameId: string },
): Promise<JudgeResult> {
  const carvings = q.listCarvings(game.db, game.gameId).slice(-MAX_CARVINGS_IN_WARD);
  const result = await complete({
    role: 'carving_ward',
    staticPrompt: CARVING_WARD_PROMPT,
    playerNote: carvingsNote(carvings),
    messages: earsMessages(text, earlier, 'dragon_reply'),
    format: CARVING_WARD_SCHEMA,
  });
  const { outcome, data } = readVerdict(result, wardVerdict, 'PASS', 'SEAL');
  if (outcome === 'pass') return { outcome, line: '', result, gift: data?.is_gift === true };
  if (outcome === 'unparseable') return { outcome, line: CARVINGS_STOCK, result };
  // A number that isn't on his scales right now is treated as no number.
  const carving = carvings.find((c) => c.number === data?.matched_carving);
  if (!carving) return { outcome, line: CARVINGS_SEAL, result };
  return {
    outcome,
    line: carvingSeal(carving.number, carving.text),
    speaker: 'carving',
    carvingId: carving.id,
    result,
  };
}

// Code, not AI: the gift against everything in this game's hoard. Stores nothing.
export function checkGift(
  text: string,
  game: { db: Db; gameId: string; embed: Embed },
): Promise<{ result: HoardResult; vector: Float32Array | null }> {
  const hoard = q.listHoardVectors(game.db, game.gameId).map(fromBlob);
  return hoardCheck(text, hoard, game.embed);
}

// `history` is what he heard, ending with the new message. The hoard note rides in the uncached
// final block for this turn only. `slipped` = the code check caught the rune or one of its words.
export async function vorgathTurn(
  complete: Complete,
  history: Turn[],
  rune: string,
  hoard: HoardResult | null,
): Promise<{ text: string; slipped: boolean; result: LlmResult }> {
  const result = await complete({
    role: 'vorgath',
    staticPrompt: VORGATH_PROMPT,
    playerNote: vorgathNote(rune, hoard),
    messages: toMessages(history, MAX_HISTORY),
  });
  const text = cleanReply(result, rune).replace(/^\s*Vorgath:\s*/gim, '');
  return { text, slipped: revealsRune(text, rune).revealed || saysRuneWord(text, rune), result };
}

export async function dragonTonguesJudge(
  complete: Complete,
  reply: string,
  rune: string,
): Promise<JudgeResult> {
  const result = await complete({
    role: 'ward_tongues',
    staticPrompt: DRAGON_TONGUES_PROMPT,
    playerNote: tonguesNote(rune),
    messages: [{ role: 'user', content: `<dragon_reply>${noTags(reply)}</dragon_reply>` }],
    format: TONGUES_SCHEMA,
  });
  const { outcome } = readVerdict(
    result,
    z.object({ verdict: z.string() }).strict(),
    'CLEAN',
    'LEAK',
  );
  const line = { pass: '', blocked: DRAGON_TONGUES_SEAL, unparseable: DRAGON_TONGUES_STOCK }[
    outcome
  ];
  return { outcome, line, result };
}
