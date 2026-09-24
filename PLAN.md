# Setline plan

Source: SPEC.md section 7. Work one phase at a time; stop after each and wait for the go-ahead.

## Status

| Phase | Status |
| --- | --- |
| 1. Foundation and touch workout loop (no AI) | Done |
| 2. Voice | Done, awaiting phone test |
| 3. AI brain and Coach | Not started |
| 4. Routines and plans | Not started |
| 5. Progress and extras | Not started |

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

Decisions made in phase 2:
- "Add 2.5", "læg 2,5 til" and "one more rep" adjust the last logged set (the intent is AdjustLast); the card shows "Set 2, was 80 kg × 8".
- Naming an exercise that's already in the workout jumps to it instead of adding a duplicate.
- A bare number with no context ("8") is never guessed; weight without reps uses the planned reps if there are any, otherwise asks.
- Cards show exercise names in the app language; replies are spoken in the language you spoke.
- Anything the parser doesn't understand shows "Didn't catch that" until the AI fallback lands in phase 3.
- Groq could not be reached from the build sandbox (network policy), so the request was tested against a mock; the Settings Test button verifies it on the phone.

## Phase 3: AI brain and Coach

Gemini command fallback, Coach tab, spoken answers, history-aware context, model auto-selection.

## Phase 4: Routines and plans

Routine editor, starter routines, voice plan builder.

## Phase 5: Progress and extras

SVG progress charts, Today cards, bodyweight log, plate calculator, backup export/import, polish pass.

## Notes

- Release version lives in `sw.js` (`VERSION`) and `js/version.js`; a test keeps them in sync. Bump both on every release.
