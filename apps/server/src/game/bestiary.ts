// The Bestiary: the reveal's projector cards, built from numbers only. The fixed lines are copied
// exactly from each docs/prompts/0N-*.md "Bestiary card"; "How you beat it" comes from templates
// here, never from the AI. Pure: sockets/reveal.ts gathers the numbers from the database.
import type { BestiaryCard, ClosingCard, RevealCard, Tile } from '@silvertongue/shared/events';
import type { Technique } from '../llm/tagger.ts';
import type { LeakRoute } from './leakRoute.ts';
import { titleFor } from './titles.ts';

export interface FloorStats {
  floor: number;
  reached: number;
  cleared: number;
  attempts: number; // player messages on this floor
  clearMs: number[]; // reached → cleared, one per clear
  routes: Partial<Record<LeakRoute, number>>;
  winningTags: Technique[]; // the tags of the winning messages that have one
  lettersSnipped: number; // Floor 3
  smashed: number; // Floor 4
  passed: number;
  planLengths: number[]; // Floor 4: messages Gorm passed before Mumble said it, per plan clear
  earsSeals: number; // Floor 5
  tonguesSeals: number;
  riddlesGiven: number;
  quote: { nickname: string; text: string } | null; // newest APPROVED attempt only
}

export interface Leader {
  nickname: string;
  floor: number; // 1–6, or 7 when finished
  score: number;
}

export const CLOSING_LINE =
  'Every defence you broke today is a real technique, and every one can be beaten.';

// Bestiary text, word for word from the prompt docs. Pronouns for "Nobody got past him."
const CARDS: Record<
  number,
  { name: string; technique: string; lesson: string; him: string; hes: string }
> = {
  1: {
    name: 'Grub: a plain system prompt.',
    technique: 'The only thing guarding the rune was one sentence asking him not to share it.',
    lesson: 'An instruction is a request, not a lock.',
    him: 'him',
    hes: "He's",
  },
  2: {
    name: 'Ser Vellum: strong instructions.',
    technique:
      "He obeyed his rules perfectly, and the rune leaked through everything the rules didn't name.",
    lesson: 'Models follow wording, not intent.',
    him: 'him',
    hes: "He's",
  },
  3: {
    name: 'Morwen & Snip: an output filter.',
    technique:
      "Snip checked every reply for the exact rune. Anything that wasn't the exact rune walked straight past him.",
    lesson: 'Keyword filters only stop what they were told to look for.',
    him: 'her',
    hes: "She's",
  },
  4: {
    name: 'Gorm & Mumble: an input guard.',
    technique:
      "A second AI read every message first and blocked anything that looked like an attack. It judged each message alone, so attacks that didn't look like attacks walked straight through.",
    lesson: 'A guard is only as good as what it can see.',
    him: 'them',
    hes: "They're",
  },
  5: {
    name: 'Queen Ashveil: defence in depth.',
    technique:
      "Two wards stopped almost everything: one heard the whole conversation, one checked every reply for the rune in any form. Neither was built to check the rune's meaning.",
    lesson: 'Layers make attacks harder, not impossible.',
    him: 'her',
    hes: "She's",
  },
};

export const TRICK_NAMES: Record<Technique, string> = {
  friendship: 'friendship',
  authority: 'claiming authority',
  persistence: 'asking again',
  pieces: 'asking for pieces',
  backwards: 'asking for it backwards',
  poem: 'asking for a poem',
  encoding: 'asking for a new shape',
  other_script: 'another script',
  story: 'a story or role-play',
  multi_step: 'a plan in small steps',
  taunt: 'a taunt',
  gift: 'a gift',
  instruction_injection: 'overriding the instructions',
  other: 'something else',
};

// One card per floor that anyone reached (Floors 1–5; Floor 6 waits for M9), then the closing card.
// `techniques`: false when the tagger couldn't finish; then no card mentions techniques.
export function buildCards(
  floors: FloorStats[],
  leaders: Leader[],
  techniques: boolean,
): RevealCard[] {
  const cards: RevealCard[] = floors
    .filter((f) => f.reached > 0 && CARDS[f.floor])
    .sort((a, b) => a.floor - b.floor)
    .map((f) => floorCard(f, techniques));
  return [...cards, closingCard(leaders)];
}

function floorCard(f: FloorStats, techniques: boolean): BestiaryCard {
  const text = CARDS[f.floor]!;
  return {
    kind: 'floor',
    floor: f.floor,
    name: text.name,
    technique: text.technique,
    lesson: text.lesson,
    tiles: [
      { label: plural(f.attempts, 'attempt').replace(/^\d+ /, ''), value: String(f.attempts) },
      { label: `of ${f.reached} got through`, value: `${f.cleared}/${f.reached}` },
      { label: 'median time to clear', value: f.clearMs.length ? clock(median(f.clearMs)) : '—' },
    ],
    details: details(f),
    howBeat: howBeat(f),
    topTrick: techniques ? topTrick(f.winningTags) : null,
    quote: f.quote,
  };
}

