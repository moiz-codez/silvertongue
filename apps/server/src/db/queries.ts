// Every SQL query lives here, as a typed function. Callers never write SQL.
// Rows returned here are server-side only: client payloads are built from them field by field.
import { randomUUID } from 'node:crypto';
import type { Db } from './db.ts';

export interface PlayerRow {
  id: string;
  game_id: string;
  nickname: string;
  floor: number;
  score: number;
  messages_sent: number;
  kicked: number;
}

export interface ProgressRow {
  floor: number;
  reached_at: number;
  cleared_at: number | null;
  messages_used: number;
  failed_tries: number;
  wrong_door_streak: number;
  door_locked_until: number | null;
}

export interface MessageRow {
  id: number;
  speaker: string;
  text: string;
  in_guardian_history: number;
}

// ---------- games ----------

// Reuses the running game so a server restart never resets anyone's progress.
export function getOrCreateRunningGame(db: Db, now: number): string {
  const existing = db
    .prepare("SELECT id FROM games WHERE status = 'running' ORDER BY created_at DESC LIMIT 1")
    .get() as { id: string } | undefined;
  if (existing) return existing.id;

  const id = randomUUID();
  db.prepare(
    "INSERT INTO games (id, status, created_at, started_at) VALUES (?, 'running', ?, ?)",
  ).run(id, now, now);
  return id;
}

// ---------- players ----------

export function isNicknameTaken(db: Db, gameId: string, nickname: string): boolean {
  return !!db
    .prepare('SELECT 1 FROM players WHERE game_id = ? AND nickname = ?')
    .get(gameId, nickname);
}

