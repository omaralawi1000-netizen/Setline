# Setline: Claude Code notes

Follow `AGENTS.md`. It's short on purpose; don't read more than the task needs.

## How to work with Omar
- Work autonomously. Don't stop to ask for routine choices; decide and keep going.
- Freedom on HOW: if you see a clearly better technique, structure, test or fix than what Omar's prompt describes, use it without asking, and explain it in the final report.
- Preserve product functions, data and the requested dotted-orb identity. The latest user brief authorizes changes to layout, glass, lighting and motion; older visual prescriptions do not veto those changes. Explain meaningful design decisions when delivering them.
- Stop and ask only when: (1) something could lose Omar's data or break the live app in a way a revert can't fix, (2) the prompt is impossible or clearly contradicts itself, or (3) an essential product requirement cannot be inferred. Routine visual and motion improvements are already authorized. In that case, say what and why in 2–3 lines and wait.
- Everything else: finish the whole task, test it, commit, deploy, then report.

- Cloud sessions run `.claude/hooks/session-start.sh`, which installs Playwright for the check scripts.
- For design and animation work, follow `docs/DESIGN_SYSTEM.md`. Omar wants the app as beautiful and premium as possible: be ambitious, change the look, layout and motion of any screen, use `impeccable`, `emil-design-eng` and `frontend-design` freely. Keep every feature and `data-act`/`data-k`/`#s-<screen>` hook.
- Keep chat replies short.
- Use the `impeccable` skill for UI work and `emil-design-eng` for motion.
- Before and after any visual change, screenshot the main screens and the voice orb and look at them (`npm run screens`; `scripts/snap.mjs` was part of the undone 1.62–1.65 releases and is not in the repo now). Never commit screenshots.

## Motion & performance rules
29 Sep 2026: rolled back to 1.59.1 (released as 1.65.2), then 1.66.0 polished its motion. Don't reapply 1.62.0–1.65.1 unless Omar asks (backup: branch `backup-before-rollback-1.59.1`). Keep the 1.59.1 design: floating orb, pull-up voice screen, frosted glass, sea light, the message box's orb on the left. Omar wants iOS-quality motion: springs, depth, soft light; be creative.
- Springs come from `js/ui/springs.js` (`spring(response, damping)` → a CSS `linear()` easing the compositor runs; `SMOOTH`, `SNAPPY`, `LIVELY`; `--e-spring` and `--sp-card` in CSS). Use them for anything that arrives or settles.
- Animate anything except layout (width, height, top, left, margin, padding, `all`). Glows are radial gradients, never big `filter: blur` or masked layers (Android clips those into hard rectangles). If an effect stutters on the phone, simplify it and check `?perf=1`.
- Exactly one orb visible at a time; orb flights go through `flyOrb` in `js/app.js` (one solid orb on a spring arc, no trail, no stretch).
- Never two pages' content at once: the page being left is gone before the next one's words arrive (Home ↔ Coach in `coachMorph`). The sea background is shared and never fades.
- Voice → Coach (`handToCoach` in `js/ui/voice.js`): straight into the Coach, never back to Home; the words become the message bubble, the orb flies into the message box.
- Checks: `npm run golden` covers `home-coach`, `voice-to-coach`, `voice-screen-to-coach` and `mic-hold-twice` (overlaps, two orbs, Home showing through, the second hold). Judge motion by frames: record the compositor's frames (CDP screencast) of the flow and look at them.
- Chat: never rebuild the thread with innerHTML; one DOM node per message for its whole life; one DOM write per frame.
- will-change only just before an animation, removed after. Canvases ≤ 2× DPR, never resized in the loop.
