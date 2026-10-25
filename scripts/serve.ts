// Backup launcher for when `npm run tunnel` (cloudflared) won't work: runs the production server
// with a public address you pass in, e.g. your ngrok domain, so the projector QR points at it:
//   npm run serve -- --url https://snuggle-steerable-subatomic.ngrok-free.dev
// then, in a second window: ngrok http --domain=snuggle-steerable-subatomic.ngrok-free.dev 3000
// Without --url it is the same-Wi-Fi fallback: the QR points at this laptop's Wi-Fi address.
// Run `npm run build` first. Ctrl+C stops the server. Steps: docs/DEPLOY_LAPTOP.md, "Backup: ngrok".
// The small helpers below are copied from tunnel.ts on purpose (it stays untouched before the demo).
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadEnv } from '../apps/server/src/config/env.ts';

const repoRoot = path.join(import.meta.dirname, '..');
const env = loadEnv(); // fails here if .env is incomplete
const { values } = parseArgs({ options: { url: { type: 'string' } } });

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

// This laptop's Wi-Fi/Ethernet addresses. Virtual adapters (WSL, Hyper-V, VPNs) are skipped.
const VIRTUAL_ADAPTER = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Docker|Loopback|Bluetooth/i;
const lanUrls = Object.entries(os.networkInterfaces())
  .filter(([name]) => !VIRTUAL_ADAPTER.test(name))
  .flatMap(([, addresses]) => addresses ?? [])
  .filter((a) => a.family === 'IPv4' && !a.internal)
  .map((a) => `http://${a.address}:${env.PORT}`);

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '0.0.0.0', () => probe.close(() => resolve(true)));
  });
}

const publicUrl = values.url?.replace(/\/+$/, '') ?? lanUrls[0];
if (values.url !== undefined && !/^https:\/\/[^/\s]+$/.test(publicUrl ?? '')) {
  shout([
    `COULD NOT START: --url must be an https address, e.g. https://<name>.ngrok-free.dev`,
    `You gave: ${values.url}`,
  ]);
  process.exit(1);
}
if (!publicUrl) {
  shout(['COULD NOT START: no --url given and this laptop has no Wi-Fi/LAN address.']);
  process.exit(1);
}
if (!existsSync(path.join(repoRoot, 'apps/web/dist/index.html'))) {
  shout(['COULD NOT START: no web build found.', 'Run `npm run build` first.']);
  process.exit(1);
}
if (!(await portFree(env.PORT))) {
  shout([
    `COULD NOT START: port ${env.PORT} is already in use (EADDRINUSE).`,
    'Another `npm run serve`, `npm run tunnel`, `npm start` or `npm run dev` is still running.',
    'Close that window (or Ctrl+C in it), then try again.',
  ]);
  process.exit(1);
}

let stopping = false;
const server: ChildProcess = spawn(
  process.execPath,
  [path.join(repoRoot, 'apps/server/src/index.ts')],
  {
    stdio: 'inherit',
    // With --url the visitors come through ngrok, which puts their address in X-Forwarded-For.
    env: {
      ...process.env,
      PUBLIC_URL: publicUrl,
      TRUST_FORWARDED_FOR: values.url ? 'true' : 'false',
    },
  },
);

// On Windows, kill() stops only that one process, so taskkill /T takes its whole tree.
function stop(code: number) {
  stopping = true;
  if (server.pid && server.exitCode === null) {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    } else server.kill();
  }
  process.exit(code);
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => stop(0));

server.on('exit', (code) => {
  if (stopping) return;
  shout([
    `THE SERVER STOPPED (exit code ${code}).`,
    'Read the error above, then run the same `npm run serve` command again.',
    'Same address, so phones carry on by themselves.',
  ]);
  process.exit(1);
});

// Ready once the server answers on this laptop.
for (;;) {
  try {
    if ((await fetch(`http://127.0.0.1:${env.PORT}/health`)).ok) break;
  } catch {
    // not up yet
  }
  await new Promise((r) => setTimeout(r, 500));
}
const domain = publicUrl.replace(/^https?:\/\//, '');
banner([
  `READY: the QR and join address say ${publicUrl}`,
  ...(values.url
    ? [
        'Now, in a SECOND window, start ngrok (old v3 takes --domain, not --url):',
        `  ngrok http --domain=${domain} ${env.PORT}`,
        '  (add --region=in if it is slow). Free ngrok shows a "Visit Site" page first: tap it once.',
      ]
    : ['Same-Wi-Fi mode: only phones on the same Wi-Fi as this laptop can join.']),
  `On this laptop:`,
  `  Projector: http://localhost:${env.PORT}/projector`,
  `  Admin:     http://localhost:${env.PORT}/admin`,
  ...lanUrls.map((u) => `Same-Wi-Fi players can use ${u} (never open /admin this way)`),
]);
