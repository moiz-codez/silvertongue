// The big screen: read-only, no token. It only ever gets nicknames that passed the filter and
// event text the server wrote itself, built field by field. No ids, tokens, runes or player messages.
import type { Namespace } from 'socket.io';
import type { ProjectorServerEvents, ProjectorSnapshot } from '@silvertongue/shared/events';
import * as q from '../db/queries.ts';
import { elapsedMs } from '../game/state.ts';
import type { GameContext, PlayerServer } from './player.ts';
import { throttle } from './throttle.ts';

const FEED_LENGTH = 8;

// Returns "something changed": call it freely, it sends at most 2 snapshots a second.
export function registerProjector(io: PlayerServer, ctx: GameContext): () => void {
  // Its own namespace with its own event types; it listens to nothing.
  const screen = io.of('/projector') as unknown as Namespace<object, ProjectorServerEvents>;

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
      feed: q.listProjectorEvents(db, game.id, FEED_LENGTH).map((e) => ({
        gameMs: e.game_ms,
        type: e.type === 'first_blood' ? 'first_blood' : 'clear',
        text: e.text,
      })),
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
