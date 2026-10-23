# Silvertongue — Architecture

## Overview

```
 phones (40×)        projector laptop        admin laptop
     │  Socket.IO          │  Socket.IO           │  Socket.IO + ADMIN_TOKEN
     └──────────────┬──────┴──────────────────────┘
                    ▼
        Cloudflare quick tunnel (HTTPS, websockets; *.trycloudflare.com)
                    ▼
        cloudflared ─▶ Node process on the Windows laptop (npm run tunnel)
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
  created_at INTEGER NOT NULL, started_at INTEGER, ended_at INTEGER,
  paused_at INTEGER,                      -- set while paused (and at reveal/end), so the timer stops
  paused_ms INTEGER NOT NULL DEFAULT 0,   -- total time paused; timer = now - started_at - paused_ms
  -- Live settings (admin "Live settings" panel). .env only seeds the FIRST game; Reset copies the
  -- current game's settings into the next one, and a restart keeps them. So changing LLM_MODE,
  -- COOLDOWN_MS or MAX_MESSAGES_PER_PLAYER in .env does not affect an existing database: use /admin.
  cooldown_ms INTEGER, max_messages INTEGER, llm_mode TEXT,
  budget_alert_at INTEGER                 -- set when spend crossed BUDGET_USD and the game paused itself
);

CREATE TABLE players (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  nickname TEXT NOT NULL COLLATE NOCASE,  -- "Ali" and "ali" count as the same name
  token_hash TEXT NOT NULL UNIQUE,      -- sha256 of the session token; token itself only on the phone
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
  leak_route TEXT,                      -- set on a clear: how the rune leaked (label only, see below)
  winning_message_id INTEGER,           -- the player message just before the leak
  leak_message_id INTEGER,              -- the guardian reply that leaked it
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
  correct INTEGER NOT NULL, created_at INTEGER NOT NULL,  -- the guess itself is not stored
  distance INTEGER                  -- wrong guesses: edit distance to the nearer word order of the rune (letters only); never sent to any client (schema v5)
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
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL REFERENCES players(id),
  floor INTEGER NOT NULL,
  type TEXT NOT NULL,                     -- first_blood | clear | note
  game_ms INTEGER NOT NULL,               -- time in the dungeon when it happened (for "08:31")
  created_at INTEGER NOT NULL
  -- No text column: the line is built when sent, from the player's CURRENT name, so a rename
  -- or kick also fixes their old lines.
);

CREATE TABLE attempts (                  -- the best-attempts wall (schema v4, M7)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL REFERENCES players(id),
  floor INTEGER NOT NULL,
  text TEXT NOT NULL,                     -- the player's own (sanitized) winning message
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | hidden (hidden is final)
  created_at INTEGER NOT NULL
);
```

Migrations: `PRAGMA user_version` is the schema version. A new file runs `schema.sql`; an older file runs the steps in `db.ts` → `MIGRATIONS` inside one transaction.

Put every query in typed functions in `db/`. Client payloads are built by explicit mapper functions that list the fields they include, never by spreading a row.

## Socket events (`packages/shared/src/events.ts`)

All payloads validated with zod on receipt.

**Player → server**
- `player:join { nickname }` → ack `{ ok: true, playerId, token }` or `{ ok: false, error }` (error is in character and never names a rude word)
- `player:resume { token }` → ack `{ ok }`
- `player:message { text }`
- `player:door { guess }`

