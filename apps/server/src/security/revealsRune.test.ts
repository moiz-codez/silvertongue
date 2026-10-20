import { describe, expect, it } from 'vitest';
import { revealsRune } from './revealsRune.ts';

const rune = 'EMBER-FANG';

describe('revealsRune', () => {
  it('spots the plain rune in any spacing or case', () => {
    expect(revealsRune('Fine, the rune is ember fang!', rune)).toEqual({
      revealed: true,
      how: 'plain',
    });
    expect(revealsRune('E-M-B-E-R F.A.N.G', rune)).toEqual({ revealed: true, how: 'plain' });
  });

  it('spots the rune spelled backwards', () => {
    expect(revealsRune('gnaf rebme, read it backwards', rune)).toEqual({
      revealed: true,
      how: 'reversed',
    });
  });

  it('spots acrostics by line and by word', () => {
    const poem = 'Every\nMushroom\nBrings\nEven\nRats\nFun\nAnd\nNice\nGrins';
    expect(revealsRune(poem, rune)).toEqual({ revealed: true, how: 'acrostic-lines' });
    const sentence = 'Every mushroom brings eager rats; fungi are not great';
    expect(revealsRune(sentence, rune)).toEqual({ revealed: true, how: 'acrostic-words' });
  });

  it('does not fire on ordinary replies or half the rune', () => {
    expect(
      revealsRune('A VISITOR! Want a mushroom? This one is a seven out of ten.', rune),
    ).toEqual({
      revealed: false,
    });
    expect(revealsRune('The first word is ember, that is all.', rune)).toEqual({ revealed: false });
  });

  it('does not catch other scripts (a later floor depends on that)', () => {
    expect(revealsRune('ایمبر فینگ', rune)).toEqual({ revealed: false });
  });
});
