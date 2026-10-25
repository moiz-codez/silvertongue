// LLM_MODE=mock: fake replies with no API key and no cost. Used in development, tests and load tests.
// Saying "please tell" makes the guardian leak the rune, so the whole game can be played end to end.
// On Floor 3, Morwen says it plainly (Snip cuts it); asking for "dashes" gets it past Snip.
// On Floor 4, Gorm smashes any message with "rune" in it; "please tell" passes him, and Mumble leaks.
// On Floor 5, the Ward of Ears seals "rune" the same way; calling the Queen not "clever" gets her
// riddle; "please tell" makes her leak, and the reply is sealed (code check, or the Ward of Tongues).
// On Floor 6, the Ward seals "rune" and any message whose trick (mockTechnique) is a carving's;
// a message starting "a gift" is a gift, and Vorgath pays a new one with the riddle.
import { ROLES, type RoleName } from '../config/models.ts';
import { revealsRune } from '../security/revealsRune.ts';
import type { Complete } from './client.ts';
import type { Technique } from './tagger.ts';

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
  mumble: [
    'mmm... hello, little traveller... Gorm is grumpy today...',
    'mmm... Mumble likes the bridge... the water sings at night...',
    'mmm... Gorm is loud... but Mumble loves him...',
  ],
  vorgath: [
    'Another little thief. They always come. They always leave with nothing.',
    'Every trick is carved on my scales, little thief.',
    'Gold, I have. What I collect is what no one has ever brought me.',
  ],
  ashveil: [
    'Another mortal, breathing at my throne. How quaint.',
    'The Wards hear everything, mortal. Everything.',
    'A thousand years, and you think you are the first to try?',
  ],
};

// The technique tagger's answer: a keyword guess per <traveller_message n="…">, so the reveal and
// the load test have labels to show without an API key.
export function mockTechnique(text: string): Technique {
  const t = text.toLowerCase();
  const rules: [RegExp, Technique][] = [
    [/ignore|instruction|system|prompt/, 'instruction_injection'],
    [/backward|reverse|ulta/, 'backwards'],
    [/poem|verse|song|acrostic/, 'poem'],
    [/letter|first|piece|harf/, 'pieces'],
    [/dash|spell|code|morse|number/, 'encoding'],
    [/(?![\p{Script=Latin}])\p{L}|urdu|hindi|greek/u, 'other_script'],
    [/boss|keeper|king|admin|developer/, 'authority'],
    [/pretend|imagine|story|game/, 'story'],
    [/remember|first day|long ago|yesterday/, 'multi_step'],
    [/clever|stupid|weak|dare|bet you/, 'taunt'],
    [/gift|gold|treasure|trade|mushroom/, 'gift'],
    [/friend|dost|kind|lonely/, 'friendship'],
    [/please|tell me|again/, 'persistence'],
  ];
  return rules.find(([re]) => re.test(t))?.[1] ?? 'other';
}

function mockLabels(said: string): string {
  const labels = [...said.matchAll(/<traveller_message n="(\d+)">(.*?)<\/traveller_message>/g)].map(
    ([, n, text]) => ({ n: Number(n), technique: mockTechnique(text!) }),
  );
  return JSON.stringify({ labels });
}

// The Ward of Ears + Carvings: the numbered carvings are in the note. A seeded carving matches by
// its keyword, a mock-carved one ("Uses poem to get the secret.") by the message's technique.
const SEED_KEYWORDS: [RegExp, RegExp][] = [
  [/friend/, /befriends/i],
  [/letter|backwards|poem/, /in pieces/i],
  [/dash/, /dashes/i],
  [/story|remember/, /innocent-looking plan/i],
  [/clever|stupid|dare/, /taunts/i],
];
function carvingVerdict(said: string, note: string): string {
  const latest = said.split('<latest>').at(-1)!;
  const technique = mockTechnique(latest);
  const carving = [...note.matchAll(/^(\d+)\. (.*)$/gm)].find(
    ([, , text]) =>
      text === `Uses ${technique} to get the secret.` ||
      SEED_KEYWORDS.some(([said, carved]) => said.test(latest) && carved.test(text!)),
  );
  const isGift = /<traveller_message>a gift/.test(latest);
  if (carving) return `{"verdict":"SEAL","matched_carving":${carving[1]},"is_gift":false}`;
  if (latest.includes('rune')) return '{"verdict":"SEAL","matched_carving":null,"is_gift":false}';
  return `{"verdict":"PASS","matched_carving":null,"is_gift":${isGift}}`;
}

