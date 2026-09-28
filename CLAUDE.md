# Setline: Claude Code notes

Follow `AGENTS.md`. It's short on purpose; don't read more than the task needs.

- Cloud sessions run `.claude/hooks/session-start.sh`, which installs Playwright for the check scripts.
- For design and animation work, follow `docs/DESIGN_SYSTEM.md`. The `frontend-design` skill is only for a full redesign Omar asks for.
- Keep chat replies short.

## Motion & performance rules

The budget from 1.60 (the phone ran out of GPU memory mid-transition before it), with 1.61's frost. `tests/motion-rules.test.js` enforces the first two; the golden flows `tap-chat`, `hold-send`, `hold-review`, `hold-cancel`, `reduced-motion` and `chat-stream` enforce the voice and chat rules. Every motion and frost value lives in `js/motion.config.js` (`?tune=1` edits them live).
- Animate only `transform` and `opacity` (transitions, keyframes and `el.animate`). The one exception is SVG `stroke-dashoffset` on the rings and exercise figures.
- `backdrop-filter` only on the dock (`.dcap`, `.obub`) and the Coach's message box (blur ≤ 16px, solid while `.app.moving` or `.app.frosted` is on), and on the ONE full-screen frost layer (`#frost`, `css/flow.css`): `blur(20px) saturate(170%) brightness(.85)` from `--frost-*`, a constant that never animates; only the layer's opacity fades. Never stack two backdrop-filters: sheets over the frost are ~92% theme background, not a second blur. Everything that moves (orb, waveform, sheets) sits above the frost; under it the page is inert and frozen. `prefers-reduced-transparency` → solid tint.
- Glows and background lights are static gradients; animate only their opacity or scale.
- One animation frame: anything that draws every frame subscribes to `onFrame` / `nextFrame` in `js/ui/frame.js` (it stops when nothing is subscribed or the page is hidden). No other rAF loops. Never write a value every frame to a property that has a CSS transition (it restarts each frame).
- Canvas: DPR ≤ 2, never resized in the loop, sprites pre-drawn once (no per-dot gradients or `shadowBlur`).
- `will-change` only just before an animation and removed after; no standing layers.
- No forced layout during a transition: measure first, then write; no `void el.offsetWidth` or `getComputedStyle` in a moving frame (`token()` is cached).
- Exactly one orb element exists (`#orb`, `js/ui/stage.js`). It sits in a slot (dock, message box) and flies between them in the flier with FLIP (measure where it is, then move); never a second copy. No comet trails.
- Motion is one critically damped spring (`js/ui/spring.js`, stiffness/damping in `motion.config.js`), never a fixed-duration tween for things that travel. Every move can be sent somewhere new mid-way and carries on from where it is. A finger drives motion 1:1 in the frame (the hold's `dy × follow`), never through a spring.
- Destination content (the chat, its scroll position) is laid out and final before its sheet starts moving; nothing settles after it arrives.
- `will-change: transform` only on what a spring is moving right now (`.sheetmoving`, `.rvmoving`, the flier), removed when it rests.
- A label that changes: the old text fades out (80 ms), then the new fades in (120 ms); never both at once.
- Chat: never rebuild the thread with `innerHTML`; patch by id, stream into the bubble that becomes the final message, at most one DOM write per frame, and scroll (`scrollTop`, never smooth `scrollIntoView`) only when within about 80 px of the end.
- Reduced motion: 150 ms opacity cross-fades, nothing travels, the orb holds still.
- Check with `npm run golden`, `npm run motion -- --only=…` and, on the phone, `?perf=1` (frame meter; `?perf=0` hides it) and `?tune=1` (sliders, Slow-mo ×4; `?tune=0` resets).
