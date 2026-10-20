import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

const SCHEMA_VERSION = 2;

// Steps that bring an older file up to date. Key = the version the step upgrades FROM.
const MIGRATIONS: Record<number, string> = {
  1: `
    ALTER TABLE games ADD COLUMN paused_at INTEGER;
    ALTER TABLE games ADD COLUMN paused_ms INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE projector_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL, type TEXT NOT NULL, text TEXT NOT NULL,
      game_ms INTEGER NOT NULL, created_at INTEGER NOT NULL
    );`,
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
