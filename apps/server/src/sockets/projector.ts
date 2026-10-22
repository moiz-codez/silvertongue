// The big screen: read-only, no token. It only ever gets nicknames that passed the filter and
// event text the server wrote itself, built field by field, plus winning messages the admin approved.
// No ids, tokens, runes, or any other player message.
import type { Namespace } from 'socket.io';
import type { ProjectorServerEvents, ProjectorSnapshot } from '@silvertongue/shared/events';
import { GUARDIANS } from '@silvertongue/shared/floors';
import * as q from '../db/queries.ts';
import { elapsedMs } from '../game/state.ts';
import type { GameContext, PlayerServer } from './player.ts';
import { clientIp } from './clientIp.ts';
import { throttle } from './throttle.ts';

const FEED_LENGTH = 5;
const BEST_ATTEMPTS = 5;
const MAX_SCREENS_PER_IP = 5; // a projector or two plus spares; stops one address opening hundreds

// Returns "something changed": call it freely, it sends at most 2 snapshots a second.
export function registerProjector(io: PlayerServer, ctx: GameContext): () => void {
  // Its own namespace with its own event types; it listens to nothing.
  const screen = io.of('/projector') as unknown as Namespace<object, ProjectorServerEvents>;
  screen.use((socket, next) => {
    const ip = clientIp(socket.handshake);
    const open = [...screen.sockets.values()].filter((s) => clientIp(s.handshake) === ip).length;
    if (open >= MAX_SCREENS_PER_IP) return next(new Error('Too many screens from this address.'));
    next();
  });

  function snapshot(): ProjectorSnapshot {
    const { db, game } = ctx;
    return {
      status: game.status,
      elapsedMs: elapsedMs(game, Date.now()),
      publicUrl: ctx.env.PUBLIC_URL,
      players: q
        .listPlayers(db, game.id)
        .filter((p) => !p.kicked)
        .map((p) => ({ nickname: p.nickname, floor: p.floor })),
      // Server-written words around a filtered nickname. No player-typed text, ever.
      feed: q.listProjectorEvents(db, game.id, FEED_LENGTH).map((e) =>
        e.type === 'note'
          ? { gameMs: e.game_ms, type: 'note', text: `A note has appeared on Floor ${e.floor}.` }
          : {
              gameMs: e.game_ms,
              type: e.type === 'first_blood' ? 'first_blood' : 'clear',
              text: GUARDIANS[e.floor]?.clearedBy(e.nickname) ?? '',
            },
      ),
      wards: q.countWardSeals(db, game.id), // counts only, never text
      // The only player-typed text here: what the admin approved.
      bestAttempts: q
        .listApprovedAttempts(db, game.id, BEST_ATTEMPTS)
        .map((a) => ({ nickname: a.nickname, floor: a.floor, text: a.text })),
    };
  }

  screen.on('connection', (socket) => {
    try {
      socket.emit('projector:snapshot', snapshot());
    } catch (err) {
      ctx.logError(err);
    }
  });

  return throttle(() => {
    try {
      screen.emit('projector:snapshot', snapshot());
    } catch (err) {
      ctx.logError(err); // a missed frame is fine; the next change sends a fresh one
    }
  }, 500);
}
