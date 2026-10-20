// Everything a phone can ask the server to do. Every payload is validated, every rule is enforced here,
// and every outgoing payload is built field by field. No rune ever goes into an emit.
import { createHash, randomBytes } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import type {
  Bubble,
  ClientToServerEvents,
  PlayerState,
  ServerToClientEvents,
  Speaker,
} from '@silvertongue/shared/events';
import { NICKNAME_MAX, NICKNAME_MIN } from '@silvertongue/shared/constants';
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
import { titleFor } from '../game/titles.ts';
import { errorStatus, type Complete } from '../llm/client.ts';
import { isProfane } from '../security/profanity.ts';
import { revealsRune } from '../security/revealsRune.ts';
import { sanitize } from '../security/sanitize.ts';

type PlayerSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export interface GameContext {
  db: Db;
  env: Env;
  complete: Complete;
  gameId: string;
  logError: (err: unknown) => void;
}

const BUILT_FLOORS = new Set([1]); // floors whose guardian exists; more arrive in M4–M9
const GUARDIAN_NAMES: Record<number, string> = { 1: 'Grub' };

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function registerPlayerHandlers(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  ctx: GameContext,
): void {
  const { db, env, complete, gameId } = ctx;
  const cooldownUntil = new Map<string, number>(); // playerId → time the next message is allowed
  const busy = new Set<string>(); // players waiting for a reply: one message at a time

  function stateFor(playerId: string): PlayerState {
    const player = q.getPlayer(db, playerId);
    const now = Date.now();
    const progress = BUILT_FLOORS.has(player.floor)
      ? q.getProgress(db, playerId, player.floor)
      : null;
    return {
      nickname: player.nickname,
      floor: player.floor,
      floorReady: BUILT_FLOORS.has(player.floor),
      score: player.score,
      title: titleFor(player.floor - 1),
      messagesLeft: Math.max(0, env.MAX_MESSAGES_PER_PLAYER - player.messages_sent),
      cooldownMs: Math.max(0, (cooldownUntil.get(playerId) ?? 0) - now),
      doorLockedMs: Math.max(0, (progress?.door_locked_until ?? 0) - now),
    };
  }

  // Sent after join, resume and reconnect: the whole current floor, from the database.
  function sendEverything(socket: PlayerSocket, playerId: string): void {
    const player = q.getPlayer(db, playerId);
    socket.emit('player:state', stateFor(playerId));
    if (!BUILT_FLOORS.has(player.floor)) return;

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

  io.on('connection', (socket: PlayerSocket) => {
    let playerId: string | null = null; // set by join or resume

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
        if (playerId) return ack({ ok: false, error: 'You are already in the dungeon.' }); // one player per socket
        const parsed = joinPayload.safeParse(payload);
        if (!parsed.success)
          return ack({ ok: false, error: 'That name got lost in the dark. Try again.' });

        const nickname = parsed.data.nickname.trim().replace(/\s+/g, ' ');
        const error =
          nicknameProblem(nickname) ?? (q.isNicknameTaken(db, gameId, nickname) ? TAKEN : null);
        if (error) return ack({ ok: false, error });

        const token = randomBytes(32).toString('base64url');
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
            return ack({ ok: false, error: TAKEN });
          }
          throw err;
        }
        ack({ ok: true, playerId, token });
        sendEverything(socket, playerId);
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
        if (!player || player.kicked || player.game_id !== gameId) return ack({ ok: false });

        playerId = player.id;
        ack({ ok: true });
        sendEverything(socket, player.id);
      }),
    );

    socket.on(
      'player:message',
      safely(async (payload) => {
        const parsed = messagePayload.safeParse(payload);
        if (!playerId || !parsed.success) return;
        const id = playerId;
        const player = q.getPlayer(db, id);
        const floor = player.floor;
        const now = Date.now();

        const text = sanitize(parsed.data.text, env.MAX_MESSAGE_CHARS);
        if (text === '') return;
        if (!BUILT_FLOORS.has(floor)) return sendError(socket, 'not_ready', STAIRS);
        if (busy.has(id)) return sendError(socket, 'busy', 'Wait for an answer first, tall-folk.');
        if (now < (cooldownUntil.get(id) ?? 0)) {
          return sendError(socket, 'cooldown', 'Catch your breath before you speak again.');
        }
        if (player.messages_sent >= env.MAX_MESSAGES_PER_PLAYER) {
          return sendError(socket, 'cap', 'You have used all your words for this game.');
        }

        busy.add(id);
        cooldownUntil.set(id, now + env.COOLDOWN_MS);
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
          logCall(id, floor, turn.result.model, turn.result.usage, turn.result.latencyMs, 'ok');
          q.countPlayerMessage(db, id, floor);
          // Floor 1 has no output filter: the reply, minus *stage directions*, is the post-filter text.
          const replyId = q.insertMessage(db, {
            gameId,
            playerId: id,
            floor,
            speaker: 'guardian',
            text: turn.text,
            rawText: turn.result.text !== turn.text ? turn.result.text : undefined, // server only
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
            id,
            floor,
            ROLES.grub.model,
            { input_tokens: 0, output_tokens: 0 },
            0,
            errorStatus(err),
          );
          q.removeFromGuardianHistory(db, playerMessageId);
          cooldownUntil.delete(id); // their turn wasn't used, so give it back
          sendError(socket, 'llm', 'The dungeon trembles. Try again.');
        } finally {
          busy.delete(id);
          socket.emit('player:state', stateFor(id));
        }
      }),
    );

    // The ONLY way to clear a floor. Synchronous, so first blood can't be claimed twice.
    socket.on(
      'player:door',
      safely((payload) => {
        const parsed = doorPayload.safeParse(payload);
        if (!playerId || !parsed.success) return;
        const id = playerId;
        const player = q.getPlayer(db, id);
        const floor = player.floor;
        if (!BUILT_FLOORS.has(floor)) return sendError(socket, 'not_ready', STAIRS);

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

        const firstBlood = !q.isFloorClearedInGame(db, gameId, floor);
        const score = scoreFloorClear({
          floor,
          guardianName: GUARDIAN_NAMES[floor] ?? 'the guardian',
          reachedAt: progress.reached_at,
          clearedAt: now,
          messagesUsed: progress.messages_used,
          firstBlood,
        });
        q.clearFloor(db, { playerId: id, floor, points: score.total, firstBlood, now });

        socket.emit('player:door-result', { correct: true, lockedMs: 0 });
        socket.emit('player:expression', { floor, state: 'slipped' });
        socket.emit('player:floor-cleared', {
          floor,
          lines: score.lines,
          total: score.total,
          score: player.score + score.total,
          title: titleFor(floor),
          nextFloorReady: BUILT_FLOORS.has(floor + 1),
        });
        socket.emit('player:state', stateFor(id));
      }),
    );
  });

  function logCall(
    id: string,
    floor: number,
    model: Parameters<typeof costUsd>[0],
    usage: Parameters<typeof costUsd>[1],
    latencyMs: number,
    status: string,
  ): void {
    q.insertLlmCall(db, {
      gameId,
      playerId: id,
      floor,
      role: 'grub',
      model,
      inputTokens: usage.input_tokens,
      cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      outputTokens: usage.output_tokens,
      costUsd: costUsd(model, usage),
      latencyMs,
      status,
      now: Date.now(),
    });
  }
}

const TAKEN = 'Someone in the dungeon already goes by that name.';
const STAIRS = 'The stairs below are still being carved. Wait here, rogue.';

// In-character reasons a nickname is refused. Never says which word matched.
function nicknameProblem(nickname: string): string | null {
  if (nickname.length < NICKNAME_MIN || nickname.length > NICKNAME_MAX) {
    return `Names need ${NICKNAME_MIN} to ${NICKNAME_MAX} characters.`;
  }
  if (!/^[A-Za-z0-9 _.-]+$/.test(nickname)) return 'Use letters, numbers, spaces, dots, - or _.';
  if (isProfane(nickname)) return 'Grub covers his ears. Pick a kinder name, tall-folk.';
  return null;
}

function sendError(socket: PlayerSocket, code: string, message: string): void {
  socket.emit('player:error', { code, message });
}
