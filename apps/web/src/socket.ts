import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@silvertongue/shared/events';

// One connection for the whole phone app. Same origin: Vite proxies /socket.io in dev,
// Fastify serves both in production. Socket.IO reconnects by itself. It connects only when
// the phone screens mount, so the projector and admin pages don't open a phone socket.
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  autoConnect: false,
});

// The session token lives only on this phone. Storage can be blocked (private mode),
// so every access is wrapped: worst case the player just joins again.
const TOKEN_KEY = 'silvertongue-token';

export function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

// A kicked phone remembers it, so it can't simply join again under a new name.
// Clearing the browser gets round this; the server's per-address join limit slows that down.
// ponytail: expires after 3 hours (one class), since the phone can't tell a new game from the old one.
const KICKED_KEY = 'silvertongue-kicked-at';
const KICK_LASTS_MS = 3 * 60 * 60 * 1000;

export function wasKicked(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(KICKED_KEY) ?? 0) < KICK_LASTS_MS;
  } catch {
    return false;
  }
}

export function rememberKick(): void {
  try {
    localStorage.setItem(KICKED_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}
