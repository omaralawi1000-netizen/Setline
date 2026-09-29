# Performance record (master fix, 1.62.x)

Measured with `node scripts/perf.mjs`: 412×915 at 2.625× pixel density, CPU slowed 4×, headless Chromium
in the cloud sandbox (software rendering, no GPU: frame rates here run well below a phone's, so compare
rows with each other, not with 60). "Layers" and "layer MP" are the most composited layers drawing
content at any moment and their size in megapixels: what asks for GPU tile memory, which is what ran
out on the phone (the dark tiles growing into a band at the bottom).

## Phase 2 (1.62.1)

Before: 1.62.0 (= 1.59.1), same machine, same run conditions.

| flow | fps | dropped | worst ms | long tasks | long ms | paint ms/f | raster ms/f | layers | layer MP |
|---|---|---|---|---|---|---|---|---|---|
| hold → floating orb | 32.6 | 46 | 100 | 2 | 113 | 0.64 | 0.83 | 75 | 40.8 |
| pull up → voice screen | 30.5 | 87 | 150 | 4 | 307 | 0.39 | 0.78 | 136 | 57.7 |
| listening (voice screen) | 32.3 | 37 | 50 | 1 | 53 | 0 | 0.23 | 98 | 41.9 |
| release → Coach | 19.3 | 107 | 300 | 10 | 993 | 3.11 | 3.39 | 111 | 46.2 |
| reply streaming | 26.3 | 15 | 67 | 2 | 109 | 2.26 | 0.63 | 76 | 30.2 |
| tap orb → Coach | 38.6 | 31 | 200 | 2 | 231 | 1.05 | 1.28 | 57 | 32.3 |
| Coach → back to Home | 48.6 | 14 | 150 | 2 | 158 | 0.54 | 1.59 | 43 | 33.3 |
| typed question → streamed reply | 35.5 | 19 | 167 | 1 | 136 | 2.46 | 1.43 | 62 | 31.4 |
| scroll Today | 60 | 0 | 17 | 0 | 0 | 0 | 0 | 34 | 24.7 |

After: 1.62.1.

| flow | fps | dropped | worst ms | long tasks | long ms | paint ms/f | raster ms/f | layers | layer MP |
|---|---|---|---|---|---|---|---|---|---|
| hold → floating orb | 42.8 | 29 | 67 | 1 | 56 | 0.18 | 0.54 | 46 | 22.9 |
| pull up → voice screen | 34.2 | 73 | 133 | 4 | 310 | 0.26 | 0.5 | 54 | 28.7 |
| listening (voice screen) | 36.3 | 34 | 50 | 0 | 0 | 0 | 0.19 | 42 | 23.6 |
| release → Coach | 29.4 | 69 | 333 | 4 | 473 | 1.78 | 2.13 | 77 | 33.1 |
| reply streaming | 35.8 | 15 | 83 | 1 | 66 | 2.07 | 0.38 | 75 | 22.6 |
| tap orb → Coach | 48.5 | 15 | 167 | 1 | 148 | 0.66 | 0.97 | 53 | 24.6 |
| Coach → back to Home | 55 | 5 | 100 | 1 | 80 | 0.56 | 1.6 | 39 | 25.6 |
| typed question → streamed reply | 38.2 | 19 | 133 | 2 | 146 | 1.74 | 1.52 | 57 | 23.7 |
| scroll Today | 59.8 | 0 | 17 | 0 | 0 | 0 | 0 | 30 | 17 |

Where the time went (traces of hold → release → Coach) and what changed:
- The command parser matched every word against the exercise library with an allocating edit distance:
  359 ms of main thread at release. Now a bounded, allocation-free edit distance (4–6× faster per
  sentence) and one warm-up parse while the app is idle.
- The dotted orb asked whether it was visible (`checkVisibility`) every frame, forcing a style pass each
  time (376 ms over the flow). Now a quarter-second timer outside the frame (from 1.60).
- Motion tokens were read with `getComputedStyle` in the middle of flights; now read once.
- Every loop that draws per frame runs on one shared frame (`js/ui/frame.js`, with the fix for loops
  multiplying). `?perf=1` shows a frame meter on the phone.
- The voice glow was ~25 masked elements, each its own layer, per glow: now one canvas at half
  resolution drawn from sprites made while the app is idle (same lobes, masks, envelope and colours).
- Standing `will-change` removed from the sea lights, the bar, the wave bars, clouds and the Coach's
  glow (they are lifted only while their screen shows). Keyframes that end on a filter end on `none`.
- The sea, clouds and the Coach's glow hold still while the page scrolls (until 150 ms after), for 0.9 s
  after a screen change, and while the floating orb, the voice screen or a sheet is open (`.app.bg-still`);
  the sea drifts to a new screen's place after the screens have moved.
- The floating orb's scrim stays up until the voice screen's backdrop has faded in over it (both fading
  at once dropped the cover to 57 % for a few frames; the `voice-to-coach` golden flow now checks it).
- The page under the floating orb and the voice screen holds still. It is not hidden under the voice
  screen: that backdrop is slightly see-through in 1.59.1 and hiding the page changed the look.

## Blur audit (live, per state, from the running app)

Most of the 39 `backdrop-filter` and 51 `filter: blur` declarations in css/app.css are overridden by later
sections and never draw. What really draws:

| Surface | Blur | Decision |
|---|---|---|
| Bar capsule `.dcap`, orb drop `.obub` | 30 px backdrop | keep (the bar: always real blur, also while it folds) |
| Bottom edge `.edge.eb::after` | 12–14 px backdrop | keep (part of the bar's feathered frost; content scrolls under it) |
| Top edge `.edge.et::after` (scrolled) | 14–16 px backdrop | keep (content scrolls under it; 36 px tall) |
| Message box `.composer.glass` | 30 px backdrop | keep |
| Sheet `.sheet.glass` | 30 px backdrop | keep (sheet over the page) |
| Scrim under a sheet `.scrim` | 3 px backdrop | keep (sheet over the page; the page holds still under it) |
| Voice screen backdrop `.vlayer .vbg` | none since 1.58 | solid tint already |
| Cards `.screen .glass`, chat bubbles `.msg.ai .bub` | none (overridden) | tint already |
| `.orbbtn::before`, `.upcoming::before`, `.ambient i` blur | `display:none` / `filter:none` | never drawn |
| `.orb .core b` blur + screen blend | hidden on every (dotted) orb | blend and `will-change` removed |
| Voice glow bloom | baked into its gradient | now a canvas sprite |
| Reply words `wordrise`, thinking letters `thinkin` | animated filter blur on small spans | keep the look; they end on `filter: none` (phase 3 limits it to the newest words) |
| Thinking bubble glow `.msg.ai.is-thinking .bub::after` | 16 px filter on a small gradient | keep (small, only while thinking) |

At most five blurred layers show at once (bar ×2, bottom edge, scrim, sheet).
