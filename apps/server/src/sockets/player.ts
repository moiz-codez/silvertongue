// Everything a phone can ask the server to do. Every payload is validated, every rule is enforced here,
// and every outgoing payload is built field by field. No rune ever goes into an emit.
import { createHash, randomBytes } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import type {
  Bubble,
  ClientToServerEvents,
  GameStatus,
  PlayerState,
  ServerToClientEvents,
  Speaker,
} from '@silvertongue/shared/events';
import { GUARDIANS, isBuilt } from '@silvertongue/shared/floors';
import {
  doorPayload,
  joinPayload,
  messagePayload,
  resumePayload,
} from '@silvertongue/shared/schemas';
import type { Env } from '../config/env.ts';
import { costUsd, ROLES } from '../config/models.ts';
import type { Db } from '../db/db.ts';
import * as q from '../db/queries.ts';
import { grubTurn, type Turn } from '../floors/01-grub/pipeline.ts';
import { checkDoor } from '../game/door.ts';
import { generateRunes } from '../game/runes.ts';
import { scoreFloorClear } from '../game/scoring.ts';
import { elapsedMs } from '../game/state.ts';
import { titleFor } from '../game/titles.ts';
import type { AdminReply } from '@silvertongue/shared/events';
import { DeadlineError, errorStatus, type Complete } from '../llm/client.ts';
import type { QueueStats } from '../llm/queue.ts';
import { cleanNickname, NICKNAME_TAKEN, nicknameProblem } from '../security/nickname.ts';
import { revealsRune } from '../security/revealsRune.ts';
import { sanitize } from '../security/sanitize.ts';
import { clientIp, slidingLimit } from './clientIp.ts';
import { throttle } from './throttle.ts';

export interface SocketData {
  playerId?: string; // set by join or resume; cleared by kick and reset
}
export type PlayerServer = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
type PlayerSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

export interface GameContext {
  db: Db;
  env: Env;
  complete: Complete; // goes through the rate-limited queue
  queueStats: () => QueueStats;
  game: q.GameRow; // the current game, with its live settings; admin commands replace it
  changed: () => void; // the projector and admin screens need a fresh look (throttled)
  runCommand: (type: 'start' | 'pause' | 'resume' | 'reveal' | 'end' | 'reset') => AdminReply;
  logError: (err: unknown) => void;
}

// What the admin can do to phones from outside these handlers.
export interface PhoneControls {
  refreshAll: () => void;
  kick: (playerId: string) => void;
  resetAll: () => void;
}

