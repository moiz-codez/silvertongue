// Who is on the other end of a socket, for per-address limits.
// Behind the Cloudflare tunnel every socket arrives from cloudflared on this machine (loopback),
// and the visitor's real address is in the cf-connecting-ip header. Behind ngrok (`npm run serve
// -- --url`, TRUST_FORWARDED_FOR=true) it is the last X-Forwarded-For address instead: the one
// ngrok itself added, since a visitor can put fake addresses in front of it. Either header is only
// trusted from loopback (anyone else could simply make it up), and only the one for the mode.
interface Handshake {
  address: string;
  headers: Record<string, string | string[] | undefined>;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function forwardedIp(handshake: Handshake, trustForwardedFor: boolean): string | null {
  if (!LOOPBACK.has(handshake.address)) return null;
  // One header per mode: ngrok passes a visitor's own cf-connecting-ip through untouched.
  const header = handshake.headers[trustForwardedFor ? 'x-forwarded-for' : 'cf-connecting-ip'];
  if (typeof header !== 'string') return null;
  return header.split(',').at(-1)!.trim() || null;
}

export function clientIp(handshake: Handshake, trustForwardedFor = false): string {
  return forwardedIp(handshake, trustForwardedFor) ?? handshake.address;
}

// A browser on this laptop itself (not through the tunnel or ngrok).
export function isLocal(handshake: Handshake, trustForwardedFor = false): boolean {
  return LOOPBACK.has(handshake.address) && forwardedIp(handshake, trustForwardedFor) === null;
}

// At most `max` hits per key in any `windowMs`.
export function slidingLimit(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  function recent(key: string, now: number): number[] {
    const list = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
    if (list.length) hits.set(key, list);
    else hits.delete(key); // so the map doesn't grow forever
    return list;
  }
  return {
    full: (key: string, now = Date.now()) => recent(key, now).length >= max,
    add: (key: string, now = Date.now()) => void hits.set(key, [...recent(key, now), now]),
  };
}
