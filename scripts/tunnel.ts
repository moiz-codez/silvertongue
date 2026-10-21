// Demo-day launcher: opens a Cloudflare quick tunnel to this laptop, then starts the production
// server with PUBLIC_URL set to the tunnel's address, so the projector QR always points at it.
// If the game server crashes, only the server restarts: the tunnel (and its address) stays, and
// phones reconnect and resume by themselves. Run `npm run build` first. Ctrl+C stops both.
// Steps: docs/DEPLOY_LAPTOP.md.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../apps/server/src/config/env.ts';

const CHECK_EVERY_MS = 15_000;
const RESTART_DELAY_MS = 2000;
const MAX_RESTARTS = 5; // within RESTART_WINDOW_MS; one more crash than that and we give up
const RESTART_WINDOW_MS = 60_000;
const repoRoot = path.join(import.meta.dirname, '..');
const env = loadEnv(); // fails here, before the tunnel opens, if .env is incomplete

function shout(lines: string[]) {
  const bar = '!'.repeat(64);
  console.error(
    `\n\x1b[41m\x1b[97m${bar}\n${lines.map((l) => `  ${l}`).join('\n')}\n${bar}\x1b[0m\n`,
  );
}

function banner(lines: string[]) {
  const bar = '='.repeat(64);
  console.log(
    `\n\x1b[42m\x1b[30m${bar}\n${lines.map((l) => `  ${l}`).join('\n')}\n${bar}\x1b[0m\n`,
  );
}

if (!existsSync(path.join(repoRoot, 'apps/web/dist/index.html'))) {
  shout(['No web build found. Run `npm run build` first, then `npm run tunnel`.']);
  process.exit(1);
}

let server: ChildProcess | undefined;
let stopping = false;
let restartTimer: ReturnType<typeof setTimeout> | undefined;
let restarts: number[] = []; // when the server was restarted, for the "keeps crashing" check
let quietUntil = 0; // while the server restarts, cloudflared's "can't reach it" errors are expected

function stopAll(code: number) {
  stopping = true;
  clearTimeout(restartTimer);
  tunnel.kill();
  server?.kill();
  process.exit(code);
}

// --no-autoupdate: never swap the binary in the middle of the demo.
const tunnel = spawn('cloudflared', [
  'tunnel',
  '--no-autoupdate',
  '--url',
  `http://127.0.0.1:${env.PORT}`,
]);
tunnel.on('error', (err) => {
  shout([
    `Could not start cloudflared: ${err.message}`,
    'Is it installed and on PATH? See docs/DEPLOY_LAPTOP.md.',
  ]);
  stopAll(1);
});
tunnel.on('exit', (code) => {
  if (stopping) return;
  shout([
    `THE TUNNEL DIED (cloudflared exited with code ${code}).`,
    'Phones can no longer reach the game.',
    'Run `npm run tunnel` again. It gives a NEW address: everyone re-scans the QR and joins again.',
  ]);
  stopAll(1);
});

// cloudflared logs to stderr. The address shows up once; errors are echoed so they're not missed.
let publicUrl = '';
tunnel.stderr.setEncoding('utf8');
tunnel.stderr.on('data', (chunk: string) => {
  if (!publicUrl) {
    const match = chunk.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match) {
      publicUrl = match[0];
      startServer();
      void watchTunnel();
    }
  }
  for (const line of chunk.split('\n')) {
    if (!/\bERR\b/.test(line)) continue;
    // During a restart these flood in from every reconnecting phone and would bury the banner.
    if (Date.now() < quietUntil && /Unable to reach the origin/.test(line)) continue;
    console.error(`[tunnel] ${line}`);
  }
});

function startServer() {
  server = spawn(process.execPath, [path.join(repoRoot, 'apps/server/src/index.ts')], {
    stdio: 'inherit',
    env: { ...process.env, PUBLIC_URL: publicUrl }, // a set variable wins over .env
  });
  server.on('exit', (code) => {
    if (stopping) return;
    const now = Date.now();
    restarts = restarts.filter((t) => t > now - RESTART_WINDOW_MS);
    if (restarts.length >= MAX_RESTARTS) {
      shout([
        `THE SERVER KEEPS CRASHING (${MAX_RESTARTS} restarts in a minute). Giving up.`,
        'Check the error in the log above, fix it, then run `npm run tunnel` again.',
      ]);
      stopAll(1);
      return;
    }
    restarts.push(now);
    quietUntil = now + RESTART_DELAY_MS + 10_000;
    shout([
      `THE SERVER CRASHED (exit code ${code}). Restarting in ${RESTART_DELAY_MS / 1000} s.`,
      `Same address: ${publicUrl}`,
      'Phones reconnect and carry on by themselves.',
    ]);
    restartTimer = setTimeout(startServer, RESTART_DELAY_MS);
  });
}

// Checks /health through the tunnel, the same way a phone reaches it.
async function reachable(): Promise<boolean> {
  try {
    const res = await fetch(`${publicUrl}/health`, { signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function watchTunnel() {
  while (!(await reachable())) await new Promise((r) => setTimeout(r, 2000));
  banner([
    `READY: ${publicUrl}`,
    `On this laptop (keeps working if the tunnel drops):`,
    `  Projector: http://localhost:${env.PORT}/projector`,
    `  Admin:     http://localhost:${env.PORT}/admin`,
    `From another device: ${publicUrl}/admin`,
    'Check it from a phone on mobile data before the class joins.',
  ]);
  let failures = 0;
  setInterval(async () => {
    if (await reachable()) {
      if (failures >= 2) banner([`The game is answering again: ${publicUrl}`]);
      failures = 0;
    } else if (++failures === 2) {
      shout([
        'THE GAME IS NOT ANSWERING through the tunnel.',
        'If the server just crashed, it is restarting (see above).',
        "Otherwise check the laptop's connection (switch to the phone hotspot if the Wi-Fi is down).",
        "Still trying; if it doesn't come back, Ctrl+C and run `npm run tunnel` again.",
      ]);
    }
  }, CHECK_EVERY_MS);
}

process.on('SIGINT', () => stopAll(0));
