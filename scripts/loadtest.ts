// Load test: N fake phones play against a running server IN MOCK MODE, then a report.
// Start the server first (LLM_MODE=mock, e.g. `npm start`), then:
//   npm run loadtest -- --players 40 --minutes 5            normal: a message every 10–20 s each
//   npm run loadtest -- --players 40 --minutes 2 --burst    the "go" burst: first messages within 5 s
//   (overload: start the server with a low RATE_RPM, e.g. RATE_RPM=30, and use --players 80)
// It resets the game. Every message must get a reply or an in-character error; anything else
// is "unanswered" and makes the run fail.
import { parseArgs } from 'node:util';
import { io, type Socket } from 'socket.io-client';
import type {
  AdminClientEvents,
  AdminServerEvents,
  AdminState,
  ClientToServerEvents,
  ProjectorServerEvents,
  ServerToClientEvents,
} from '@silvertongue/shared/events';
import { loadEnv } from '../apps/server/src/config/env.ts';

const { values } = parseArgs({
  options: {
    players: { type: 'string', default: '40' },
    minutes: { type: 'string', default: '5' },
    burst: { type: 'boolean', default: false },
    url: { type: 'string', default: '' },
  },
});
const env = loadEnv();
const URL = values.url || `http://localhost:${env.PORT}`;
// It resets the game: only ever against a server on this laptop, never the demo address.
if (!['localhost', '127.0.0.1'].includes(new globalThis.URL(URL).hostname)) {
  console.error('Load tests only run against a server on this laptop (localhost).');
  process.exit(1);
}
const PLAYERS = Number(values.players);
const DURATION_MS = Number(values.minutes) * 60_000;
const GRACE_MS = 65_000; // longer than the queue's 60 s deadline: every message must be answered by then
// The account limits the queue is protecting (the queue itself runs at 80% of these).
const LIMITS = { rpm: 1000, itpm: 500_000, otpm: 80_000 };

// Harmless lines: none says "please tell", so mock Grub never leaks and nobody leaves Floor 1.
const LINES = [
  'hello grub, how are you today?',
  'tell me about your mushrooms',
  'what is behind that door?',
  'I brought you a shiny button',
  'who was the goblin king?',
  'do you ever get lonely at the gate?',
];

type Phone = Socket<ServerToClientEvents, ClientToServerEvents>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const between = (min: number, max: number) => min + Math.random() * (max - min);

const stats = {
  sent: 0,
  replies: 0,
  errors: {} as Record<string, number>,
  latencies: [] as number[],
  disconnects: 0,
  joinFailures: 0,
};
const peaks = {
  queued: 0,
  inFlight: 0,
  calls: 0,
  estInput: 0,
  maxOutput: 0,
  memoryMb: 0,
  rateLimited: 0,
};
let snapshotsPerSecondMax = 0;

// ---------- admin: check mock mode, reset, start; watch health ----------
const admin: Socket<AdminServerEvents, AdminClientEvents> = io(`${URL}/admin`, {
  auth: { token: env.ADMIN_TOKEN },
  transports: ['websocket'],
});
const first = await new Promise<AdminState>((resolve, reject) => {
  admin.once('admin:state', resolve);
  admin.once('connect_error', (e) => reject(new Error(`Admin connection refused: ${e.message}`)));
});
if (first.settings.llmMode !== 'mock') {
  console.error(
    'The server is in LIVE mode. Load tests only run against mock mode (no real API calls).',
  );
  process.exit(1);
}
admin.on('admin:state', (s) => {
  const h = s.health;
  peaks.queued = Math.max(peaks.queued, h.queued);
  peaks.inFlight = Math.max(peaks.inFlight, h.inFlight);
  peaks.calls = Math.max(peaks.calls, h.callsLastMin);
  peaks.estInput = Math.max(peaks.estInput, h.estInputLastMin);
  peaks.maxOutput = Math.max(peaks.maxOutput, h.maxOutputLastMin);
  peaks.memoryMb = Math.max(peaks.memoryMb, h.memoryMb);
  peaks.rateLimited = Math.max(peaks.rateLimited, h.rateLimited1m);
});
await admin.emitWithAck('admin:command', { type: 'reset' });

// The projector must stay throttled (≤ 2 snapshots a second) however busy the game gets.
const projector: Socket<ProjectorServerEvents> = io(`${URL}/projector`, {
  transports: ['websocket'],
  forceNew: true,
});
let snapshotsThisSecond = 0;
projector.on('projector:snapshot', () => snapshotsThisSecond++);
const snapshotTimer = setInterval(() => {
  snapshotsPerSecondMax = Math.max(snapshotsPerSecondMax, snapshotsThisSecond);
  snapshotsThisSecond = 0;
}, 1000);

