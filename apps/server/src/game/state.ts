// The game's life: lobby → running ⇄ paused → reveal → ended. Only the admin moves it.
// Pure: takes a game and returns the next one; the caller saves it.
import type { GameStatus } from '@silvertongue/shared/events';

export type GameCommand = 'start' | 'pause' | 'resume' | 'reveal' | 'end';

export interface GameClock {
  status: GameStatus;
  started_at: number | null;
  paused_at: number | null; // while not running (after start): when the clock stopped
  paused_ms: number; // total time paused before the last resume
}

const MOVES: Record<GameCommand, { from: GameStatus[]; to: GameStatus }> = {
  start: { from: ['lobby'], to: 'running' },
  pause: { from: ['running'], to: 'paused' },
  resume: { from: ['paused'], to: 'running' },
  reveal: { from: ['running', 'paused'], to: 'reveal' },
  end: { from: ['lobby', 'running', 'paused', 'reveal'], to: 'ended' },
};

export function applyCommand<G extends GameClock>(
  game: G,
  command: GameCommand,
  now: number,
): { ok: true; game: G } | { ok: false; error: string } {
  const move = MOVES[command];
  if (!move.from.includes(game.status)) {
    return { ok: false, error: `Can't ${command} while the game is ${game.status}.` };
  }
  const next = { ...game, status: move.to };
  if (command === 'start') next.started_at = now;
  if (command === 'resume' && game.paused_at !== null) {
    next.paused_ms = game.paused_ms + (now - game.paused_at);
    next.paused_at = null;
  }
  // Pause, reveal and end stop the clock (if it is running).
  if (command !== 'start' && command !== 'resume' && next.paused_at === null) {
    next.paused_at = game.started_at === null ? null : now;
  }
  return { ok: true, game: next };
}

// Time in the dungeon: only while running counts.
export function elapsedMs(game: GameClock, now: number): number {
  if (game.started_at === null) return 0;
  return Math.max(0, (game.paused_at ?? now) - game.started_at - game.paused_ms);
}
