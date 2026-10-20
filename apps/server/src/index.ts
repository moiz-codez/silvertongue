import path from 'node:path';
import { createApp } from './app.ts';
import { loadEnv } from './config/env.ts';
import { openDb } from './db/db.ts';

const env = loadEnv();
const repoRoot = path.join(import.meta.dirname, '../../..');
const db = openDb(path.resolve(repoRoot, env.DATABASE_PATH)); // relative to the repo, not the cwd

const { app } = await createApp(env, db);
if (env.LLM_MODE === 'mock')
  app.log.warn(
    'LLM_MODE=mock: guardians are fake and leak runes on request. Use LLM_MODE=live for a real game.',
  );
await app.listen({ port: env.PORT, host: '0.0.0.0' });
