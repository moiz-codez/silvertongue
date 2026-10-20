// Builds the whole server (HTTP + sockets) without starting it, so tests can run a real one on a temp DB.
import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@silvertongue/shared/events';
import { echoPayload } from '@silvertongue/shared/schemas';
import type { Env } from './config/env.ts';
import type { Db } from './db/db.ts';
import { getOrCreateRunningGame } from './db/queries.ts';
import type { Complete } from './llm/client.ts';
import { registerPlayerHandlers } from './sockets/player.ts';

export async function createApp(env: Env, db: Db, complete: Complete, opts = { logger: true }) {
  const app = Fastify({ logger: opts.logger });
  const gameId = getOrCreateRunningGame(db, Date.now()); // M1: one running game; M2 adds lobby/admin

  app.get('/health', async () => ({ ok: true, llmMode: env.LLM_MODE }));

  // After `npm run build`, the same process serves the web app (this is how production runs).
  const webDist = path.join(import.meta.dirname, '../../web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
  }

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(app.server);
  registerPlayerHandlers(io, { db, env, complete, gameId, logError: (err) => app.log.error(err) });

  // M0 hello-page echo; removed with the real phone screens.
  io.on('connection', (socket) => {
    socket.on('echo', (payload, ack) => {
      const parsed = echoPayload.safeParse(payload);
      if (!parsed.success || typeof ack !== 'function') return;
      ack({ text: parsed.data.text });
    });
  });

  return { app, io, gameId };
}
