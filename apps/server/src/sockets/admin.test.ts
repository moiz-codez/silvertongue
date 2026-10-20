// The game master's controls, end to end in mock mode.
import type { Socket } from 'socket.io-client';
import { describe, expect, it } from 'vitest';
import type { AdminClientEvents, AdminServerEvents, AdminState } from '@silvertongue/shared/events';
import { getRune, saveGame } from '../db/queries.ts';
import type { Complete } from '../llm/client.ts';
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
    expect(await rename('ALI')).toEqual({ ok: true }); // their own name in other letters is fine
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

  it('applies live settings to every phone, and refuses bad values', async () => {
    const { url } = await startServer();
    const phone = await joined(url, 'Ali');
    const { socket, latest } = admin(url);

    expect(
      await socket.emitWithAck('admin:config', {
        cooldownMs: 999_999,
        maxMessages: 10,
        llmMode: 'mock',
      }),
    ).toEqual({ ok: false, error: 'Cooldown 0–60 s, messages 1–500.' });

    const capped = next(phone.socket, 'player:state', (s) => s.messagesLeft === 10);
    expect(
      await socket.emitWithAck('admin:config', {
        cooldownMs: 8000,
        maxMessages: 10,
        llmMode: 'mock',
      }),
    ).toEqual({ ok: true });
    await capped;

    // The new cooldown applies to the next message.
    const cooling = next(phone.socket, 'player:state', (s) => s.cooldownMs > 5000);
    phone.socket.emit('player:message', { text: 'hello' });
    await cooling;
    await new Promise((r) => setTimeout(r, 600));
    expect(latest()?.settings).toEqual({ cooldownMs: 8000, maxMessages: 10, llmMode: 'mock' });
  });

  it('refuses Live when the server has no API key', async () => {
    const { url } = await startServer();
    const { socket, latest } = admin(url);
    expect(
      await socket.emitWithAck('admin:config', {
        cooldownMs: 5000,
        maxMessages: 150,
        llmMode: 'live',
      }),
    ).toEqual({ ok: false, error: "The server has no ANTHROPIC_API_KEY, so it can't go Live." });
    await new Promise((r) => setTimeout(r, 600));
    expect(latest()).toMatchObject({ liveAvailable: false, settings: { llmMode: 'mock' } });
  });

  it('shows MOCK when a game saved as Live runs on a server without an API key', async () => {
    const { db, ctx, url } = await startServer();
    ctx.game = { ...ctx.game, llm_mode: 'live' }; // e.g. saved as Live, then restarted without the key
    saveGame(db, ctx.game, Date.now());
    const { latest } = admin(url);
    await new Promise((r) => setTimeout(r, 300));
    expect(latest()).toMatchObject({ liveAvailable: false, settings: { llmMode: 'mock' } });
  });

  it('keeps Live and the other settings through a Reset', async () => {
    // A fake key: no call is made, the mode is only switched.
    const { url } = await startServer({ ANTHROPIC_API_KEY: 'sk-ant-not-a-real-key' });
    const { socket, latest } = admin(url);
    expect(
      await socket.emitWithAck('admin:config', {
        cooldownMs: 7000,
        maxMessages: 90,
        llmMode: 'live',
      }),
    ).toEqual({ ok: true });
    expect(await socket.emitWithAck('admin:command', { type: 'reset' })).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 600));
    expect(latest()).toMatchObject({
      status: 'lobby',
      liveAvailable: true,
      settings: { cooldownMs: 7000, maxMessages: 90, llmMode: 'live' },
    });
  });

  it('shows queue health', async () => {
    const { url } = await startServer();
    const phone = await joined(url, 'Ali');
    const { latest } = admin(url);
    phone.socket.emit('player:message', { text: 'hello' });
    await next(phone.socket, 'player:bubble', (b) => b.speaker === 'guardian');
    await new Promise((r) => setTimeout(r, 600));
    expect(latest()?.health).toMatchObject({
      queued: 0,
      inFlight: 0,
      rateLimited1m: 0,
      callsLastMin: 1,
    });
    expect(latest()?.health.memoryMb).toBeGreaterThan(0);
  });

  it('pauses the game by itself when spend crosses the budget, once', async () => {
    // Every reply "costs" $1: 100M cache reads at $0.01 per million (they skip the rate limit).
    const pricey: Complete = async () => ({
      text: 'Mushroom?',
      rawText: 'Mushroom?',
      model: 'claude-haiku-5-5',
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 100_000_000 },
      latencyMs: 1,
    });
    const { url } = await startServer({ BUDGET_USD: '0.5' }, pricey);
    const phone = await joined(url, 'Ali');
    const { socket, latest } = admin(url);

    const paused = next(phone.socket, 'player:state', (s) => s.gameStatus === 'paused');
    phone.socket.emit('player:message', { text: 'hello' });
    await paused;
    await new Promise((r) => setTimeout(r, 600));
    expect(latest()).toMatchObject({ status: 'paused', budgetAlert: true });

    // The admin resumes on purpose: the next call doesn't pause again.
    expect(await socket.emitWithAck('admin:command', { type: 'resume' })).toEqual({ ok: true });
    phone.socket.emit('player:message', { text: 'hello again' });
    await next(phone.socket, 'player:bubble', (b) => b.speaker === 'guardian');
    await new Promise((r) => setTimeout(r, 600));
    expect(latest()).toMatchObject({ status: 'running', budgetAlert: true });
  });

  it('locks out an address that guesses through the tunnel, but never this laptop', async () => {
    const { url } = await startServer();
    const refusal = (s: Admin) =>
      new Promise<string>((resolve) => s.on('connect_error', (e) => resolve(e.message)));

    // Through the tunnel: 5 wrong tokens, then even the right one waits.
    for (let i = 0; i < 5; i++) {
      expect(
        await refusal(
          open<Admin>(`${url}/admin`, { token: 'guess-guess-guess' }, '203.0.113.9').socket,
        ),
      ).toBe('Wrong admin token.');
    }
    expect(
      await refusal(open<Admin>(`${url}/admin`, { token: ADMIN_TOKEN }, '203.0.113.9').socket),
    ).toBe('Too many tries. Wait a minute.');
    // Another address through the tunnel is not affected.
    const other = open<Admin>(`${url}/admin`, { token: ADMIN_TOKEN }, '203.0.113.10');
    await new Promise((resolve) => other.socket.on('admin:state', resolve));

    // On the laptop itself: wrong tokens never lock it out.
    for (let i = 0; i < 6; i++) {
      expect(await refusal(admin(url, 'guess-guess-guess').socket)).toBe('Wrong admin token.');
    }
    const local = admin(url);
    await new Promise((resolve) => local.socket.on('admin:state', resolve));
  });
});
