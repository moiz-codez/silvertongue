// The reveal: the technique tagger (in the background, and a catch-up when the admin pauses or
// starts the reveal) and the Bestiary cards the projector shows. Cards carry numbers, fixed text
// and admin-approved quotes only (game/bestiary.ts); runes are read here to count riddles and
// never leave this file.
import { setTimeout as sleep } from 'node:timers/promises';
import type { AdminReply, RevealCard } from '@silvertongue/shared/events';
import { costUsd } from '../config/models.ts';
import * as q from '../db/queries.ts';
import { buildCards, type FloorStats } from '../game/bestiary.ts';
import { isRiddle, leakRoute, type LeakRoute } from '../game/leakRoute.ts';
import type { LlmResult } from '../llm/client.ts';
import { BATCH_SIZE, maskRune, tagBatch, type Technique } from '../llm/tagger.ts';
import type { GameContext } from './player.ts';

const CATCH_UP_BATCHES = 3; // tagger calls at once during a catch-up
const REVEAL_WAIT_MS = 15_000; // after this the cards go up without techniques
const QUIET_IN_FLIGHT = 5; // the background tagger only calls when fewer calls than this are running

export type Reveal = ReturnType<typeof createReveal>;

export function createReveal(ctx: GameContext) {
  const { db, env } = ctx;
  const skip = new Set<number>(); // messages whose batch failed: never retried in a loop
  let ticking: Promise<void> | null = null; // the background tagger's one call
  let catchUpRun: Promise<void> | null = null;
  let tagging: { done: number; total: number } | null = null;
  let ready = false; // the cards can go up
  let techniques = false; // every winning message had a tag when the cards were made
  let index = 0;

  const canSpend = () =>
    ctx.game.budget_alert_at === null && q.gameSpendUsd(db, ctx.game.id) < env.BUDGET_USD;

  function nextBatch(size: number) {
    return q
      .listUntagged(db, ctx.game.id, size + skip.size)
      .filter((m) => !skip.has(m.id))
      .slice(0, size);
  }

  // One tagger call. Any failure only means "no label": those messages are skipped from now on.
  async function tag(rows: ReturnType<typeof nextBatch>): Promise<void> {
    try {
      const texts = rows.map((m) => maskRune(m.text, q.listRunes(db, m.player_id)));
      const { labels, result } = await tagBatch(ctx.complete, texts);
      log(result, result.stopReason === 'refusal' ? 'refusal' : labels ? 'ok' : 'unreadable');
      if (!labels) throw new Error('unreadable labels');
      rows.forEach((m, i) => q.setTechnique(db, m.id, labels[i]!));
    } catch {
      rows.forEach((m) => skip.add(m.id));
    }
  }

  function log(result: LlmResult, status: string): void {
    q.insertLlmCall(db, {
      gameId: ctx.game.id,
      playerId: null,
      floor: null,
      role: 'tagger',
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
  }

  // Every few seconds while the game is on: one batch, only when no player is waiting.
  // It runs from a timer, so nothing in it may throw.
  function tick(): void {
    try {
      if (ticking || catchUpRun || !canSpend()) return;
      if (ctx.game.status !== 'running' && ctx.game.status !== 'paused') return;
      const queue = ctx.queueStats();
      if (queue.queued > 0 || queue.inFlight >= QUIET_IN_FLIGHT) return;
      const rows = nextBatch(BATCH_SIZE);
      if (rows.length === 0) return;
      ticking = tag(rows).finally(() => (ticking = null));
    } catch (e) {
      ctx.logError(e);
    }
  }

  // Fills in clears from older games, then tags everything left, winning messages first.
  // One at a time; a second call joins the one running.
  function catchUp(): Promise<void> {
    catchUpRun ??= (async () => {
      backfillRoutes();
      await ticking;
      tagging = { done: 0, total: q.countUntagged(db, ctx.game.id).all };
      ctx.changed();
      while (canSpend()) {
        const rows = nextBatch(BATCH_SIZE * CATCH_UP_BATCHES);
        if (rows.length === 0) break;
        const batches = [];
        for (let i = 0; i < rows.length; i += BATCH_SIZE)
          batches.push(rows.slice(i, i + BATCH_SIZE));
        await Promise.all(batches.map(tag));
        tagging.done += rows.length;
        ctx.changed();
      }
    })()
      .catch(ctx.logError)
      .finally(() => {
        catchUpRun = null;
        tagging = null;
        ctx.changed();
      });
    return catchUpRun;
  }

  function backfillRoutes(): void {
    for (const c of q.listClearsWithoutRoute(db, ctx.game.id)) {
      const messages = q.listFloorMessages(db, c.player_id, c.floor);
      q.setClear(
        db,
        c.player_id,
        c.floor,
        leakRoute(c.floor, messages, q.getRune(db, c.player_id, c.floor)),
      );
    }
  }

  // Start reveal: the projector holds until every winning message has a tag (they go first), the
  // catch-up ends, or 15 s have passed. The rest of the catch-up keeps going without changing the
  // cards: they only use the winning messages' tags.
  async function prepare(): Promise<void> {
    const running = catchUp();
    await Promise.race([running, winningTagged(Date.now() + REVEAL_WAIT_MS)]);
    if (ctx.game.status !== 'reveal') return;
    techniques = q.countUntagged(db, ctx.game.id).winning === 0;
    ready = true;
    index = 0;
    ctx.changed();
  }

  // Also gives up at the deadline, or when the catch-up ends (a failed batch is never retried).
  async function winningTagged(deadline: number): Promise<void> {
    while (catchUpRun && Date.now() < deadline && q.countUntagged(db, ctx.game.id).winning > 0)
      await sleep(100);
  }

  function floorStats(): FloorStats[] {
    const gameId = ctx.game.id;
    const progress = q.listGameProgress(db, gameId);
    const messages = q.listGameMessages(db, gameId);
    const byId = new Map(messages.map((m) => [m.id, m]));
    const approved = q.listApprovedAttempts(db, gameId, 100); // newest first
    const runeOf = (playerId: string, floor: number) => q.getRune(db, playerId, floor);

    return [1, 2, 3, 4, 5].map((floor) => {
      const here = progress.filter((p) => p.floor === floor);
      const clears = here.filter((p) => p.cleared_at !== null);
      const said = messages.filter((m) => m.floor === floor);
      const players = said.filter((m) => m.speaker === 'player');
      const routes: Partial<Record<LeakRoute, number>> = {};
      for (const c of clears) {
        const route = (c.leak_route ?? 'other') as LeakRoute;
        routes[route] = (routes[route] ?? 0) + 1;
      }
      const quote = approved.find((a) => a.floor === floor);
      return {
        floor,
        reached: here.length,
        cleared: clears.length,
        attempts: players.length,
        clearMs: clears.map((c) => c.cleared_at! - c.reached_at),
        routes,
        winningTags: clears
          .map((c) => byId.get(c.winning_message_id ?? -1)?.technique)
          .filter((t): t is Technique => !!t),
        lettersSnipped: said
          .filter((m) => m.speaker === 'snip')
          .reduce((sum, m) => sum + Number(m.text.match(/(\d+) letters/)?.[1] ?? 0), 0),
        smashed: players.filter((m) => m.verdict === 'SMASH').length,
        passed: floor === 4 ? players.filter((m) => m.verdict === 'PASS').length : 0,
        planLengths: clears
          .filter((c) => c.leak_route === 'plan' && c.leak_message_id !== null)
          .map(
            (c) =>
              players.filter(
                (m) =>
                  m.player_id === c.player_id && m.verdict === 'PASS' && m.id < c.leak_message_id!,
              ).length,
          ),
        earsSeals: players.filter((m) => m.verdict === 'SEAL').length,
        tonguesSeals: said.filter((m) => m.speaker === 'guardian' && m.verdict === 'LEAK').length,
        riddlesGiven:
          floor === 5
            ? said.filter(
                (m) =>
                  m.speaker === 'guardian' &&
                  m.verdict === 'CLEAN' &&
                  isRiddle(m.text, runeOf(m.player_id, 5)),
              ).length
            : 0,
        quote: quote ? { nickname: quote.nickname, text: quote.text } : null,
      };
    });
  }

  // Built fresh for every screen update, so a quote the admin hides or a player they kick leaves
  // the card at once.
  function cards(): RevealCard[] {
    return buildCards(floorStats(), leaders(), techniques);
  }

  function leaders() {
    return q
      .listPlayers(db, ctx.game.id)
      .filter((p) => !p.kicked)
      .map((p) => ({ nickname: p.nickname, floor: p.floor, score: p.score }));
  }

  return {
    tick,

    // After an admin command went through.
    afterCommand(type: string): void {
      if (type === 'pause') void catchUp();
      if (type === 'reveal') {
        ready = false;
        void prepare();
      }
    },

    step(by: number): AdminReply {
      if (ctx.game.status !== 'reveal' || !ready) {
        return { ok: false, error: 'The Bestiary is still being written.' };
      }
      index = Math.max(0, Math.min(cards().length - 1, index + by));
      return { ok: true };
    },

    // For the projector: the card on screen, while the reveal is on and the cards are ready.
    view() {
      if (ctx.game.status !== 'reveal' || !ready) return null;
      const all = cards();
      index = Math.min(index, all.length - 1);
      return { card: all[index]!, index, total: all.length };
    },

    // For the admin screen.
    progress: () => tagging && { ...tagging },
    position: () =>
      ctx.game.status === 'reveal' && ready ? { index, total: cards().length } : null,
  };
}
