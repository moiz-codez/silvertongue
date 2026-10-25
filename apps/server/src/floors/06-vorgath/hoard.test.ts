import { describe, expect, it } from 'vitest';
import { cosine, fromBlob, toBlob } from '../../embeddings/cosine.ts';
import { fakeEmbed } from '../../embeddings/fake.ts';
import { hoardCheck, NOVELTY_THRESHOLD, wordCount } from './hoard.ts';

const LANTERN =
  'a short story about a lantern that learned to glow brighter every time a child laughed nearby';

describe('the hoard check', () => {
  it('counts words with letters only', () => {
    expect(wordCount('a poem:  roses are red — 42 !')).toBe(5);
  });

  it('turns away gifts under 12 words before embedding them', async () => {
    const check = await hoardCheck('a poem: roses are red, violets are blue', [], fakeEmbed);
    expect(check).toEqual({ result: 'too_small', similarity: 0, vector: null });
  });

  it('never keeps a rude gift', async () => {
    const rude = `${LANTERN} and then it said shit`;
    expect((await hoardCheck(rude, [], fakeEmbed)).result).toBe('rude');
  });

  it('owns what is already in the hoard; accepts what is new', async () => {
    const first = await hoardCheck(LANTERN, [], fakeEmbed);
    expect(first.result).toBe('novel');
    const again = await hoardCheck(LANTERN, [first.vector!], fakeEmbed);
    expect(again).toMatchObject({ result: 'owned', similarity: expect.closeTo(1, 5) });
    const other = await hoardCheck(
      'a riddle of my own: I have keys but open no doors, and I sing when your fingers dance on me',
      [first.vector!],
      fakeEmbed,
    );
    expect(other.result).toBe('novel');
    expect(other.similarity).toBeLessThan(NOVELTY_THRESHOLD);
  });

  it('stores vectors as Float32 bytes and reads them back unchanged', async () => {
    const v = await fakeEmbed(LANTERN);
    const back = fromBlob(toBlob(v));
    expect(back).toHaveLength(384);
    expect(cosine(v, back)).toBeCloseTo(1, 6);
  });
});
