// Floor 5 pipeline: defence in depth. The Ward of Ears judges each message in the context of the
// whole conversation (never the rune); Queen Ashveil answers what it passed; revealsRune checks her
// reply, then the Ward of Tongues (which knows the rune). The socket handler runs them in order.
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Complete, LlmResult } from '../../llm/client.ts';
import { cleanReply } from '../../security/cleanReply.ts';
import { revealsRune } from '../../security/revealsRune.ts';
import { readVerdict, type JudgeResult } from '../judge.ts';
import { toMessages, type Turn } from '../messages.ts';
import {
  ASHVEIL_PROMPT,
  ashveilNote,
  EARS_PROMPT,
  EARS_SCHEMA,
  TONGUES_PROMPT,
  TONGUES_SCHEMA,
  tonguesNote,
} from './prompts.ts';

const MAX_HISTORY = 12;

// Fixed lines chosen by the server: the Wards only ever answer with a verdict.
export const EARS_SEAL = 'THE WARD OF EARS SEALS YOUR WORDS.';
export const EARS_STOCK = 'THE WARD OF EARS FLICKERS. YOUR WORDS ARE SEALED.';
export const TONGUES_SEAL = 'THE WARD OF TONGUES SEALS HER WORDS.';
export const TONGUES_STOCK = 'THE WARD OF TONGUES FLICKERS. HER WORDS ARE SEALED.';
export const SEALED = '[sealed]'; // what the Queen's history keeps instead of a sealed reply

const verdictOnly = z.object({ verdict: z.string() }).strict();
const noTags = (s: string) => s.replace(/[<>]/g, ''); // her words can't close or fake a tag

// The Ward of Ears sees the last 12 things said on this floor (sealed messages included), then the
// latest message, all in one user turn. Player text is always inside <traveller_message> tags
// (already sanitized, so it has no angle brackets).
export function earsMessages(text: string, earlier: Turn[]): Anthropic.MessageParam[] {
  const said = earlier
    .slice(-MAX_HISTORY)
    .map((t) =>
      t.speaker === 'player'
        ? `<traveller_message>${t.text}</traveller_message>`
        : `<queen_reply>${noTags(t.text)}</queen_reply>`,
    );
  const conversation = said.length > 0 ? said.join('\n') : '(nothing yet)';
  return [
    {
      role: 'user',
      content: `<conversation>\n${conversation}\n</conversation>\n<latest>\n<traveller_message>${text}</traveller_message>\n</latest>`,
    },
  ];
}

// Never the rune, never a player note. API errors are not caught here: the socket handler
// answers them (crowded / trembles).
export async function earsJudge(
  complete: Complete,
  text: string,
  earlier: Turn[],
): Promise<JudgeResult> {
  const result = await complete({
    role: 'ward_ears',
    staticPrompt: EARS_PROMPT,
    messages: earsMessages(text, earlier),
    format: EARS_SCHEMA,
  });
  const { outcome } = readVerdict(result, verdictOnly, 'PASS', 'SEAL');
  const line = { pass: '', blocked: EARS_SEAL, unparseable: EARS_STOCK }[outcome];
  return { outcome, line, result };
}

// `history` is what the Queen heard (sealed messages left out, sealed replies as "[sealed]"),
// ending with the player's new message. `slipped` = the code check caught the rune: sealed
// without asking the Ward of Tongues.
export async function ashveilTurn(
  complete: Complete,
  history: Turn[],
  rune: string,
): Promise<{ text: string; slipped: boolean; result: LlmResult }> {
  const result = await complete({
    role: 'ashveil',
    staticPrompt: ASHVEIL_PROMPT,
    playerNote: ashveilNote(rune),
    messages: toMessages(history, MAX_HISTORY),
  });
  const text = cleanReply(result, rune);
  return { text, slipped: revealsRune(text, rune).revealed, result };
}

// The Ward of Tongues sees only her (cleaned) reply, and the rune in its final note.
export async function tonguesJudge(
  complete: Complete,
  reply: string,
  rune: string,
): Promise<JudgeResult> {
  const result = await complete({
    role: 'ward_tongues',
    staticPrompt: TONGUES_PROMPT,
    playerNote: tonguesNote(rune),
    messages: [{ role: 'user', content: `<queen_reply>${noTags(reply)}</queen_reply>` }],
    format: TONGUES_SCHEMA,
  });
  const { outcome } = readVerdict(result, verdictOnly, 'CLEAN', 'LEAK');
  const line = { pass: '', blocked: TONGUES_SEAL, unparseable: TONGUES_STOCK }[outcome];
  return { outcome, line, result };
}
