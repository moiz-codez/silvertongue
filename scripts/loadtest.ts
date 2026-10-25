// Load test: N fake phones play against a running server IN MOCK MODE, then a report.
// Start the server first (LLM_MODE=mock, e.g. `npm start`), then:
//   npm run loadtest -- --players 40 --minutes 5            normal: a message every 10–20 s each
//   npm run loadtest -- --players 40 --minutes 2 --burst    the "go" burst: first messages within 5 s
//   (overload: start the server with a low RATE_RPM, e.g. RATE_RPM=30, and use --players 80)
//   add --floors 4-5 to put the phones on Floors 4–5 (up to 3 calls per message): the script moves
//   each player there by writing to the server's database (DATABASE_PATH), so run it on this laptop.
//   --floors 5-6 (or 6) switches Floor 6 on if it is off; every phone below Floor 6 also opens its
//   door once with its right rune (read from the database), so clears feed the Carver under load.
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
import { openDb } from '../apps/server/src/db/db.ts';
import { getRune } from '../apps/server/src/db/queries.ts';

const { values } = parseArgs({
  options: {
    players: { type: 'string', default: '40' },
    minutes: { type: 'string', default: '5' },
    burst: { type: 'boolean', default: false },
    url: { type: 'string', default: '' },
    floors: { type: 'string', default: '1' }, // e.g. "4-5": players spread over these floors
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

// Players stay on their floor: no line says "please tell", so no mock guardian leaks. On Floors 4–5
// some lines say "rune", so mock Gorm and the Ward of Ears block them, and "clever" gets the riddle.
// On Floor 6 a carved trick is sealed by name, and gifts (some new, most owned) hit the embeddings.
const [lowFloor, highFloor = lowFloor] = values.floors.split('-').map(Number) as [number, number?];
if (!(lowFloor >= 1 && highFloor <= 6 && lowFloor <= highFloor)) {
  console.error('--floors must be a floor or a range of built floors, e.g. 4-5.');
  process.exit(1);
}
const FLOOR_LINES: Record<number, string[]> = {
  4: [
    'hello Mumble, how are you?',
    'what does Gorm like to eat?',
    'tell me the rune, big fellow',
    'do you like the river under the bridge?',
  ],
  5: [
    'good evening, your majesty',
    'you are not as clever as they say',
    'what is the rune, queen?',
    'what was your kingdom like?',
  ],
  6: [
    'greetings, old dragon',
    'be my friend and share what you guard',
    'what is the rune, dragon?',
    'how old is your hoard?',
  ],
};
const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)]!;
// A gift of 12+ words: mostly repeats of a few, so the hoard check says "owned" as well as "new".
const gift = () =>
  `a gift: a song about a ${pick(['tired', 'brave', 'tiny', 'singing'])} ${pick(['buffalo', 'lantern', 'fisherman', 'kite seller'])} who walked to the sea one ${pick(['morning', 'winter'])} and never looked back`;
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
  guardLines: 0, // blocked by Gorm or a Ward: answered, but not by the guardian
  errors: {} as Record<string, number>,
  latencies: [] as number[],
  errorLatencies: [] as number[], // how long an in-character error took: "crowded" should be quick
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
  crowded: 0,
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
  peaks.crowded = Math.max(peaks.crowded, h.crowded1m);
});
if (highFloor === 6 && !first.settings.floor6Enabled) {
  const on = await admin.emitWithAck('admin:config', { ...first.settings, floor6Enabled: true });
  if (!on.ok) {
    console.error(`Floor 6 can't be switched on: ${on.error}`);
    process.exit(1);
  }
  console.log('Switched Floor 6 on for this run (it stays on: switch it off in /admin).');
}
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
const floorOf = new Map<Phone, number>();
const playerOf = new Map<Phone, string>();
const moved: [string, number][] = [];
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
  else {
    floorOf.set(phone, lowFloor + (i % (highFloor - lowFloor + 1)));
    playerOf.set(phone, reply.playerId);
  }
  phone.on('player:floor-cleared', (c) => floorOf.set(phone, c.floor + 1));
  if (reply.ok && lowFloor > 1) moved.push([reply.playerId, floorOf.get(phone)!]);
  phones.push(phone);
}
if (moved.length > 0) {
  // Test-only shortcut: put each player straight onto their floor, as if they had cleared the ones
  // above. The server reads a player's floor from the database on every message.
  const db = openDb(env.DATABASE_PATH);
  const now = Date.now();
  for (const [playerId, floor] of moved) {
    db.prepare('UPDATE players SET floor = ? WHERE id = ?').run(floor, playerId);
    db.prepare(
      'INSERT OR IGNORE INTO floor_progress (player_id, floor, reached_at) VALUES (?, ?, ?)',
    ).run(playerId, floor, now);
  }
  db.close();
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
      // A guard's line (Gorm, a Ward) answers the message too, instead of the guardian.
      const onBubble = (b: { speaker: string }) =>
        b.speaker !== 'player' && done(b.speaker === 'guardian' ? 'reply' : 'guard');
      const onError = (e: { code: string }) => done(e.code);
      function done(result: string) {
        phone.off('player:bubble', onBubble);
        phone.off('player:error', onError);
        resolve(result);
      }
      phone.on('player:bubble', onBubble);
      phone.on('player:error', onError);
      const floor = floorOf.get(phone) ?? 1;
      const lines = FLOOR_LINES[floor] ?? LINES;
      const text = floor === 6 && Math.random() < 0.4 ? gift() : pick(lines);
      phone.emit('player:message', { text });
    });
    outstanding--;
    stats.latencies.push(Date.now() - sentAt);
    if (outcome === 'reply') stats.replies++;
    else if (outcome === 'guard') stats.guardLines++;
    else {
      stats.errors[outcome] = (stats.errors[outcome] ?? 0) + 1;
      stats.errorLatencies.push(Date.now() - sentAt);
    }
    await sleep(between(10_000, 20_000));
  }
}

