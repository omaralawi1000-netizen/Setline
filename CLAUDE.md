# Setline: Claude Code notes

Follow `AGENTS.md`. It's short on purpose; don't read more than the task needs.

## How to work with Omar
- Work autonomously. Don't stop to ask for routine choices; decide and keep going.
- Freedom on HOW: if you see a clearly better technique, structure, test or fix than what Omar's prompt describes, use it without asking, and explain it in the final report.
- No freedom on WHAT: never remove or change a feature, the look (colours, blur, glass, orb, layout), or a flow Omar asked for without asking first. Better performance or simpler code is never a reason to change his design.
- Stop and ask only when: (1) something could lose Omar's data or break the live app in a way a revert can't fix, (2) the prompt is impossible or clearly contradicts itself, or (3) you're convinced a design/feature change is needed. In that case, say what and why in 2–3 lines and wait.
- Everything else: finish the whole task, test it, commit, deploy, then report.

- Cloud sessions run `.claude/hooks/session-start.sh`, which installs Playwright for the check scripts.
- For design and animation work, follow `docs/DESIGN_SYSTEM.md`. Omar wants the app as beautiful and premium as possible: be ambitious, change the look, layout and motion of any screen, use `impeccable`, `emil-design-eng` and `frontend-design` freely. Keep every feature and `data-act`/`data-k`/`#s-<screen>` hook.
- Keep chat replies short.
- Use the `impeccable` skill for UI work and `emil-design-eng` for motion.
- Before and after any visual change, run `node scripts/snap.mjs` and look at the pictures in `/tmp/snaps` (main screens, plus `orb-frames/`: the voice orb, about 4 frames a second). Never commit them.

## Motion & performance rules
28 Sep 2026: Omar restored the 1.59.1 design (floating orb, pull-up voice screen, frosted glass, sea light). Keep those; make them move as well as possible. Omar wants the best animation: springs, blur, glow, parallax, richer transitions are all welcome.
- Animate anything except layout (width, height, top, left, margin, padding, `all`). If a heavy effect (big or animated blur, many blurred layers, large shadows) stutters on the phone, shrink or simplify it and check `?perf=1`; don't drop the idea.
- Ambient motion (clouds, sea) may keep running; if it costs frames during scrolling or a transition, pause just that part.
- Exactly one orb visible at a time (hand over cleanly).
- No comet trails, streaks or smears: the orb is one solid object at every frame (flights go through `arcFly` in `js/ui/choreo.js`).
- Never dip to black and never double-expose two screens' content; the sea background is shared and never fades.
- The destination exists and is visible before anything lands on it. `node scripts/choreo.mjs` films and checks the four big transitions.
- Chat: never rebuild the thread with innerHTML; one DOM node per message for its whole life; one DOM write per frame.
- will-change only just before an animation, removed after. Canvases ≤ 2× DPR, never resized in the loop.