// ---------- players join (each from its own fake address, as through the tunnel) ----------
const phones: Phone[] = [];
for (let i = 0; i < PLAYERS; i++) {
  const phone: Phone = io(URL, {
    transports: ['websocket'],
    forceNew: true,
    extraHeaders: { 'cf-connecting-ip': `10.0.${Math.floor(i / 250)}.${(i % 250) + 1}` },
  });
  phone.on('disconnect', () => stats.disconnects++);
  await new Promise((r) => phone.once('connect', () => r(null)));
  const reply = await phone.emitWithAck('player:join', { nickname: `Load${i + 1}` });
  if (!reply.ok) stats.joinFailures++;
  phones.push(phone);
}
await admin.emitWithAck('admin:command', { type: 'start' });
console.log(
  `${PLAYERS} players joined (${stats.joinFailures} refused). Playing for ${values.minutes} min${values.burst ? ', burst start' : ''}…`,
);

// ---------- play ----------
const started = Date.now();
const stopSendingAt = started + DURATION_MS;
let outstanding = 0;

async function play(phone: Phone) {
  // Burst: everyone's first message within 5 s. Otherwise spread over the first 20 s.
  await sleep(values.burst ? between(0, 5000) : between(0, 20_000));
  while (Date.now() < stopSendingAt) {
    const sentAt = Date.now();
    stats.sent++;
    outstanding++;
    const outcome = await new Promise<string>((resolve) => {
      const onBubble = (b: { speaker: string }) => b.speaker === 'guardian' && done('reply');
      const onError = (e: { code: string }) => done(e.code);
      function done(result: string) {
        phone.off('player:bubble', onBubble);
        phone.off('player:error', onError);
        resolve(result);
      }
      phone.on('player:bubble', onBubble);
      phone.on('player:error', onError);
      phone.emit('player:message', { text: LINES[Math.floor(Math.random() * LINES.length)]! });
    });
    outstanding--;
    stats.latencies.push(Date.now() - sentAt);
    if (outcome === 'reply') stats.replies++;
    else stats.errors[outcome] = (stats.errors[outcome] ?? 0) + 1;
    await sleep(between(10_000, 20_000));
  }
}

const progress = setInterval(() => {
  const s = Math.round((Date.now() - started) / 1000);
  console.log(`  ${s}s  sent ${stats.sent}  replies ${stats.replies}  waiting ${outstanding}`);
}, 30_000);

const playing = Promise.all(phones.map(play));
await Promise.race([playing, sleep(DURATION_MS + GRACE_MS)]);
clearInterval(progress);
clearInterval(snapshotTimer);

// ---------- report ----------
const unanswered = outstanding;
const sorted = [...stats.latencies].sort((a, b) => a - b);
const pct = (p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! : 0;
const errorCount = Object.values(stats.errors).reduce((a, b) => a + b, 0);
const share = (used: number, limit: number) =>
  `${used} (${Math.round((used / limit) * 100)}% of ${limit})`;

console.log(`
Load test: ${PLAYERS} players, ${values.minutes} min${values.burst ? ', burst' : ''}, ${URL}
  Messages sent           ${stats.sent}
  Replies                 ${stats.replies}
  In-character errors     ${errorCount} ${JSON.stringify(stats.errors)} (${stats.sent ? ((errorCount / stats.sent) * 100).toFixed(1) : 0}%)
  UNANSWERED              ${unanswered}
  Join refusals           ${stats.joinFailures}
  Disconnects             ${stats.disconnects}
  Latency p50 / p95       ${(pct(0.5) / 1000).toFixed(1)} s / ${(pct(0.95) / 1000).toFixed(1)} s
  Peak queue / in flight  ${peaks.queued} / ${peaks.inFlight}
  Peak 429s in a minute   ${peaks.rateLimited}
  Server memory (peak)    ${peaks.memoryMb} MB
  Projector, max snaps/s  ${snapshotsPerSecondMax}

Projected real-API use at peak (one minute), against the account limits:
  Requests                ${share(peaks.calls, LIMITS.rpm)}
  Input tokens            ${share(peaks.estInput, LIMITS.itpm)}  (uncached part only: the cached prompt doesn't count)
  Output tokens           ${share(peaks.maxOutput, LIMITS.otpm)}  (upper bound: every reply at max_tokens)
`);

for (const phone of phones) phone.close();
projector.close();
admin.close();
process.exit(unanswered === 0 && stats.joinFailures === 0 ? 0 : 1);
