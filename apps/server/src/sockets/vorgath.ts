// Floor 6 around the edges of play: whether Vorgath is open, his seeds, and the Carver that turns
// every clear anywhere into a new carving. Everything here runs in the background: a failure is
// logged and never reaches a player.
import * as q from '../db/queries.ts';
import { costUsd } from '../config/models.ts';
import { carveClear } from '../floors/06-vorgath/carver.ts';
import { seedFloor6 } from '../floors/06-vorgath/seeds.ts';
import type { LlmResult } from '../llm/client.ts';
import type { GameContext } from './player.ts';

export type Vorgath = ReturnType<typeof createVorgath>;

export function createVorgath(ctx: GameContext) {
  const { db } = ctx;

  // Open = the admin's switch is on AND the embedding model loaded.
  const open = () => ctx.game.floor6_enabled && ctx.embed !== null;

  // Once per game (seedFloor6 checks): on Start, when the switch goes on, and at boot.
  function seed(): void {
    const embed = ctx.embed;
    if (!open() || !embed || ctx.game.status === 'lobby' || ctx.game.status === 'ended') return;
    seedFloor6(db, ctx.game.id, embed, Date.now())
      .then(() => ctx.changed())
      .catch(ctx.logError);
  }

  // After a clear on ANY floor. The projector's counter climbs when a carving lands.
  function afterClear(playerId: string, floor: number): void {
    const embed = ctx.embed;
    if (!open() || !embed) return;
    const gameId = ctx.game.id;
    const log = (result: LlmResult, status: string) =>
      q.insertLlmCall(db, {
        gameId,
        playerId,
        floor,
        role: 'carver',
        model: result.model,
        inputTokens: result.usage.input_tokens,
        cacheCreationTokens: result.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: result.usage.cache_read_input_tokens ?? 0,
        outputTokens: result.usage.output_tokens,
        costUsd: costUsd(result.model, result.usage),
        latencyMs: result.latencyMs,
        status,
        now: Date.now(),
      });
    carveClear(
      { db, complete: ctx.complete, embed, log },
      { gameId, playerId, floor, now: Date.now() },
    )
      .then((carved) => {
        if (carved !== null) ctx.changed();
      })
      .catch(ctx.logError);
  }

  return { open, seed, afterClear };
}
