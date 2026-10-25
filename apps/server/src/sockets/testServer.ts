// Shared by the socket tests: a real server on a random port with an in-memory database,
// in mock mode. No API calls. Everything opened here is closed after each test.
import type { AddressInfo } from 'node:net';
import { setTimeout as wait } from 'node:timers/promises';
import { afterEach, beforeAll } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@silvertongue/shared/events';
import { createApp } from '../app.ts';
import { parseEnv } from '../config/env.ts';
import { openDb } from '../db/db.ts';
import { saveGame } from '../db/queries.ts';
import { applyCommand, type GameCommand } from '../game/state.ts';
import type { Complete } from '../llm/client.ts';
import { fakeEmbed } from '../embeddings/fake.ts';
import { createMockClient } from '../llm/mock.ts';

export type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
export interface Seen {
  event: string;
  payload: unknown;
}
export const ADMIN_TOKEN = 'test-admin-token-123';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

// The first server in a test worker loads Fastify's and Socket.IO's lazy parts: ~0.3 s alone, over
// 2 s when several suites run at once. Pay it here, not inside the first test's 5 s.
beforeAll(async () => {
  const { app } = await createApp(
    parseEnv({ ADMIN_TOKEN }),
    openDb(':memory:'),
    createMockClient(),
    {
      logger: false,
    },
  );
  await app.listen({ port: 0, host: '127.0.0.1' });
  await app.close();
});

// Polls until `check` passes. The admin and projector screens are throttled to 2 updates a
// second, so wait for the state itself instead of sleeping a fixed time.
export async function until<T>(get: () => T | undefined, check: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const value = get();
    if (value !== undefined && check(value)) return value;
    await wait(20);
  }
  throw new Error('never happened');
}

// The game starts running unless `commands` says otherwise ([] = still in the lobby).
export async function startServer(
  vars: Record<string, string> = {},
  complete?: Complete,
  commands: GameCommand[] = ['start'],
) {
  const env = parseEnv({ ADMIN_TOKEN, COOLDOWN_MS: '0', ...vars });
  const db = openDb(':memory:');
  const { app, ctx, phones } = await createApp(
    env,
    db,
    complete ?? createMockClient({ minMs: 0, maxMs: 0 }),
    { logger: false, tagEveryMs: 0, embed: fakeEmbed }, // the reveal's catch-up still tags
  );
  for (const command of commands) {
    const moved = applyCommand(ctx.game, command, Date.now());
    if (!moved.ok) throw new Error(moved.error);
    ctx.game = moved.game;
    saveGame(db, ctx.game, Date.now());
  }
  await app.listen({ port: 0, host: '127.0.0.1' });
  cleanups.push(() => app.close());
  const { port } = app.server.address() as AddressInfo;
  return { db, ctx, phones, url: `http://127.0.0.1:${port}` };
}

// A socket on any namespace that records every event it receives.
// `viaTunnel`: pretend to come through cloudflared from this address (sets cf-connecting-ip).
export function open<S extends Socket>(
  url: string,
  auth?: Record<string, string>,
  via?: string | Record<string, string>, // a tunnel visitor's address, or raw headers (ngrok)
) {
  const extraHeaders = typeof via === 'string' ? { 'cf-connecting-ip': via } : via;
  const socket = connect(url, {
    transports: ['websocket'],
    forceNew: true,
    auth,
    extraHeaders,
  }) as S;
  const seen: Seen[] = [];
  socket.onAny((event: string, payload: unknown) => seen.push({ event, payload }));
  cleanups.push(() => void socket.close());
  return { socket, seen };
}

// A phone.
export const client = (url: string, via?: string | Record<string, string>) =>
  open<Client>(url, undefined, via);

// Resolves with the next `event` payload that matches.
export function next<E extends keyof ServerToClientEvents>(
  socket: Client,
  event: E,
  match: (payload: Parameters<ServerToClientEvents[E]>[0]) => boolean = () => true,
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve) => {
    const handler = (payload: Parameters<ServerToClientEvents[E]>[0]) => {
      if (!match(payload)) return;
      socket.off(event, handler as never);
      resolve(payload);
    };
    socket.on(event, handler as never);
  });
}

export async function join(socket: Client, nickname: string) {
  return socket.emitWithAck('player:join', { nickname });
}
