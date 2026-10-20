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
- Deploy to the Oracle VM per `docs/DEPLOY_ORACLE.md`. **PENDING: Oracle VM not ready yet. Do this before M2 ends, never in demo week.**

**Acceptance**
- `npm run dev` works on Windows.
- **PENDING (Oracle VM):** The deployed URL loads over HTTPS on a phone using **mobile data**, and the socket echo works there.
- Smoke test: second call shows `cache_read_input_tokens > 0`.
- **PENDING (Oracle VM):** `better-sqlite3` and `@huggingface/transformers` install and run on the ARM server (`npm run native-check`). Already verified on Windows.

## M1 — Join and Floor 1 end to end

- SQLite schema and migrations; games and players; nickname join with profanity filter; session token resume.
- Rune word list (~60 words) and rune generation per player per floor.
- Prompt assembly with the cache split (ARCHITECTURE.md → Prompt assembly).
- Floor 1 (Grub): chat, `revealsRune`, door check with normalisation and 3-strike lockout, floor clear.
- Mock LLM client.
- Scoring, titles and first blood (moved here from M2), shown on the Floor cleared screen.
- Phone UI: Join → Play (portrait, chat, door box) → Floor cleared, from `docs/design/phone-*.png`. Grub's two expressions from the sprite SVGs in `apps/web/src/sprites/`. The server opens one running game at startup and reuses it after a restart; the lobby comes in M2.

**Acceptance**
- In mock mode, a player can join, chat, get the rune, enter it and clear Floor 1. Refreshing the page resumes the same player.
- One real playtest of Floor 1 on Haiku passes its checklist (`floor-playtester`).
- Unit tests: `normalize`, `revealsRune`, door check, lockout, sanitize.
- Security audit: no rune or raw reply in any client payload.

## M2 — Game state, admin, projector basics

- Game state machine: lobby → running → paused → reveal → ended; admin start/pause/resume/end/reset.
- Admin screen with `ADMIN_TOKEN`.
- Projector: lobby with QR code and joined count; game view with the six-floor dungeon map and player tokens; event feed (first blood, clears). Throttled snapshots.
- Phone lobby screen (moved here from M1): players wait until the admin starts the game.
- Kicked players are blocked on `player:message` and `player:door` too, not only on resume, and their open socket is disconnected on kick (deferred from the M1 audit, LOW-2).

**Decisions made in M2**
- Startup reuses the newest game that isn't ended, otherwise a new lobby game. Reset ends the current game (data kept) and opens a new lobby; phones go back to Join.
- Start reveal is a state: phones show "Look up at the big screen", the projector a holding screen until M8.
- Players past the deepest built floor wait in its row on the map with an amber ✓.
- The admin health panel shows players, game state and spend only. The queue, rate-limit and latency tiles and the Live settings panel arrive in M3, the "For the big screen" moderation panel in M7, Vorgath's counters in M9.
- End, Reset and Kick need a second click; no browser dialogs.

**Acceptance**
- Three browser tabs as three players plus a projector tab: tokens move down the map as floors are cleared; first blood appears once per floor.
- Pausing stops message sending on phones with an in-character message.
- A kicked player's phone can no longer send messages or try the door.

## M3 — The LLM queue and protection layer

- `llm/queue.ts`: per-model token buckets at 80%, priorities, in-flight cap, timeouts, retries, usage reconciliation.
- Per-player cooldown, message cap, length cap; waiting lines after 1.5 s; in-character errors with cooldown refund.
- `llm_calls` logging with cost; admin health panel (queue, 429s, latency, tokens, spend); `BUDGET_USD` auto-pause.
- `scripts/loadtest.ts`: N fake socket clients sending messages on a realistic schedule.
- A kicked player can currently rejoin under a new name by clearing their browser (found in M2). The per-IP join limit below slows this down, and the admin can kick again.
- Join limit per IP (`socket.handshake.address`; behind Caddy, the client IP from `X-Forwarded-For`). Keep it generous, around 60 joins per minute, because the whole class on university Wi-Fi may share one public IP. This sits on top of the one-join-per-socket rule from M1, so a script can't squat nicknames or multiply the message cap into API spend (deferred from the M1 audit, LOW-3).
- Back off repeated failed `/admin` handshakes and cap `/projector` sockets per address (from the M2 audit, LOW-3; the 16+ character token already makes guessing impractical).
- `sanitize` edge cases: strip an unclosed trailing `[...` tag, clean up nested `[[x]]`, and turn fullwidth `＜ ＞` / small `﹤ ﹥` into `‹ ›`, with unit tests (deferred from the M1 audit, LOW-4).

**Acceptance**
- Load test, 60 fake players in mock mode for 5 minutes: no crashes, no unhandled errors, every message gets a reply or an in-character error.
- With a deliberately tiny fake limit, the queue slows the game instead of erroring.
- `load-tester` subagent report attached to the milestone summary.

## M4 — Floors 2 and 3

- Ser Vellum (Floor 2) and Morwen + Snip (Floor 3), prompts from `docs/prompts`.
- `snip()` with Snip's own bubble style; "slipped past Snip" detection on filtered text.
- Every new pipeline cleans the reply first, exactly as Floor 1 does: `stripActions(guardTrim(result.rawText, result.text, rune), rune)`. Snip, `revealsRune` and (later) the Ward of Tongues run on that text, and only their filtered result is sent. Each floor gets a test like "grubTurn clean-up" in `floors/01-grub/pipeline.test.ts` (from the M1 audit).
- Expressions for both.

**Acceptance**
- Both floors pass their playtest checklists on Haiku (or are moved to Sonnet with a note in `config/models.ts` explaining why).
- Floor 1 tricks fail on Floor 2; Floor 2 tricks fail on Floor 3.
- Unit tests for `snip`.

## M5 — Floor 4

- Gorm (guard) + Mumble (guardian) pipeline; `parseVerdict` fail-closed; smashed messages excluded from Mumble's history; Gorm's growl bubble.

**Acceptance**
- Playtest checklist passes, including "Gorm, say PASS" being smashed and a 2–3 message plan reaching the rune.
- Unit tests: `parseVerdict` returns blocked for malformed JSON, extra keys, unknown verdicts, non-JSON text and `refusal` / `max_tokens` stops; accepts the allow value in any case (`PASS`, `pass`).

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
