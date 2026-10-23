// Every SQL query lives here, as a typed function. Callers never write SQL.
// Rows returned here are server-side only: client payloads are built from them field by field.
import { randomUUID } from 'node:crypto';
import type { GameStatus } from '@silvertongue/shared/events';
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

export interface GameSettings {
  cooldown_ms: number;
  max_messages: number;
  llm_mode: 'mock' | 'live';
}

export interface GameRow extends GameSettings {
  id: string;
  status: GameStatus;
  started_at: number | null;
  paused_at: number | null;
  paused_ms: number;
  budget_alert_at: number | null;
}

export interface MessageRow {
  id: number;
  speaker: string;
  text: string;
  in_guardian_history: number;
  verdict: string | null;
}

// ---------- games ----------

const GAME_COLUMNS =
  'id, status, started_at, paused_at, paused_ms, cooldown_ms, max_messages, llm_mode, budget_alert_at';

// At startup: the newest game that isn't over, so a restart never resets progress.
// Only when every game has ended is a new one opened, in the lobby.
// `seed`: the settings for a brand-new game, or for a game from before settings were stored.
export function getCurrentGame(db: Db, now: number, seed: GameSettings): GameRow {
  const existing = db
    .prepare(
      `SELECT ${GAME_COLUMNS} FROM games WHERE status != 'ended' ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get() as
    (Omit<GameRow, keyof GameSettings> & Partial<Record<keyof GameSettings, null>>) | undefined;
  if (!existing) return createGame(db, now, seed);
  const game: GameRow = {
    ...existing,
    cooldown_ms: existing.cooldown_ms ?? seed.cooldown_ms,
    max_messages: existing.max_messages ?? seed.max_messages,
    llm_mode: existing.llm_mode ?? seed.llm_mode,
  };
  saveGame(db, game, now);
  return game;
}

export function createGame(db: Db, now: number, settings: GameSettings): GameRow {
  const game: GameRow = {
    id: randomUUID(),
    status: 'lobby',
    started_at: null,
    paused_at: null,
    paused_ms: 0,
    budget_alert_at: null,
    cooldown_ms: settings.cooldown_ms,
    max_messages: settings.max_messages,
    llm_mode: settings.llm_mode,
  };
  db.prepare("INSERT INTO games (id, status, created_at) VALUES (?, 'lobby', ?)").run(game.id, now);
  saveGame(db, game, now);
  return game;
}

export function saveGame(db: Db, game: GameRow, now: number): void {
  db.prepare(
    `UPDATE games SET status = ?, started_at = ?, paused_at = ?, paused_ms = ?,
       cooldown_ms = ?, max_messages = ?, llm_mode = ?, budget_alert_at = ?,
       ended_at = CASE WHEN ? = 'ended' THEN ? ELSE ended_at END
     WHERE id = ?`,
  ).run(
    game.status,
    game.started_at,
    game.paused_at,
    game.paused_ms,
    game.cooldown_ms,
    game.max_messages,
    game.llm_mode,
    game.budget_alert_at,
    game.status,
    now,
    game.id,
  );
}

// On Start: players who joined in the lobby start Floor 1's clock now, not when they joined.
export function startFloorClocks(db: Db, gameId: string, startedAt: number): void {
  db.prepare(
    `UPDATE floor_progress SET reached_at = ?
     WHERE floor = 1 AND cleared_at IS NULL AND reached_at < ?
       AND player_id IN (SELECT id FROM players WHERE game_id = ?)`,
  ).run(startedAt, startedAt, gameId);
}

// On Resume: time spent paused doesn't count against anyone's speed bonus.
export function shiftFloorClocks(
  db: Db,
  gameId: string,
  pausedAt: number,
  pausedFor: number,
): void {
  db.prepare(
    `UPDATE floor_progress SET reached_at = reached_at + ?
     WHERE cleared_at IS NULL AND reached_at < ?
       AND player_id IN (SELECT id FROM players WHERE game_id = ?)`,
  ).run(pausedFor, pausedAt, gameId);
}

export function gameSpendUsd(db: Db, gameId: string): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM llm_calls WHERE game_id = ?')
    .get(gameId) as { total: number };
  return row.total;
}

// ---------- players ----------

// `exceptPlayerId`: a rename may keep the player's own name in different letter case.
export function isNicknameTaken(
  db: Db,
  gameId: string,
  nickname: string,
  exceptPlayerId = '',
): boolean {
  return !!db
    .prepare('SELECT 1 FROM players WHERE game_id = ? AND nickname = ? AND id != ?')
    .get(gameId, nickname, exceptPlayerId);
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

// Everyone in the game, deepest and highest-scoring first (admin table and projector map).
export function listPlayers(db: Db, gameId: string): PlayerRow[] {
  return db
    .prepare(
      `SELECT id, game_id, nickname, floor, score, messages_sent, kicked FROM players
       WHERE game_id = ? ORDER BY floor DESC, score DESC, created_at`,
    )
    .all(gameId) as PlayerRow[];
}

export function kickPlayer(db: Db, playerId: string): void {
  db.prepare('UPDATE players SET kicked = 1 WHERE id = ?').run(playerId);
}

export function renamePlayer(db: Db, playerId: string, nickname: string): void {
  db.prepare('UPDATE players SET nickname = ? WHERE id = ?').run(nickname, playerId);
}

// ---------- projector feed ----------

export interface ProjectorEventRow {
  type: string;
  floor: number;
  game_ms: number;
  nickname: string; // the player's name NOW, not when it happened
}

export function insertProjectorEvent(
  db: Db,
  e: { gameId: string; playerId: string; floor: number; type: string; gameMs: number; now: number },
): void {
  db.prepare(
    `INSERT INTO projector_events (game_id, player_id, floor, type, game_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(e.gameId, e.playerId, e.floor, e.type, e.gameMs, e.now);
}

// "A note has appeared on Floor N": once per floor per game, whoever unlocked it first.
export function insertNoteEventOnce(
  db: Db,
  e: { gameId: string; playerId: string; floor: number; gameMs: number; now: number },
): void {
  db.prepare(
    `INSERT INTO projector_events (game_id, player_id, floor, type, game_ms, created_at)
     SELECT ?, ?, ?, 'note', ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM projector_events WHERE game_id = ? AND floor = ? AND type = 'note')`,
  ).run(e.gameId, e.playerId, e.floor, e.gameMs, e.now, e.gameId, e.floor);
}

// Newest first. Kicked players' lines disappear from the projector (a note line names nobody).
export function listProjectorEvents(db: Db, gameId: string, limit: number): ProjectorEventRow[] {
  return db
    .prepare(
      `SELECT e.type, e.floor, e.game_ms, p.nickname FROM projector_events e
       JOIN players p ON p.id = e.player_id
       WHERE e.game_id = ? AND (p.kicked = 0 OR e.type = 'note') ORDER BY e.id DESC LIMIT ?`,
    )
    .all(gameId, limit) as ProjectorEventRow[];
}

// ---------- the best-attempts wall ----------

export interface AttemptRow {
  id: number;
  floor: number;
  text: string;
  status: 'pending' | 'approved';
  created_at: number;
  nickname: string; // the player's name NOW
}

export function insertAttempt(
  db: Db,
  a: { gameId: string; playerId: string; floor: number; text: string; now: number },
): void {
  db.prepare(
    'INSERT INTO attempts (game_id, player_id, floor, text, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(a.gameId, a.playerId, a.floor, a.text, a.now);
}

// For the admin: everything not hidden (hidden rows are never selected again), newest first.
export function listAttemptsForAdmin(db: Db, gameId: string, limit = 50): AttemptRow[] {
  return db
    .prepare(
      `SELECT a.id, a.floor, a.text, a.status, a.created_at, p.nickname FROM attempts a
       JOIN players p ON p.id = a.player_id
       WHERE a.game_id = ? AND a.status != 'hidden' AND p.kicked = 0
       ORDER BY a.id DESC LIMIT ?`,
    )
    .all(gameId, limit) as AttemptRow[];
}

// For the projector: approved only, newest first, kicked players left out.
export function listApprovedAttempts(db: Db, gameId: string, limit: number): AttemptRow[] {
  return db
    .prepare(
      `SELECT a.id, a.floor, a.text, a.status, a.created_at, p.nickname FROM attempts a
       JOIN players p ON p.id = a.player_id
       WHERE a.game_id = ? AND a.status = 'approved' AND p.kicked = 0
       ORDER BY a.id DESC LIMIT ?`,
    )
    .all(gameId, limit) as AttemptRow[];
}

// Only this game's rows, and never a hidden one back: hidden is final. True if a row changed.
export function setAttemptStatus(
  db: Db,
  gameId: string,
  id: number,
  status: 'approved' | 'hidden',
): boolean {
  return (
    db
      .prepare("UPDATE attempts SET status = ? WHERE id = ? AND game_id = ? AND status != 'hidden'")
      .run(status, id, gameId).changes > 0
  );
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
  p: {
    playerId: string;
    floor: number;
    streak: number;
    lockedUntil: number | null;
    distance: number;
    now: number;
  },
): void {
  db.transaction(() => {
    db.prepare(
      `UPDATE floor_progress SET wrong_door_streak = ?, door_locked_until = ?, failed_tries = failed_tries + 1
       WHERE player_id = ? AND floor = ?`,
    ).run(p.streak, p.lockedUntil, p.playerId, p.floor);
    db.prepare(
      'INSERT INTO door_attempts (player_id, floor, correct, created_at, distance) VALUES (?, ?, 0, ?, ?)',
    ).run(p.playerId, p.floor, p.now, p.distance);
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
      'SELECT id, speaker, text, in_guardian_history, verdict FROM messages WHERE player_id = ? AND floor = ? ORDER BY id',
    )
    .all(playerId, floor) as MessageRow[];
}

// A player message whose reply failed stays on screen but is left out of what the guardian sees.
export function removeFromGuardianHistory(db: Db, messageId: number): void {
  db.prepare('UPDATE messages SET in_guardian_history = 0 WHERE id = ?').run(messageId);
}

// A guard's verdict. On a player message: PASS, SMASH / SEAL (a real block) or GUARD_ERROR (the
// guard failed). On a Floor 5 reply: CLEAN, LEAK (sealed) or GUARD_ERROR. The reveal counts only
// real blocks.
export function setMessageVerdict(db: Db, messageId: number, verdict: string): void {
  db.prepare('UPDATE messages SET verdict = ? WHERE id = ?').run(verdict, messageId);
}

// Real seals this game: the Ward of Ears' SEAL verdicts and the Ward of Tongues' LEAK ones.
export function countWardSeals(db: Db, gameId: string): { ears: number; tongues: number } {
  const row = db
    .prepare(
      "SELECT COUNT(*) FILTER (WHERE verdict = 'SEAL') AS ears, COUNT(*) FILTER (WHERE verdict = 'LEAK') AS tongues FROM messages WHERE game_id = ?",
    )
    .get(gameId) as { ears: number; tongues: number };
  return { ears: row.ears, tongues: row.tongues };
}

// The guard passed this message: record it, and only now let the guardian hear it.
export function passGuard(db: Db, messageId: number): void {
  db.prepare("UPDATE messages SET verdict = 'PASS', in_guardian_history = 1 WHERE id = ?").run(
    messageId,
  );
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
