import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openDb } from './db.ts';
import {
  clearFloor,
  createGame,
  createPlayer,
  getCurrentGame,
  getPlayer,
  getProgress,
  saveGame,
  shiftFloorClocks,
  startFloorClocks,
  isFloorClearedInGame,
  isNicknameTaken,
} from './queries.ts';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silvertongue-db-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const SEED = { cooldown_ms: 5000, max_messages: 150, llm_mode: 'mock' } as const;
const runes = ['EMBER-FANG', 'IRON-MOTH', 'SALT-RIVER', 'ASH-LANTERN', 'FROST-BELL', 'BONE-HARP'];

it('uses WAL mode and survives a restart without resetting the game', () => {
  const file = path.join(dir, 'game.db');
  const db1 = openDb(file);
  expect(db1.pragma('journal_mode', { simple: true })).toBe('wal');
  const gameId = getCurrentGame(db1, 1000, SEED).id;
  const playerId = createPlayer(db1, {
    gameId,
    nickname: 'Ali',
    tokenHash: 'h1',
    runes,
    now: 1000,
  });
  db1.close();

  const db2 = openDb(file); // "server restart"
  expect(getCurrentGame(db2, 2000, SEED).id).toBe(gameId);
  expect(getPlayer(db2, playerId).nickname).toBe('Ali');
  db2.close();
});

it('treats nicknames case-insensitively within a game', () => {
  const db = openDb(':memory:');
  const gameId = getCurrentGame(db, 1000, SEED).id;
  createPlayer(db, { gameId, nickname: 'Ali', tokenHash: 'h1', runes, now: 1000 });
  expect(isNicknameTaken(db, gameId, 'ali')).toBe(true);
  expect(isNicknameTaken(db, gameId, 'Sara')).toBe(false);
});

it('scopes first blood to one game', () => {
  const db = openDb(':memory:');
  const gameA = getCurrentGame(db, 1000, SEED).id;
  const ali = createPlayer(db, {
    gameId: gameA,
    nickname: 'Ali',
    tokenHash: 'h1',
    runes,
    now: 1000,
  });
  clearFloor(db, { playerId: ali, floor: 1, points: 100, firstBlood: true, now: 2000 });

  db.prepare("UPDATE games SET status = 'ended' WHERE id = ?").run(gameA);
  const gameB = getCurrentGame(db, 3000, SEED).id;
  expect(gameB).not.toBe(gameA);
  expect(isFloorClearedInGame(db, gameA, 1)).toBe(true);
  expect(isFloorClearedInGame(db, gameB, 1)).toBe(false);
});

it('opens a new game in the lobby, and reuses a paused one after a restart', () => {
  const db = openDb(':memory:');
  const game = getCurrentGame(db, 1000, SEED);
  expect(game.status).toBe('lobby');

  saveGame(db, { ...game, status: 'paused', started_at: 1500, paused_at: 1800 }, 1800);
  expect(getCurrentGame(db, 2000, SEED)).toEqual({
    id: game.id,
    status: 'paused',
    started_at: 1500,
    paused_at: 1800,
    paused_ms: 0,
    budget_alert_at: null,
    ...SEED,
  });

  saveGame(db, { ...game, status: 'ended' }, 3000); // ended games are never reused
  const next = getCurrentGame(db, 4000, SEED);
  expect(next.id).not.toBe(game.id);
  expect(next.status).toBe('lobby');
});

it('migrates a version-1 file without losing data', () => {
  const file = path.join(dir, 'v1.db');
  const old = new Database(file);
  old.exec(`
    CREATE TABLE games (id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at INTEGER NOT NULL,
      started_at INTEGER, ended_at INTEGER);
    INSERT INTO games (id, status, created_at, started_at) VALUES ('g1', 'running', 1, 1);
    PRAGMA user_version = 1;`);
  old.close();

  const db = openDb(file);
  expect(db.pragma('user_version', { simple: true })).toBe(3);
  // A game from before settings were stored gets them from .env (the seed).
  expect(getCurrentGame(db, 2, SEED)).toMatchObject({
    id: 'g1',
    status: 'running',
    paused_ms: 0,
    ...SEED,
  });
  const columns = db.prepare('SELECT name FROM pragma_table_info(?)').all('projector_events');
  expect(columns.map((c) => (c as { name: string }).name)).toEqual([
    'id',
    'game_id',
    'player_id',
    'floor',
    'type',
    'game_ms',
    'created_at',
  ]);
  db.close();
});

it('starts lobby players at the start time, and skips paused time', () => {
  const db = openDb(':memory:');
  const gameId = getCurrentGame(db, 1000, SEED).id;
  const ali = createPlayer(db, { gameId, nickname: 'Ali', tokenHash: 'h1', runes, now: 1000 });

  startFloorClocks(db, gameId, 5000); // joined in the lobby at 1000, game started at 5000
  expect(getProgress(db, ali, 1).reached_at).toBe(5000);

  shiftFloorClocks(db, gameId, 8000, 30_000); // paused at 8000 for 30 s
  expect(getProgress(db, ali, 1).reached_at).toBe(35_000);
});

it('keeps live settings across a restart, and Reset carries them into the next game', () => {
  const file = path.join(dir, 'settings.db');
  const db1 = openDb(file);
  const game = getCurrentGame(db1, 1000, SEED);
  saveGame(db1, { ...game, llm_mode: 'live', cooldown_ms: 9000, max_messages: 40 }, 1100);
  db1.close();

  const db2 = openDb(file);
  const reloaded = getCurrentGame(db2, 2000, SEED); // .env still says mock: the game's own settings win
  expect(reloaded).toMatchObject({
    id: game.id,
    llm_mode: 'live',
    cooldown_ms: 9000,
    max_messages: 40,
  });
  const next = createGame(db2, 3000, reloaded);
  expect(next).toMatchObject({
    status: 'lobby',
    llm_mode: 'live',
    cooldown_ms: 9000,
    max_messages: 40,
  });
  expect(getCurrentGame(db2, 3100, SEED).id).toBe(next.id);
  db2.close();
});