**Server → player**
- `player:state { gameStatus, playersInGame, nickname, floor, floorReady, score, title, messagesLeft, cooldownMs, doorCooldownMs, doorLockedMs, notes }`. Durations are milliseconds from now, never timestamps, so a phone with a wrong clock still counts down correctly. `floorReady` is false while the floor isn't built yet. `playersInGame` is the lobby's "N adventurers at the gate". The phone picks its screen from `gameStatus`. `notes` are the notes on the wall this player unlocked on this floor (0, 1 or 2; text from `game/hints.ts`), worked out from `floor_progress.failed_tries` on every state, so a refresh brings them back. `doorCooldownMs`: after a wrong guess the door waits as long as the send button (`cooldown_ms`); a guess sent sooner gets `player:error { code: 'door_cooldown' }` and isn't counted.
- `player:history { floor, bubbles }`: on resume, replays this floor's bubbles so a refresh shows the same chat.
- `player:bubble { id, floor, speaker, text }` (speaker: player | guardian | snip | gorm | ward_ears | ward_tongues | system; Floor 6 adds carving). On Floor 5 a `ward_ears` bubble (cyan) replaces the Queen's reply when the Ward of Ears sealed the message, and a `ward_tongues` bubble (magenta) replaces it when her reply was sealed; both are fixed lines chosen by the server, and any non-player bubble ends the wait for an answer. On Floor 4 a `gorm` bubble is Gorm's growl when he blocked the message; the phone shows "Mumble was asleep and never heard that." under it (UI text, not stored), and a `gorm` bubble ends the wait for an answer just like a guardian reply. On Floor 3 the guardian bubble is Snip's output, and when Snip cut something a `snip` bubble follows: `SNIP! N letters removed.` It is stored as its own message with `in_guardian_history = 0`, so Morwen never sees it. Morwen's history is what the traveller saw (blacked out); her unfiltered words are only in `raw_text`. The player's own message comes back as a bubble too.
- `player:expression { floor, state: 'idle' | 'slipped' }` (computed on the server with `revealsRune`)
- `player:door-result { correct, lockedMs }`
- `player:floor-cleared { floor, lines: [{ label, points, highlight? }], total, score, title, nextFloorReady }`
- `player:error { code, message }` (message is in character, never a stack trace). Code `door_cooldown` for a door guess sent within the cooldown after a wrong one (not counted as a try); `not_running` while the game is in the lobby, paused, at the reveal or ended; `crowded` when the queue can't answer within its 60 s deadline (turned away at once if the line is already too long; not counted against the message cap, but the player waits the normal cooldown plus a random 0–3 s, so turned-away phones don't resend at once or all come back together); `refused` when the safety classifier stops the guardian's reply twice in a row, or when the reply is empty after cleaning twice in a row (e.g. only "Queen Ashveil:"; an empty bubble is never sent) (`stop_reason: "refusal"`: the reply is thrown away and asked once more; on a second refusal the message is the guardian's own "lost my words" line; it isn't counted against the cap, but the cooldown stays, since a refusal costs two paid calls); `llm` for any other failed call (the turn and cooldown are refunded).
- `player:kicked`: the admin kicked this player; the phone forgets its token and the server disconnects the socket.
- `player:reset`: the admin opened a new game; the phone forgets its token and goes back to Join.

There is no `player:pending` event: the phone shows an in-character waiting line from `packages/shared/src/floors.ts` as soon as the player sends, and hides it when the reply or an error arrives.

**Server → projector** (namespace `/projector`, read-only, no token; throttled to ≤ 2 updates/s)
- `projector:snapshot { status, elapsedMs, publicUrl, players: [{ nickname, floor }], feed: [{ gameMs, type: 'first_blood' | 'clear' | 'note', text }] }`, sent on connect and after every change. Kicked players are left out. The feed is the newest 5 `projector_events` of players who aren't kicked, each turned into a server-written line with the player's current name (e.g. "NightOwl charmed Grub."), so no player-written text reaches the projector and a rename or kick also changes the old lines. A `note` line is "A note has appeared on Floor N.": written once per floor per game, the first time anyone unlocks note 1 there; it never carries the note or a name. Nicknames passed the profanity filter at join or rename. It also carries `wards: { ears, tongues }`, the number of real seals this game (`SEAL` and `LEAK` verdicts): counts only, never text. The projector flares a glow over the matching gem on Queen Ashveil's pillars when one rises. `bestAttempts: [{ nickname, floor, text }]` is the best-attempts wall: admin-approved winning messages only, at most 5, newest first, players who aren't kicked, with their current name. It is the only player-typed text the projector ever gets. M9 adds Vorgath's counters.
  `reveal: { card, index, total } | null`: during the reveal, the Bestiary card on screen (`game/bestiary.ts`), null while the cards are being prepared. A floor card is `{ kind: 'floor', floor, name, technique, lesson, tiles: [{ label, value }], details: [{ label, value }], howBeat, topTrick, quote }`; the closing card is `{ kind: 'closing', line, top: [{ nickname, floor, title }] }`. Only numbers, fixed text from the prompt docs, template sentences and an admin-approved quote: `sockets/reveal.test.ts` checks that no other player text, rune or id reaches the projector.

