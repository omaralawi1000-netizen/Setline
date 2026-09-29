# AGENTS.md: how any AI works on Setline

Setline is a voice-first gym PWA for one user (Omar) on Android Chrome, served as static files from GitHub Pages. Plain HTML/CSS/JS modules, no app dependencies, no backend. The goal of every session: make the app better, especially how it looks, feels and moves.

## 1. Keep it smooth and premium

- Read `PLAN.md` at the start. Read other files only when the task needs them: `docs/DESIGN_SYSTEM.md` for any UI or motion work, `SPEC.md` only for the part you're touching. Never read `docs/HISTORY.md` or whole test files unless the task needs them.
- **Don't ask Omar for permission.** He says what he wants; you build it, check it and ship it. Ask first only if you see a clearly better way (say it in one or two sentences) or it would lose his data. Tool permissions are pre-approved in `.claude/settings.json`; don't remove them.
- Don't run planning or brainstorming skills, and don't write plans or checklists in chat. Just do the work.
- Don't paste files, diffs or long logs into chat. Keep replies short.

## 2. Rules

- Work only on what was asked. No refactors for tidiness, no extra features.
- Plain HTML/CSS/JS ES modules, relative paths. No app dependencies (Playwright for the check scripts is the only dev tool).
- Nothing in the UI unless it works. No placeholders, no dead buttons.
- API keys never go into the repo, logs or chat.
- Values from outside (user text, AI replies, food data) that go into HTML go through `esc()`.
- Keep the `data-act` / `data-k` / `#s-<screen>` hooks; the check scripts drive the app through them. If one must move, update `scripts/` in the same change.
- If something is blocked, stop and say so. Don't invent workarounds.

## 3. Checks

Run only what the change needs:

| Command | When |
|---|---|
| `npm run verify` | every change (secrets scan, version/PLAN/HISTORY in sync, unit tests) |
| `npm run visual` | UI changes. Look at CHANGED pictures; if the change is the one asked for, approve it with `npm run visual -- --approve` |
| `npm run motion` | animation changes. Compare `motion/sheets/` with `motion/previous/`; judge by comparison (no GPU in the cloud) |
| `npm run golden` | changes to the workout loop, storage or the service worker |

The cloud can't test the microphone, haptics, the lock screen or an installed PWA update. Don't claim those work; list them as phone steps.

## 4. Ship

1. Bump `js/version.js` and `VERSION` in `sw.js` (same number).
2. `PLAN.md`: describe the app as it is now (short). `docs/HISTORY.md`: add `## x.y.z: …`.
3. Checks pass → commit → push the working branch, then `main` (fetch `main`, merge it in if it moved, re-run `npm run verify`, push). No pull request needed. If a check can't pass, don't ship; fix it or say what's blocking.
4. Reply in a few lines: what changed, which checks ran, and the phone steps to test.

Rolling back: `git restore --source=<good commit or tag> --staged --worktree .`, bump to a new version, add a HISTORY line, commit.
