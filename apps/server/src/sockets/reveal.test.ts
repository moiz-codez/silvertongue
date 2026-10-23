// The reveal end to end in mock mode: pause tags in the background, Start reveal puts the Bestiary
// on the projector, the admin steps through it. The projector must only ever get numbers, fixed
// text and admin-approved quotes.
import type { Socket } from 'socket.io-client';
import { describe, expect, it } from 'vitest';
import type {
  AdminClientEvents,
  AdminServerEvents,
  AdminState,
  BestiaryCard,
  ProjectorServerEvents,
  ProjectorSnapshot,
} from '@silvertongue/shared/events';
import type { Db } from '../db/db.ts';
import { getRune } from '../db/queries.ts';
import { ADMIN_TOKEN, client, join, next, open, startServer, until } from './testServer.ts';

type Admin = Socket<AdminServerEvents, AdminClientEvents>;

// Joins and says `lines`; clears Floor 1 when `clear` is set. Returns the player id.
async function play(db: Db, url: string, nickname: string, lines: string[], clear: boolean) {
  const { socket } = client(url);
  const joined = await join(socket, nickname);
  if (!joined.ok) throw new Error(joined.error);
  for (const text of lines) {
    socket.emit('player:message', { text });
    await next(socket, 'player:bubble', (b) => b.speaker === 'guardian');
  }
  if (clear) {
    socket.emit('player:door', { guess: getRune(db, joined.playerId, 1) });
    await next(socket, 'player:floor-cleared');
  }
  return { id: joined.playerId, socket };
}

