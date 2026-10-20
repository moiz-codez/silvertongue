# Guardian prompts

One file per floor. These are the **source of truth for wording**: every guardian, guard and judge prompt, the per-floor settings, the wall hints, the bestiary card, and the playtest checklist.

Two things to know when turning them into `apps/server/src/floors/<n>/prompts.ts`:

1. **`{{RUNE}}` is not interpolated into the prompt text.** To keep the cached prompt identical for every player, the line that states the rune is replaced with "The rune is given in the final note at the end of these instructions", and the rune goes into a second, uncached system block. Examples always use the example rune OAK-WIND. See `docs/ARCHITECTURE.md` → "Prompt assembly and caching". The same applies to Vorgath's `[HOARD: …]` note.
2. **Model rows in the Settings tables are relative** ("small", "mid-tier", "strongest affordable"). The actual default for every role is `claude-haiku-5-5` (see AGENTS.md → LLM usage). A role moves to `claude-sonnet-5-5` only when its floor fails the playtest checklist on Haiku, and that decision is recorded in `config/models.ts`.

When you change how a guardian behaves, update the file here in the same change.
