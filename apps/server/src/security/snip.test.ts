import { describe, expect, it } from 'vitest';
import { snip } from './snip.ts';

const RUNE = 'EMBER-FANG';

describe('snip', () => {
  it('blacks out the three shapes he knows, in any capitalisation', () => {
    for (const shape of ['EMBER-FANG', 'ember fang', 'EmberFang']) {
      const result = snip(`It's ${shape}! Hehe.`, RUNE);
      expect(result).toEqual({
        text: `It's ${'█'.repeat(shape.length)}! Hehe.`,
        snipped: true,
        removed: 9,
      });
    }
  });

  it('counts every time the rune is said', () => {
    const result = snip('EMBER-FANG, I said EMBER-FANG!', RUNE);
    expect(result.removed).toBe(18);
    expect(result.text).not.toMatch(/ember|fang/i);
  });

  it('lets every other shape straight past', () => {
    for (const reply of [
      'E-M-B-E-R-F-A-N-G',
      'E M B E R F A N G',
      'Echo Mike Bravo Echo Romeo Foxtrot Alpha November Golf',
      'ایمبر فینگ',
      '5-13-2-5-18 6-1-14-7',
      'GNAF-REBME',
    ]) {
      expect(snip(reply, RUNE)).toEqual({ text: reply, snipped: false, removed: 0 });
    }
  });

  it('leaves a reply without the rune alone', () => {
    expect(snip('Gossip, potions or secrets, dearie?', RUNE)).toEqual({
      text: 'Gossip, potions or secrets, dearie?',
      snipped: false,
      removed: 0,
    });
  });
});
