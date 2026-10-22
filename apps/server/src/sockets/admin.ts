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
import {
  adminCommandPayload,
  configPayload,
  kickPayload,
  moderatePayload,
  renamePayload,
} from '@silvertongue/shared/schemas';
import { effectiveMode } from '../config/env.ts';
import * as q from '../db/queries.ts';
import { applyCommand, elapsedMs } from '../game/state.ts';
import { cleanNickname, NICKNAME_TAKEN, nicknameProblem } from '../security/nickname.ts';
import type { GameContext, PhoneControls, PlayerServer } from './player.ts';
import { clientIp, isLocal, slidingLimit } from './clientIp.ts';
import { throttle } from './throttle.ts';

type AdminCommand = z.infer<typeof adminCommandPayload>['type'];

// Hashing first makes both sides the same length, which timingSafeEqual needs.
const sha256 = (s: string) => createHash('sha256').update(s).digest();
export const tokenMatches = (given: unknown, expected: string) =>
  typeof given === 'string' && timingSafeEqual(sha256(given), sha256(expected));

// Returns `changed` ("something changed": call it freely, it sends at most 2 updates a second)
// and `runCommand`, which the budget brake also uses to pause the game.
export function registerAdmin(io: PlayerServer, ctx: GameContext, phones: PhoneControls) {
  const { db, env } = ctx;
  const admin = io.of('/admin') as unknown as Namespace<AdminClientEvents, AdminServerEvents>;

  // Through the tunnel, 5 wrong tokens in a minute from one address lock it out for the rest of
  // that minute. A browser on this laptop is never locked out of its own admin page.
  const wrongTokens = slidingLimit(5, 60_000);
  admin.use((socket, next) => {
    const local = isLocal(socket.handshake);
    const ip = clientIp(socket.handshake);
    if (!local && wrongTokens.full(ip)) return next(new Error('Too many tries. Wait a minute.'));
    if (tokenMatches(socket.handshake.auth.token, env.ADMIN_TOKEN)) return next();
    if (!local) wrongTokens.add(ip);
    next(new Error('Wrong admin token.'));
  });

  function state(): AdminState {
    const game = ctx.game;
    const queue = ctx.queueStats();
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
      settings: {
        cooldownMs: game.cooldown_ms,
        maxMessages: game.max_messages,
        llmMode: effectiveMode(game.llm_mode, env), // what is really answering, never just what was saved
      },
      liveAvailable: env.ANTHROPIC_API_KEY !== '',
      health: {
        queued: queue.queued,
        inFlight: queue.inFlight,
        rateLimited1m: queue.rateLimited1m,
        crowded1m: queue.crowded1m,
        avgReplyMs: queue.avgReplyMs,
        callsLastMin: queue.callsLastMin,
        estInputLastMin: queue.estInputLastMin,
        maxOutputLastMin: queue.maxOutputLastMin,
        memoryMb: Math.round(process.memoryUsage().rss / 1_000_000),
      },
      spendUsd: q.gameSpendUsd(db, game.id),
      budgetUsd: env.BUDGET_USD,
      budgetAlert: game.budget_alert_at !== null,
      moderation: q.listAttemptsForAdmin(db, game.id).map((a) => ({
        id: a.id,
        nickname: a.nickname,
        floor: a.floor,
        text: a.text,
        createdAt: a.created_at,
        status: a.status,
      })),
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
      ctx.game = q.createGame(db, now, ctx.game); // the live settings carry over
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
      'admin:config',
      safely((payload) => {
        const parsed = configPayload.safeParse(payload);
        if (!parsed.success) return { ok: false, error: 'Cooldown 0–60 s, messages 1–500.' };
        const { cooldownMs, maxMessages, llmMode } = parsed.data;
        if (llmMode === 'live' && !env.ANTHROPIC_API_KEY) {
          return { ok: false, error: "The server has no ANTHROPIC_API_KEY, so it can't go Live." };
        }
        ctx.game = {
          ...ctx.game,
          cooldown_ms: cooldownMs,
          max_messages: maxMessages,
          llm_mode: llmMode,
        };
        q.saveGame(db, ctx.game, Date.now());
        phones.refreshAll(); // "messages left" changes on every phone
        return { ok: true };
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

    // Approve puts a winning message on the projector's wall; hide removes it for good.
    socket.on(
      'admin:moderate',
      safely((payload) => {
        const parsed = moderatePayload.safeParse(payload);
        if (!parsed.success) return { ok: false, error: 'Unknown item.' };
        const { id, action } = parsed.data;
        const status = action === 'approve' ? 'approved' : 'hidden';
        if (!q.setAttemptStatus(db, ctx.game.id, id, status)) {
          return { ok: false, error: 'That item is gone.' };
        }
        ctx.changed(); // the projector's wall
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
          (q.isNicknameTaken(db, ctx.game.id, nickname, player.id) ? NICKNAME_TAKEN : null);
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

  const changed = throttle(() => {
    try {
      admin.emit('admin:state', state());
    } catch (err) {
      ctx.logError(err);
    }
  }, 500);
  return { changed, runCommand };
}
