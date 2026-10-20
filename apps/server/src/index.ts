import path from 'node:path';
import { createApp } from './app.ts';
import { loadEnv } from './config/env.ts';
import { openDb } from './db/db.ts';
import { createLlm } from './llm/client.ts';

const env = loadEnv();
const repoRoot = path.join(import.meta.dirname, '../../..');
const db = openDb(path.resolve(repoRoot, env.DATABASE_PATH)); // relative to the repo, not the cwd

const { app } = await createApp(env, db, createLlm(env));
await app.listen({ port: env.PORT, host: '0.0.0.0' });
