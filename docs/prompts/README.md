# Guardian prompts

One file per floor. These are the **source of truth for wording**: every guardian, guard and judge prompt, the per-floor settings, the wall hints, the bestiary card, and the playtest checklist.

Two things to know when turning them into `apps/server/src/floors/<n>/prompts.ts`:

1. **`{{RUNE}}` is not interpolated into the prompt text.** To keep the cached prompt identical for every player, the line that states the rune is replaced with "The rune is given in the final note at the end of these instructions", and the rune goes into a second, uncached system block. Examples always use the example rune OAK-WIND. See `docs/ARCHITECTURE.md` → "Prompt assembly and caching". The same applies to Vorgath's `[HOARD: …]` note.
2. **Model rows in the Settings tables are relative** ("small", "mid-tier", "strongest affordable"). The actual default for every role is `claude-haiku-5-5` (see AGENTS.md → LLM usage). A role moves to `claude-sonnet-5-5` only when its floor fails the playtest checklist on Haiku, and that decision is recorded in `config/models.ts`.

3. **There are no Temperature rows.** Haiku 5.5 and Sonnet 5.5 reject non-default `temperature`, `top_p` and `top_k` with a 400, so no call sends them. Every game call runs with thinking off. A guardian's voice and steadiness come from its prompt and examples; guards and judges get theirs from a fixed structured-output schema (an `enum` verdict) plus fail-closed parsing. If a guardian is too loose or too stiff in playtests, change the prompt or its examples, not a sampling setting. See `docs/ARCHITECTURE.md` → "Sampling, thinking and structured outputs".
4. **"Reply with ONLY this JSON" lines stay in the guard prompts.** The schema enforces the shape; the prompt line still tells the model what each field means.

When you change how a guardian behaves, update the file here in the same change.
