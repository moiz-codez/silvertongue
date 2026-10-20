@AGENTS.md

# Working on Silvertongue with Claude Code

## Who you're working with

Moiz, BSCS 7th semester at Mehran UET. He builds with Claude Code and has to present and explain this project live to his class and teacher. So:

- After each milestone, end with a short plain-English **"How it works"** (5–8 lines) plus the AI concept it demonstrates, written so he could say it out loud in the presentation.
- Explain non-obvious choices briefly in your reply, not in long code comments.
- Prefer simple, readable code over clever abstractions. He should be able to open any file and follow it.

## The demo

- Date: **[DEMO DATE]**
- About 40 players on their own phones, ~15 minutes of play, a projector, university Wi-Fi or mobile data.
- **Priority: the demo never visibly breaks.** A slower game beats an error screen every time. When a choice trades speed for reliability, choose reliability.

## How to work

- Follow `docs/BUILD_PLAN.md` in order. One milestone per session where possible.
- Start each milestone in **plan mode**: read the relevant docs, propose the plan and the files you'll touch, and wait for approval.
- **Done** means the milestone's acceptance criteria are met **and** `npm run check` passes. Say what you verified and how.
- Use `LLM_MODE=mock` in development by default. Call the real API only for: the M0 smoke test, `npm run playtest`, or when Moiz asks. After any real calls, report tokens used and estimated cost.
- Ask before adding a dependency that isn't listed in AGENTS.md.
- Never put secrets in code or commit `.env`. Read all config through `config/env.ts`.
- When you change a guardian's behaviour, update `docs/prompts/<floor>.md` in the same change.
- If a doc and the code disagree, stop and ask which one is right instead of guessing.

## Commits and pushing

- You commit and push for Moiz, following "Git workflow" in AGENTS.md. Routine git commands are pre-approved in `.claude/settings.json`; force-pushes and reading `.env` are blocked there.
- Start each session with `git status` and `git pull`. If there are uncommitted changes you didn't make, ask before touching them.
- At the end of every session, list the commits you made (hash + message) and the branch they're on, so Moiz can review them on GitHub.

## Subagents (`.claude/agents/`)

- **rune-security-auditor**: run after any change to `sockets/`, `floors/`, `llm/`, `security/` or the web build, and before every deploy. Fix every CRITICAL finding before moving on.
- **floor-playtester**: run after building or changing a floor. It runs that floor's checklist against the real API and proposes prompt fixes.
- **load-tester**: run after M3, after M6, and in the week before the demo.

## Deploying

Follow `docs/DEPLOY_ORACLE.md`. Deploy a hello-world in M0 and keep deploying after each milestone. The first real deploy must never be in demo week.

## Gotchas

- Oracle VM: ports 80 and 443 must be opened in **both** the VCN security list and the instance's own firewall (iptables).
- The server is ARM64. Confirm in M0 that `better-sqlite3` and `@huggingface/transformers` install and run there.
- Socket.IO behind Caddy: plain `reverse_proxy` handles the websocket upgrade; test it from a phone on mobile data, not just on Wi-Fi.
- SQLite: enable WAL mode at startup.
- The prompt cache only hits when the static prefix is byte-identical. Never interpolate per-player values (rune, nickname, hoard note) into the cached block.
- Windows dev machine: no bash-only npm scripts; use Node scripts or cross-platform tools.
