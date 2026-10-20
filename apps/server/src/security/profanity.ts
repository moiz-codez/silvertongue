import { BAD_WORDS, JOINED_FORMS, SUFFIXES } from './profanityWords.ts';

// Common look-alike characters: "sh1t", "$hit", "@ss".
const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
  '!': 'i',
};

// "fuck" becomes /^f+u+c+k+$/: repeated letters still match ("fuuuck"), but we never
// collapse the NAME's letters, so "as" can't turn into a match for "ass".
const stretchy = (word: string) => [...word].map((c) => `${c}+`).join('');
const suffixes = SUFFIXES.map(stretchy).join('|');
const PATTERNS = [
  ...BAD_WORDS.map((w) => new RegExp(`^${stretchy(w)}(?:${suffixes})?$`)),
  ...JOINED_FORMS.map((w) => new RegExp(`^${stretchy(w)}$`)),
];

// True when any word of the name is on the list. Words are checked whole, never as substrings.
export function isProfane(name: string): boolean {
  const mapped = [...name].map((c) => LEET[c] ?? c).join('');
  const words = mapped.split(/[^A-Za-z]+/).filter(Boolean);
  const candidates = [
    ...words,
    ...words.flatMap((w) => w.split(/(?<=[a-z])(?=[A-Z])/)), // camelCase: "BigDick" → Big, Dick
    words.join(''), // spaced out: "f u c k", "f.u.c.k"
  ];
  return candidates.some((c) => PATTERNS.some((p) => p.test(c.toLowerCase())));
}
