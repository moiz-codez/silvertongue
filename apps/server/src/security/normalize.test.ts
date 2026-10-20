import { expect, it } from 'vitest';
import { normalize } from './normalize.ts';

it('keeps only uppercase A–Z', () => {
  expect(normalize('ember fang')).toBe('EMBERFANG');
  expect(normalize('Ember-Fang')).toBe('EMBERFANG');
  expect(normalize(' e.m.b.e.r  f-a-n-g! 42 ')).toBe('EMBERFANG');
  expect(normalize('')).toBe('');
});
