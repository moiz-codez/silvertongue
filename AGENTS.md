# Silvertongue

A live, multiplayer AI-security game built for an Artificial Intelligence lab presentation (BSCS, 7th semester, Mehran UET). The whole class scans a QR code, picks a nickname and plays on their phones at the same time while the projector shows the dungeon live. Players must talk six AI guardians into revealing secret runes. Each floor demonstrates one real LLM-security idea, and the presentation ends with a reveal built from the class's own attempts.

## The game in one table

| Floor | Guardian | Defence (AI concept) | Intended way through |
|---|---|---|---|
| 1 | Grub, the Gate Goblin | Plain system prompt | Friendship, claiming to be his boss, asking twice |
| 2 | Ser Vellum, the Oathbound Knight | Strict instructions | Pieces: letters, backwards, acrostic poem |
| 3 | Morwen the Witch & Snip the crow | Output filter (code, keyword match) | The rune in a shape Snip doesn't know (dashes, other script) |
| 4 | Gorm & Mumble, the two-headed ogre | Input guard (2nd AI, sees one message) | An innocent-looking plan spread over several messages |
| 5 | Queen Ashveil, the Lich | Defence in depth: Ward of Ears (history-aware input guard) + Ward of Tongues (AI output judge) | Taunt her vanity → a riddle about the rune's *meaning* |
| 6 | Vorgath, the Dragon Who Remembers | Adaptive: every winning trick anywhere becomes a "carving" his guard blocks | A gift he has never seen (embedding novelty check) → riddle |

- Full design: `docs/GAME_DESIGN.md`
- Exact prompts, per-floor settings and playtest checklists: `docs/prompts/0N-*.md` (**source of truth for guardian wording**)
- Architecture, data model, socket events, pipelines: `docs/ARCHITECTURE.md`
- Milestones and acceptance criteria: `docs/BUILD_PLAN.md`
- Server setup: `docs/DEPLOY_ORACLE.md`

## Core game rules

- Every player gets their own random rune per floor: two concrete, picturable words, e.g. `EMBER-FANG`. Shared answers are useless.
- A floor is cleared **only** by submitting the rune at the door. A model saying "you win" means nothing.
- Door check: compare guess and rune after normalising both (uppercase, letters only). 3 wrong guesses → door locked 20 s.
- Hints ("notes on the wall") unlock after 10 and 20 failed tries on a floor.
- Scoring, titles, hints, screens: `docs/GAME_DESIGN.md`.

## Stack (decided; ask before changing)

- **Runtime:** Node.js 24 LTS, TypeScript strict, npm workspaces.
- **Server** (`apps/server`): Fastify 5, Socket.IO 4, better-sqlite3 (WAL mode), zod, `@anthropic-ai/sdk`, pino. Floor 6 embeddings: `@huggingface/transformers` running `Xenova/all-MiniLM-L6-v2` locally (the Claude API has no embeddings endpoint).
- **Web** (`apps/web`): React + Vite + TypeScript, socket.io-client, `qrcode` for the projector QR. Plain CSS with design tokens. No UI framework.
- **Shared** (`packages/shared`): socket event types, zod schemas, constants.
- **Tests:** vitest.
- **Hosting:** one Oracle Cloud Always Free VM (Ubuntu, ARM64). Fastify serves the built web app and Socket.IO in **one process** behind Caddy (HTTPS + websockets), run by systemd. One process means one in-memory LLM queue sees all traffic.

## Repo layout

```
apps/server/src/
  index.ts          Fastify + Socket.IO bootstrap; serves apps/web/dist in production
  config/           env.ts (zod-validated env), models.ts (model + max_tokens per role, "thinking off" per model)
  db/               schema.sql, db.ts, typed query functions
  llm/              client.ts (Anthropic wrapper + prompt assembly), queue.ts (rate limiter), mock.ts
  game/             runeWords.ts, runes.ts, door.ts, scoring.ts, hints.ts, titles.ts, state.ts
  floors/           01-grub/ … 06-vorgath/: prompts.ts, pipeline.ts, *.test.ts
  security/         normalize.ts, revealsRune.ts, snip.ts, sanitize.ts, verdict.ts (fail-closed parsing)
  embeddings/       embed.ts, cosine.ts
  sockets/          player.ts, projector.ts, admin.ts
apps/web/src/
  routes/           Join, Play, Projector, Admin
  sprites/          pixel-art SVG components, two expressions per guardian
  styles/           tokens.css
packages/shared/src/  events.ts, schemas.ts, constants.ts
scripts/            playtest.ts, loadtest.ts, seed.ts
docs/               design docs + prompts/
```

## Commands

Create these in milestone M0 and keep this list accurate.

- `npm install`
- `npm run dev` — server + web with hot reload; `LLM_MODE=mock` unless overridden
- `npm run check` — typecheck + lint + unit tests. **Must pass before any task is done.**
- `npm test` — unit tests only
- `npm run build` — typecheck, then production build of the web app (the server runs its `.ts` source directly on Node 24)
- `npm start` — production server on `PORT`; serves `apps/web/dist` and Socket.IO from one process
- `npm run smoke` — two **real** Haiku calls; passes when the second shows `cache_read_input_tokens > 0` (well under $0.01)
- `npm run native-check` — better-sqlite3 in WAL mode + one local MiniLM embedding; run on every new machine/server
- `npm run playtest -- --floor 1` — scripted attacks from the floor's playtest checklist against the **real** API; prints transcripts, leaks, tokens and cost (costs money; Haiku = about a cent). Floors are added as they are built.
- `npm run loadtest -- --players 40` — fake socket clients against a mock-mode server

