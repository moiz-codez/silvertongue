import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { throttle } from './throttle.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('runs at most twice a second however many requests arrive', () => {
  const fn = vi.fn();
  const request = throttle(fn, 500);

  for (let t = 0; t < 1000; t += 10) {
    request(); // 100 requests in one second
    vi.advanceTimersByTime(10);
  }
  vi.advanceTimersByTime(500);
  expect(fn.mock.calls.length).toBeLessThanOrEqual(3); // 0 ms, 500 ms, then the trailing one
  expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2);
});

it('always runs after the latest request', () => {
  const fn = vi.fn();
  const request = throttle(fn, 500);
  request();
  vi.advanceTimersByTime(1);
  expect(fn).toHaveBeenCalledTimes(1);

  request(); // arrives during the quiet period (t = 1): must still go out, at t = 500
  vi.advanceTimersByTime(498);
  expect(fn).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);
  expect(fn).toHaveBeenCalledTimes(2);
});
