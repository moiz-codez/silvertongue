import { describe, expect, it } from 'vitest';
import { isProfane } from './profanity.ts';

describe('isProfane', () => {
  it.each([
    'Assad',
    'Shitij',
    'Hassan',
    'Dickson',
    'Scunthorpe',
    'Cassandra',
    'Essex',
    'Titus',
    'Cocker',
    'Cumming',
    'Ali As',
    'NightOwl',
    'Bass Player',
    'Sexton',
  ])('allows %s', (name) => {
    expect(isProfane(name)).toBe(false);
  });

  it.each([
    'fuck',
    'FuCk',
    'fuuuuck',
    'f u c k',
    'f.u.c.k',
    'sh1t',
    '$hit',
    'BigDick',
    'dick_head',
    'dickhead',
    'a55hole',
    'Fuck You',
    'bitches',
    'motherfucker',
    'chutiya',
    'Bhenchod',
  ])('rejects %s', (name) => {
    expect(isProfane(name)).toBe(true);
  });
});
