// Demo-day launcher: opens a Cloudflare quick tunnel to this laptop, then starts the production
// server with PUBLIC_URL set to the tunnel's address, so the projector QR always points at it.
// If the game server crashes, only the server restarts: the tunnel (and its address) stays, and
// phones reconnect and resume by themselves. Run `npm run build` first. Ctrl+C stops both.
// Steps: docs/DEPLOY_LAPTOP.md (including "Tunnel won't start").
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { loadEnv } from '../apps/server/src/config/env.ts';
import { diagnose, findTunnelUrl, isErrorLine } from './tunnelErrors.ts';

const CHECK_EVERY_MS = 15_000;
const RESTART_DELAY_MS = 2000;
const MAX_RESTARTS = 5; // within RESTART_WINDOW_MS; one more crash than that and we give up
const RESTART_WINDOW_MS = 60_000;
const RETRY_DELAYS_MS = [10_000, 30_000]; // if the tunnel can't start: two more tries, then give up
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

// "Same-Wi-Fi players can use http://192.168.1.20:3000", one line per network the laptop is on.
// Virtual adapters (WSL, Hyper-V, VPNs) have addresses no phone can reach, so they're skipped.
const VIRTUAL_ADAPTER = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Docker|Loopback|Bluetooth/i;
function lanLines(): string[] {
  return Object.entries(os.networkInterfaces())
    .filter(([name]) => !VIRTUAL_ADAPTER.test(name))
    .flatMap(([, addresses]) => addresses ?? [])
    .filter((a) => a.family === 'IPv4' && !a.internal)
    .map(
      (a) =>
        `Same-Wi-Fi players can use http://${a.address}:${env.PORT} (never open /admin this way)`,
    );
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '0.0.0.0', () => probe.close(() => resolve(true)));
  });
}

if (!existsSync(path.join(repoRoot, 'apps/web/dist/index.html'))) {
  shout([
    'COULD NOT START: no web build found.',
    'Run `npm run build` first, then `npm run tunnel`.',
  ]);
  process.exit(1);
}
if (!(await portFree(env.PORT))) {
  shout([
    `COULD NOT START: port ${env.PORT} is already in use (EADDRINUSE).`,
    'Another `npm run tunnel`, `npm start` or `npm run dev` is probably still running.',
    'Close that window (or Ctrl+C in it), then run `npm run tunnel` again.',
  ]);
  process.exit(1);
}

let tunnel: ChildProcess | undefined;
let server: ChildProcess | undefined;
let publicUrl = '';
let attempt = 0; // tunnel start attempts so far
let startupErrors: string[] = []; // cloudflared's error lines before it gave an address
let stopping = false;
let timer: ReturnType<typeof setTimeout> | undefined; // a pending tunnel retry or server restart
let restarts: number[] = []; // when the server was restarted, for the "keeps crashing" check
let quietUntil = 0; // while the server restarts, cloudflared's "can't reach it" errors are expected

// On Windows, kill() stops only that one process, so taskkill /T takes its whole tree.
function killTree(child: ChildProcess | undefined) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill();
  }
}

function stopAll(code: number) {
  stopping = true;
  clearTimeout(timer);
  killTree(tunnel);
  killTree(server);
  process.exit(code);
}

function startTunnel() {
  attempt++;
  startupErrors = [];
  // --no-autoupdate: never swap the binary in the middle of the demo.
  const child = spawn('cloudflared', [
    'tunnel',
    '--no-autoupdate',
    '--url',
    `http://127.0.0.1:${env.PORT}`,
  ]);
  tunnel = child;
  child.on('error', (err) => {
    if (stopping) return;
    shout([
      'COULD NOT START THE TUNNEL',
      `cloudflared could not be run: ${err.message}`,
      'Is it installed and on PATH? Check with `cloudflared --version`. See docs/DEPLOY_LAPTOP.md.',
    ]);
    stopAll(1);
  });

  // cloudflared logs to stderr. Error lines are echoed as they come, so they sit above any banner.
  readline.createInterface({ input: child.stderr }).on('line', (line) => {
    if (!publicUrl) {
      const url = findTunnelUrl(line);
      if (url) {
        publicUrl = url;
        startServer();
        void watchTunnel();
      }
    }
    if (!isErrorLine(line)) return;
    if (!publicUrl) startupErrors.push(line);
    // During a restart these flood in from every reconnecting phone and would bury the banner.
    if (Date.now() < quietUntil && /Unable to reach the origin/.test(line)) return;
    console.error(`[cloudflared] ${line}`);
  });

  // 'close', not 'exit': it waits until all of cloudflared's output has been read.
  child.on('close', (code) => {
    if (stopping || child !== tunnel) return;
    if (publicUrl) {
      shout([
        `THE TUNNEL DIED (cloudflared exited with code ${code}).`,
        'Phones can no longer reach the game.',
        'Run `npm run tunnel` again. It gives a NEW address: everyone re-scans the QR and joins again.',
      ]);
      stopAll(1);
    } else {
      couldNotStart(code);
    }
  });
}

function couldNotStart(code: number | null) {
  const { reason, hint, retry } = diagnose(startupErrors);
  const delay = retry ? RETRY_DELAYS_MS[attempt - 1] : undefined;
  shout([
    'COULD NOT START THE TUNNEL',
    `cloudflared exited with code ${code} before it gave an address.`,
    `Why: ${reason}`,
    `What to do: ${hint}`,
    delay === undefined
      ? 'Giving up. Run `npm run tunnel` again once that is sorted.'
      : `Trying again in ${delay / 1000} s (try ${attempt + 1} of ${RETRY_DELAYS_MS.length + 1}). Ctrl+C to stop.`,
  ]);
  if (delay === undefined) stopAll(1);
  else timer = setTimeout(startTunnel, delay);
}

function startServer() {
  server = spawn(process.execPath, [path.join(repoRoot, 'apps/server/src/index.ts')], {
    stdio: 'inherit', // its startup errors (and logs) print straight into this window
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
    timer = setTimeout(startServer, RESTART_DELAY_MS);
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
    ...lanLines(),
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
        ...lanLines(),
        "Still trying; if it doesn't come back, Ctrl+C and run `npm run tunnel` again.",
      ]);
    }
  }, CHECK_EVERY_MS);
}

// Ctrl+C, a closed terminal window (SIGHUP on Windows) or a plain kill: stop both children.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => stopAll(0));

startTunnel();
