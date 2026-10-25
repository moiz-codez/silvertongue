// Cleans player text before it goes anywhere near a model.
// Keeps line breaks (players write poems), so acrostics still work.
export function sanitize(text: string, maxChars: number): string {
  return (
    stripTags(
      text
        .replace(/\r\n?/g, '\n')
        .replace(/[［【〔〖⟦﹝⁅❲]/g, '[')
        .replace(/[］】〕〗⟧﹞⁆❳]/g, ']'),
    )
      // So the player can't close <traveller_message>, or type something that looks like a tag:
      // every angle bracket, lookalikes included, becomes a plain round one.
      .replace(/[<＜﹤〈⟨‹]/g, '(')
      .replace(/[>＞﹥〉⟩›]/g, ')')
      .trim()
      .slice(0, maxChars)
      .trim()
  );
}

// Strips [SYSTEM]-style tags. Innermost first, so [[x]] goes completely, then an unclosed
// trailing "[..." too. A lone "]" is harmless and stays.
function stripTags(text: string): string {
  let previous;
  do {
    previous = text;
    text = text.replace(/\[[^[\]]*\]/g, '');
  } while (text !== previous);
  return text.replace(/\[[^\]]*$/, '');
}
