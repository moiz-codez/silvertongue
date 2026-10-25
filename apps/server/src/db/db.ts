import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

const SCHEMA_VERSION = 7;

// Steps that bring an older file up to date. Key = the version the step upgrades FROM.
const MIGRATIONS: Record<number, string> = {
  1: `
    ALTER TABLE games ADD COLUMN paused_at INTEGER;
    ALTER TABLE games ADD COLUMN paused_ms INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE projector_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL, player_id TEXT NOT NULL REFERENCES players(id),
      floor INTEGER NOT NULL, type TEXT NOT NULL,
      game_ms INTEGER NOT NULL, created_at INTEGER NOT NULL
    );`,
  // Live settings live on the game. Older games get them filled in from .env when loaded.
  2: `
    ALTER TABLE games ADD COLUMN cooldown_ms INTEGER;
    ALTER TABLE games ADD COLUMN max_messages INTEGER;
    ALTER TABLE games ADD COLUMN llm_mode TEXT;
    ALTER TABLE games ADD COLUMN budget_alert_at INTEGER;`,
  // The moderation queue for the best-attempts wall.
  3: `
    CREATE TABLE attempts (                  -- winning messages waiting for the admin (M7)
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      player_id TEXT NOT NULL REFERENCES players(id),
      floor INTEGER NOT NULL,
      text TEXT NOT NULL,                     -- the player's own (sanitized) message
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','hidden')),
      created_at INTEGER NOT NULL
    );`,
  // How far each wrong door guess was from the rune (a number; the guess is never stored).
  4: `ALTER TABLE door_attempts ADD COLUMN distance INTEGER;`,
  // How each floor was cleared, for the reveal (a label and a message id, never the rune).
  5: `
    ALTER TABLE floor_progress ADD COLUMN leak_route TEXT;
    ALTER TABLE floor_progress ADD COLUMN winning_message_id INTEGER;
    ALTER TABLE floor_progress ADD COLUMN leak_message_id INTEGER;`,
  // Floor 6: carvings, the hoard, what each message met there, and the live switch.
  6: `
    CREATE TABLE carvings (                 -- Floor 6: tricks Vorgath has learned. Text is for the phone and admin, never the projector
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      number INTEGER NOT NULL,                -- "carving #12": 1, 2, 3… within the game, seeds first
      text TEXT NOT NULL,
      vector BLOB NOT NULL,                   -- 384 Float32 (embeddings/embed.ts), for the duplicate check
      source_floor INTEGER,                   -- the floor whose clear it describes; null for a seed
      player_id TEXT,                         -- whose clear it describes; null for a seed
      seeded INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      UNIQUE (game_id, number)
    );
    
    CREATE TABLE hoard (                    -- Floor 6: gifts Vorgath keeps. Text is for the admin only
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      player_id TEXT,                         -- null for a seed
      text TEXT NOT NULL,
      vector BLOB NOT NULL,
      seeded INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    ALTER TABLE messages ADD COLUMN carving_id INTEGER;
    ALTER TABLE messages ADD COLUMN hoard TEXT;
    ALTER TABLE games ADD COLUMN floor6_enabled INTEGER;`,
};

// Opens (or creates) the database file. Pass ':memory:' in tests.
export function openDb(file: string): Db {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL'); // readers don't block the writer
  db.pragma('foreign_keys = ON');

  // user_version is our migration marker: 0 means a brand-new file.
  let version = db.pragma('user_version', { simple: true }) as number;
  if (version === 0) {
    db.exec(fs.readFileSync(path.join(import.meta.dirname, 'schema.sql'), 'utf8'));
    version = SCHEMA_VERSION;
  }
  db.transaction(() => {
    for (; version < SCHEMA_VERSION; version++) db.exec(MIGRATIONS[version]!);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  })(); // all or nothing: a crash mid-migration leaves the old version intact
  return db;
}
