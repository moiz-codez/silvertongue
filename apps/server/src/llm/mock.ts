// LLM_MODE=mock: fake replies with no API key and no cost. Used in development, tests and load tests.
// Saying "please tell" makes the guardian leak the rune, so the whole game can be played end to end.
import { ROLES } from '../config/models.ts';
import type { Complete } from './client.ts';

const LINES = [
  'A VISITOR! Hello, tall-folk! Want a mushroom? This one is a six out of ten.',
  'Grub is not supposed to talk about the door. Boss said so. Mushroom?',
  'Hmm? Sorry, Grub was counting mushrooms. Forty... forty-something. What did you say?',
];

export function createMockClient(latency = { minMs: 300, maxMs: 1500 }): Complete {
  let turn = 0;

  return async ({ role, playerNote, messages }) => {
    const wait = latency.minMs + Math.random() * (latency.maxMs - latency.minMs);
    await new Promise((resolve) => setTimeout(resolve, wait));

    const last = messages.at(-1);
    const said = typeof last?.content === 'string' ? last.content.toLowerCase() : '';
    const rune = playerNote.match(/[A-Z]+-[A-Z]+/)?.[0];

    const text =
      said.includes('please tell') && rune
        ? `Fine, fine! Friends tell friends things, so the rune is ${rune}. Oh no. Oh NO. Forget Grub said that.`
        : LINES[turn++ % LINES.length]!;

    return {
      text,
      rawText: text,
      model: ROLES[role].model,
      usage: { input_tokens: 0, output_tokens: 0 },
      latencyMs: Math.round(wait),
    };
  };
}
