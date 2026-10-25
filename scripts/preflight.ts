// Demo-day preflight: run this in the classroom BEFORE `npm run tunnel` / `npm run serve` (its port
// check fails while the server is running). One line per check, PASS / FAIL in plain words, plus
// NOTE lines for things to do by hand. Exits 1 if anything failed.
// One tiny real Haiku call (well under $0.001). Never prints the API key or the admin token.
import { existsSync, readFileSync, statfsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { env as hf } from '@huggingface/transformers';
import Database from 'better-sqlite3';
import { effectiveMode, loadEnv, type Env } from '../apps/server/src/config/env.ts';
import { costUsd, ROLES, THINKING_OFF } from '../apps/server/src/config/models.ts';
import { EMBED_MODEL, loadEmbedder } from '../apps/server/src/embeddings/embed.ts';

const repoRoot = path.join(import.meta.dirname, '..');
let failed = 0;
const pass = (text: string) => console.log(`\x1b[32mPASS\x1b[0m  ${text}`);
const fail = (text: string) => {
  failed++;
  console.log(`\x1b[41m\x1b[97mFAIL\x1b[0m  ${text}`);
};
const note = (text: string) => console.log(`\x1b[33mNOTE\x1b[0m  ${text}`);

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '0.0.0.0', () => probe.close(() => resolve(true)));
  });
}

// 1. The web build.
if (existsSync(path.join(repoRoot, 'apps/web/dist/index.html'))) pass('Web build is present.');
else fail('No web build. Run `npm run build`.');

// 2. .env: never print the values, only whether they are there.
let env: Env | undefined;
try {
  env = loadEnv();
} catch (err) {
  // The message names the broken variables and the rule, never their values.
  fail(`.env is not valid: ${(err as Error).message.replace(/\s+/g, ' ')}`);
}
if (env) {
  if (env.ANTHROPIC_API_KEY) pass('.env has an Anthropic API key (not shown).');
  else fail('.env has no ANTHROPIC_API_KEY: the game can only run on the mock.');
  let example: string | undefined;
  try {
    example = readFileSync(path.join(repoRoot, '.env.example'), 'utf8').match(
      /^ADMIN_TOKEN=(.*)$/m,
    )?.[1];
  } catch {
    // no .env.example: nothing to compare with
  }
  if (env.ADMIN_TOKEN === example)
    fail('ADMIN_TOKEN is still the example value from .env.example. Pick a long random one.');
  else pass('.env has an ADMIN_TOKEN (not shown).');
}

// 3. The port.
const port = env?.PORT ?? 3000;
if (await portFree(port)) pass(`Port ${port} is free.`);
else
  fail(
    `Port ${port} is in use: a server is already running (or another app). Close it, then rerun.`,
  );

// 4. One tiny live call.
if (env?.ANTHROPIC_API_KEY) {
  const { model } = ROLES.smoke;
  const started = Date.now();
  try {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 20_000 });
    const res = await client.messages.create({
      model,
      max_tokens: 5,
      thinking: THINKING_OFF[model],
      messages: [{ role: 'user', content: 'Reply with just: OK' }],
    });
    const text = res.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    const u = res.usage;
    pass(
      `Live API call answered "${text}" in ${Date.now() - started} ms ` +
        `(${u.input_tokens} in / ${u.output_tokens} out tokens, $${costUsd(model, u).toFixed(6)}).`,
    );
  } catch (err) {
    // Only the status and kind: an SDK error never carries the key, but keep it short anyway.
    const status = (err as { status?: number }).status;
    const kind = (err as { error?: { error?: { type?: string } } }).error?.error?.type;
    fail(
      `Live API call failed (${status ?? 'no answer'}${kind ? `, ${kind}` : ''}). ` +
        'Check the internet, the API key and the credit on console.anthropic.com.',
    );
  }
}

