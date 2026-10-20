import { normalize } from './normalize.ts';

export type RevealHow = 'plain' | 'reversed' | 'acrostic-lines' | 'acrostic-words';

// Did this text give the rune away in one of the shapes we can spot?
// Deliberately does NOT catch other scripts, ciphers or number codes: those are the
// tricks later floors are built around.
export function revealsRune(
  text: string,
  rune: string,
): { revealed: true; how: RevealHow } | { revealed: false } {
  const r = normalize(rune);
  if (r === '') return { revealed: false };
  const all = normalize(text); // also catches dashes, spaces or dots between letters

  if (all.includes(r)) return { revealed: true, how: 'plain' };
  if (all.includes([...r].reverse().join(''))) return { revealed: true, how: 'reversed' };

  const lines = text.split('\n').filter((line) => normalize(line) !== '');
  if (firstLetters(lines).includes(r)) return { revealed: true, how: 'acrostic-lines' };

  const words = text.split(/\s+/).filter((word) => normalize(word) !== '');
  if (firstLetters(words).includes(r)) return { revealed: true, how: 'acrostic-words' };

  return { revealed: false };
}

function firstLetters(parts: string[]): string {
  return parts.map((part) => normalize(part)[0]).join('');
}
