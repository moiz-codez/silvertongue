// Snip, the crow on Morwen's shoulder (Floor 3). Exactly as in docs/prompts/03-morwen-snip.md.
// He is deliberately dumb: he knows the rune in three shapes, in any capitalisation: as written,
// with a space instead of the hyphen, and with no separator. Nothing else. That's the lesson.
export function snip(
  reply: string,
  rune: string,
): { text: string; snipped: boolean; removed: number } {
  const words = rune.split('-'); // "EMBER-FANG" → ["EMBER", "FANG"]
  const shapes = [words.join('-'), words.join(' '), words.join('')];
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(shapes.map(escape).join('|'), 'gi');

  let removed = 0;
  const text = reply.replace(pattern, (match) => {
    removed += match.replace(/[^a-z]/gi, '').length;
    return '█'.repeat(match.length);
  });

  return { text, snipped: removed > 0, removed };
}
