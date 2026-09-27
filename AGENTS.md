# AGENTS.md: how any AI works on Setline

Setline is a voice-first gym PWA for one user (Omar) on Android Chrome, served as static files from GitHub Pages. Plain HTML/CSS/JS modules, no app dependencies, no backend. This file is the router: it says how much process a task needs and what proof "done" requires. It is the same for Claude Code, Codex and anything else.

## 1. Read first, and what wins

At the start of a session read `PLAN.md` (what the app is now). Read other files only when the task needs them.

When sources disagree, the higher one wins:
1. Omar's request in this session
2. `SPEC.md`: what Setline is and its hard constraints
3. `PLAN.md`: what the app does now
4. `docs/DESIGN_SYSTEM.md`: how it looks and moves
5. `docs/SECURITY_MODEL.md`: what must stay safe
6. this file
7. skills and plugins
8. vendor docs
9. existing code
10. `docs/HISTORY.md` and `docs/decisions/`: history, never current truth

If Omar's request conflicts with SPEC.md on something expensive to undo (architecture, storage, a new dependency, the design direction), say so in one sentence and ask before building.

## 2. Classify every task

Pick a class before you start. Before you report, run `npm run risk`: it reads the diff and prints the minimum class and the required checks. You may raise the class, never lower it. If it prints a higher class than you picked, do the missing steps.

| Class | Examples | Workflow |
|---|---|---|
| A tiny | copy, a spacing value, an obvious CSS fix | edit → the checks `npm run risk` lists |
| B local | a parser bug, a state bug, one broken animation | reproduce → find the cause → failing test first → smallest fix → checks |
| C feature | a new workout behaviour, a new Coach ability | short written plan (5–10 lines, in chat) → build → tests → checks |
| D sensitive | keys, Coach actions, backup/import, Drive, storage, mic, service worker, dependencies | read `docs/SECURITY_MODEL.md` first → plan with the risks named → build → checks → security gate |
| E structural | storage schema, navigation model, redesign, anything touching 12+ app files | options and trade-offs → Omar decides → `docs/decisions/NNN-*.md` → plan → build in steps, each verified |

Superpowers (if installed) is for C, D and E only. For A and B, don't run brainstorming or planning skills even if they offer themselves; B may use systematic debugging.

## 3. Hard rules

- Work only on what was asked. No refactors for tidiness, no extra features, no speculative "improvements" to other screens.
- Stack: plain HTML/CSS/JS ES modules, relative paths. No app dependencies. Dev tooling (Playwright) is the only exception.
- Nothing in the UI unless it works. No placeholders, no dead buttons.
- API keys never go into code, commits, logs, errors, tests, backups, screenshots or chat. `npm run verify` scans for real key shapes.
- AI output never runs directly. Every Coach action goes: parse → allow-list (`SETTABLE`, `PAGES`, plan forms) → validate values → apply with Undo. Finish, discard and delete always need Omar's confirmation, including when the Coach asks for them.
- Every `${…}` that ends up in HTML goes through `esc()`, unless it is a number or a fixed i18n/icon string.
- Keep the `data-act` / `data-k` / `#s-<screen>` hooks. The golden flows and screenshot scripts drive the app through them. If a change must move one, update `scripts/` in the same change.
- Push to the working branch. Merging to `main` (which deploys to GitHub Pages) is Omar's call.
- After every update, open a pull request from the working branch to `main` (or update the open one) so Omar can merge it. Anything important (risky, breaking, needs his decision, a check that can't pass) is told to Omar before, not after.
- If something is blocked (a provider refuses browser calls, a tool can't run in the cloud session), stop and say so. Don't invent workarounds.

## 4. Checks: evidence beats confidence

Never certify your own work by re-reading it. Proof comes from something independent of you:

| Command | Proves | When |
|---|---|---|
| `npm run verify` | no secrets, version/PLAN/HISTORY in sync, every unit test passes | every code change |
| `npm run golden` | real-browser journeys: workout survives a killed tab and lands in history, the app opens offline, every tab opens without errors | class C+, and anything touching the service worker, storage or the workout loop |
| `npm run visual` | the main screens still match the approved pictures | any UI change. Explain every CHANGED picture; baselines change only with `-- --approve` after Omar approved the look |
| `npm run motion` | frames, jank and layout work of every animation | any motion change. Judge against `motion/previous/`, not the absolute PASS/FAIL marks (the cloud machine has no GPU) |
| security gate | the checklist in `docs/SECURITY_MODEL.md` §5, answered line by line | class D and E |
| device check | the steps in `docs/DEVICE_CHECKLIST.md`, done by Omar on his phone | mic, audio, TTS, service worker, install/update, notifications, haptics, Drive |

The cloud session can't test a real microphone, the Android lock screen, haptics or an installed PWA update. Never claim those work. Mark them `DEVICE: pending` and list the exact phone steps.

When Omar finds a bug that got past the checks, the fix includes a guard so it can't come back: a unit test, a golden-flow step or a device-checklist line. Say which one you added.

## 5. The report (instead of "done")

End every code task with this, short:

```
CHANGED    what behaviour changed, in one or two lines
CLASS      picked X · npm run risk said Y
CHECKS     verify ✓ · golden ✓ · visual: 2 changed (today.png, workout.png: intended, the new card) · motion: n/a
SECURITY   n/a, or each §5 line answered
DEVICE     n/a, or pending: 1) … 2) …
NOT TESTED anything you couldn't run, and why
RISK       what Omar should know before merging, or "none"
```

A task is not done while any required check fails or is skipped without a written reason.

## 6. Releases

1. Bump `js/version.js` and `VERSION` in `sw.js` (the same number).
2. `PLAN.md`: describe the app as it is now. Keep it about what exists, not a changelog.
3. `docs/HISTORY.md`: add `## x.y.z: …` with what changed.
4. `npm run verify` and `npm run golden` pass; `npm run visual` changes are explained.
5. Commit, push, report with the phone checklist.
6. After Omar's device check passes: `git tag good-x.y.z && git push --tags`. Known-good tags are the rollback points.

Rolling back: `git restore --source=good-x.y.z --staged --worktree .` makes every file match that version (files added since are removed). Then bump the version to a new number (phones only update when it changes), add a HISTORY entry saying what was rolled back and why, and commit.

## 7. Usage budget (Claude Pro, Codex limits)

- Don't read `docs/HISTORY.md`, whole test files or unrelated screens unless the task needs them.
- Run checks with `--only=` filters while iterating; run the full set once before reporting.
- Don't paste whole files, diffs or long logs into chat.
- `PLAN.md` stays short; history goes to `docs/HISTORY.md`.

## 8. Growing and pruning this system

Something new goes up this ladder only as far as it needs to: a line in this file → a script or test → a skill → a plugin or MCP. A new skill or plugin needs a clear answer to: what it owns that nothing else does, when it runs, when it must not, how we'll know it helps, what access it gets, and what would make us remove it. Adopt a vendor tool only once Setline actually uses that vendor.

Every couple of months, delete rules here that never caught anything. This file should get shorter as Setline matures, not longer.