**Admin ↔ server** (namespace `/admin`. The token goes in the Socket.IO handshake, `auth: { token }`, and connection middleware compares it with `ADMIN_TOKEN` using `timingSafeEqual`. A wrong token is refused before any handler exists. Through the tunnel, 5 wrong tokens in a minute from one address lock that address out for the rest of the minute ("Too many tries. Wait a minute."); a browser on the laptop itself is never locked out.)
- `admin:command { type: 'start'|'pause'|'resume'|'reveal'|'end'|'reset'|'next'|'prev' }` → ack `{ ok: true }` or `{ ok: false, error }`. `next`/`prev` move the Bestiary card (reveal only; refused while the cards are being written). `pause` and `reveal` also start the tagger's catch-up (`sockets/reveal.ts`); Start reveal waits for it at most 15 s, then shows the cards, with technique lines only if every winning message got a tag.
- `admin:moderate { id, action: 'approve' | 'hide' }` → same ack. Only this game's items; hidden is final (a hidden item is never selected again, so it can't be approved later).
- `admin:kick { playerId }`, `admin:rename { playerId, nickname }` → same ack. Rename runs the same nickname rules as join (`security/nickname.ts`).
- `admin:config { cooldownMs, maxMessages, llmMode }` → same ack. Cooldown 0–60 s, cap 1–500, `mock` | `live`; Live is refused when the server has no `ANTHROPIC_API_KEY`. Saved on the current game.
- server → admin: `admin:state { status, elapsedMs, players: [{ id, nickname, floor, score, messagesSent, kicked }], settings: { cooldownMs, maxMessages, llmMode }, liveAvailable, health: { queued, inFlight, rateLimited1m, crowded1m, avgReplyMs, callsLastMin, estInputLastMin, maxOutputLastMin, memoryMb }, spendUsd, budgetUsd, budgetAlert, moderation: [{ id, nickname, floor, text, createdAt, status: 'pending' | 'approved' }], tagging: { done, total } | null, reveal: { index, total } | null }`, throttled like the projector, and refreshed every 5 s so the last-minute tiles age out. Never tokens, token hashes, runes or raw replies.

**Per-address limits** (`sockets/clientIp.ts`). Behind the Cloudflare tunnel every socket comes from cloudflared on the laptop, so the visitor's address is the `cf-connecting-ip` header, trusted only when the socket itself comes from loopback; otherwise the socket's own address. This is only safe because cloudflared sets that header itself. Behind any other local proxy (Caddy on Oracle) a player could send a fake `cf-connecting-ip`: there, strip the header in the proxy or read `X-Forwarded-For` instead.
- Joins: `JOIN_LIMIT_PER_MIN` successful joins per minute per address (default 60; the class may share one university IP).
- Admin: the wrong-token lockout above.
- Projector: at most 5 `/projector` sockets per address.

**Game states** (`game/state.ts`, driven only by the admin)

| Command | From | To |
|---|---|---|
| start | lobby | running |
| pause | running, reveal ("Back to game") | paused |
| resume | paused | running |
| reveal | running, paused | reveal |
| end | lobby, running, paused, reveal | ended |
| reset | any | the current game is ended (data kept) and a new game opens in the lobby |

- At startup the server reuses the newest game that isn't ended, otherwise it opens a new one in the lobby. A restart never resets progress.
- Messages and the door work only while running. Joining works in the lobby, running and paused.
- The timer counts running time only. On start, Floor 1's clock for lobby joiners starts at the start time; on resume, every uncleared floor's clock moves forward by the pause, so neither eats the speed bonus.

