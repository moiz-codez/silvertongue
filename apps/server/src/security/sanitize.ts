// Cleans player text before it goes anywhere near a model.
// Keeps line breaks (players write poems), so acrostics still work.
export function sanitize(text: string, maxChars: number): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\[[^\]]*\]/g, '') // strip [SYSTEM]-style tags
    .replace(/</g, '‹') // so the player can't close <traveller_message>
    .replace(/>/g, '›')
    .trim()
    .slice(0, maxChars)
    .trim();
}
