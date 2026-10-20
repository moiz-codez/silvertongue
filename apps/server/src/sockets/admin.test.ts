// The game master's controls, end to end in mock mode.
import type { Socket } from 'socket.io-client';
import { describe, expect, it } from 'vitest';
import type { AdminClientEvents, AdminServerEvents, AdminState } from '@silvertongue/shared/events';
import { getRune } from '../db/queries.ts';
import { ADMIN_TOKEN, client, join, next, open, startServer } from './testServer.ts';

type Admin = Socket<AdminServerEvents, AdminClientEvents>;

function admin(url: string, token = ADMIN_TOKEN) {
  const { socket, seen } = open<Admin>(`${url}/admin`, { token });
  const latest = () =>
    seen.filter((s) => s.event === 'admin:state').at(-1)?.payload as AdminState | undefined;
  return { socket, seen, latest };
}

async function joined(url: string, nickname: string) {
  const phone = client(url);
  const reply = await join(phone.socket, nickname);
  if (!reply.ok) throw new Error(reply.error);
  return { ...phone, ...reply };
}

describe('admin', () => {
  it('refuses a missing or wrong token before anything else', async () => {
    const { url } = await startServer();
    for (const token of ['', 'not-the-admin-token']) {
      const { socket, seen } = admin(url, token);
      const error = await new Promise<Error>((resolve) => socket.on('connect_error', resolve));
      expect(error.message).toBe('Wrong admin token.');
      expect(seen).toEqual([]);
    }
  });

  it('starts the game and moves every waiting phone onto Floor 1', async () => {
    const { url } = await startServer({}, undefined, []);
    const phone = await joined(url, 'Ali');
    const { socket } = admin(url);

    expect(await socket.emitWithAck('admin:command', { type: 'pause' })).toEqual({
      ok: false,
      error: "Can't pause while the game is lobby.",
    });
    const running = next(phone.socket, 'player:state', (s) => s.gameStatus === 'running');
    expect(await socket.emitWithAck('admin:command', { type: 'start' })).toEqual({ ok: true });
    expect(await running).toMatchObject({ floor: 1, floorReady: true });
  });

  it('pauses (server refuses messages) and resumes', async () => {
    const { url } = await startServer();
    const phone = await joined(url, 'Ali');
    const { socket } = admin(url);

    await socket.emitWithAck('admin:command', { type: 'pause' });
    phone.socket.emit('player:message', { text: 'hello?' });
    expect((await next(phone.socket, 'player:error')).message).toContain('holds its breath');

    await socket.emitWithAck('admin:command', { type: 'resume' });
    phone.socket.emit('player:message', { text: 'hello again' });
    await next(phone.socket, 'player:bubble', (b) => b.speaker === 'guardian');
  });

  it('kicks a player: disconnected, blocked, and shown as kicked', async () => {
    const { url } = await startServer();
    const phone = await joined(url, 'Ali');
    const { socket, latest } = admin(url);

    const kicked = next(phone.socket, 'player:kicked');
    expect(await socket.emitWithAck('admin:kick', { playerId: phone.playerId })).toEqual({
      ok: true,
    });
    await kicked;
    const again = client(url);
    expect(await again.socket.emitWithAck('player:resume', { token: phone.token })).toEqual({
      ok: false,
    });
    await new Promise((r) => setTimeout(r, 600));
    expect(latest()?.players).toEqual([expect.objectContaining({ nickname: 'Ali', kicked: true })]);
    expect(await socket.emitWithAck('admin:kick', { playerId: 'nobody' })).toMatchObject({
      ok: false,
    });
  });

  it('renames through the same filter as joining', async () => {
    const { url } = await startServer();
    const ali = await joined(url, 'Ali');
    await joined(url, 'Sara');
    const { socket } = admin(url);
    const rename = (nickname: string) =>
      socket.emitWithAck('admin:rename', { playerId: ali.playerId, nickname });

    expect((await rename('BigDick')).ok).toBe(false);
    expect(await rename('sara')).toEqual({
      ok: false,
      error: 'Someone in the dungeon already goes by that name.',
    });
    const renamed = next(ali.socket, 'player:state', (s) => s.nickname === 'Ali Baba');
    expect(await rename('  Ali   Baba ')).toEqual({ ok: true });
    await renamed;
  });

  it('resets: phones go back to Join and old tokens stop working', async () => {
    const { url } = await startServer();
    const phone = await joined(url, 'Ali');
    const { socket, latest } = admin(url);

    const reset = next(phone.socket, 'player:reset');
    expect(await socket.emitWithAck('admin:command', { type: 'reset' })).toEqual({ ok: true });
    await reset;
    expect(await client(url).socket.emitWithAck('player:resume', { token: phone.token })).toEqual({
      ok: false,
    });
    await new Promise((r) => setTimeout(r, 600));
    expect(latest()).toMatchObject({ status: 'lobby', players: [] });
  });

  it('never sees a rune, token or token hash', async () => {
    const { db, url } = await startServer();
    const { seen } = admin(url);
    const phone = await joined(url, 'Ali');
    phone.socket.emit('player:door', { guess: getRune(db, phone.playerId, 1) });
    await next(phone.socket, 'player:floor-cleared');
    await new Promise((r) => setTimeout(r, 600));

    const everything = JSON.stringify(seen);
    expect(everything).toContain('Ali');
    for (let floor = 1; floor <= 6; floor++) {
      expect(everything).not.toContain(getRune(db, phone.playerId, floor));
    }
    expect(everything).not.toContain(phone.token);
    const { token_hash } = db.prepare('SELECT token_hash FROM players').get() as {
      token_hash: string;
    };
    expect(everything).not.toContain(token_hash);
  });
});