function details(f: FloorStats): Tile[] {
  const route = (r: LeakRoute, label: string): Tile => ({
    label,
    value: String(f.routes[r] ?? 0),
  });
  const other: Tile[] = f.routes.other ? [route('other', 'cleared another way')] : [];
  switch (f.floor) {
    case 2:
      return [
        route('poem', 'cleared with a poem'),
        route('backwards', 'cleared backwards'),
        route('letters', 'cleared letter by letter'),
        ...other,
      ];
    case 3:
      return [
        count(f.lettersSnipped, 'letter', 'snipped'),
        route('dashes', 'cleared with dashes'),
        route('other_script', 'cleared in another script'),
        route('word_per_letter', 'cleared one word per letter'),
        ...other,
      ];
    case 4:
      return [
        count(f.smashed, 'message', 'smashed'),
        count(f.passed, 'message', 'passed'),
        planTile(f.planLengths),
      ];
    case 5:
      return [
        { label: 'sealed by the Ward of Ears', value: String(f.earsSeals) },
        { label: 'sealed by the Ward of Tongues', value: String(f.tonguesSeals) },
        count(f.riddlesGiven, 'riddle', 'given'),
        count(f.routes.riddle ?? 0, 'riddle', 'solved'),
      ];
    default:
      return [];
  }
}

// "How you beat it": one sentence from fixed templates, filled with numbers.
export function howBeat(f: FloorStats): string {
  const { him, hes } = CARDS[f.floor]!;
  if (f.floor === 4 && f.cleared === 0) {
    return `Gorm smashed ${plural(f.smashed, 'message')}. Nobody got past them. They're still waiting.`;
  }
  if (f.cleared === 0) return `Nobody got past ${him}. ${hes} still waiting.`;

  const who =
    f.reached === 1
      ? `The only one of you who reached ${him}`
      : f.cleared === 1
        ? 'One of you'
        : `${f.cleared} of you`;
  const share = (k: number) => (f.cleared === 1 ? 'The only clear' : `${k} of ${f.cleared} clears`);
  const main = (routes: LeakRoute[]) => {
    const best = routes.map((r) => [r, f.routes[r] ?? 0] as const).sort((a, b) => b[1] - a[1])[0];
    return best && best[1] > 0 ? best : undefined;
  };

  switch (f.floor) {
    case 1:
      return `${who} got the rune out of him, and he never meant to say it.`;
    case 2: {
      const top = main(['poem', 'backwards', 'letters']);
      if (!top) return `${who} found words his oath didn't name.`;
      const how = { poem: 'a poem', backwards: 'the rune backwards', letters: 'single letters' };
      return `${share(top[1])} came from ${how[top[0] as 'poem']}: his oath never named it.`;
    }
    case 3: {
      const top = main(['dashes', 'other_script', 'word_per_letter']);
      if (!top) return `${who} slipped the rune past Snip.`;
      const how = {
        dashes: 'dashes between the letters',
        other_script: 'another script',
        word_per_letter: 'one word per letter',
      };
      return `${share(top[1])} used ${how[top[0] as 'dashes']}: a shape Snip was never told about.`;
    }
    case 4: {
      const plans = f.planLengths.length === 1 ? 'The winning plan' : 'The winning plans';
      const steps = f.planLengths.length
        ? ` ${plans} took ${plural(median(f.planLengths), 'message')}.`
        : '';
      return `Gorm smashed ${plural(f.smashed, 'message')}. ${f.passed} got through, each one innocent on its own.${steps}`;
    }
    case 5: {
      const seals = `The Ward of Ears sealed ${plural(f.earsSeals, 'message')} and the Ward of Tongues sealed ${plural(f.tonguesSeals, 'reply', 'replies')}.`;
      const around =
        (f.routes.riddle ?? 0) === f.cleared
          ? `${who} got through without breaking a ward: you went around them.`
          : `${who} got through anyway.`;
      return `${seals} ${around}`;
    }
    default:
      return `${who} got through.`;
  }
}

// The most common trick among winning messages ("other" doesn't count); ties go to the list order.
export function topTrick(tags: Technique[]): string | null {
  let best: Technique | null = null;
  let bestCount = 0;
  for (const t of Object.keys(TRICK_NAMES) as Technique[]) {
    const count = tags.filter((x) => x === t).length;
    if (t !== 'other' && count > bestCount) [best, bestCount] = [t, count];
  }
  return best && TRICK_NAMES[best];
}

function closingCard(leaders: Leader[]): ClosingCard {
  return {
    kind: 'closing',
    line: CLOSING_LINE,
    top: [...leaders]
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((l) => ({
        nickname: l.nickname,
        cleared: Math.min(l.floor - 1, 6), // the deepest floor CLEARED, never one not built yet
        title: titleFor(l.floor - 1),
      })),
  };
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function clock(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// A detail tile with the noun matching its number: "1 riddle given", "3 riddles given".
function count(n: number, one: string, verb: string): Tile {
  return { value: String(n), label: `${plural(n, one).replace(/^\d+ /, '')} ${verb}` };
}

// Floor 4: one plan's length, or the median of several ("—" before anyone clears).
function planTile(lengths: number[]): Tile {
  if (!lengths.length) return { value: '—', label: 'messages in a winning plan' };
  const n = median(lengths);
  const noun = n === 1 ? 'message' : 'messages';
  return {
    value: String(n),
    label: `${noun} in ${lengths.length === 1 ? 'the' : 'a'} winning plan`,
  };
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
