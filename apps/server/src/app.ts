// Builds the whole server (HTTP + sockets) without starting it, so tests can run a real one on a temp DB.
import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { Server } from 'socket.io';
import type { Env } from './config/env.ts';
import type { Db } from './db/db.ts';
import { getCurrentGame } from './db/queries.ts';
import type { Complete } from './llm/client.ts';
import { registerAdmin } from './sockets/admin.ts';
import { registerProjector } from './sockets/projector.ts';
import { registerPlayerHandlers, type GameContext, type PlayerServer } from './sockets/player.ts';

export async function createApp(env: Env, db: Db, complete: Complete, opts = { logger: true }) {
  const app = Fastify({ logger: opts.logger });

  app.get('/health', async () => ({ ok: true })); // no LLM mode here: it would tell players when Grub is a mock

  // After `npm run build`, the same process serves the web app (this is how production runs).
  const webDist = path.join(import.meta.dirname, '../../web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    // /projector and /admin are screens of the same single-page app.
    app.get('/projector', (_req, reply) => reply.sendFile('index.html'));
    app.get('/admin', (_req, reply) => reply.sendFile('index.html'));
  }

  const ctx: GameContext = {
    db,
    env,
    complete,
    game: getCurrentGame(db, Date.now()), // a restart picks up where the game was
    changed: () => {}, // the projector and admin screens hook in here
    logError: (err) => app.log.error(err),
  };
  const io: PlayerServer = new Server(app.server);
  const phones = registerPlayerHandlers(io, ctx);
  const projectorChanged = registerProjector(io, ctx);
  const adminChanged = registerAdmin(io, ctx, phones);
  ctx.changed = () => {
    projectorChanged();
    adminChanged();
  };

  return { app, io, ctx, phones };
}