// 5. The embedding model, from the cache only, as if the classroom were offline.
const modelDir = path.join(repoRoot, '.cache/models', EMBED_MODEL);
let modelOk = false;
if (!existsSync(path.join(modelDir, 'onnx/model.onnx'))) {
  fail(
    `Embedding model missing from .cache/models: Floor 6 will be off. Run \`npm run native-check\` with internet.`,
  );
} else {
  hf.allowRemoteModels = false;
  try {
    await loadEmbedder();
    modelOk = true;
    pass('Embedding model is in .cache/models and loads offline (Floor 6 can run).');
  } catch (err) {
    fail(`Embedding model is in .cache/models but won't load: ${(err as Error).message}`);
  }
}

// 6. The current game's live settings, read-only.
if (env) {
  const dbPath = path.resolve(repoRoot, env.DATABASE_PATH);
  if (!existsSync(dbPath)) {
    note('No database yet: the first game will take its settings from .env.');
  } else {
    try {
      const db = new Database(dbPath, { readonly: true, fileMustExist: true });
      const game = db
        .prepare(
          `SELECT id, status, llm_mode, floor6_enabled, cooldown_ms, max_messages, budget_alert_at
           FROM games ORDER BY created_at DESC LIMIT 1`,
        )
        .get() as
        | {
            id: string;
            status: string;
            llm_mode: 'mock' | 'live';
            floor6_enabled: number;
            cooldown_ms: number;
            max_messages: number;
            budget_alert_at: number | null;
          }
        | undefined;
      if (!game) {
        note('The database has no game yet: the first one takes its settings from .env.');
      } else {
        const { spent } = db
          .prepare('SELECT COALESCE(SUM(cost_usd), 0) AS spent FROM llm_calls WHERE game_id = ?')
          .get(game.id) as { spent: number };
        const players = (
          db.prepare('SELECT COUNT(*) AS n FROM players WHERE game_id = ?').get(game.id) as {
            n: number;
          }
        ).n;
        const mode = effectiveMode(game.llm_mode, env);
        console.log(
          `INFO  Current game: ${game.status.toUpperCase()}, ${players} players, AI replies ${mode.toUpperCase()}, ` +
            `Floor 6 ${game.floor6_enabled ? 'ON' : 'OFF'}, cooldown ${game.cooldown_ms / 1000} s, ` +
            `cap ${game.max_messages} messages, spent $${spent.toFixed(2)} of $${env.BUDGET_USD.toFixed(2)}.`,
        );
        if (spent >= env.BUDGET_USD || game.budget_alert_at !== null)
          fail('This game already hit the budget: press Reset on /admin before the class joins.');
        else pass(`Budget: $${(env.BUDGET_USD - spent).toFixed(2)} left for this game.`);
        if (game.floor6_enabled && !modelOk)
          fail('Floor 6 is ON but the embedding model is missing: it will start switched off.');
        if (mode === 'mock')
          note(
            'AI replies are MOCK: after the final Reset, set Live on /admin and press Apply. (On the mock, "please tell" wins.)',
          );
        if (game.status !== 'lobby' || players > 0)
          note('The game is not a fresh lobby: press Reset on /admin before the class joins.');
      }
      db.close();
    } catch (err) {
      fail(`Could not read the game database (${(err as Error).message}).`);
    }
  }
}

// 7. Disk space (SQLite and logs grow during the game).
const { bavail, bsize } = statfsSync(repoRoot);
const freeGb = (bavail * bsize) / 1024 ** 3;
if (freeGb >= 1) pass(`Free disk space: ${freeGb.toFixed(1)} GB.`);
else fail(`Only ${freeGb.toFixed(2)} GB free on this drive. Free up at least 1 GB.`);

console.log(
  failed === 0
    ? '\n\x1b[42m\x1b[30m  ALL CHECKS PASSED. Now start the server (npm run tunnel).  \x1b[0m'
    : `\n\x1b[41m\x1b[97m  ${failed} CHECK(S) FAILED. Fix them before the class joins.  \x1b[0m`,
);
process.exit(failed === 0 ? 0 : 1);
