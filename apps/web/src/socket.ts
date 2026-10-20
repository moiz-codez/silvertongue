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
