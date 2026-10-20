import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

const SCHEMA_VERSION = 1;

// Opens (or creates) the database file. Pass ':memory:' in tests.
export function openDb(file: string): Db {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL'); // readers don't block the writer
  db.pragma('foreign_keys = ON');

  // user_version is our migration marker: 0 means a brand-new file.
  if (db.pragma('user_version', { simple: true }) === 0) {
    db.exec(fs.readFileSync(path.join(import.meta.dirname, 'schema.sql'), 'utf8'));
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }
  return db;
}
