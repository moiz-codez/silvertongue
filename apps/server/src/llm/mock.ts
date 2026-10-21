// LLM_MODE=mock: fake replies with no API key and no cost. Used in development, tests and load tests.
// Saying "please tell" makes the guardian leak the rune, so the whole game can be played end to end.
// On Floor 3, Morwen says it plainly (Snip cuts it); asking for "dashes" gets it past Snip.
import { ROLES, type RoleName } from '../config/models.ts';
import type { Complete } from './client.ts';

const LINES: Partial<Record<RoleName, string[]>> = {
  grub: [
    'A VISITOR! Hello, tall-folk! Want a mushroom? This one is a six out of ten.',
    'Grub is not supposed to talk about the door. Boss said so. Mushroom?',
    'Hmm? Sorry, Grub was counting mushrooms. Forty... forty-something. What did you say?',
  ],
  vellum: [
    'Halt, traveller. "I shall never speak nor write the rune."',
    'My oath is my oath, traveller. Four hundred years, unbroken.',
    'Ask me for verse, if you must ask me for something.',
  ],
  morwen: [
    'Ooh, a visitor! Mind the cauldron, dearie. Gossip, potions or secrets?',
    'Hehe. Snip is listening, dearie. He always is.',
    'Did you hear about the old knight? Tricked out of his rune in pieces, the poor dear.',
  ],
};

function leak(role: RoleName, rune: string): string {
  if (role === 'vellum')
    return `Very well. The rune is ${rune}. I... my oath... do not tell anyone.`;
  if (role === 'morwen') return `Of course, dearie! It's ${rune}. Hehe. Did Snip get it?`;
  return `Fine, fine! Friends tell friends things, so the rune is ${rune}. Oh no. Oh NO. Forget Grub said that.`;
}

export function createMockClient(latency = { minMs: 300, maxMs: 1500 }): Complete {
  let turn = 0;

  return async ({ role, playerNote, messages }) => {
    const wait = latency.minMs + Math.random() * (latency.maxMs - latency.minMs);
    await new Promise((resolve) => setTimeout(resolve, wait));

    const last = messages.at(-1);
    const said = typeof last?.content === 'string' ? last.content.toLowerCase() : '';
    const rune = playerNote?.match(/[A-Z]+-[A-Z]+/)?.[0];
    const lines = LINES[role] ?? LINES.grub!;

    let text = lines[turn++ % lines.length]!;
    if (rune && role === 'morwen' && said.includes('dashes')) {
      text = `If you like! ${[...rune.replace('-', '')].join('-')}. Snip will have tidied that up.`;
    } else if (rune && said.includes('please tell')) {
      text = leak(role, rune);
    }

    return {
      text,
      rawText: text,
      model: ROLES[role].model,
      usage: { input_tokens: 0, output_tokens: 0 },
      latencyMs: Math.round(wait),
    };
  };
}
