# Setline plan

Source: SPEC.md section 7. Work one phase at a time; stop after each and wait for the go-ahead.

## Status

| Phase | Status |
| --- | --- |
| 1. Foundation and touch workout loop (no AI) | Done |
| 2. Voice | Done (1.2.1 fixes after phone test) |
| 3. AI brain and Coach | Done (1.3.1 model fixes after phone test) |
| 4. Routines and plans | Done, awaiting phone test |
| 5. Progress and extras | Partly pulled forward (see below) |

## Phase 1: Foundation and touch workout loop (no AI)

- [x] PWA shell and install: `index.html`, `manifest.webmanifest`, `sw.js` (versioned cache, "Update ready, tap to reload"), PNG icons 192/512/maskable
- [x] Tokens (`css/tokens.css` copied from `design-target.html`), glass/solid surfaces, ambient light, motion rules
- [x] Dock (only working tabs: Today, Workout, History) and workout mini bar
- [x] i18n EN/DA (app language auto/Dansk/English)
- [x] Today with start (Push Day routine, empty workout) and resume
- [x] Workout screen as in the mockup: steppers, log set, previous performance, set list with swipe-to-delete, rest ring with ±15 and skip, auto-rest after logging
- [x] Exercise picker: search, add custom
- [x] Start empty workout, Push Day starter routine
- [x] Finish with confirmation (and discard, confirmed)
- [x] History list and workout detail
- [x] PR detection (heaviest, best e1RM, most reps at a weight; warm-ups excluded)
- [x] Undo
- [x] Full persistence in IndexedDB (active workout written on every change, resumes exactly)
- [x] Wake lock during an active workout
- [x] Basic Settings: language, units, default rest, haptics, motion, reset all data
- [x] Exercise catalog (~60, EN/DA names, aliases, muscles, equipment)
- [x] Dev seed behind `?seed=1`
- [x] `node --test`: set rules, units, PR and 1RM math, catalog search, i18n keys, version sync

Decisions made in phase 1:
- Dock shows only Today, Workout and History; the Orb and Coach arrive with their phases.
- No voice hints ("or say …") until phase 2; tagline reads "Lift. Tap it. Saved." until then.
- PRs need a baseline: an exercise's first session sets it, later sessions can beat it. Reps PRs need earlier history at that exact weight.
- Tap a done set to edit it; swipe any set left to delete (with Undo).
- Rest card lingers 4 s after the timer ends ("Rest done"), with a success vibration.
- Routine names are localized only while `names` is present (starter data); phase 4 edits should drop it.
- Backup export/import is listed under phase 5, so Settings has no backup rows yet.

## Phase 2: Voice

- [x] Orb in the dock (hold to talk, or tap mode in Settings); the Orb flies up into the voice screen and back
- [x] Voice screen as in the mockup: live level meter driving orb, halo, ripples and wave; transcript words land one by one
- [x] Capture: getUserMedia + MediaRecorder (webm/opus, mono), 30 s max, stream released on stop and when the page hides, AudioContext unlocked on first gesture
- [x] Groq speech-to-text (`whisper-large-v3-turbo`, accurate option `whisper-large-v3`), temperature 0, language from settings, context prompt, 6 s timeout with one retry
- [x] Parser (`js/parser.js`), English and Danish, 103 tests incl. mishearings
- [x] Commands (`js/commands.js`): intent → card, spoken reply and action; tested with the definition-of-done script
- [x] Intent card: auto-commit after 1.5 s with Undo; finish, discard and delete need Confirm; chips when two exercises match
- [x] Spoken replies (off, short, full) via Gemini TTS, cached in IndexedDB, speechSynthesis fallback; never while the mic is open
- [x] Type instead (same pipeline), tappable hints
- [x] Keys for Groq and Google (masked, Test buttons, links), TTS model picked from the model list on test, override in Advanced
- [x] Error states: no key, offline, mic denied, nothing heard, didn't catch that (Retry / Edit)
- [x] Motion pass: sliding dock indicator, directional screen transitions with staggered entry, number ticks on the steppers, exercise slide on next/previous, log flash, sets landing (touch and voice), drag-to-close sheets

- [x] Pulled forward from phase 5 (asked for): Today cards as in the mockup (This week ring and days, Last session, Latest PR with e1RM sparkline), plus a Weekly goal setting (default 3) for the ring