// Creates the player, all their runes and their Floor 1 progress in one transaction.
export function createPlayer(
  db: Db,
  p: { gameId: string; nickname: string; tokenHash: string; runes: string[]; now: number },
): string {
  const id = randomUUID();
  db.transaction(() => {
    db.prepare(
      'INSERT INTO players (id, game_id, nickname, token_hash, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(id, p.gameId, p.nickname, p.tokenHash, p.now);
    const insertRune = db.prepare('INSERT INTO runes (player_id, floor, rune) VALUES (?, ?, ?)');
    p.runes.forEach((rune, i) => insertRune.run(id, i + 1, rune));
    db.prepare('INSERT INTO floor_progress (player_id, floor, reached_at) VALUES (?, 1, ?)').run(
      id,
      p.now,
    );
  })();
  return id;
}

export function findPlayerByTokenHash(db: Db, tokenHash: string): PlayerRow | undefined {
  return db
    .prepare(
      'SELECT id, game_id, nickname, floor, score, messages_sent, kicked FROM players WHERE token_hash = ?',
    )
    .get(tokenHash) as PlayerRow | undefined;
}

export function getPlayer(db: Db, playerId: string): PlayerRow {
  return db
    .prepare(
      'SELECT id, game_id, nickname, floor, score, messages_sent, kicked FROM players WHERE id = ?',
    )
    .get(playerId) as PlayerRow;
}

// SERVER ONLY. The result must never be put into anything sent to a client.
export function getRune(db: Db, playerId: string, floor: number): string {
  const row = db
    .prepare('SELECT rune FROM runes WHERE player_id = ? AND floor = ?')
    .get(playerId, floor) as { rune: string };
  return row.rune;
}

// ---------- floor progress ----------

export function getProgress(db: Db, playerId: string, floor: number): ProgressRow {
  return db
    .prepare(
      `SELECT floor, reached_at, cleared_at, messages_used, failed_tries, wrong_door_streak, door_locked_until
       FROM floor_progress WHERE player_id = ? AND floor = ?`,
    )
    .get(playerId, floor) as ProgressRow;
}

// A message the guardian answered: counts toward the cap, efficiency and "failed tries".
export function countPlayerMessage(db: Db, playerId: string, floor: number): void {
  db.transaction(() => {
    db.prepare('UPDATE players SET messages_sent = messages_sent + 1 WHERE id = ?').run(playerId);
    db.prepare(
      `UPDATE floor_progress SET messages_used = messages_used + 1, failed_tries = failed_tries + 1
       WHERE player_id = ? AND floor = ?`,
    ).run(playerId, floor);
  })();
}

export function recordWrongDoor(
  db: Db,
  p: { playerId: string; floor: number; streak: number; lockedUntil: number | null; now: number },
): void {
  db.transaction(() => {
    db.prepare(
      `UPDATE floor_progress SET wrong_door_streak = ?, door_locked_until = ?, failed_tries = failed_tries + 1
       WHERE player_id = ? AND floor = ?`,
    ).run(p.streak, p.lockedUntil, p.playerId, p.floor);
    db.prepare(
      'INSERT INTO door_attempts (player_id, floor, correct, created_at) VALUES (?, ?, 0, ?)',
    ).run(p.playerId, p.floor, p.now);
  })();
}

// First blood is per game: has anyone else in this game already cleared this floor?
export function isFloorClearedInGame(db: Db, gameId: string, floor: number): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM floor_progress fp JOIN players p ON p.id = fp.player_id
       WHERE p.game_id = ? AND fp.floor = ? AND fp.cleared_at IS NOT NULL`,
    )
    .get(gameId, floor);
}

// Marks the floor cleared, adds the points and moves the player down one floor.
export function clearFloor(
  db: Db,
  p: { playerId: string; floor: number; points: number; firstBlood: boolean; now: number },
): void {
  db.transaction(() => {
    db.prepare(
      `UPDATE floor_progress SET cleared_at = ?, first_blood = ?, wrong_door_streak = 0, door_locked_until = NULL
       WHERE player_id = ? AND floor = ?`,
    ).run(p.now, p.firstBlood ? 1 : 0, p.playerId, p.floor);
    db.prepare(
      'INSERT INTO door_attempts (player_id, floor, correct, created_at) VALUES (?, ?, 1, ?)',
    ).run(p.playerId, p.floor, p.now);
    db.prepare('UPDATE players SET score = score + ?, floor = floor + 1 WHERE id = ?').run(
      p.points,
      p.playerId,
    );
    if (p.floor < 6) {
      db.prepare(
        'INSERT OR IGNORE INTO floor_progress (player_id, floor, reached_at) VALUES (?, ?, ?)',
      ).run(p.playerId, p.floor + 1, p.now);
    }
  })();
}

// ---------- messages ----------

export function listFloorMessages(db: Db, playerId: string, floor: number): MessageRow[] {
  return db
    .prepare(
      'SELECT id, speaker, text, in_guardian_history FROM messages WHERE player_id = ? AND floor = ? ORDER BY id',
    )
    .all(playerId, floor) as MessageRow[];
}

// A player message whose reply failed stays on screen but is left out of what the guardian sees.
export function removeFromGuardianHistory(db: Db, messageId: number): void {
  db.prepare('UPDATE messages SET in_guardian_history = 0 WHERE id = ?').run(messageId);
}

export function insertMessage(
  db: Db,
  m: {
    gameId: string;
    playerId: string;
    floor: number;
    speaker: string;
    text: string;
    rawText?: string;
    inGuardianHistory?: boolean;
    now: number;
  },
): number {
  const result = db
    .prepare(
      `INSERT INTO messages (game_id, player_id, floor, speaker, text, raw_text, in_guardian_history, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      m.gameId,
      m.playerId,
      m.floor,
      m.speaker,
      m.text,
      m.rawText ?? null,
      m.inGuardianHistory === false ? 0 : 1,
      m.now,
    );
  return Number(result.lastInsertRowid);
}

// ---------- LLM call log ----------

export function insertLlmCall(
  db: Db,
  c: {
    gameId: string;
    playerId: string;
    floor: number;
    role: string;
    model: string;
    inputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    costUsd: number;
    latencyMs: number;
    status: string;
    now: number;
  },
): void {
  db.prepare(
    `INSERT INTO llm_calls (game_id, player_id, floor, role, model, input_tokens, cache_creation_tokens,
       cache_read_tokens, output_tokens, cost_usd, latency_ms, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    c.gameId,
    c.playerId,
    c.floor,
    c.role,
    c.model,
    c.inputTokens,
    c.cacheCreationTokens,
    c.cacheReadTokens,
    c.outputTokens,
    c.costUsd,
    c.latencyMs,
    c.status,
    c.now,
  );
}
