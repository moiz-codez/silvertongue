import { expect, it } from 'vitest';
import { costUsd } from './models.ts';

it('prices every kind of token', () => {
  const cost = costUsd('claude-haiku-5-5', {
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    cache_creation_input_tokens: 1_000_000,
    cache_read_input_tokens: null,
  });
  expect(cost).toBeCloseTo(0.1 + 0.5 + 0.125);
});