Decisions made in phase 2:
- "Add 2.5", "læg 2,5 til" and "one more rep" adjust the last logged set (the intent is AdjustLast); the card shows "Set 2, was 80 kg × 8".
- Naming an exercise that's already in the workout jumps to it instead of adding a duplicate.
- A bare number with no context ("8") is never guessed; weight without reps uses the planned reps if there are any, otherwise asks.
- Cards show exercise names in the app language; replies are spoken in the language you spoke.
- Anything the parser doesn't understand shows "Didn't catch that" until the AI fallback lands in phase 3.
- The spec has no weekly target, so the week ring uses a new Weekly goal setting (1 to 7, default 3).
- Groq could not be reached from the build sandbox (network policy), so the request was tested against a mock; the Settings Test button verifies it on the phone.

## Phase 3: AI brain and Coach

- [x] Model auto-selection on Google key test: newest stable Flash-Lite (commands), Flash not lite/tts/image/live (Coach), Flash-Lite TTS; shown in Advanced with overrides
- [x] Command fallback: parser misses go to Flash-Lite with JSON schema output and small context; strict validation; 4 s timeout, then "Didn't catch that" with Retry and Edit
- [x] Local commands never wait on the AI; if state changed meanwhile the AI result comes back as a suggestion to confirm
- [x] Questions (by voice, typed, or classified by the AI) go to the Coach
- [x] Coach tab: thread, composer (lifted above the Android keyboard), example questions, streamed answers (SSE), spoken when complete per the spoken-reply setting, stop button, clear chat, persisted in IndexedDB
- [x] Coach context built locally (~6k tokens max): current workout, per-exercise best/e1RM trend/last 3 sessions, 8 weeks of volume, routines, bodyweight, last 12 turns
- [x] Coach system prompt per spec (language, voice-friendly, data only, injury guidance)
- [x] Tests: model choice, SSE parsing, AI intent validation, context, question detection, safe formatting

Fixes shipped alongside (from phone testing of phase 2):
- Spoken replies read the style prompt aloud: removed; PCM edges faded (the "thud"); sample rate read from the response; old cache cleared (DB v2).
- Dictation: silence is only judged when the level meter really ran; first mic prompt handled; error codes shown on failures.
- Orb flight measured from the current state (mid-flight, typing layout, sliding dock); dock orb reappears on landing.
- Rest card and screen entrances no longer replay on re-render.
- The app frame could be scrolled sideways by off-stage screens (whole UI shifted ~26px): frame now clips.
- The app shrank to 128px during workouts (class name clash): fixed in 1.2.0.

## Phase 4: Routines and plans

- [x] Routine editor: rename, add, remove, drag to reorder, sets × reps per exercise, duplicate, delete (confirmed), start
- [x] Starter programs: Push / Pull / Legs, Upper / Lower, Full body 3× (one tap, sets the weekly goal)
- [x] Coach plan builder: "make me a 4-day upper/lower, 60 minutes, focus chest, dumbbells only" → JSON plan checked against the catalog → plan card → Save as routines
- [x] "Up next" on Today: the routine done least recently

Added on request (not in the original spec), 1.4.0:
- [x] Cardio as a first-class part of the app: 11 types, live session with pause (timestamps only), log a past session, distance/pace/speed/splits, zones 1–5, records (distance, duration, pace), weekly minutes goal, History, Coach context, voice ("30 minutes zone 2 on the bike", "løb 5 km på 25 minutter", "start a run")
- [x] Next-set suggestions (double progression, stall detection, 10% deload; 5 kg steps for big lower-body lifts, 2 kg for dumbbells) in planned weights with the reason shown; "what should I lift?"
- [x] Readiness check before a routine (1–5); 1–2 offers an easy day (−10%, one set fewer)
- [x] Weekly streak (strength workouts + cardio of 20+ min against the weekly goal)
- [x] Bodyweight log (one per day, trend, 30-day change) and a protein target from bodyweight with quick +20/+30/+40 g and voice
- [x] Last week review card with a Coach check-in button
- [x] Multi-set logging: "9, 8 and 8 reps at 100 kg" (parser and AI)
- [x] Design pass: film grain, scroll-aware blurred top bars, small-caps labels, calmer surfaces
- Decisions: live cardio can't run during a strength workout (log it afterwards instead); voice starts skip the readiness check to stay hands-free; a live session must be at least 1 minute and pass a speed sanity check.

## Phase 5: Progress and extras

SVG progress charts, plate calculator, backup export/import, polish pass. (Bodyweight log and Today cards were pulled forward.)

## Notes

- Release version lives in `sw.js` (`VERSION`) and `js/version.js`; a test keeps them in sync. Bump both on every release.