// Why a phone can't talk or try the door right now, by game status. null = play on.
const NOT_NOW: Record<GameStatus, string | null> = {
  lobby: 'The doors are still sealed. Wait for the game master.',
  running: null,
  paused: 'The torches gutter. The dungeon holds its breath… wait for the game master.',
  reveal: 'The dungeon sleeps. Look up at the big screen.',
  ended: 'The dungeon sleeps. Look up at the big screen.',
};

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function registerPlayerHandlers(io: PlayerServer, ctx: GameContext): PhoneControls {
  const { db, env, complete } = ctx;
  const cooldownUntil = new Map<string, number>(); // playerId → time the next message is allowed
  const busy = new Set<string>(); // players waiting for a reply: one message at a time
  const joinsByIp = slidingLimit(env.JOIN_LIMIT_PER_MIN, 60_000); // slows down name-squatting scripts

  function stateFor(playerId: string): PlayerState {
    const player = q.getPlayer(db, playerId);
    const now = Date.now();
    const progress = isBuilt(player.floor) ? q.getProgress(db, playerId, player.floor) : null;
    return {
      gameStatus: ctx.game.status,
      playersInGame: q.listPlayers(db, ctx.game.id).filter((p) => !p.kicked).length,
      nickname: player.nickname,
      floor: player.floor,
      floorReady: isBuilt(player.floor),
      score: player.score,
      title: titleFor(player.floor - 1),
      messagesLeft: Math.max(0, ctx.game.max_messages - player.messages_sent),
      cooldownMs: Math.max(0, (cooldownUntil.get(playerId) ?? 0) - now),
      doorLockedMs: Math.max(0, (progress?.door_locked_until ?? 0) - now),
    };
  }

  // Sent after join, resume and reconnect: the whole current floor, from the database.
  function sendEverything(socket: PlayerSocket, playerId: string): void {
    const player = q.getPlayer(db, playerId);
    socket.emit('player:state', stateFor(playerId));
    if (!isBuilt(player.floor)) return;

    const rows = q.listFloorMessages(db, playerId, player.floor);
    const bubbles: Bubble[] = rows.map((row) => ({
      id: row.id,
      floor: player.floor,
      speaker: row.speaker as Speaker,
      text: row.text,
    }));
    socket.emit('player:history', { floor: player.floor, bubbles });

    // Server-side only: we check the replies against the rune and send just a yes/no face.
    const rune = q.getRune(db, playerId, player.floor);
    const slipped = rows.some(
      (r) => r.speaker === 'guardian' && revealsRune(r.text, rune).revealed,
    );
    socket.emit('player:expression', { floor: player.floor, state: slipped ? 'slipped' : 'idle' });
  }

  function phoneSockets(): PlayerSocket[] {
    return [...io.of('/').sockets.values()].filter((s) => s.data.playerId);
  }

  const controls: PhoneControls = {
    refreshAll() {
      for (const s of phoneSockets()) s.emit('player:state', stateFor(s.data.playerId!));
    },
    kick(playerId) {
      for (const s of phoneSockets().filter((s) => s.data.playerId === playerId)) {
        s.data.playerId = undefined;
        s.emit('player:kicked');
        s.disconnect(true);
      }
    },
    resetAll() {
      for (const s of phoneSockets()) {
        s.data.playerId = undefined;
        s.emit('player:reset');
      }
    },
  };
  const refreshLobbyCount = throttle(controls.refreshAll, 500);

  // The player behind this socket, if they may still play. Kicked players are logged out here.
  function currentPlayer(socket: PlayerSocket): q.PlayerRow | null {
    const id = socket.data.playerId;
    if (!id) return null;
    const player = q.getPlayer(db, id);
    if (player.kicked) {
      controls.kick(id); // also covers a phone that missed the kick while offline
      return null;
    }
    if (player.game_id !== ctx.game.id) {
      socket.data.playerId = undefined; // their game was reset
      socket.emit('player:reset');
      return null;
    }
    return player;
  }

  io.on('connection', (socket: PlayerSocket) => {
    // Any unexpected error is logged and answered in character; it never crashes the server.
    function safely<A extends unknown[]>(handler: (...args: A) => unknown) {
      return async (...args: A) => {
        try {
          await handler(...args);
        } catch (err) {
          ctx.logError(err);
          sendError(socket, 'server', 'The dungeon trembles. Try again.');
        }
      };
    }

    socket.on(
      'player:join',
      safely((payload, ack) => {
        if (typeof ack !== 'function') return;
        if (socket.data.playerId) {
          return ack({ ok: false, error: 'You are already in the dungeon.' }); // one player per socket
        }
        if (ctx.game.status === 'reveal' || ctx.game.status === 'ended') {
          return ack({ ok: false, error: 'The dungeon is closed. Look up at the big screen.' });
        }
        const ip = clientIp(socket.handshake);
        if (joinsByIp.full(ip)) {
          return ack({ ok: false, error: 'Too many new adventurers at once. Wait a minute.' });
        }
        const parsed = joinPayload.safeParse(payload);
        if (!parsed.success)
          return ack({ ok: false, error: 'That name got lost in the dark. Try again.' });

        const gameId = ctx.game.id;
        const nickname = cleanNickname(parsed.data.nickname);
        const error =
          nicknameProblem(nickname) ??
          (q.isNicknameTaken(db, gameId, nickname) ? NICKNAME_TAKEN : null);
        if (error) return ack({ ok: false, error });

        const token = randomBytes(32).toString('base64url');
        let playerId: string;
        try {
          playerId = q.createPlayer(db, {
            gameId,
            nickname,
            tokenHash: hashToken(token),
            runes: generateRunes(),
            now: Date.now(),
          });
        } catch (err) {
          // Two phones picked the same name at the same moment.
          if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return ack({ ok: false, error: NICKNAME_TAKEN });
          }
          throw err;
        }
        joinsByIp.add(ip);
        socket.data.playerId = playerId;
        ack({ ok: true, playerId, token });
        sendEverything(socket, playerId);
        ctx.changed();
        if (ctx.game.status === 'lobby') refreshLobbyCount(); // "27 adventurers at the gate"
      }),
    );

    socket.on(
      'player:resume',
      safely((payload, ack) => {
        if (typeof ack !== 'function') return;
        const parsed = resumePayload.safeParse(payload);
        const player = parsed.success
          ? q.findPlayerByTokenHash(db, hashToken(parsed.data.token))
          : undefined;
        if (!player || player.kicked || player.game_id !== ctx.game.id) return ack({ ok: false });
        // One player per socket, as for join: switching mid-call would dodge the message cap.
        if (socket.data.playerId && socket.data.playerId !== player.id) return ack({ ok: false });

        socket.data.playerId = player.id;
        ack({ ok: true });
        sendEverything(socket, player.id);
      }),
    );

    socket.on(
      'player:message',
      safely(async (payload) => {
        const parsed = messagePayload.safeParse(payload);
        const player = currentPlayer(socket);
        if (!player || !parsed.success) return;
        const id = player.id;
        const gameId = ctx.game.id;
        const floor = player.floor;
        const now = Date.now();

        const text = sanitize(parsed.data.text, env.MAX_MESSAGE_CHARS);
        if (text === '') return;
        const notNow = NOT_NOW[ctx.game.status];
        if (notNow) return sendError(socket, 'not_running', notNow);
        if (!isBuilt(floor)) return sendError(socket, 'not_ready', STAIRS);
        if (busy.has(id)) return sendError(socket, 'busy', 'Wait for an answer first, tall-folk.');
        if (now < (cooldownUntil.get(id) ?? 0)) {
          return sendError(socket, 'cooldown', 'Catch your breath before you speak again.');
        }
        if (player.messages_sent >= ctx.game.max_messages) {
          return sendError(socket, 'cap', 'You have used all your words for this game.');
        }

        busy.add(id);
        cooldownUntil.set(id, now + ctx.game.cooldown_ms);
        const history: Turn[] = q
          .listFloorMessages(db, id, floor)
          .filter(
            (m) =>
              m.in_guardian_history === 1 && (m.speaker === 'player' || m.speaker === 'guardian'),
          )
          .map((m) => ({ speaker: m.speaker as Turn['speaker'], text: m.text }));
        const playerMessageId = q.insertMessage(db, {
          gameId,
          playerId: id,
          floor,
          speaker: 'player',
          text,
          now,
        });
        socket.emit('player:bubble', { id: playerMessageId, floor, speaker: 'player', text });

        try {
          const turn = await grubTurn(
            complete,
            [...history, { speaker: 'player', text }],
            q.getRune(db, id, floor),
          );
          logCall(gameId, id, floor, turn.result, 'ok');
          checkBudget();
          // Kicked or reset while Grub was thinking: this socket no longer plays as them.
          if (socket.data.playerId !== id) return;
          q.countPlayerMessage(db, id, floor);
          // Floor 1 has no output filter: the reply, minus *stage directions*, is the post-filter text.
          const replyId = q.insertMessage(db, {
            gameId,
            playerId: id,
            floor,
            speaker: 'guardian',
            text: turn.text,
            rawText: turn.result.rawText !== turn.text ? turn.result.rawText : undefined, // server only
            now: Date.now(),
          });
          socket.emit('player:bubble', {
            id: replyId,
            floor,
            speaker: 'guardian',
            text: turn.text,
          });
          if (turn.slipped) socket.emit('player:expression', { floor, state: 'slipped' });
        } catch (err) {
          logCall(
            gameId,
            id,
            floor,
            { model: ROLES.grub.model, usage: { input_tokens: 0, output_tokens: 0 }, latencyMs: 0 },
            errorStatus(err),
          );
          q.removeFromGuardianHistory(db, playerMessageId);
          if (err instanceof DeadlineError) {
            // Crowded: no refund, or turned-away phones could resend at once. A normal cooldown
            // plus 0–3 s at random, so they don't all come back together. The cap isn't touched.
            cooldownUntil.set(id, Date.now() + ctx.game.cooldown_ms + Math.random() * 3000);
            sendError(
              socket,
              'crowded',
              'The dungeon is crowded. Catch your breath and try again.',
            );
          } else {
            cooldownUntil.delete(id); // their turn wasn't used, so give it back
            sendError(socket, 'llm', 'The dungeon trembles. Try again.');
          }
        } finally {
          busy.delete(id);
          if (socket.data.playerId === id) socket.emit('player:state', stateFor(id));
          ctx.changed(); // message counts and spend on the admin screen
        }
      }),
    );

    // The ONLY way to clear a floor. Synchronous, so first blood can't be claimed twice.
    socket.on(
      'player:door',
      safely((payload) => {
        const parsed = doorPayload.safeParse(payload);
        const player = currentPlayer(socket);
        if (!player || !parsed.success) return;
        const id = player.id;
        const floor = player.floor;
        const notNow = NOT_NOW[ctx.game.status];
        if (notNow) return sendError(socket, 'not_running', notNow);
        if (!isBuilt(floor)) return sendError(socket, 'not_ready', STAIRS);

        const now = Date.now();
        const progress = q.getProgress(db, id, floor);
        const result = checkDoor(
          parsed.data.guess,
          q.getRune(db, id, floor),
          { streak: progress.wrong_door_streak, lockedUntil: progress.door_locked_until },
          now,
        );

        if (result.kind === 'locked') {
          socket.emit('player:door-result', { correct: false, lockedMs: result.lockedUntil - now });
          return;
        }
        if (result.kind === 'wrong') {
          q.recordWrongDoor(db, {
            playerId: id,
            floor,
            streak: result.next.streak,
            lockedUntil: result.next.lockedUntil,
            now,
          });
          const lockedMs = result.next.lockedUntil === null ? 0 : result.next.lockedUntil - now;
          socket.emit('player:door-result', { correct: false, lockedMs });
          socket.emit('player:state', stateFor(id));
          return;
        }

        const guardian = GUARDIANS[floor]!;
        const firstBlood = !q.isFloorClearedInGame(db, ctx.game.id, floor);
        const score = scoreFloorClear({
          floor,
          guardianName: guardian.name,
          reachedAt: progress.reached_at,
          clearedAt: now,
          messagesUsed: progress.messages_used,
          firstBlood,
        });
        q.clearFloor(db, { playerId: id, floor, points: score.total, firstBlood, now });
        // The projector turns this into "NightOwl charmed Grub." when it sends the feed.
        q.insertProjectorEvent(db, {
          gameId: ctx.game.id,
          playerId: id,
          floor,
          type: firstBlood ? 'first_blood' : 'clear',
          gameMs: elapsedMs(ctx.game, now),
          now,
        });

        socket.emit('player:door-result', { correct: true, lockedMs: 0 });
        socket.emit('player:expression', { floor, state: 'slipped' });
        socket.emit('player:floor-cleared', {
          floor,
          lines: score.lines,
          total: score.total,
          score: player.score + score.total,
          title: titleFor(floor),
          nextFloorReady: isBuilt(floor + 1),
        });
        socket.emit('player:state', stateFor(id));
        ctx.changed();
      }),
    );
  });

  // Once per game: when spend crosses BUDGET_USD the game pauses itself and the admin is alerted.
  // The admin may resume on purpose; this won't fire again for the same game.
  function checkBudget(): void {
    if (ctx.game.budget_alert_at !== null) return;
    if (q.gameSpendUsd(db, ctx.game.id) < env.BUDGET_USD) return;
    if (ctx.game.status === 'running') ctx.runCommand('pause');
    ctx.game = { ...ctx.game, budget_alert_at: Date.now() };
    q.saveGame(db, ctx.game, Date.now());
  }

  function logCall(
    gameId: string,
    id: string,
    floor: number,
    call: {
      model: Parameters<typeof costUsd>[0];
      usage: Parameters<typeof costUsd>[1];
      latencyMs: number;
    },
    status: string,
  ): void {
    q.insertLlmCall(db, {
      gameId,
      playerId: id,
      floor,
      role: 'grub',
      model: call.model,
      inputTokens: call.usage.input_tokens,
      cacheCreationTokens: call.usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: call.usage.cache_read_input_tokens ?? 0,
      outputTokens: call.usage.output_tokens,
      costUsd: costUsd(call.model, call.usage),
      latencyMs: call.latencyMs,
      status,
      now: Date.now(),
    });
  }

  return controls;
}

const STAIRS = 'The stairs below are still being carved. Wait here, rogue.';

function sendError(socket: PlayerSocket, code: string, message: string): void {
  socket.emit('player:error', { code, message });
}