## LLM layer

### Prompt assembly and caching

Every call is built the same way:

```ts
await anthropic.messages.create({
  model, max_tokens,
  thinking: THINKING_OFF[model],          // from config/models.ts; never temperature/top_p/top_k
  output_config,                          // guards and judges only: their one fixed JSON schema
  system: [
    { type: 'text', text: STATIC_PROMPT, cache_control: { type: 'ephemeral' } }, // identical for every player
    { type: 'text', text: perPlayerNote },   // e.g. "The rune for this traveller is: EMBER-FANG"; hoard note on floor 6
  ],
  messages,   // history: user = <traveller_message>…</traveller_message>, assistant = guardian replies; always ends with a user turn
});
const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
```

**Sampling, thinking and structured outputs.** No call sends `temperature`, `top_p` or `top_k`: Haiku 5.5 and Sonnet 5.5 return a 400 for non-default values. Every game call turns thinking off (`{ type: 'disabled' }` on Haiku 5.5, `{ type: 'between_tools' }` on Sonnet 5.5, which rejects `disabled`), and no call sets or changes `effort`. Guards, judges and the tagger get consistency from structured outputs, not sampling settings: each role has one fixed schema (below), so the cache and the compiled grammar are reused. Guardians get their voice and consistency from the prompt and its examples. No request ends with an assistant turn (prefill is rejected), and reply text is always read from `type === 'text'` blocks, never `content[0]`.

