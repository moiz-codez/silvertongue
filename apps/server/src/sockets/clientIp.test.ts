import { expect, it } from 'vitest';
import { clientIp, isLocal, slidingLimit } from './clientIp.ts';

const via = (address: string, cf?: string) => ({
  address,
  headers: cf === undefined ? {} : { 'cf-connecting-ip': cf },
});

it('uses cf-connecting-ip only when the socket comes from cloudflared on this machine', () => {
  expect(clientIp(via('127.0.0.1', '203.0.113.7'))).toBe('203.0.113.7');
  expect(clientIp(via('::ffff:127.0.0.1', '203.0.113.7'))).toBe('203.0.113.7');
  expect(clientIp(via('192.168.1.20', '203.0.113.7'))).toBe('192.168.1.20'); // made up: ignored
  expect(clientIp(via('127.0.0.1'))).toBe('127.0.0.1');
});

it('counts only a loopback socket without the header as local', () => {
  expect(isLocal(via('127.0.0.1'))).toBe(true);
  expect(isLocal(via('::1'))).toBe(true);
  expect(isLocal(via('127.0.0.1', '203.0.113.7'))).toBe(false); // through the tunnel
  expect(isLocal(via('192.168.1.20'))).toBe(false);
});

it('allows at most max hits per key in the window', () => {
  const limit = slidingLimit(2, 60_000);
  limit.add('a', 0);
  limit.add('a', 10_000);
  expect(limit.full('a', 20_000)).toBe(true);
  expect(limit.full('b', 20_000)).toBe(false);
  expect(limit.full('a', 60_001)).toBe(false); // the first hit has aged out
});
