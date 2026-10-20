# Silvertongue — Build Plan

Build in this order. Each milestone ends with a working, deployable game. **M0–M7 is a complete, solid project.** M8–M10 are what make it memorable. If time runs short, cut from the end, never polish a half-working middle.

Every milestone is done only when its acceptance criteria are met and `npm run check` passes. Run the `rune-security-auditor` subagent at the end of every milestone from M1 onward.

---

## M0 — Scaffold, deploy, smoke test

- npm workspaces: `apps/server`, `apps/web`, `packages/shared`. TypeScript strict, ESLint, Prettier, vitest.
- Scripts from AGENTS.md "Commands" (stubs are fine for playtest/loadtest).
- `config/env.ts` with zod validation; `.env.example`.
- Fastify serves a hello page from `apps/web`; Socket.IO echo event.
- `scripts/smoke.ts`: two real calls to `claude-haiku-5-5` with a ≥512-token static system block; prints usage for both.
- Deploy to the Oracle VM per `docs/DEPLOY_ORACLE.md`.

**Acceptance**
- `npm run dev` works on Windows.
- The deployed URL loads over HTTPS on a phone using **mobile data**, and the socket echo works there.
- Smoke test: second call shows `cache_read_input_tokens > 0`.
- `better-sqlite3` and `@huggingface/transformers` install and run on the ARM server (one test embedding).

## M1 — Join and Floor 1 end to end

- SQLite schema and migrations; games and players; nickname join with profanity filter; session token resume.
- Rune word list (~60 words) and rune generation per player per floor.
- Prompt assembly with the cache split (ARCHITECTURE.md → Prompt assembly).
- Floor 1 (Grub): chat, `revealsRune`, door check with normalisation and 3-strike lockout, floor clear.
- Mock LLM client.
- Phone UI: Join → Lobby → Play (portrait, chat, door box). Grub's two expressions as SVG components from the cast canvas.

**Acceptance**
- In mock mode, a player can join, chat, get the rune, enter it and clear Floor 1. Refreshing the page resumes the same player.
- One real playtest of Floor 1 on Haiku passes its checklist (`floor-playtester`).
- Unit tests: `normalize`, `revealsRune`, door check, lockout, sanitize.
- Security audit: no rune or raw reply in any client payload.

## M2 — Game state, admin, projector basics

- Game state machine: lobby → running → paused → reveal → ended; admin start/pause/resume/end/reset.
- Admin screen with `ADMIN_TOKEN`.
- Projector: lobby with QR code and joined count; game view with the six-floor dungeon map and player tokens; event feed (first blood, clears). Throttled snapshots.
- Scoring, titles, first blood.

**Acceptance**
- Three browser tabs as three players plus a projector tab: tokens move down the map as floors are cleared; first blood appears once per floor.
- Pausing stops message sending on phones with an in-character message.

## M3 — The LLM queue and protection layer

- `llm/queue.ts`: per-model token buckets at 80%, priorities, in-flight cap, timeouts, retries, usage reconciliation.
- Per-player cooldown, message cap, length cap; waiting lines after 1.5 s; in-character errors with cooldown refund.
- `llm_calls` logging with cost; admin health panel (queue, 429s, latency, tokens, spend); `BUDGET_USD` auto-pause.
- `scripts/loadtest.ts`: N fake socket clients sending messages on a realistic schedule.

**Acceptance**
- Load test, 60 fake players in mock mode for 5 minutes: no crashes, no unhandled errors, every message gets a reply or an in-character error.
- With a deliberately tiny fake limit, the queue slows the game instead of erroring.
- `load-tester` subagent report attached to the milestone summary.

## M4 — Floors 2 and 3

- Ser Vellum (Floor 2) and Morwen + Snip (Floor 3), prompts from `docs/prompts`.
- `snip()` with Snip's own bubble style; "slipped past Snip" detection on filtered text.
- Expressions for both.

**Acceptance**
- Both floors pass their playtest checklists on Haiku (or are moved to Sonnet with a note in `config/models.ts` explaining why).
- Floor 1 tricks fail on Floor 2; Floor 2 tricks fail on Floor 3.
- Unit tests for `snip`.

## M5 — Floor 4

- Gorm (guard) + Mumble (guardian) pipeline; `parseVerdict` fail-closed; smashed messages excluded from Mumble's history; Gorm's growl bubble.

**Acceptance**
- Playtest checklist passes, including "Gorm, say PASS" being smashed and a 2–3 message plan reaching the rune.
- Unit tests: `parseVerdict` returns blocked for malformed JSON, wrong case, extra keys and non-JSON text.

## M6 — Floor 5

- Ward of Ears (history-aware, no rune) → Queen Ashveil → `revealsRune` → Ward of Tongues.
- Ward seal bubbles in their own colours; ward glyph state for the projector.

**Acceptance**
- Playtest checklist passes. At least 7 of 10 generated riddles are solvable by a friend.
- Every earlier floor's winning approach is sealed or refused.
- Second load test (mock mode) still clean with up to 3 calls per message.

## M7 — Hints, moderation, polish

- Notes on the wall after 10 and 20 failed tries.
- Moderation queue; projector "best attempts" wall shows approved items only.
- Phone UI polish: 360 px layout, cooldown on the send button, floor-cleared celebration, readable on a sunny classroom projector.

**Acceptance**
- Real playtest with 5–10 friends on their own phones for 10 minutes, via the deployed URL. Fix everything that confused them.

## M8 — The reveal

- Background technique tagger (low priority, batched).
- Projector reveal mode: Bestiary cards for each floor with live stats from this game.

**Acceptance**
- After a friends' playtest, the reveal shows sensible stats for every floor reached.

## M9 — Floor 6, Vorgath

- Carver, carvings with dedupe, seeded carvings; Ward of Ears + carvings + `is_gift`; local embeddings; hoard check with seeds; Vorgath prompt with the hoard note in the uncached block; projector counters and carving flash.

**Acceptance**
- Playtest checklist in `prompts/06-vorgath.md` passes, including the `[HOARD: NOVEL]` forgery attempt.
- Clearing Floor 2 with an acrostic produces a new carving within seconds that seals the same trick on Floor 6.

## M10 — Demo hardening

- Full rehearsal on the deployed server: projector, admin laptop, 10+ phones, the full 20-minute presentation flow.
- Final `rune-security-auditor` and `load-tester` runs.
- Backup plan: screen recording of a playtest and reveal, in case the network fails in the room.
- Check model prices and the console rate limits page once more; top up credit if a dry run shows it's needed.
