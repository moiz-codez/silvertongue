import { describe, expect, it } from 'vitest';
import { applyCommand, elapsedMs, type GameClock, type GameCommand } from './state.ts';

const lobby: GameClock = { status: 'lobby', started_at: null, paused_at: null, paused_ms: 0 };

// Runs commands in order and returns the final game, failing the test on a refused move.
function run(start: GameClock, steps: [GameCommand, number][]): GameClock {
  return steps.reduce((game, [command, now]) => {
    const result = applyCommand(game, command, now);
    if (!result.ok) throw new Error(result.error);
    return result.game;
  }, start);
}

describe('applyCommand', () => {
  it('follows lobby → running ⇄ paused → reveal → ended', () => {
    const game = run(lobby, [
      ['start', 1000],
      ['pause', 2000],
      ['resume', 5000],
      ['reveal', 9000],
      ['end', 10_000],
    ]);
    expect(game.status).toBe('ended');
  });

  it('refuses moves that make no sense, with a readable reason', () => {
    expect(applyCommand(lobby, 'pause', 1)).toEqual({
      ok: false,
      error: "Can't pause while the game is lobby.",
    });
    const running = run(lobby, [['start', 1]]);
    expect(applyCommand(running, 'start', 2).ok).toBe(false);
    expect(applyCommand(running, 'resume', 2).ok).toBe(false);
    const ended = run(lobby, [['end', 1]]);
    for (const command of ['start', 'pause', 'resume', 'reveal', 'end'] as const) {
      expect(applyCommand(ended, command, 2).ok).toBe(false);
    }
  });

  it('can end a game straight from the lobby without starting the clock', () => {
    expect(run(lobby, [['end', 1]])).toMatchObject({ status: 'ended', started_at: null });
  });
});

describe('elapsedMs', () => {
  it('is zero before the start', () => {
    expect(elapsedMs(lobby, 5000)).toBe(0);
  });

  it('counts running time only', () => {
    const paused = run(lobby, [
      ['start', 1000],
      ['pause', 4000],
    ]);
    expect(elapsedMs(paused, 60_000)).toBe(3000); // frozen while paused

    const resumed = run(paused, [['resume', 10_000]]);
    expect(elapsedMs(resumed, 12_000)).toBe(5000); // 3 s before + 2 s after the pause
  });

  it('freezes at the reveal, even when revealed from a pause', () => {
    const revealed = run(lobby, [
      ['start', 0],
      ['pause', 1000],
      ['reveal', 5000],
    ]);
    expect(elapsedMs(revealed, 99_000)).toBe(1000);
  });
});
