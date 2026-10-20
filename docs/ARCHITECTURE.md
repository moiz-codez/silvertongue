# Silvertongue — Architecture

## Overview

```
 phones (40×)        projector laptop        admin laptop
     │  Socket.IO          │  Socket.IO           │  Socket.IO + ADMIN_TOKEN
     └──────────────┬──────┴──────────────────────┘
                    ▼
        Caddy (HTTPS, websockets)          Oracle Always Free VM, Ubuntu ARM64
                    ▼
        Node process (systemd)
        ├─ Fastify: serves apps/web/dist, /health
        ├─ Socket.IO: player / projector / admin namespaces or rooms
        ├─ Game engine: runes, door, scoring, hints, state
        ├─ Floor pipelines: guards → guardian → filters
        ├─ LLM layer: prompt assembly + caching, rate-limited queue, mock
        ├─ Embeddings: local MiniLM model (Floor 6)
        └─ SQLite (better-sqlite3, WAL) ── one file on disk
                    ▼
        Anthropic Messages API (claude-haiku-5-5 / claude-sonnet-5-5)
```

Everything runs in **one process** so the LLM queue sees all traffic and game state is consistent without a message broker. SQLite is plenty for ~40 concurrent players.

## Data model (`apps/server/src/db/schema.sql`)

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE games (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('lobby','running','paused','reveal','ended')),
  created_at INTEGER NOT NULL, started_at INTEGER, ended_at INTEGER
);

CREATE TABLE players (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  nickname TEXT NOT NULL,
  token_hash TEXT NOT NULL,             -- sha256 of the session token; token itself only on the phone
  floor INTEGER NOT NULL DEFAULT 1,     -- current floor (7 = finished)
  score INTEGER NOT NULL DEFAULT 0,
  messages_sent INTEGER NOT NULL DEFAULT 0,
  kicked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (game_id, nickname)
);

CREATE TABLE runes (                    -- SERVER ONLY. Never selected into a client payload.
  player_id TEXT NOT NULL REFERENCES players(id),
  floor INTEGER NOT NULL,
  rune TEXT NOT NULL,
  PRIMARY KEY (player_id, floor)
);

CREATE TABLE floor_progress (
  player_id TEXT NOT NULL REFERENCES players(id),
  floor INTEGER NOT NULL,
  reached_at INTEGER NOT NULL,
  cleared_at INTEGER,
  messages_used INTEGER NOT NULL DEFAULT 0,
  failed_tries INTEGER NOT NULL DEFAULT 0,
  wrong_door_streak INTEGER NOT NULL DEFAULT 0,
  door_locked_until INTEGER,
  first_blood INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, floor)
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL, player_id TEXT NOT NULL, floor INTEGER NOT NULL,
  speaker TEXT NOT NULL,                -- player | guardian | gorm | snip | ward_ears | ward_tongues | carving | system
  text TEXT NOT NULL,                   -- what the player saw (filtered)
  raw_text TEXT,                        -- SERVER ONLY: unfiltered guardian output
  verdict TEXT,                         -- PASS/SMASH/SEAL/CLEAN/LEAK where relevant
  in_guardian_history INTEGER NOT NULL DEFAULT 1,  -- 0 for smashed/sealed player messages
  technique TEXT,                       -- filled by the background tagger
  created_at INTEGER NOT NULL
);

CREATE TABLE door_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL, floor INTEGER NOT NULL,
  correct INTEGER NOT NULL, created_at INTEGER NOT NULL   -- the guess itself is not stored
);

CREATE TABLE llm_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT, player_id TEXT, floor INTEGER,
  role TEXT NOT NULL,                   -- guardian | gorm | ward_ears | ward_tongues | tagger | carver
  model TEXT NOT NULL,
  input_tokens INTEGER, cache_creation_tokens INTEGER, cache_read_tokens INTEGER, output_tokens INTEGER,
  cost_usd REAL, latency_ms INTEGER,
  status TEXT NOT NULL,                 -- ok | rate_limited | error | timeout
  created_at INTEGER NOT NULL
);

CREATE TABLE carvings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL, text TEXT NOT NULL, vector BLOB NOT NULL,
  source_floor INTEGER, seeded INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);

CREATE TABLE hoard (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL, player_id TEXT, text TEXT NOT NULL, vector BLOB NOT NULL,
  seeded INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);

