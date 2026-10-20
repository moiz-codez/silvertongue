// Builds the whole server (HTTP + sockets) without starting it, so tests can run a real one on a temp DB.
import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@silvertongue/shared/events';
import type { Env } from './config/env.ts';
import type { Db } from './db/db.ts';
import { getCurrentGame } from './db/queries.ts';
import type { Complete } from './llm/client.ts';
import { registerPlayerHandlers } from './sockets/player.ts';

export async function createApp(env: Env, db: Db, complete: Complete, opts = { logger: true }) {
  const app = Fastify({ logger: opts.logger });
  const gameId = getCurrentGame(db, Date.now()).id;

  app.get('/health', async () => ({ ok: true })); // no LLM mode here: it would tell players when Grub is a mock

  // After `npm run build`, the same process serves the web app (this is how production runs).
  const webDist = path.join(import.meta.dirname, '../../web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
  }

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(app.server);
  registerPlayerHandlers(io, { db, env, complete, gameId, logError: (err) => app.log.error(err) });

  return { app, io, gameId };
}
