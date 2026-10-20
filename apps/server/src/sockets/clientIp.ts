// Who is on the other end of a socket, for per-address limits.
// Behind the Cloudflare tunnel every socket arrives from cloudflared on this machine (loopback),
// and the visitor's real address is in the cf-connecting-ip header. That header is only trusted
// from loopback: anyone else could simply make it up.
interface Handshake {
  address: string;
  headers: Record<string, string | string[] | undefined>;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function forwardedIp(handshake: Handshake): string | null {
  const header = handshake.headers['cf-connecting-ip'];
  return LOOPBACK.has(handshake.address) && typeof header === 'string' && header !== ''
    ? header
    : null;
}

export function clientIp(handshake: Handshake): string {
  return forwardedIp(handshake) ?? handshake.address;
}

// A browser on this laptop itself (not through the tunnel).
export function isLocal(handshake: Handshake): boolean {
  return LOOPBACK.has(handshake.address) && forwardedIp(handshake) === null;
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
