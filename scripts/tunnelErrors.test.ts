import { describe, expect, it } from 'vitest';
import { diagnose, findTunnelUrl, isErrorLine } from './tunnelErrors.ts';

// Real cloudflared 2026.9.3 lines.
const REQUESTING = '2026-10-22T16:59:42Z INF Requesting new quick Tunnel on trycloudflare.com...';
const TIMEOUT =
  'failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": context deadline exceeded (Client.Timeout exceeded while awaiting headers)';

describe('reading cloudflared output', () => {
  it('finds the address in the box cloudflared prints', () => {
    const box = '2026-10-22T17:05:01Z INF |  https://brave-otter-lamp-sky.trycloudflare.com  |';
    expect(findTunnelUrl(box)).toBe('https://brave-otter-lamp-sky.trycloudflare.com');
    expect(findTunnelUrl(REQUESTING)).toBeUndefined();
    expect(findTunnelUrl(TIMEOUT)).toBeUndefined(); // api.trycloudflare.com/tunnel is not an address
  });

  it('treats ERR, FTL and untagged lines as errors, but not INF or WRN', () => {
    expect(isErrorLine(TIMEOUT)).toBe(true);
    expect(isErrorLine('2026-10-22T17:00:00Z ERR Unable to reach the origin service')).toBe(true);
    expect(isErrorLine('2026-10-22T17:00:00Z FTL failed to start')).toBe(true);
    expect(isErrorLine(REQUESTING)).toBe(false);
    expect(
      isErrorLine('2026-10-22T17:00:00Z WRN Cannot determine default origin certificate'),
    ).toBe(false);
    expect(isErrorLine('   ')).toBe(false);
  });
});

describe('why the tunnel would not start', () => {
  it('a slow quick-tunnel service: retry', () => {
    expect(diagnose([TIMEOUT])).toMatchObject({
      retry: true,
      reason: expect.stringContaining("didn't answer in time"),
    });
  });

  it('a 429 rate limit: no retry, wait 15-30 minutes', () => {
    const d = diagnose(['failed to unmarshal quick Tunnel: status 429 Too Many Requests']);
    expect(d.retry).toBe(false);
    expect(d.hint).toContain('15-30 minutes');
  });

  it('a config file in ~/.cloudflared: no retry, rename it', () => {
    const d = diagnose([
      '2026-10-22T17:00:00Z ERR Cannot use quick tunnel: found config file at C:\\Users\\x\\.cloudflared\\config.yml',
    ]);
    expect(d.retry).toBe(false);
    expect(d.hint).toContain('~/.cloudflared');
  });

  it('a DNS or dial error: try a phone hotspot', () => {
    for (const line of [
      'failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": dial tcp: lookup api.trycloudflare.com: no such host',
      'failed to request quick Tunnel: dial tcp 104.16.230.132:443: i/o timeout',
    ]) {
      const d = diagnose([line]);
      expect(d.retry).toBe(true);
      expect(d.hint).toContain('phone hotspot');
    }
  });

  it('anything else: points at the lines above', () => {
    expect(diagnose(['something new went wrong']).hint).toContain('lines above');
    expect(diagnose([]).retry).toBe(true);
  });
});
