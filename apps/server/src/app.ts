// Builds the whole server (HTTP + sockets) without starting it, so tests can run a real one on a temp DB.
import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { Server } from 'socket.io';
import { effectiveMode, type Env } from './config/env.ts';
import type { Db } from './db/db.ts';
import { getCurrentGame } from './db/queries.ts';
import { createLiveClient, type Complete } from './llm/client.ts';
import { createMockClient } from './llm/mock.ts';
import { createQueue } from './llm/queue.ts';
import { registerAdmin } from './sockets/admin.ts';
import { registerProjector } from './sockets/projector.ts';
import { registerPlayerHandlers, type GameContext, type PlayerServer } from './sockets/player.ts';

// `mock` is the client used in mock mode (tests pass a fake one). The live client is only
// created the first time the game is switched to live, and only if there is an API key.
export async function createApp(
  env: Env,
  db: Db,
  mock: Complete = createMockClient(),
  opts = { logger: true },
) {
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

  let live: Complete | undefined;
  const pickClient = (): Complete => {
    if (effectiveMode(ctx.game.llm_mode, env) === 'mock') return mock;
    return (live ??= createLiveClient(env.ANTHROPIC_API_KEY));
  };
  // Every call from every phone waits its turn here.
  const queue = createQueue(
    pickClient,
    { rpm: env.RATE_RPM, itpm: env.RATE_ITPM, otpm: env.RATE_OTPM },
    () => ctx.changed(),
  );

  const ctx: GameContext = {
    db,
    env,
    complete: queue.complete,
    queueStats: queue.stats,
    // A restart picks up where the game was, settings included. .env only seeds the first game.
    game: getCurrentGame(db, Date.now(), {
      cooldown_ms: env.COOLDOWN_MS,
      max_messages: env.MAX_MESSAGES_PER_PLAYER,
      llm_mode: env.LLM_MODE,
    }),
    changed: () => {}, // the projector and admin screens hook in here
    runCommand: () => ({ ok: false, error: 'Not ready yet.' }), // the admin module hooks in here
    logError: (err) => app.log.error(err),
  };
  const io: PlayerServer = new Server(app.server);
  const phones = registerPlayerHandlers(io, ctx);
  const projectorChanged = registerProjector(io, ctx);
  const admin = registerAdmin(io, ctx, phones);
  ctx.changed = () => {
    projectorChanged();
    admin.changed();
  };
  ctx.runCommand = admin.runCommand;

  // The health tiles show the last minute, so they need refreshing even when nothing happens.
  const healthTimer = setInterval(admin.changed, 5000);
  healthTimer.unref();
  app.addHook('onClose', async () => clearInterval(healthTimer));

  return { app, io, ctx, phones };
}