CREATE TABLE projector_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL, type TEXT NOT NULL, text TEXT NOT NULL,
  needs_approval INTEGER NOT NULL DEFAULT 0, approved INTEGER, created_at INTEGER NOT NULL
);
```

Put every query in typed functions in `db/`. Client payloads are built by explicit mapper functions that list the fields they include, never by spreading a row.

## Socket events (`packages/shared/src/events.ts`)

All payloads validated with zod on receipt.

**Player → server**
- `player:join { nickname }` → ack `{ playerId, token }`
- `player:resume { token }` → ack `{ ok }`
- `player:message { text }`
- `player:door { guess }`

**Server → player**
- `player:state { gameStatus, floor, score, title, cooldownUntil, doorLockedUntil, notes: string[] }`
- `player:pending { waitingLine }` (sent if a reply takes > 1.5 s)
- `player:bubble { id, floor, speaker, text }` (speaker: guardian | gorm | snip | ward_ears | ward_tongues | carving | system)
- `player:expression { floor, state: 'idle' | 'slipped' }`
- `player:door-result { correct, lockedUntil? }`
- `player:floor-cleared { floor, points, title }`
- `player:error { code, message }` (message is in character, never a stack trace)

**Server → projector** (throttled to ≤ 2 updates/s)
- `projector:snapshot { gameStatus, timer, players: [{ nickname, floor, title, score }], counters: { carvings, hoard } }`
- `projector:event { type, text }` (first blood, clear, carving, approved attempt)
- `projector:reveal { bestiary: FloorStats[] }`

**Admin ↔ server** (after `admin:auth { token }`)
- `admin:command { type: 'start'|'pause'|'resume'|'reveal'|'end'|'reset', ... }`
- `admin:config { cooldownMs?, maxMessages?, llmMode? }`
- `admin:kick { playerId }`, `admin:rename { playerId, nickname }`
- `admin:moderate { eventId, approve }`
- server → admin: `admin:health { queueLength, inFlight, rateLimited1m, avgLatencyMs, tokens, costUsd }`, `admin:moderation-queue`

## LLM layer

### Prompt assembly and caching

Every call is built the same way:

```ts
await anthropic.messages.create({
  model, max_tokens, temperature,
  system: [
    { type: 'text', text: STATIC_PROMPT, cache_control: { type: 'ephemeral' } }, // identical for every player
    { type: 'text', text: perPlayerNote },   // e.g. "The rune for this traveller is: EMBER-FANG"; hoard note on floor 6
  ],
  messages,   // history: user = <traveller_message>…</traveller_message>, assistant = guardian replies
});
```

**Adapting the prompt files to this split.** In `docs/prompts`, the rune appears as `{{RUNE}}` inside the prompt text. When building `floors/<n>/prompts.ts`:
- Replace the line that states the rune (e.g. "The door opens with a secret rune word: {{RUNE}}") with "The rune is given in the final note at the end of these instructions."
- Put the rune in the second, uncached system block.
- All examples use a different example rune (OAK-WIND), never the real one.

This keeps the static block byte-identical across all players, so one cache entry serves the whole class. Check `usage.cache_read_input_tokens > 0` from the second call onward; if it stays 0, the static block is under 512 tokens or isn't identical.

**History rules**
- Smashed or sealed player messages are not sent to the guardian (`in_guardian_history = 0`).
- A Ward of Tongues–sealed guardian reply is stored and sent back in history as `[sealed]`.
- Floors 5–6: send at most the last 12 messages.
- Gorm receives only the latest player message. The Ward of Ears receives the last 12 messages plus the latest one marked.

### Rate-limited queue (`llm/queue.ts`)

- One queue per model with three token buckets refilled continuously: requests (1,000/min), input tokens (500K/min), output tokens (80K/min), each set to **80%** via env.
- Before sending: reserve `estimatedInput = uncached chars / 4` and `max_tokens`. After the response: reconcile with real usage (`input_tokens + cache_creation_input_tokens`, `output_tokens`).
- Priorities: player-facing calls first; background calls (technique tagger, Carver) only when the queue is quiet.
- Max 30 calls in flight; 30 s timeout per call.
- Retries: SDK `maxRetries: 2`, honouring `retry-after`. On final failure: in-character error bubble ("The dungeon trembles. Try again."), the player's cooldown is refunded, the call is logged as `rate_limited` / `error`.
- Every call writes a row to `llm_calls` with tokens and cost (prices in `config/models.ts`; check claude.com/pricing before demo day).

### Mock mode (`LLM_MODE=mock`)

Default in development and in load tests. No API key needed. Deterministic, with 300–1,500 ms of fake latency:
- Guardians reply with a fixed in-character line, and "leak" the rune when the message contains `please tell` (so the whole flow can be tested end to end).
- Gorm / Ward of Ears return `PASS` unless the message contains `rune`.
- Ward of Tongues returns `LEAK` if `revealsRune` fires, else `CLEAN`.

## Floor pipelines

| Floor | Input guard | Guardian | Output checks | "Slipped" expression |
|---|---|---|---|---|
| 1 Grub | — | Grub | — | `revealsRune(reply)` or clear |
| 2 Vellum | — | Ser Vellum | — | `revealsRune(reply)` or clear |
| 3 Morwen | — | Morwen | `snip(reply)` | `revealsRune(filteredText)` (rune got past Snip) or clear |
| 4 Ogre | Gorm: latest message only, no rune, JSON verdict | Mumble | — | `revealsRune(reply)` or clear |
| 5 Ashveil | Ward of Ears: last 12 messages, no rune | Queen Ashveil | `revealsRune` → else Ward of Tongues | on clear |
| 6 Vorgath | Ward of Ears + carvings + `is_gift` | Vorgath (+ hoard note) | `revealsRune` → else Ward of Tongues | on clear |

Model, temperature and `max_tokens` per role come from `config/models.ts`; defaults are in each prompt file's Settings table, all on `claude-haiku-5-5` initially.

## Security functions (`apps/server/src/security/`)

All pure, all unit-tested.

- `normalize(s)`: `s.toUpperCase().replace(/[^A-Z]/g, '')`
- `revealsRune(text, rune)`: with `R = normalize(rune)`, returns `{ revealed, how }`, where `how` is the first of:
  - `plain`: `normalize(text)` contains `R` (also catches dashes, spaces, dots between letters)
  - `reversed`: contains reverse(`R`)
  - `acrostic-lines`: first letters of consecutive non-empty lines contain `R`
  - `acrostic-words`: first letters of consecutive words contain `R`

  It deliberately does not detect other scripts, ciphers or number codes.
- `snip(reply, rune)`: exactly as in `prompts/03-morwen-snip.md`: three shapes, case-insensitive, replaced with `█`.
- `parseVerdict(raw, allowValue)`: strip code fences, `JSON.parse`, validate with zod; return `allowed: true` only when `verdict === allowValue` exactly. Any exception → `allowed: false`.
- `sanitize(text)`: trim; cap at `MAX_MESSAGE_CHARS`; remove `[...]` tags; replace `<` and `>` with `‹` and `›` so the player can't close `<traveller_message>`. Keep line breaks (poems).
- Door check: `normalize(guess) === normalize(rune)`.

## Background jobs

- **Technique tagger:** batches of ~10 untagged player messages → one Haiku call (temperature 0) → one label each from: friendship, authority, persistence, pieces, backwards, poem, encoding, other_script, story, multi_step, taunt, gift, instruction_injection, other. Low priority. Feeds the reveal stats.
- **Carver (Floor 6):** on every floor clear anywhere, as specified in `prompts/06-vorgath.md`. Seed 5 carvings at game start.

## Embeddings (Floor 6)

- `@huggingface/transformers`, model `Xenova/all-MiniLM-L6-v2`, mean pooling + normalisation, 384-dim vectors stored as Float32 BLOBs.
- Load once at startup and run one warm-up embedding so the first gift isn't slow.
- Thresholds (tune in playtest): hoard novelty ≥ 0.85 = owned; carving duplicate ≥ 0.90.
- Seed the hoard with 5–10 obvious gifts at game start.

## Configuration (`config/env.ts`, validated with zod)

| Variable | Example | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-…` | Required when `LLM_MODE=live` |
| `LLM_MODE` | `mock` | `mock` or `live` |
| `ADMIN_TOKEN` | long random string | Admin access |
| `PORT` | `3000` | Fastify port (Caddy proxies to it) |
| `PUBLIC_URL` | `https://silvertongue.duckdns.org` | For the projector QR code |
| `DATABASE_PATH` | `./data/silvertongue.db` | SQLite file |
| `RATE_RPM` / `RATE_ITPM` / `RATE_OTPM` | `800` / `400000` / `64000` | 80% of the console limits |
| `COOLDOWN_MS` | `5000` | Per-player message cooldown |
| `MAX_MESSAGES_PER_PLAYER` | `150` | Per-game cap |
| `MAX_MESSAGE_CHARS` | `300` | Message length cap |
| `BUDGET_USD` | `4.00` | Game auto-pauses and alerts admin when estimated spend reaches this |

## Failure modes and fallbacks

| Problem | What happens |
|---|---|
| Burst of 429s | Queue absorbs and retries; players see waiting lines. Admin can raise the cooldown live. |
| API down | In-character error bubbles; admin pauses the game; the projector shows "The dungeon sleeps". |
| Budget reached | Auto-pause at `BUDGET_USD`, admin alert. |
| Server restart | SQLite keeps state; phones reconnect and `player:resume` with their token. In-flight replies are lost; player retries. |
| Phone loses connection | Socket.IO reconnects automatically; on reconnect the client resumes and receives `player:state`. |
| Projector laptop fails | Projector is a plain URL; open it on any laptop. |