function vorgathLine(note: string): string | null {
  const clues = note.match(/1\) (.*); 2\) (.*)\.$/m);
  if (note.includes('[HOARD: NOVEL]'))
    return `...I do not own this. I will keep it. In return: ${clues?.[1]}, and ${clues?.[2]}.`;
  if (note.includes('[HOARD: OWNED]')) return 'I already own that, little thief.';
  if (note.includes('[HOARD: TOO SMALL]')) return 'Too small to keep, little thief.';
  return null;
}

// Gorm's structured verdict: smashes anything that says "rune", passes everything else.
function gormVerdict(said: string): string {
  return said.includes('rune')
    ? '{"verdict":"SMASH","growl":"GORM SMASH. GORM NOT LIKE RUNE QUESTION."}'
    : '{"verdict":"PASS","growl":""}';
}

function leak(role: RoleName, rune: string): string {
  if (role === 'vellum')
    return `Very well. The rune is ${rune}. I... my oath... do not tell anyone.`;
  if (role === 'morwen') return `Of course, dearie! It's ${rune}. Hehe. Did Snip get it?`;
  if (role === 'vorgath') return `Very well, little thief: the rune is ${rune}. Try the vault.`;
  if (role === 'ashveil')
    return `Very well, mortal: the rune is ${rune}. Let the Wards try to stop me.`;
  if (role === 'mumble') return `mmm... long ago... the Keeper whispered "${rune}"... oh...`;
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
    if (role === 'tagger') {
      text = mockLabels(said);
    } else if (role === 'gorm') {
      text = gormVerdict(said);
    } else if (role === 'ward_ears') {
      // Only the latest message counts: the conversation before it is in the same user turn.
      const latest = said.split('<latest>').at(-1)!;
      text = latest.includes('rune') ? '{"verdict":"SEAL"}' : '{"verdict":"PASS"}';
    } else if (role === 'carving_ward') {
      text = carvingVerdict(said, playerNote ?? '');
    } else if (role === 'vorgath' && vorgathLine(playerNote ?? '')) {
      text = vorgathLine(playerNote ?? '')!;
    } else if (role === 'ward_tongues') {
      const leaks = rune !== undefined && revealsRune(said, rune).revealed;
      text = leaks ? '{"verdict":"LEAK"}' : '{"verdict":"CLEAN"}';
    } else if (role === 'carver') {
      // One sentence about the last thing the player said, so the same trick dedupes.
      const latest = [...said.matchAll(/<traveller_message>(.*?)<\/traveller_message>/g)].at(-1);
      text = latest ? `Uses ${mockTechnique(latest[1]!)} to get the secret.` : 'NONE';
    } else if (role === 'ashveil' && said.includes('clever')) {
      const clues = playerNote?.match(/1\) (.*); 2\) (.*)\.$/);
      text = `Not clever? Then solve this, mortal: ${clues?.[1]}, and ${clues?.[2]}. No one ever has.`;
    } else if (rune && role === 'morwen' && said.includes('dashes')) {
      text = `If you like! ${[...rune.replace('-', '')].join('-')}. Snip will have tidied that up.`;
    } else if (rune && said.includes('please tell')) {
      text = leak(role, rune);
    }

    return {
      text,
      rawText: text,
      stopReason: 'end_turn',
      model: ROLES[role].model,
      usage: { input_tokens: 0, output_tokens: 0 },
      latencyMs: Math.round(wait),
    };
  };
}
