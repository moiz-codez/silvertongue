import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openDb } from './db.ts';
import {
  clearFloor,
  createPlayer,
  getOrCreateRunningGame,
  getPlayer,
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

const runes = ['EMBER-FANG', 'IRON-MOTH', 'SALT-RIVER', 'ASH-LANTERN', 'FROST-BELL', 'BONE-HARP'];

it('uses WAL mode and survives a restart without resetting the game', () => {
  const file = path.join(dir, 'game.db');
  const db1 = openDb(file);
  expect(db1.pragma('journal_mode', { simple: true })).toBe('wal');
  const gameId = getOrCreateRunningGame(db1, 1000);
  const playerId = createPlayer(db1, {
    gameId,
    nickname: 'Ali',
    tokenHash: 'h1',
    runes,
    now: 1000,
  });
  db1.close();

  const db2 = openDb(file); // "server restart"
  expect(getOrCreateRunningGame(db2, 2000)).toBe(gameId);
  expect(getPlayer(db2, playerId).nickname).toBe('Ali');
  db2.close();
});

it('treats nicknames case-insensitively within a game', () => {
  const db = openDb(':memory:');
  const gameId = getOrCreateRunningGame(db, 1000);
  createPlayer(db, { gameId, nickname: 'Ali', tokenHash: 'h1', runes, now: 1000 });
  expect(isNicknameTaken(db, gameId, 'ali')).toBe(true);
  expect(isNicknameTaken(db, gameId, 'Sara')).toBe(false);
});

it('scopes first blood to one game', () => {
  const db = openDb(':memory:');
  const gameA = getOrCreateRunningGame(db, 1000);
  const ali = createPlayer(db, {
    gameId: gameA,
    nickname: 'Ali',
    tokenHash: 'h1',
    runes,
    now: 1000,
  });
  clearFloor(db, { playerId: ali, floor: 1, points: 100, firstBlood: true, now: 2000 });

  db.prepare("UPDATE games SET status = 'ended' WHERE id = ?").run(gameA);
  const gameB = getOrCreateRunningGame(db, 3000);
  expect(gameB).not.toBe(gameA);
  expect(isFloorClearedInGame(db, gameA, 1)).toBe(true);
  expect(isFloorClearedInGame(db, gameB, 1)).toBe(false);
});
