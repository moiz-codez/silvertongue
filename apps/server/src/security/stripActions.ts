import { revealsRune } from './revealsRune.ts';

const MAX_ACTION_WORDS = 8;

// Removes short *stage directions* from a guardian reply, e.g. "*chomps mushroom*".
// Runs before every leak check (revealsRune now, Snip and the judges on later floors), so it must
// never hide a leak: a segment that holds the rune keeps its words, and if stripping would make a
// revealing reply stop revealing (a rune split across segments, an acrostic), nothing is removed.
export function stripActions(text: string, rune: string): string {
  const keepWords = tidy(text.replace(/\*/g, ''));

  const stripped = tidy(
    text.replace(/\*([^*\n]+)\*/g, (_whole, inner: string) => {
      if (revealsRune(inner, rune).revealed) return inner;
      return inner.trim().split(/\s+/).length <= MAX_ACTION_WORDS ? '' : inner;
    }),
  );

  if (stripped === '') return keepWords; // the whole reply was an action: show it as words
  if (revealsRune(text, rune).revealed && !revealsRune(stripped, rune).revealed) return keepWords;
  return stripped;
}

// The same rule for the max_tokens trim in llm/client.ts, which can't check runes itself:
// if trimming cut the rune away, send the whole cut-off reply, marked as trailing off.
export function guardTrim(full: string, trimmed: string, rune: string): string {
  if (revealsRune(full, rune).revealed && !revealsRune(trimmed, rune).revealed) {
    return `${full.trim()}…`;
  }
  return trimmed;
}

// Squeezes the gaps a removed action leaves behind, line by line (newlines matter for acrostics).
function tidy(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/ +([.,!?…])/g, '$1')
        .trim(),
    )
    .join('\n')
    .trim();
}
