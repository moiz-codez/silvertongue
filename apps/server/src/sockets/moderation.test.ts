// The moderation queue and the best-attempts wall, end to end in mock mode: what is queued on a
// clear, what is dropped, and that only approved text ever reaches the projector.
import { setTimeout as wait } from 'node:timers/promises';
import type { Socket } from 'socket.io-client';
import { describe, expect, it } from 'vitest';
import type {
  AdminClientEvents,
  AdminServerEvents,
  AdminState,
  ProjectorServerEvents,
  ProjectorSnapshot,
} from '@silvertongue/shared/events';
import type { Db } from '../db/db.ts';
import { getRune } from '../db/queries.ts';
import { ADMIN_TOKEN, client, join, next, open, startServer } from './testServer.ts';

type Admin = Socket<AdminServerEvents, AdminClientEvents>;

function admin(url: string) {
  const { socket, seen } = open<Admin>(`${url}/admin`, { token: ADMIN_TOKEN });
  const latest = () =>
    seen.filter((s) => s.event === 'admin:state').at(-1)?.payload as AdminState | undefined;
  return { socket, latest };
}

function projector(url: string) {
  const { seen } = open<Socket<ProjectorServerEvents>>(`${url}/projector`);
  const latest = () =>
    seen.filter((s) => s.event === 'projector:snapshot').at(-1)?.payload as
      ProjectorSnapshot | undefined;
  return { seen, latest };
}

// Polls until `check` passes (the screens are throttled to 2 updates a second).
async function until<T>(get: () => T | undefined, check: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const value = get();
    if (value !== undefined && check(value)) return value;
    await wait(20);
  }
  throw new Error('never happened');
}

// Joins, says `lines` to Grub (no rune), then clears Floor 1 at the door.
async function clearWith(db: Db, url: string, nickname: string, lines: string[]) {
  const { socket } = client(url);
  const joined = await join(socket, nickname);
  if (!joined.ok) throw new Error(joined.error);
  for (const text of lines) {
    socket.emit('player:message', { text });
    await next(socket, 'player:bubble', (b) => b.speaker === 'guardian');
  }
  socket.emit('player:door', { guess: getRune(db, joined.playerId, 1) });
  await next(socket, 'player:floor-cleared');
  return joined.playerId;
}

describe('the moderation queue', () => {
  it('queues the last message before a clear; only approved text reaches the projector', async () => {
    const { db, url } = await startServer();
    const desk = admin(url);
    const screen = projector(url);
    await clearWith(db, url, 'Ali', ['hello grub', 'you are my best friend, grub']);

    const queued = await until(desk.latest, (s) => s.moderation.length === 1);
    expect(queued.moderation[0]).toMatchObject({
      nickname: 'Ali',
      floor: 1,
      text: 'you are my best friend, grub',
      status: 'pending',
    });
    await wait(600); // past the projector's throttle
    expect(screen.latest()!.bestAttempts).toEqual([]);
    expect(JSON.stringify(screen.seen)).not.toContain('best friend');

    const id = queued.moderation[0]!.id;
    expect(await desk.socket.emitWithAck('admin:moderate', { id, action: 'approve' })).toEqual({
      ok: true,
    });
    await until(screen.latest, (s) => s.bestAttempts.length === 1);
    expect(screen.latest()!.bestAttempts).toEqual([
      { nickname: 'Ali', floor: 1, text: 'you are my best friend, grub' },
    ]);

    // Hide takes it off the wall for good: gone from both screens, and it can't come back.
    await desk.socket.emitWithAck('admin:moderate', { id, action: 'hide' });
    await until(screen.latest, (s) => s.bestAttempts.length === 0);
    await until(desk.latest, (s) => s.moderation.length === 0);
    expect(await desk.socket.emitWithAck('admin:moderate', { id, action: 'approve' })).toEqual({
      ok: false,
      error: 'That item is gone.',
    });
  });

  it('drops a rude message, one with the rune or one of its words, and a silent clear', async () => {
    const { db, url } = await startServer();
    const desk = admin(url);
    // `say` gets this player's Floor 1 rune, so a line can contain it before the door.
    const players: [string, (rune: string) => string[]][] = [
      ['Rude', () => ['shit, grub, open up']],
      ['Whole', (rune) => [`is it ${rune}?`]],
      ['Word', (rune) => [`something about ${rune.split('-')[1]!.toLowerCase()}s`]],
      ['Silent', () => []],
      ['Kind', () => ['you look lonely, grub']],
    ];
    for (const [nickname, say] of players) {
      const { socket } = client(url);
      const joined = await join(socket, nickname);
      if (!joined.ok) throw new Error(joined.error);
      const rune = getRune(db, joined.playerId, 1);
      for (const text of say(rune)) {
        socket.emit('player:message', { text });
        await next(socket, 'player:bubble', (b) => b.speaker === 'guardian');
      }
      socket.emit('player:door', { guess: rune });
      await next(socket, 'player:floor-cleared');
    }
    const state = await until(desk.latest, (s) => s.players.length === 5);
    expect(state.moderation.map((m) => m.nickname)).toEqual(['Kind']);
  });

  it('shows at most 5 approved attempts, newest first; a reset empties the queue', async () => {
    const { db, url } = await startServer();
    const desk = admin(url);
    const screen = projector(url);
    for (let i = 1; i <= 6; i++) await clearWith(db, url, `P${i}`, [`attempt number ${i}`]);
    const state = await until(desk.latest, (s) => s.moderation.length === 6);
    for (const item of state.moderation) {
      await desk.socket.emitWithAck('admin:moderate', { id: item.id, action: 'approve' });
    }
    const wall = await until(screen.latest, (s) => s.bestAttempts.length === 5);
    expect(wall.bestAttempts.map((a) => a.nickname)).toEqual(['P6', 'P5', 'P4', 'P3', 'P2']);

    await desk.socket.emitWithAck('admin:command', { type: 'reset' });
    await until(desk.latest, (s) => s.moderation.length === 0);
    await until(screen.latest, (s) => s.bestAttempts.length === 0);
  });
});