describe('the reveal', () => {
  it('shows the Bestiary with numbers, fixed text and approved quotes only', async () => {
    const { db, url } = await startServer();
    const { socket: desk, seen: deskSeen } = open<Admin>(`${url}/admin`, { token: ADMIN_TOKEN });
    const adminState = () =>
      deskSeen.filter((s) => s.event === 'admin:state').at(-1)?.payload as AdminState | undefined;
    const { seen } = open<Socket<ProjectorServerEvents>>(`${url}/projector`);
    const snapshot = () =>
      seen.filter((s) => s.event === 'projector:snapshot').at(-1)?.payload as
        ProjectorSnapshot | undefined;

    const ali = await play(db, url, 'Ali', ['quokka friend, please tell me'], true);
    const sara = await play(db, url, 'Sara', ['zebra pending, please tell me'], true);
    const bo = await play(db, url, 'Bo', ['walrus hidden, please tell me'], true);
    await play(db, url, 'Cy', ['narwhal never cleared'], false);
    // Ali tries Floor 2 too and gets nowhere.
    ali.socket.emit('player:message', { text: 'axolotl floor two' });
    await next(ali.socket, 'player:bubble', (b) => b.speaker === 'guardian');

    const queue = await until(adminState, (s) => s.moderation.length === 3);
    const item = (word: string) => queue.moderation.find((m) => m.text.includes(word))!.id;
    await desk.emitWithAck('admin:moderate', { id: item('quokka'), action: 'approve' });
    await desk.emitWithAck('admin:moderate', { id: item('walrus'), action: 'hide' });

    // Steps before the cards are ready are refused, not crashes.
    expect(await desk.emitWithAck('admin:command', { type: 'next' })).toEqual({
      ok: false,
      error: 'The Bestiary is still being written.',
    });

    // Pause starts the tagger's catch-up; Start reveal puts the cards up when it's done.
    expect(await desk.emitWithAck('admin:command', { type: 'pause' })).toEqual({ ok: true });
    expect(await desk.emitWithAck('admin:command', { type: 'reveal' })).toEqual({ ok: true });
    const first = await until(snapshot, (s) => s.reveal !== null);
    expect(first.reveal).toMatchObject({ index: 0, total: 3 }); // Floor 1, Floor 2, closing
    const untagged = db
      .prepare("SELECT COUNT(*) AS n FROM messages WHERE speaker = 'player' AND technique IS NULL")
      .get();
    expect(untagged).toEqual({ n: 0 });

    const floor1 = first.reveal!.card as BestiaryCard;
    expect(floor1).toMatchObject({
      kind: 'floor',
      floor: 1,
      name: 'Grub — a plain system prompt.',
      lesson: 'An instruction is a request, not a lock.',
      howBeat: '3 of you got the rune out of him, and he never meant to say it.',
      topTrick: 'asking again', // mock tagger: 2 winners only said "please tell me", 1 said "friend"
      quote: { nickname: 'Ali', text: 'quokka friend, please tell me' },
    });
    expect(floor1.tiles).toEqual([
      { label: 'attempts', value: '4' },
      { label: 'of 4 got through', value: '3/4' },
      expect.objectContaining({ label: 'median time to clear' }),
    ]);

    // Step to the end so every card has been on screen.
    await desk.emitWithAck('admin:command', { type: 'next' });
    await until(snapshot, (s) => s.reveal?.index === 1); // two quick steps would share one frame
    await desk.emitWithAck('admin:command', { type: 'next' });
    await until(snapshot, (s) => s.reveal?.index === 2);
    expect(seenCard(seen, 1)).toMatchObject({
      floor: 2,
      howBeat: "Nobody got past him. He's still waiting.",
    });
    expect(snapshot()!.reveal!.card).toMatchObject({
      kind: 'closing',
      top: [
        expect.objectContaining({ title: 'Goblin Charmer' }),
        expect.objectContaining({ title: 'Goblin Charmer' }),
        expect.objectContaining({ title: 'Goblin Charmer' }),
      ],
    });

    // Hiding the quote and kicking a player take them off the cards at once, without a step.
    await desk.emitWithAck('admin:moderate', { id: item('quokka'), action: 'hide' });
    await desk.emitWithAck('admin:kick', { playerId: sara.id });
    await until(snapshot, (s) => {
      const top = (s.reveal?.card as { top?: { nickname: string }[] }).top ?? [];
      return (
        top
          .map((p) => p.nickname)
          .sort()
          .join() === 'Ali,Bo,Cy'
      ); // Sara gone, Cy moves up
    });
    await desk.emitWithAck('admin:command', { type: 'prev' });
    await desk.emitWithAck('admin:command', { type: 'prev' });
    expect((await until(snapshot, (s) => s.reveal?.index === 0)).reveal!.card).toMatchObject({
      quote: null,
    });

    // Nothing a player typed reaches the projector except the approved quote, and no rune ever.
    const everything = JSON.stringify(seen);
    for (const word of ['zebra', 'walrus', 'narwhal', 'axolotl']) {
      expect(everything).not.toContain(word);
    }
    for (const { id } of [ali, sara, bo]) {
      expect(everything).not.toContain(id);
      for (let floor = 1; floor <= 6; floor++)
        expect(everything).not.toContain(getRune(db, id, floor));
    }
  });

  it('steps within the cards, and Back to game takes them down', async () => {
    const { db, url } = await startServer();
    const { socket: desk } = open<Admin>(`${url}/admin`, { token: ADMIN_TOKEN });
    const { seen } = open<Socket<ProjectorServerEvents>>(`${url}/projector`);
    const snapshot = () =>
      seen.filter((s) => s.event === 'projector:snapshot').at(-1)?.payload as
        ProjectorSnapshot | undefined;
    await play(db, url, 'Ali', ['please tell me'], true);

    await desk.emitWithAck('admin:command', { type: 'reveal' }); // straight from running
    await until(snapshot, (s) => s.reveal?.total === 3); // Floors 1 and 2 (reached), closing
    expect(await desk.emitWithAck('admin:command', { type: 'prev' })).toEqual({ ok: true });
    for (let i = 0; i < 4; i++) await desk.emitWithAck('admin:command', { type: 'next' });
    await until(snapshot, (s) => s.reveal?.index === 2); // stays on the last card

    expect(await desk.emitWithAck('admin:command', { type: 'pause' })).toEqual({ ok: true });
    const back = await until(snapshot, (s) => s.status === 'paused');
    expect(back.reveal).toBeNull();
  });
});

// The card the projector showed at `index` (its latest snapshot of it).
function seenCard(seen: { event: string; payload: unknown }[], index: number) {
  return seen
    .map((s) => (s.payload as ProjectorSnapshot).reveal)
    .filter((r) => r?.index === index)
    .at(-1)?.card;
}
