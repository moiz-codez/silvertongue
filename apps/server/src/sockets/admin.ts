// The game master's screen. Every socket must show ADMIN_TOKEN before any handler exists for it.
// Admin sees player ids (needed for kick and rename) but never tokens, token hashes, runes or raw replies.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Namespace } from 'socket.io';
import type { z } from 'zod';
import type {
  AdminClientEvents,
  AdminReply,
  AdminServerEvents,
  AdminState,
} from '@silvertongue/shared/events';
import { adminCommandPayload, kickPayload, renamePayload } from '@silvertongue/shared/schemas';
import * as q from '../db/queries.ts';
import { applyCommand, elapsedMs } from '../game/state.ts';
import { cleanNickname, NICKNAME_TAKEN, nicknameProblem } from '../security/nickname.ts';
import type { GameContext, PhoneControls, PlayerServer } from './player.ts';
import { throttle } from './throttle.ts';

type AdminCommand = z.infer<typeof adminCommandPayload>['type'];

// Hashing first makes both sides the same length, which timingSafeEqual needs.
const sha256 = (s: string) => createHash('sha256').update(s).digest();
export const tokenMatches = (given: unknown, expected: string) =>
  typeof given === 'string' && timingSafeEqual(sha256(given), sha256(expected));

// Returns "something changed": call it freely, it sends at most 2 updates a second.
export function registerAdmin(
  io: PlayerServer,
  ctx: GameContext,
  phones: PhoneControls,
): () => void {
  const { db, env } = ctx;
  const admin = io.of('/admin') as unknown as Namespace<AdminClientEvents, AdminServerEvents>;

  admin.use((socket, next) => {
    if (tokenMatches(socket.handshake.auth.token, env.ADMIN_TOKEN)) return next();
    next(new Error('Wrong admin token.'));
  });

  function state(): AdminState {
    const game = ctx.game;
    return {
      status: game.status,
      elapsedMs: elapsedMs(game, Date.now()),
      players: q.listPlayers(db, game.id).map((p) => ({
        id: p.id,
        nickname: p.nickname,
        floor: p.floor,
        score: p.score,
        messagesSent: p.messages_sent,
        kicked: p.kicked === 1,
      })),
      maxMessages: env.MAX_MESSAGES_PER_PLAYER,
      spendUsd: q.gameSpendUsd(db, game.id),
      budgetUsd: env.BUDGET_USD,
    };
  }

  function runCommand(type: AdminCommand): AdminReply {
    const now = Date.now();
    if (type === 'reset') {
      // The old game keeps its data; everyone starts over in a fresh lobby.
      if (ctx.game.status !== 'ended') {
        const ended = applyCommand(ctx.game, 'end', now);
        if (ended.ok) q.saveGame(db, ended.game, now);
      }
      ctx.game = q.createGame(db, now);
      phones.resetAll();
      return { ok: true };
    }

    const before = ctx.game;
    const moved = applyCommand(before, type, now);
    if (!moved.ok) return moved;
    q.saveGame(db, moved.game, now);
    if (type === 'start') q.startFloorClocks(db, before.id, now);
    if (type === 'resume' && before.paused_at !== null) {
      q.shiftFloorClocks(db, before.id, before.paused_at, now - before.paused_at);
    }
    ctx.game = moved.game;
    phones.refreshAll(); // every phone moves to Floor 1, the pause banner, the closed screen…
    return { ok: true };
  }

  admin.on('connection', (socket) => {
    // Same rule as the phones: an unexpected error is logged and answered, never a crash.
    function safely<P>(handler: (payload: P) => AdminReply) {
      return (payload: P, ack: (reply: AdminReply) => void) => {
        if (typeof ack !== 'function') return;
        let reply: AdminReply;
        try {
          reply = handler(payload);
        } catch (err) {
          ctx.logError(err);
          reply = { ok: false, error: 'Something went wrong. Check the server log.' };
        }
        ack(reply);
        ctx.changed();
      };
    }

    socket.emit('admin:state', state());

    socket.on(
      'admin:command',
      safely((payload) => {
        const parsed = adminCommandPayload.safeParse(payload);
        if (!parsed.success) return { ok: false, error: 'Unknown command.' };
        return runCommand(parsed.data.type);
      }),
    );

    socket.on(
      'admin:kick',
      safely((payload) => {
        const parsed = kickPayload.safeParse(payload);
        const player = parsed.success ? findInGame(parsed.data.playerId) : undefined;
        if (!player) return { ok: false, error: 'No such player in this game.' };
        q.kickPlayer(db, player.id);
        phones.kick(player.id);
        return { ok: true };
      }),
    );

    socket.on(
      'admin:rename',
      safely((payload) => {
        const parsed = renamePayload.safeParse(payload);
        const player = parsed.success ? findInGame(parsed.data.playerId) : undefined;
        if (!parsed.success || !player) return { ok: false, error: 'No such player in this game.' };
        const nickname = cleanNickname(parsed.data.nickname);
        if (nickname === player.nickname) return { ok: true };
        const error =
          nicknameProblem(nickname) ??
          (q.isNicknameTaken(db, ctx.game.id, nickname) ? NICKNAME_TAKEN : null);
        if (error) return { ok: false, error };
        q.renamePlayer(db, player.id, nickname);
        phones.refreshAll(); // their phone shows the new name
        return { ok: true };
      }),
    );
  });

  function findInGame(playerId: string) {
    return q.listPlayers(db, ctx.game.id).find((p) => p.id === playerId);
  }

  return throttle(() => {
    try {
      admin.emit('admin:state', state());
    } catch (err) {
      ctx.logError(err);
    }
  }, 500);
}