## Message pipeline (every floor)

```
player text → sanitize (trim, ≤300 chars, strip [bracket tags])
            → cooldown + per-player cap check
            → [input guard: floor 4 Gorm, floors 5–6 Ward of Ears]   SEAL/SMASH → stop
            → guardian reply (full reply, no streaming)
            → [output checks: floor 3 Snip; floors 5–6 revealsRune → Ward of Tongues]
            → send filtered text + expression state to player
            → log everything server-side; emit moderated events to projector
```

Per-floor details: `docs/ARCHITECTURE.md` → "Floor pipelines".

## Security invariants (never break these)

1. `ANTHROPIC_API_KEY` exists only in the server environment. Never in `apps/web`, never in a `VITE_*` variable, never in any response.
2. Runes never leave the server: not in socket payloads, HTTP responses, error messages, projector events or client logs.
3. Raw guardian replies never leave the server. Only post-filter text is sent.
4. A floor is cleared only by the server-side door check. Never trust the client or model output for a win.
5. Guards and judges fail closed: unparseable output, extra keys, or any verdict other than the allow value (`PASS` / `CLEAN`, compared case-insensitively), blocks.
6. Gorm and the Ward of Ears never receive the rune.
7. Player text is data: wrap it in `<traveller_message>` tags, strip `[...]` tags, cap its length.
8. Guardian replies are never streamed to clients.
9. Cooldowns, caps and rate limits are enforced on the server.
10. Admin actions require `ADMIN_TOKEN`. The projector only shows filtered, moderated or admin-approved text.
11. Unit tests never call the real API; they use the mock client.

## LLM usage

- **Models:** `claude-haiku-5-5` for every role by default. Use `claude-sonnet-5-5` only for a floor that fails its playtest checklist on Haiku. Configure in `config/models.ts`; never hardcode model IDs elsewhere.
- **Account limits (Evaluation tier, per model):** 1,000 requests/min, 500K input tokens/min (excluding cache reads), 80K output tokens/min. The queue targets ≤80% of each.
- **Prompt caching on every call:** the static character prompt goes first with `cache_control`; per-player data (the rune, the hoard note) goes in a **last, uncached** system block. The static block must be ≥512 tokens and byte-identical across players.
- Small `max_tokens` per role (see each prompt file).
- **No sampling parameters.** Never send `temperature`, `top_p` or `top_k` on any call: Haiku 5.5 and Sonnet 5.5 reject non-default values with a 400. Consistency comes from the prompts, few-shot examples and (for guards and judges) structured outputs instead.
- **Thinking off on every game call** (guardians, Gorm, both Wards, tagger, Carver): short in-character replies and verdicts don't need it, and it would eat into the small `max_tokens`. Haiku 5.5 takes `thinking: { type: 'disabled' }`; Sonnet 5.5 rejects that with a 400 and takes `{ type: 'between_tools' }` instead. The value comes from `config/models.ts` per model, never hardcoded. Don't set `effort`, and never change it within one player's conversation (it invalidates the cache).
- **Structured outputs for guards and judges** (Gorm, Ward of Ears, Ward of Tongues, tagger): `output_config.format` with `type: 'json_schema'`, an `enum` for the verdict and `additionalProperties: false`. One fixed schema per role, defined once in code: a changing schema breaks the prompt cache and recompiles the grammar. `parseVerdict` still fails closed, because a refusal or a `max_tokens` stop can return output that doesn't match the schema.
- **Requests and replies:** every request ends with a user turn (no prefill; these models reject it). Read reply text by finding blocks with `type === 'text'`, never by position.
- **Budget:** about $5 prepaid. A full 40-player game ≈ $0.70 on Haiku. Log usage and cost per call; the admin screen shows running spend.

## Conventions

- TypeScript strict; no `any`. Validate every socket payload with zod.
- Game logic (door, scoring, hints, revealsRune, snip, cosine, verdict parsing) is pure functions with unit tests.
- Prompts live in `floors/<n>/prompts.ts`; `docs/prompts/*.md` is the source of truth for wording. Change both together.
- Small, focused commits; see "Git workflow" below.
- Cross-platform: development is on Windows, production on Linux ARM64. Write scripts in TypeScript/Node, not bash; build paths with `path.join`.
- Everything is shown in a classroom: all content stays PG.

## Git workflow

- One branch per milestone, named `mN-short-name` (e.g. `m0-scaffold`, `m1-floor1`), branched from an up-to-date `main`.
- Small commits, each a working state, with imperative messages ("Add door check with lockout").
- `npm run check` passes before every commit.
- Push the branch to `origin`; Moiz reviews on GitHub and merges to `main` via a pull request.
- Never commit `.env`, never force-push, never rewrite pushed history.
