import path from 'node:path';
import { createApp } from './app.ts';
import { effectiveMode, loadEnv } from './config/env.ts';
import { openDb } from './db/db.ts';

const env = loadEnv();
const repoRoot = path.join(import.meta.dirname, '../../..');
const db = openDb(path.resolve(repoRoot, env.DATABASE_PATH)); // relative to the repo, not the cwd

const { app, ctx } = await createApp(env, db);
// The game's own setting decides (.env only seeds the first game), so warn from that.
if (ctx.game.llm_mode === 'live' && effectiveMode('live', env) === 'mock')
  app.log.error(
    'This game is set to LIVE but there is no ANTHROPIC_API_KEY: running MOCK. Guardians leak runes on request!',
  );
else if (ctx.game.llm_mode === 'mock')
  app.log.warn(
    'Mock mode: guardians are fake and leak runes on request. Switch to Live on /admin for a real game.',
  );
await app.listen({ port: env.PORT, host: '0.0.0.0' });
