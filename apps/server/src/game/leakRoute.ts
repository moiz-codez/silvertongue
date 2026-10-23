// How a floor was cleared, worked out by code from what the server already logged: the text each
// guardian reply showed the player (after every filter). Only the route label and two message ids
// are stored; never the rune or the guess. The reveal turns these into "3 of 4 clears were poems".
import { normalize } from '../security/normalize.ts';
import { revealsRune } from '../security/revealsRune.ts';
import { cluesFor } from './runeClues.ts';

export type LeakRoute =
  | 'slip' // Floor 1: Grub said it
  | 'letters' // Floor 2: one letter at a time
  | 'backwards'
  | 'poem'
  | 'dashes' // Floor 3: a shape Snip doesn't know (spaced, dashed, dotted)
  | 'word_per_letter'
  | 'other_script'
  | 'plan' // Floor 4: Mumble said it after Gorm passed every message
  | 'riddle' // Floor 5: the Queen's riddle got past both Wards
  | 'other'; // anything code can't see (a guess, numbers, a riddle on Floor 2…)

export interface LoggedMessage {
  id: number;
  speaker: string;
  text: string; // what the player saw
  verdict: string | null;
}

export interface Clear {
  route: LeakRoute;
  winningMessageId: number | null; // the player message just before the leak (else the last one)
  leakMessageId: number | null;
}

// `messages`: this player's messages on this floor, oldest first.
export function leakRoute(floor: number, messages: LoggedMessage[], rune: string): Clear {
  const replies = messages.filter((m) => m.speaker === 'guardian');
  let route: LeakRoute = 'other';
  let leak: LoggedMessage | undefined;
  for (const reply of replies) {
    const found = routeOf(floor, reply, rune);
    if (found) {
      route = found;
      leak = reply;
      break;
    }
  }
  if (!leak && floor === 2 && givesLetters(replies, rune)) route = 'letters';

  const players = messages.filter((m) => m.speaker === 'player');
  const winning = leak ? players.filter((m) => m.id < leak.id).at(-1) : players.at(-1);
  return { route, winningMessageId: winning?.id ?? null, leakMessageId: leak?.id ?? null };
}

function routeOf(floor: number, reply: LoggedMessage, rune: string): LeakRoute | undefined {
  const shown = revealsRune(reply.text, rune);
  switch (floor) {
    case 1:
      return shown.revealed ? 'slip' : undefined;
    case 2:
      if (!shown.revealed) return undefined;
      if (shown.how === 'reversed') return 'backwards';
      return shown.how === 'plain' ? 'other' : 'poem';
    case 3: {
      // Snip already cut the shapes he knows, so a rune still visible here walked past him.
      if (shown.revealed && shown.how === 'plain') return 'dashes';
      if (shown.revealed && shown.how === 'acrostic-words') return 'word_per_letter';
      if (shown.revealed) return 'other';
      const snipped = reply.text.includes('█');
      return !snipped && otherScriptLetters(reply.text) >= 3 ? 'other_script' : undefined;
    }
    case 4:
      return shown.revealed ? 'plan' : undefined;
    case 5:
      return reply.verdict === 'CLEAN' && cluesFor(rune).some((c) => hasClue(reply.text, c))
        ? 'riddle'
        : undefined;
    default:
      return undefined;
  }
}

// Letters in any script but Latin (Urdu, Hindi, Greek…). ponytail: a heuristic, it can't tell a
// rune in Urdu letters from Morwen simply chatting in Urdu.
function otherScriptLetters(text: string): number {
  return (text.match(/(?![\p{Script=Latin}])\p{L}/gu) ?? []).length;
}

// Floor 2 letters: no reply gave the whole rune, but lone capitals ("It is O.", "Woh D hai")
// covered at least half its letters. A and I are left out: they are ordinary words too.
function givesLetters(replies: LoggedMessage[], rune: string): boolean {
  const letters = new Set([...normalize(rune)].filter((l) => l !== 'A' && l !== 'I'));
  const given = new Set<string>();
  for (const reply of replies) {
    for (const [, letter] of reply.text.matchAll(/\b([A-Z])\b/g)) {
      if (letters.has(letter!)) given.add(letter!);
    }
  }
  return letters.size > 0 && given.size * 2 >= letters.size;
}

// The clue word for word, or most of its longer words (the Queen sometimes rephrases a little).
function hasClue(text: string, clue: string): boolean {
  const words = (s: string) => s.toLowerCase().match(/[a-z]+/g) ?? [];
  if (words(text).join(' ').includes(words(clue).join(' '))) return true;
  const said = new Set(words(text));
  const key = words(clue).filter((w) => w.length >= 4);
  return key.length > 0 && key.filter((w) => said.has(w)).length / key.length >= 0.6;
}
