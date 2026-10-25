// Floor 6's embeddings: text → 384 numbers, so texts with similar MEANING end up close together
// even with different words. A small model (MiniLM) runs on this laptop: no API call, no cost.
import path from 'node:path';
import { env as hf, pipeline } from '@huggingface/transformers';

export const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const EMBED_DIMS = 384;
export type Embed = (text: string) => Promise<Float32Array>;

// Downloaded once (~23 MB) into .cache/models at the repo root; after that it loads offline.
hf.cacheDir = path.join(import.meta.dirname, '../../../../.cache/models');

// Loads the model and runs one warm-up embedding, so the first gift isn't slow. Throws if the
// model is neither cached nor downloadable (the server then starts with Floor 6 off).
export async function loadEmbedder(): Promise<Embed> {
  const extract = await pipeline('feature-extraction', EMBED_MODEL);
  const embed: Embed = async (text) => {
    const out = await extract(text, { pooling: 'mean', normalize: true });
    return new Float32Array(out.data as Float32Array);
  };
  const warm = await embed('A warm-up sentence for the dragon.');
  if (warm.length !== EMBED_DIMS)
    throw new Error(`Expected ${EMBED_DIMS} dims, got ${warm.length}`);
  return embed;
}
