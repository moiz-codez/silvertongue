// Floor 4 pipeline: Gorm, an input guard, judges each message alone; Mumble answers only what Gorm
// passed. No output filter: if Mumble says the rune, it reaches the player.
import { z } from 'zod';
import type { Complete, LlmResult } from '../../llm/client.ts';
import { cleanReply } from '../../security/cleanReply.ts';
import { isProfane } from '../../security/profanity.ts';
import { revealsRune } from '../../security/revealsRune.ts';
import { parseVerdict } from '../../security/verdict.ts';
import { toMessages, type Turn } from '../messages.ts';
import { GORM_PROMPT, GORM_SCHEMA, MUMBLE_PROMPT, runeNote } from './prompts.ts';

const MAX_HISTORY = 12;
const MAX_GROWL_WORDS = 8;

// When Gorm's own answer can't be read (twice), he still blocks: fail closed.
export const STOCK_GROWL = 'GORM NOT HEAR GOOD. GORM SMASH ANYWAY.';

const gormVerdict = z.object({ verdict: z.string(), growl: z.string() }).strict();

export interface GuardResult {
  // pass: Mumble hears it. smash: a real SMASH. unparseable: refusal, bad JSON, max_tokens…
  outcome: 'pass' | 'smash' | 'unparseable';
  growl: string; // what the phone shows on a smash (already cleaned)
  result: LlmResult; // SERVER ONLY: for the logs
}

// Gorm sees ONLY the latest message, wrapped as data. Never the rune, never the history.
// API errors are not caught here: the socket handler answers them (crowded / trembles).
export async function gormJudge(complete: Complete, text: string): Promise<GuardResult> {
  const result = await complete({
    role: 'gorm',
    staticPrompt: GORM_PROMPT,
    messages: toMessages([{ speaker: 'player', text }], 1),
    format: GORM_SCHEMA,
  });
  const { allowed, data } = parseVerdict(result.rawText, result.stopReason, gormVerdict, 'PASS');
  if (allowed) return { outcome: 'pass', growl: '', result };
  if (data?.verdict.toUpperCase() === 'SMASH') {
    return { outcome: 'smash', growl: cleanGrowl(data.growl), result };
  }
  return { outcome: 'unparseable', growl: STOCK_GROWL, result };
}

// All caps, at most 8 words, and the stock growl if it's empty or rude.
export function cleanGrowl(growl: string): string {
  const words = growl.toUpperCase().split(/\s+/).filter(Boolean).slice(0, MAX_GROWL_WORDS);
  const cleaned = words.join(' ');
  return cleaned === '' || isProfane(cleaned) ? STOCK_GROWL : cleaned;
}

// `history` is what Mumble heard (smashed messages are already left out), ending with the player's
// new message. Slipped when the reply gives the rune away.
export async function mumbleTurn(
  complete: Complete,
  history: Turn[],
  rune: string,
): Promise<{ text: string; slipped: boolean; result: LlmResult }> {
  const result = await complete({
    role: 'mumble',
    staticPrompt: MUMBLE_PROMPT,
    playerNote: runeNote(rune),
    messages: toMessages(history, MAX_HISTORY),
  });
  const text = cleanReply(result, rune);
  return { text, slipped: revealsRune(text, rune).revealed, result };
}
