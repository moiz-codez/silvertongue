// The notes on the wall, end to end in mock mode: what unlocks them, what doesn't, and what the
// projector is allowed to say about them.
import { setTimeout as wait } from 'node:timers/promises';
import type { Socket } from 'socket.io-client';
import { describe, expect, it } from 'vitest';
import type { ProjectorServerEvents, ProjectorSnapshot } from '@silvertongue/shared/events';
import { ROLES } from '../config/models.ts';
import type { Db } from '../db/db.ts';
import { getRune } from '../db/queries.ts';
import { HINTS } from '../game/hints.ts';
import { DeadlineError, type Complete } from '../llm/client.ts';
import { client, join, next, open, startServer } from './testServer.ts';

const failedTries = (db: Db, playerId: string, floor = 1) =>
  (
    db
      .prepare('SELECT failed_tries FROM floor_progress WHERE player_id = ? AND floor = ?')
      .get(playerId, floor) as { failed_tries: number }
  ).failed_tries;
const setFailedTries = (db: Db, playerId: string, tries: number, floor = 1) =>
  db
    .prepare('UPDATE floor_progress SET failed_tries = ? WHERE player_id = ? AND floor = ?')
    .run(tries, playerId, floor);

// A phone that joined; `id` is their player id.
async function phone(url: string, nickname = 'Ali') {
  const { socket, seen } = client(url);
  const joined = await join(socket, nickname);
  if (!joined.ok) throw new Error(joined.error);
  return { socket, seen, id: joined.playerId, token: joined.token };
}

// The state the server sends after the next answer (a bubble, an error or a door result).
async function wrongGuess(socket: Awaited<ReturnType<typeof phone>>['socket']) {
  const state = next(socket, 'player:state');
  socket.emit('player:door', { guess: 'NOT-IT' });
  return state;
}

describe('notes on the wall', () => {
  it('unlocks note 1 at 10 failed tries and note 2 at 20, from messages and wrong guesses', async () => {
    const { db, url } = await startServer();
    const ali = await phone(url);
    setFailedTries(db, ali.id, 9);
    expect((await wrongGuess(ali.socket)).notes).toEqual([HINTS[1]![0]]);

    setFailedTries(db, ali.id, 19);
    db.prepare('UPDATE floor_progress SET wrong_door_streak = 0, door_locked_until = NULL').run();
    const state = next(ali.socket, 'player:state', (s) => s.notes.length === 2);
    ali.socket.emit('player:message', { text: 'hello grub' });
    expect((await state).notes).toEqual([...HINTS[1]!]);
  });

  it('keeps unlocked notes after a refresh', async () => {
    const { db, url } = await startServer();
    const ali = await phone(url);
    setFailedTries(db, ali.id, 12);
    const other = client(url);
    const state = next(other.socket, 'player:state');
    await other.socket.emitWithAck('player:resume', { token: ali.token });
    expect((await state).notes).toEqual([HINTS[1]![0]]);
  });

  it('does not count a refusal or a crowded queue (guard errors: see the Floor 4–5 tests)', async () => {
    const refusing: Complete = async (req) => ({
      text: 'Ooh',
      rawText: 'Ooh',
      stopReason: 'refusal',
      model: ROLES[req.role].model,
      usage: { input_tokens: 0, output_tokens: 0 },
      latencyMs: 0,
    });
    const crowded: Complete = async () => {
      throw new DeadlineError();
    };
    for (const complete of [refusing, crowded]) {
      const { db, url } = await startServer({}, complete);
      const ali = await phone(url);
      setFailedTries(db, ali.id, 9);
      let errored = false;
      ali.socket.on('player:error', () => (errored = true));
      const state = next(ali.socket, 'player:state', () => errored); // the state after the error
      ali.socket.emit('player:message', { text: 'hello grub' });
      expect((await state).notes).toEqual([]);
      expect(failedTries(db, ali.id)).toBe(9);
    }
  });

  it('counts at most one failed try for 20 rapid wrong guesses inside one cooldown', async () => {
    const { db, url } = await startServer({ COOLDOWN_MS: '5000' });
    const ali = await phone(url);
    for (let i = 0; i < 20; i++) ali.socket.emit('player:door', { guess: 'NOT-IT' });
    await next(ali.socket, 'player:error', (e) => e.code === 'door_cooldown');
    await wait(200); // let every guess arrive
    expect(failedTries(db, ali.id)).toBe(1);
    const states = ali.seen.filter((s) => s.event === 'player:state');
    expect((states.at(-1)!.payload as { doorCooldownMs: number }).doorCooldownMs).toBeGreaterThan(
      4000,
    );
  });

  it('ignores guesses with no letters: no try, no strike, no cooldown', async () => {
    const { db, url } = await startServer({ COOLDOWN_MS: '5000' });
    const ali = await phone(url);
    setFailedTries(db, ali.id, 9); // one more failed try would unlock a note
    for (let i = 0; i < 3; i++) {
      const result = next(ali.socket, 'player:door-result');
      ali.socket.emit('player:door', { guess: '███' });
      expect(await result).toEqual({ correct: false, lockedMs: 0, noLetters: true });
    }
    expect(failedTries(db, ali.id)).toBe(9);
    expect(db.prepare('SELECT COUNT(*) AS n FROM door_attempts').get()).toEqual({ n: 0 });
    expect(
      db.prepare('SELECT wrong_door_streak, door_locked_until FROM floor_progress').get(),
    ).toEqual({ wrong_door_streak: 0, door_locked_until: null });

    // No door cooldown started: the real rune opens it straight away.
    ali.socket.emit('player:door', { guess: getRune(db, ali.id, 1) });
    expect(await next(ali.socket, 'player:door-result')).toEqual({ correct: true, lockedMs: 0 });
  });

  it('puts one "note has appeared" line per floor on the projector, never the note', async () => {
    const { db, url } = await startServer();
    const { seen } = open<Socket<ProjectorServerEvents>>(`${url}/projector`);
    for (const name of ['Ali', 'Sara']) {
      const p = await phone(url, name);
      setFailedTries(db, p.id, 9);
      await wrongGuess(p.socket);
    }
    let last: ProjectorSnapshot | undefined;
    for (let i = 0; i < 100 && !last?.feed.length; i++) {
      await wait(20);
      last = seen.filter((s) => s.event === 'projector:snapshot').at(-1)?.payload as
        ProjectorSnapshot | undefined;
    }
    expect(last!.feed).toEqual([
      { gameMs: expect.any(Number), type: 'note', text: 'A note has appeared on Floor 1.' },
    ]);
    const everything = JSON.stringify(seen);
    for (const note of Object.values(HINTS).flat()) expect(everything).not.toContain(note);
  });
});
