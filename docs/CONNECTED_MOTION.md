# Connected motion — Setline 1.65.0

The split dock now becomes the Coach composer through one joined glass contour. The Coach opens upward from that surface while the orb holds its bottom-right anchor. Back reverses from the current presentation, including during opening. The theme palette and dotted particle identity remain.

Holding the orb keeps voice beside the dock, with a meter driven by the real microphone level. Release shows an editable review. Say more appends, and Send delivers once. The review and actions clear the keyboard. Pull up still opens expanded voice; its transcript stays at reading size and fades before the chat bubble becomes readable. Retry/type actions stay visible on voice errors. Cancelling, backgrounding and delayed permission completion clean up the microphone; cancelled sessions ignore late AI classification.

The connected contour and content mask share a progress value and cached geometry (`js/ui/coachmotion.js`). They use the existing shared animation frame and particle handoff. Navigation and processing start immediately, independent of animation completion. Reduced motion keeps short fades; reduced transparency and glass-off use opaque material. No new runtime dependency or database migration.

## Verification

- `npm run verify`: secret scan, version/docs consistency and unit suite, including interruption geometry.
- `npm run golden`: workout persistence, offline/service-worker shell, mic watchdog/races, voice gestures, live-style SSE streaming and frame-by-frame transition checks.
- `node scripts/connected-motion.mjs`: 390 px / 320 px, normal / reduced motion, Back during opening, editable compact review, duplicate-send prevention, keyboard clearance and pending-permission cancellation. Long-conversation transition flows also checked.
- `npm run visual`: six normal app screens reviewed against fresh 1.64.0 captures from the same browser. Their pixels match; old tracked baselines had unrelated font/render drift. Approved the matching current captures. Compact review screenshots inspected separately.
- `npm run motion -- --only=orb,coach,button-press,tab-today`: compared with 1.64.0 in the same environment; includes reduced motion.

### Cloud motion comparison

Chromium 141, 390 × 844, 2× DPR, software rendering, CPU throttle 4×. These are diagnostic measurements, not a real Android FPS claim. The original and revised runs each meet the lab's strict zero-layout/long-frame budget in 2 of 9 scenarios; the report returns successfully because this is a comparative lab. Remaining layout/paint work is reported, not suppressed.

| Scenario | Original p95 | Revised p95 | Original layouts | Revised layouts |
| --- | ---: | ---: | ---: | ---: |
| Orb idle | 16.8 ms | 16.7 ms | 0 | 0 |
| Compact listening | 16.8 ms | 16.8 ms | 5 | 5 |
| Processing | 16.8 ms | 16.7 ms | 2 | 1 |
| Voice result / review | 33.3 ms | 16.8 ms | 40 | 1 |
| Coach opening | 16.8 ms | 16.8 ms | 2 | 5 |
| Coach closing | 16.8 ms | 16.8 ms | 1 | 3 |

The result scenario now ends at explicit review, so its timing reflects a deliberately shorter flow. The connected mask/material adds paint work to the Coach transition; the final focused Coach pass still recorded a 100 ms closing outlier under the 4× software renderer (0 of 2 meet the strict lab budget). Contact sheets confirm a continuous material reveal, readable fixed-scale text and one particle orb. Full performance proof still requires the target phone.

## On the phone

1. After the update prompt, confirm version 1.65.0, then restart the installed PWA once. Check offline opening.
2. Tap the dock orb, press Back during opening, then reopen. Check the joined glass, single orb and physical smoothness (`?perf=1` can help).
3. Hold, speak, release, edit with the keyboard, Say more, then Send. Check actual gym audio, permission prompts, haptics and music resuming after recording.
4. Cancel a hold, background the app during recording and repeat a hold. Check the system mic indicator goes away. Pull up and send from expanded voice once.
5. Try reduced motion and glass-off.

Real microphone fidelity, haptics, headphone audio focus, lock-screen behavior and the installed-PWA update cannot be validated in this cloud browser.