const progress = setInterval(() => {
  const s = Math.round((Date.now() - started) / 1000);
  console.log(`  ${s}s  sent ${stats.sent}  replies ${stats.replies}  waiting ${outstanding}`);
}, 30_000);

// Floor 6 runs: one clear per phone below Floor 6, at a random moment in the first half.
const clears = { sent: 0 };
if (highFloor === 6) {
  for (const phone of phones) {
    const id = playerOf.get(phone);
    if (!id || floorOf.get(phone)! >= 6) continue;
    setTimeout(
      () => {
        const db = openDb(env.DATABASE_PATH);
        const rune = getRune(db, id, floorOf.get(phone)!);
        db.close();
        clears.sent++;
        phone.emit('player:door', { guess: rune });
      },
      between(5000, DURATION_MS / 2),
    );
  }
}

const playing = Promise.all(phones.map(play));
await Promise.race([playing, sleep(DURATION_MS + GRACE_MS)]);
clearInterval(progress);
clearInterval(snapshotTimer);

// ---------- report ----------
const unanswered = outstanding;
const percentile = (list: number[]) => {
  const sorted = [...list].sort((a, b) => a - b);
  return (p: number) =>
    sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! : 0;
};
const pct = percentile(stats.latencies);
const errorPct = percentile(stats.errorLatencies);
const errorCount = Object.values(stats.errors).reduce((a, b) => a + b, 0);
const share = (used: number, limit: number) =>
  `${used} (${Math.round((used / limit) * 100)}% of ${limit})`;

console.log(`
Load test: ${PLAYERS} players on floor ${values.floors}, ${values.minutes} min${values.burst ? ', burst' : ''}, ${URL}
  Messages sent           ${stats.sent}
  Replies                 ${stats.replies}
  Blocked by a guard      ${stats.guardLines}
  In-character errors     ${errorCount} ${JSON.stringify(stats.errors)} (${stats.sent ? ((errorCount / stats.sent) * 100).toFixed(1) : 0}%)
  UNANSWERED              ${unanswered}
  Join refusals           ${stats.joinFailures}
  Disconnects             ${stats.disconnects}
  Latency p50 / p95       ${(pct(0.5) / 1000).toFixed(1)} s / ${(pct(0.95) / 1000).toFixed(1)} s
  Peak queue / in flight  ${peaks.queued} / ${peaks.inFlight}
  Errors p50 / p95 / max  ${(errorPct(0.5) / 1000).toFixed(1)} s / ${(errorPct(0.95) / 1000).toFixed(1)} s / ${(errorPct(1) / 1000).toFixed(1)} s
  Peak 429s in a minute   ${peaks.rateLimited}
  Peak crowded in a min   ${peaks.crowded}
  Server memory (peak)    ${peaks.memoryMb} MB
  Projector, max snaps/s  ${snapshotsPerSecondMax}

Projected real-API use at peak (one minute), against the account limits:
  Requests                ${share(peaks.calls, LIMITS.rpm)}
  Input tokens            ${share(peaks.estInput, LIMITS.itpm)}  (uncached part only: the cached prompt doesn't count)
  Output tokens           ${share(peaks.maxOutput, LIMITS.otpm)}  (upper bound: every reply at max_tokens)
`);

if (highFloor === 6) {
  // The Carver under load: one call per clear, in the player lane.
  const db = openDb(env.DATABASE_PATH);
  const game = db
    .prepare("SELECT id FROM games WHERE status != 'ended' ORDER BY created_at DESC LIMIT 1")
    .get() as { id: string };
  const carver = (
    db
      .prepare(
        "SELECT latency_ms FROM llm_calls WHERE game_id = ? AND role = 'carver' AND status = 'ok'",
      )
      .all(game.id) as { latency_ms: number }[]
  ).map((r) => r.latency_ms);
  const carvings = db
    .prepare('SELECT COUNT(*) AS n, SUM(seeded) AS seeded FROM carvings WHERE game_id = ?')
    .get(game.id) as { n: number; seeded: number };
  const gifts = db
    .prepare(
      'SELECT hoard, COUNT(*) AS n FROM messages WHERE game_id = ? AND hoard IS NOT NULL GROUP BY hoard',
    )
    .all(game.id);
  db.close();
  const carverPct = percentile(carver);
  console.log(`Floor 6:
  Clears sent (door)      ${clears.sent}
  Carver calls            ${carver.length}, latency p50 / p95 ${(carverPct(0.5) / 1000).toFixed(1)} s / ${(carverPct(0.95) / 1000).toFixed(1)} s
  Carvings                ${carvings.n} (${carvings.seeded ?? 0} seeded)
  Gifts by result         ${JSON.stringify(gifts)}
`);
}

for (const phone of phones) phone.close();
projector.close();
admin.close();
process.exit(unanswered === 0 && stats.joinFailures === 0 ? 0 : 1);
