// The big screen, end to end in mock mode: what it shows, how often, and what it must never see.
import { setTimeout as wait } from 'node:timers/promises';
import type { Socket } from 'socket.io-client';
import { describe, expect, it } from 'vitest';
import type { ProjectorServerEvents, ProjectorSnapshot } from '@silvertongue/shared/events';
import type { Db } from '../db/db.ts';
import { getRune, kickPlayer, renamePlayer } from '../db/queries.ts';
import { client, join, next, open, startServer } from './testServer.ts';

type Screen = Socket<ProjectorServerEvents>;

function projector(url: string) {
  const { socket, seen } = open<Screen>(`${url}/projector`);
  const snapshots = () =>
    seen.filter((s) => s.event === 'projector:snapshot').map((s) => s.payload as ProjectorSnapshot);
  return { socket, seen, snapshots };
}

// Waits until the newest snapshot passes `check`.
async function until(
  snapshots: () => ProjectorSnapshot[],
  check: (s: ProjectorSnapshot) => boolean,
) {
  for (let i = 0; i < 100; i++) {
    const last = snapshots().at(-1);
    if (last && check(last)) return last;
    await wait(20);
  }
  throw new Error('the projector never showed it');
}

async function joinAndClear(db: Db, url: string, nickname: string) {
  const { socket } = client(url);
  const joined = await join(socket, nickname);
  if (!joined.ok) throw new Error(joined.error);
  socket.emit('player:message', { text: 'my secret plan for grub' });
  await next(socket, 'player:bubble', (b) => b.speaker === 'guardian');
  socket.emit('player:door', { guess: getRune(db, joined.playerId, 1) });
  await next(socket, 'player:floor-cleared');
  return joined;
}

describe('projector', () => {
  it('shows the lobby with the join link and every name that joins', async () => {
    const { url } = await startServer(
      { PUBLIC_URL: 'https://silvertongue.example' },
      undefined,
      [],
    );
    const { snapshots } = projector(url);
    const first = await until(snapshots, () => true);
    expect(first).toMatchObject({ status: 'lobby', publicUrl: 'https://silvertongue.example' });

    await join(client(url).socket, 'Ali');
    await join(client(url).socket, 'Sara');
    const later = await until(snapshots, (s) => s.players.length === 2);
    expect(later.players.map((p) => p.nickname).sort()).toEqual(['Ali', 'Sara']);
  });

  it('never receives a rune, token, player id or anything a player typed', async () => {
    const { db, url } = await startServer();
    const { seen, snapshots } = projector(url);
    const ali = await joinAndClear(db, url, 'Ali');
    const sara = await joinAndClear(db, url, 'Sara');
    await until(snapshots, (s) => s.feed.length === 2);

    const everything = JSON.stringify(seen);
    for (const p of [ali, sara]) {
      if (!p.ok) continue;
      for (let floor = 1; floor <= 6; floor++) {
        expect(everything).not.toContain(getRune(db, p.playerId, floor));
      }
      expect(everything).not.toContain(p.token);
      expect(everything).not.toContain(p.playerId);
    }
    const hashes = db.prepare('SELECT token_hash FROM players').all() as { token_hash: string }[];
    for (const { token_hash } of hashes) expect(everything).not.toContain(token_hash);
    expect(everything).not.toContain('secret plan');
    expect(everything).not.toMatch(/raw_?text/i);
  });

  it('puts first blood in the feed once, then plain clears', async () => {
    const { db, url } = await startServer();
    const { snapshots } = projector(url);
    await joinAndClear(db, url, 'Ali');
    await joinAndClear(db, url, 'Sara');
    const shot = await until(snapshots, (s) => s.feed.length === 2);
    expect(shot.feed.map((f) => [f.type, f.text])).toEqual([
      ['clear', 'Sara charmed Grub.'],
      ['first_blood', 'Ali charmed Grub.'],
    ]);
    expect(shot.players).toEqual(
      expect.arrayContaining([
        { nickname: 'Ali', floor: 2 },
        { nickname: 'Sara', floor: 2 },
      ]),
    );
  });

  it('shows the current name after a rename, and drops a kicked player from the feed', async () => {
    const { db, ctx, url } = await startServer();
    const { snapshots } = projector(url);
    const ali = await joinAndClear(db, url, 'Ali');
    const sara = await joinAndClear(db, url, 'Sara');
    await until(snapshots, (s) => s.feed.length === 2);
    if (!ali.ok || !sara.ok) throw new Error('join failed');

    renamePlayer(db, ali.playerId, 'Falcon');
    kickPlayer(db, sara.playerId);
    ctx.changed();
    const shot = await until(snapshots, (s) => s.feed.length === 1);
    expect(shot.feed.map((f) => f.text)).toEqual(['Falcon charmed Grub.']);
    expect(JSON.stringify(shot)).not.toMatch(/Ali|Sara/);
  });

  it('sends at most 2 snapshots a second during a burst of joins', async () => {
    const { url } = await startServer({}, undefined, []);
    const { snapshots } = projector(url);
    await until(snapshots, () => true);
    const before = snapshots().length;

    await Promise.all(Array.from({ length: 20 }, (_, i) => join(client(url).socket, `Player${i}`)));
    await until(snapshots, (s) => s.players.length === 20);
    await wait(600); // let any trailing snapshot arrive
    expect(snapshots().length - before).toBeLessThanOrEqual(3);
  });

  it('allows at most 5 screens from one address', async () => {
    const { url } = await startServer();
    const connected = (s: Screen) =>
      new Promise<string>((resolve) => {
        s.on('projector:snapshot', () => resolve('ok'));
        s.on('connect_error', (e) => resolve(e.message));
      });
    for (let i = 0; i < 5; i++) {
      expect(
        await connected(open<Screen>(`${url}/projector`, undefined, '203.0.113.5').socket),
      ).toBe('ok');
    }
    expect(await connected(open<Screen>(`${url}/projector`, undefined, '203.0.113.5').socket)).toBe(
      'Too many screens from this address.',
    );
    expect(await connected(open<Screen>(`${url}/projector`, undefined, '203.0.113.6').socket)).toBe(
      'ok',
    );
  });
});
