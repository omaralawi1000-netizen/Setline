# Setline: Claude Code notes

Follow `AGENTS.md`. It's short on purpose; don't read more than the task needs.

- Cloud sessions run `.claude/hooks/session-start.sh`, which installs Playwright for the check scripts.
- For design and animation work, follow `docs/DESIGN_SYSTEM.md`. The `frontend-design` skill is only for a full redesign Omar asks for.
- Keep chat replies short.
- Use the `impeccable` skill for UI work and `emil-design-eng` for motion.
- Before and after any visual change, run `node scripts/snap.mjs` and look at the pictures in `/tmp/snaps` (main screens, plus `orb-frames/`: the voice orb, about 4 frames a second). Never commit them.

## Motion & performance rules

The budget from 1.60 (the phone ran out of GPU memory mid-transition before it). `tests/motion-rules.test.js` enforces the first; the golden flows `voice-to-coach` and `chat-stream` enforce the rest of the voice and chat rules.
- Animate only `transform` and `opacity` (transitions, keyframes and `el.animate`). The one exception is SVG `stroke-dashoffset` on the rings and exercise figures.
- Glows and background lights are static gradients; animate only their opacity or scale.
- One animation frame: anything that draws every frame subscribes to `onFrame` / `nextFrame` in `js/ui/frame.js` (it stops when nothing is subscribed or the page is hidden). No other rAF loops. Never write a value every frame to a property that has a CSS transition (it restarts each frame).
- Canvas: DPR ≤ 2, never resized in the loop, sprites pre-drawn once (no per-dot gradients or `shadowBlur`).
- `will-change` only just before an animation and removed after; no standing layers.
- No forced layout during a transition: measure first, then write; no `void el.offsetWidth` or `getComputedStyle` in a moving frame (`token()` is cached).
- Exactly one orb visible at a time (hand over with `handOrb`); no comet trails.
- Home is hidden and inert while the voice sheet covers it (`.app.voice-covered`, set once the sheet is opaque and cleared before it fades); the Coach is its own screen, so Home is already off under it.
- Chat: never rebuild the thread with `innerHTML`; patch by id, stream into the bubble that becomes the final message, at most one DOM write per frame, and scroll (`scrollTop`, never smooth `scrollIntoView`) only when within about 80 px of the end.
- Reduced motion: 150 ms opacity cross-fades, the orb holds still.
- Check with `npm run golden`, `npm run motion -- --only=…` and, on the phone, `?perf=1` (frame meter; `?perf=0` hides it).

28 Sep 2026: reverted to 1.60.0. The hold-to-talk / frost / review-sheet rework was unstable. Don't reapply those commits; the backup tag is backup-before-revert-1.60.0.
