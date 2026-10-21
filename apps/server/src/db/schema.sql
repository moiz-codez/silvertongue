-- Silvertongue schema, version 3 (db.ts migrates older files). WAL mode and foreign keys are switched on in db.ts.
-- Tables for later milestones (carvings, hoard) are added when they're needed.

CREATE TABLE games (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('lobby','running','paused','reveal','ended')),
  created_at INTEGER NOT NULL, started_at INTEGER, ended_at INTEGER,
  paused_at INTEGER,                      -- set while paused
  paused_ms INTEGER NOT NULL DEFAULT 0,   -- total time spent paused, so the timer skips it
  -- Live settings, changed from the admin screen. The first game takes them from .env;
  -- Reset copies them into the next game, and a restart keeps them.
  cooldown_ms INTEGER, max_messages INTEGER, llm_mode TEXT,
  budget_alert_at INTEGER                 -- set when spend crossed BUDGET_USD and the game paused itself
);

CREATE TABLE players (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  nickname TEXT NOT NULL COLLATE NOCASE,  -- "Ali" and "ali" count as the same name
  token_hash TEXT NOT NULL UNIQUE,        -- sha256 of the session token; the token itself lives only on the phone
  floor INTEGER NOT NULL DEFAULT 1,       -- current floor (7 = finished)
  score INTEGER NOT NULL DEFAULT 0,
  messages_sent INTEGER NOT NULL DEFAULT 0,
  kicked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (game_id, nickname)
);

CREATE TABLE runes (                      -- SERVER ONLY. Never selected into a client payload.
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
  speaker TEXT NOT NULL,                  -- player | guardian | system (more speakers on later floors)
  text TEXT NOT NULL,                     -- what the player saw (filtered)
  raw_text TEXT,                          -- SERVER ONLY: unfiltered guardian output, when it differs from text
  verdict TEXT,
  in_guardian_history INTEGER NOT NULL DEFAULT 1,
  technique TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX messages_by_player_floor ON messages (player_id, floor, id);

CREATE TABLE door_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL, floor INTEGER NOT NULL,
  correct INTEGER NOT NULL, created_at INTEGER NOT NULL   -- the guess itself is never stored
);

CREATE TABLE llm_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT, player_id TEXT, floor INTEGER,
  role TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER, cache_creation_tokens INTEGER, cache_read_tokens INTEGER, output_tokens INTEGER,
  cost_usd REAL, latency_ms INTEGER,
  status TEXT NOT NULL,                   -- ok | rate_limited | error | timeout
  created_at INTEGER NOT NULL
);

-- What the projector feed shows. Text is written by the server; no player-written text in M2.
CREATE TABLE projector_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL REFERENCES players(id),
  floor INTEGER NOT NULL,
  type TEXT NOT NULL,                     -- first_blood | clear
  game_ms INTEGER NOT NULL,               -- time in the dungeon when it happened (for "08:31")
  created_at INTEGER NOT NULL
  -- no text column: the line is built when sent, from the player's CURRENT name,
  -- so a rename or kick also changes or removes their old lines on the projector
);