| Role | Schema (`output_config.format`, `type: 'json_schema'`, `additionalProperties: false` on every object) |
|---|---|
| Gorm | `{ verdict: enum ['PASS','SMASH'], growl: string }` |
| Ward of Ears (floor 5) | `{ verdict: enum ['PASS','SEAL'] }` |
| Ward of Ears + Carvings (floor 6) | `{ verdict: enum ['PASS','SEAL'], matched_carving: integer \| null, is_gift: boolean }` |
| Ward of Tongues (floors 5–6) | `{ verdict: enum ['CLEAN','LEAK'] }` |
| Technique tagger | `{ labels: [{ n: integer, technique: enum [friendship, authority, …, other] }] }` (`n` = the message's number in the batch) |

Length limits (Gorm's 8-word growl) aren't expressible in the schema; the prompt asks for them and the server truncates.

**Adapting the prompt files to this split.** In `docs/prompts`, the rune appears as `{{RUNE}}` inside the prompt text. When building `floors/<n>/prompts.ts`:
- Replace the line that states the rune (e.g. "The door opens with a secret rune word: {{RUNE}}") with "The rune is given in the final note at the end of these instructions."
- Put the rune in the second, uncached system block.
- All examples use a different example rune (OAK-WIND), never the real one.

This keeps the static block byte-identical across all players, so one cache entry serves the whole class. Check `usage.cache_read_input_tokens > 0` from the second call onward; if it stays 0, the static block is under 512 tokens or isn't identical.

**History rules**
- Smashed or sealed player messages are not sent to the guardian (`in_guardian_history = 0`).
- A Ward of Tongues–sealed guardian reply is stored and sent back in history as `[sealed]`; her real words stay in `raw_text` (server only). `player:history` skips guardian rows with a `LEAK` or `GUARD_ERROR` verdict, so a refreshed phone shows the Ward's line, never a `[sealed]` bubble.
- Floors 2–6: send at most the last 12 messages (Floor 1: 20).
- Gorm receives only the latest player message, with no rune and no per-player note. The Ward of Ears receives, in one user turn, the last 12 things said on the floor (every player message, sealed ones included, as `<traveller_message>`; the Queen's replies as delivered, or `[sealed]`, as `<queen_reply>`) inside `<conversation>`, then the latest message inside `<latest>`. No rune and no per-player note.

**Input guard outcomes (Floor 4 Gorm, Floor 5 Ward of Ears).** One shared path in `sockets/player.ts`, per floor settings in `floors/index.ts` (`guard`). The guard always fails closed: the guardian is never called for a message it didn't pass. On guarded floors a player message is stored outside the guardian's history (`in_guardian_history = 0`) and joins it only when the guard passes it, so a crash mid-judgement can't leave an unjudged message for the guardian. The verdict is stored on the player's message; the M8 reveal counts only real blocks (`SMASH`, `SEAL`). The table shows Gorm; the Ward of Ears is the same with `SEAL` and its fixed lines (`docs/prompts/05-ashveil.md`).

| Gorm outcome | The player sees | Message cap | Cooldown | `messages.verdict` |
|---|---|---|---|---|
| `PASS` | Mumble's reply | counts | kept | `PASS` |
| A real `SMASH` | Gorm's growl (cleaned: caps, ≤ 8 words, stock growl if empty or rude) | counts | kept | `SMASH` |
| His answer can't be read (refusal, bad JSON, extra keys, unknown verdict, `max_tokens` stop): asked once more, then | the stock growl "GORM NOT HEAR GOOD. GORM SMASH ANYWAY." | not counted | kept | `GUARD_ERROR` |
| The call fails (crowded queue / deadline, API error, timeout) | the usual `crowded` / `llm` ("The dungeon trembles") error, not a growl | not counted | `crowded`: cooldown + 0–3 s; `llm`: refunded | `GUARD_ERROR` |

Every Gorm call is logged in `llm_calls` with role `gorm`. A message costs one Gorm call (two if his answer can't be read) plus, when he passes it, one Mumble call (two if refused).

**Output judge outcomes (Floor 5, Ward of Tongues).** Per floor settings in `floors/index.ts` (`replyJudge`). The verdict is stored on the Queen's reply; the reveal counts `LEAK`.

| Outcome | The player sees | Message cap | The Queen's history | `messages.verdict` |
|---|---|---|---|---|
| The code check fires (`revealsRune`, or `saysRuneWord`: either rune word alone; the Ward isn't asked) | `THE WARD OF TONGUES SEALS HER WORDS.` | counts | `[sealed]` | `LEAK` |
| A real `LEAK` | the same line | counts | `[sealed]` | `LEAK` |
| Its answer can't be read: asked once more, then | `THE WARD OF TONGUES FLICKERS. HER WORDS ARE SEALED.` | not counted (cooldown kept) | `[sealed]` | `GUARD_ERROR` |
| The call fails | the usual `crowded` / `llm` error | not counted (`llm`: refunded) | nothing stored; the player's message leaves her history | — (logged as `ward_tongues`, status error) |
| `CLEAN` | her reply | counts | her reply | `CLEAN` |

A Floor 5 message costs one Ward of Ears call (two if unreadable), and when it passes, one Queen call (two if refused) and one Ward of Tongues call (none if the code check already caught the reply, two if unreadable).

### Rate-limited queue (`llm/queue.ts`)

Every call from every phone goes through one queue, in front of the mock or live client that the game's `llm_mode` selects.
- Per model, three buckets refilled continuously, each holding one minute's worth: requests (`RATE_RPM`), input tokens (`RATE_ITPM`), output tokens (`RATE_OTPM`), set to **80%** of the account limits (1,000 / 500K / 80K per minute) via env.
- Before sending, a call reserves 1 request, `estimatedInput = (player note + messages chars) / 2.5` (the uncached part; calibrated on the M3 live check, where chars/4 came out 1.5× too low, so a burst's reservations stay at or above real use) and `max_tokens`. After the reply it reconciles with real usage: input = `input_tokens + cache_creation_input_tokens` (cache reads don't count toward the limit), output = `output_tokens`. Unused tokens go back; extra use becomes debt that delays the next call. A failed call gives its tokens back.
- First in, first out: nobody overtakes the head of the line. Priorities: follow-ups first (every call after the first one of a player message: the guardian behind a guard, the Ward of Tongues, retries), so a message that got through its guard finishes instead of being turned away halfway; then new player calls; background calls (technique tagger, Carver) only when no player call is waiting.
- Max 30 calls in flight.
- **Retries live in the queue, not the SDK** (`maxRetries: 0`), so the queue sees every 429: a 429 pauses that whole model for `retry-after` (counted for the "Rate-limited, last minute" tile); 5xx/529 and dropped connections back off 1 s, then 2 s. At most 2 retries.
- **Turned away early:** when a call joins, the queue estimates its wait from the calls ahead of it and the bucket levels. If that wait plus 10 s (the least time a call needs) is past the deadline, it is rejected at once as `crowded`, instead of after 60 s. A call that reaches the front with less than 10 s left is turned away too rather than started, since the deadline would cancel it (and live mode would still pay). Every turn-away counts toward the "Crowded, last minute" admin tile.
- **Deadline: 60 s per call from joining the queue**, the backstop for what the estimate misses (a hanging call, the in-flight cap). It aborts the request (`AbortSignal`) and answers the player in character ("The dungeon is crowded…"), not counted against the message cap, but the player waits the normal cooldown plus a random 0–3 s, so turned-away phones don't resend at once or all come back together. Each attempt also has the SDK's 30 s timeout. A player has at most one message waiting at a time, so the queue never holds more than one call per player.
- Every call writes a row to `llm_calls` with tokens and cost (prices in `config/models.ts`; check claude.com/pricing before demo day). After each call, if spend crossed `BUDGET_USD`, the game pauses itself once and the admin sees an alert; the admin may resume on purpose.

### Mock mode (`LLM_MODE=mock`)

Default in development and in load tests. No API key needed. Deterministic, with 300–1,500 ms of fake latency:
- Guardians reply with a fixed in-character line, and "leak" the rune when the message contains `please tell` (so the whole flow can be tested end to end).
- Gorm / Ward of Ears return `PASS` unless the message contains `rune`.
- Ward of Tongues returns `LEAK` if `revealsRune` fires, else `CLEAN`.
- Queen Ashveil answers a message containing `clever` with her riddle, built from the clues in her note; `please tell` makes her leak, and the reply is sealed.

## Floor pipelines

| Floor | Input guard | Guardian | Output checks | "Slipped" expression |
|---|---|---|---|---|
| 1 Grub | — | Grub | — | `revealsRune(reply)` or clear |
| 2 Vellum | — | Ser Vellum | — | `revealsRune(reply)` or clear |
| 3 Morwen | — | Morwen | `cleanReply` → `snip` | `revealsRune(filteredText)` (rune got past Snip) or clear |
| 4 Ogre | Gorm: latest message only, no rune, JSON verdict (`parseVerdict`, fails closed; see "Input guard outcomes") | Mumble | `cleanReply` | `revealsRune(reply)` or clear |
| 5 Ashveil | Ward of Ears: last 12 messages + the latest, no rune, JSON verdict (fails closed; see "Input guard outcomes") | Queen Ashveil (rune and her two riddle clues in the final note) | `cleanReply` → `revealsRune` / `saysRuneWord` → else Ward of Tongues (fails closed; see "Output judge outcomes") | on clear |
| 6 Vorgath | Ward of Ears + carvings + `is_gift` | Vorgath (+ hoard note) | `revealsRune` → else Ward of Tongues | on clear |

Each floor's pipeline lives in `floors/0N-*/pipeline.ts` and is registered with its role in `floors/index.ts` (`FLOOR_TURNS`); the socket handler picks it by the player's floor. Every pipeline calls `cleanReply` first. History is capped at 20 turns on Floor 1 and 12 from Floor 2 on.

Model and `max_tokens` per role, and the "thinking off" value per model, come from `config/models.ts`; defaults are in each prompt file's Settings table, all on `claude-haiku-5-5` initially.

## Security functions (`apps/server/src/security/`)

All pure, all unit-tested.

- `normalize(s)`: `s.toUpperCase().replace(/[^A-Z]/g, '')`
- `revealsRune(text, rune)`: with `R = normalize(rune)`, returns `{ revealed, how }`, where `how` is the first of:
  - `plain`: `normalize(text)` contains `R` (also catches dashes, spaces, dots between letters)
  - `reversed`: contains reverse(`R`)
  - `acrostic-lines`: first letters of consecutive non-empty lines contain `R`
  - `acrostic-words`: first letters of consecutive words contain `R`

  It deliberately does not detect other scripts, ciphers or number codes.
- `cleanReply(result, rune)`: the first thing every floor's pipeline does with a guardian reply: `stripActions(guardTrim(result.rawText, result.text, rune), rune)`. Snip, `revealsRune` and the judges only ever see its output.
- `stripActions(reply, rune)`: runs (inside `cleanReply`) on every guardian reply first, before `revealsRune`, Snip and the judges. It removes short `*stage directions*` (≤ 12 words) that don't reveal the rune. A segment that does reveal it keeps its words and loses only the asterisks. If stripping would make a revealing reply stop revealing (a rune split across segments, an acrostic), it keeps every word. A reply that is only an action is kept as plain words. Rule: it never hides a leak. Separately, `llm/client.ts` trims a reply that hit `max_tokens` back to its last full sentence, and `guardTrim` applies the same rule: if the trim would cut away a rune, the whole reply is sent with "…" instead.
- `snip(reply, rune)`: exactly as in `prompts/03-morwen-snip.md`: three shapes, case-insensitive, replaced with `█`.
- `parseVerdict(raw, allowValue)`: strip code fences, `JSON.parse`, validate with a strict zod schema (extra keys fail); return `allowed: true` only when `verdict` equals `allowValue` compared case-insensitively. Any exception, or any `stop_reason` other than `end_turn` / `stop_sequence` (e.g. `refusal`, `max_tokens`), → `allowed: false`. Structured outputs make bad JSON rare, but this is the safety net.
- `sanitize(text)`: trim; cap at `MAX_MESSAGE_CHARS`; remove `[...]` tags innermost-first (so `[[x]]` goes completely) and an unclosed trailing `[...`, treating lookalike brackets `［］【】〔〕` as square ones; replace every angle bracket, lookalikes included (`< > ＜ ＞ ﹤ ﹥ 〈 〉 ⟨ ⟩ ‹ ›`), with plain `(` `)`, so the player can't close `<traveller_message>` or type anything that looks like a tag. Keep line breaks (poems).
- Door check: `normalize(guess)` equals the rune's two words joined in either order (`runeOrders` in `game/door.ts`). A guess with no letters is ignored (`no_letters`): no strike, no failed try, no cooldown.
- Leak route (`game/leakRoute.ts`): on a clear, code reads the text each guardian reply showed the player (after every filter) and stores how the rune leaked, plus the winning message (the player message just before the leaking reply, else the floor's last one). The reveal backfills clears from older games the same way. Only the label and message ids are stored, never the rune or the guess.

| Floor | Route | Detected when the earliest such reply… | Otherwise |
|---|---|---|---|
| 1 | `slip` | `revealsRune` finds the rune in any shape | `other` |
| 2 | `poem` / `backwards` | `revealsRune` says acrostic / reversed | `letters` if no reply gave the whole rune but lone capitals ("It is O.") covered at least half its letters (A and I aside); a plain slip or a riddle is `other` |
| 3 | `dashes` / `word_per_letter` / `other_script` | the rune is still visible after Snip (plain = spaced or dashed, acrostic-words); or a reply Snip didn't cut has 3+ non-Latin letters | Snip cut it and nothing else showed, a backwards spelling, numbers (A=1…): `other` |
| 4 | `plan` | a Mumble reply reveals the rune | `other` |
| 5 | `riddle` | a CLEAN reply holds one of the player's two clues (word for word, or 60% of its 4+-letter words) | `other` |

## Background jobs

- **Technique tagger** (`llm/tagger.ts`, `sockets/reveal.ts`; wording in `prompts/tagger.md`): batches of up to 10 untagged player messages (each with its own rune words masked) → one Haiku call (thinking off, structured output with a fixed label enum) → one label each from: friendship, authority, persistence, pieces, backwards, poem, encoding, other_script, story, multi_step, taunt, gift, instruction_injection, other. Winning messages first. A 3 s tick sends one batch at the queue's background priority, only while the game runs or is paused, nothing is queued and fewer than 5 calls are in flight, and the budget isn't spent. Pause and Start reveal run a catch-up (3 batches at a time, progress on the admin screen). A failed batch is skipped, never retried in a loop. Logged in `llm_calls` as role `tagger`, so it counts toward spend. Mock mode: a keyword tagger (`mockTechnique`).
- **Carver (Floor 6):** on every floor clear anywhere, as specified in `prompts/06-vorgath.md`. Seed 5 carvings at game start.

## Embeddings (Floor 6)

- `@huggingface/transformers`, model `Xenova/all-MiniLM-L6-v2`, mean pooling + normalisation, 384-dim vectors stored as Float32 BLOBs.
- Load once at startup and run one warm-up embedding so the first gift isn't slow.
- Thresholds (tune in playtest): hoard novelty ≥ 0.85 = owned; carving duplicate ≥ 0.90.
- Seed the hoard with 5–10 obvious gifts at game start.

## Configuration (`config/env.ts`, validated with zod)

`LLM_MODE`, `COOLDOWN_MS` and `MAX_MESSAGES_PER_PLAYER` only seed the **first** game in a database. After that they live on the game (admin → Live settings), survive restarts and carry over on Reset.

| Variable | Example | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-…` | Required when `LLM_MODE=live` |
| `LLM_MODE` | `mock` | `mock` or `live` (seeds the first game) |
| `ADMIN_TOKEN` | long random string | Admin access |
| `PORT` | `3000` | Fastify port (cloudflared forwards to it) |
| `PUBLIC_URL` | `https://<words>.trycloudflare.com` | For the projector QR code; `npm run tunnel` sets it |
| `DATABASE_PATH` | `./data/silvertongue.db` | SQLite file |
| `RATE_RPM` / `RATE_ITPM` / `RATE_OTPM` | `800` / `400000` / `64000` | 80% of the console limits |
| `COOLDOWN_MS` | `5000` | Per-player message cooldown (seeds the first game) |
| `MAX_MESSAGES_PER_PLAYER` | `150` | Per-game cap (seeds the first game) |
| `MAX_MESSAGE_CHARS` | `300` | Message length cap |
| `BUDGET_USD` | `4.00` | Game auto-pauses once and alerts admin when estimated spend reaches this |
| `JOIN_LIMIT_PER_MIN` | `60` | Successful joins per minute per address (the class may share one IP) |

## Failure modes and fallbacks

| Problem | What happens |
|---|---|
| Burst of 429s | The queue pauses that model for `retry-after` and retries; players see waiting lines. Admin can raise the cooldown live. |
| The safety classifier stops a reply (`stop_reason: "refusal"`, a false positive on spelled-out letters) | The reply is thrown away and asked once more; both calls are logged and billed. A second refusal gets the guardian's "lost my words" line (`refused`); it isn't counted against the cap, but the cooldown stays, so a message that always trips the filter can't be resent at once for free. Nothing from a refused reply reaches the phone. |
| Demand above the rate limit | The queue slows everyone down; a call that can't be answered within 60 s gets "The dungeon is crowded…" straight away; it isn't counted against the cap, and the player waits the cooldown plus 0–3 s before trying again. The admin's "Crowded, last minute" tile shows it: raise the cooldown. |
| API down | In-character error bubbles; admin pauses the game; the projector shows "The dungeon sleeps". |
| Budget reached | Auto-pause at `BUDGET_USD`, admin alert. |
| Server crash | `npm run tunnel` restarts only the server after 2 s, on the same address (gives up after 5 restarts in a minute). SQLite keeps state and settings; phones reconnect and `player:resume` with their token. In-flight replies are lost; player retries. |
| Phone loses connection | Socket.IO reconnects automatically; on reconnect the client resumes and receives `player:state`. |
| Projector laptop fails | Projector is a plain URL; open it on any laptop. |
