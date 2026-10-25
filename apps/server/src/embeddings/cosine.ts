// How alike two embeddings are: 1 = same meaning, near 0 = unrelated.
export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// The closest match in `others` (0 when there are none).
export function bestMatch(v: Float32Array, others: Float32Array[]): number {
  return others.reduce((best, o) => Math.max(best, cosine(v, o)), 0);
}

// Vectors are stored in SQLite as raw Float32 bytes.
export const toBlob = (v: Float32Array): Buffer =>
  Buffer.from(v.buffer, v.byteOffset, v.byteLength);
export const fromBlob = (b: Buffer): Float32Array =>
  new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
