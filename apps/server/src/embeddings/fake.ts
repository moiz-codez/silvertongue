// For tests only: a stand-in for the MiniLM model that needs no download. Each word adds to one of
// 384 slots, so the same words give the same vector and different words differ. It knows nothing
// about meaning (a reworded gift looks new to it); the real model is checked by native-check and
// the Floor 6 playtest.
import { EMBED_DIMS, type Embed } from './embed.ts';

export const fakeEmbed: Embed = async (text) => {
  const v = new Float32Array(EMBED_DIMS);
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    let h = 0;
    for (const c of word) h = (h * 31 + c.charCodeAt(0)) % EMBED_DIMS;
    v[h]! += 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
};
