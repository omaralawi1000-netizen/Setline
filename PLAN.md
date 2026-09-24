# Setline plan

Source: SPEC.md section 7. Work one phase at a time; stop after each and wait for the go-ahead.

## Status

| Phase | Status |
| --- | --- |
| 1. Foundation and touch workout loop (no AI) | Done |
| 2. Voice | Done (1.2.1 fixes after phone test) |
| 3. AI brain and Coach | Done (1.3.1 model fixes after phone test) |
| 4. Routines and plans | Done |
| 5. Progress and extras | Done, awaiting phone test |

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

- [x] Progress screen: weekly strength volume and cardio minutes (4 weeks / 12 weeks / 1 year), bodyweight line, lifts with e1RM change, records timeline
- [x] Exercise page: e1RM curve, best set, heaviest, sessions, next-time suggestion, session list (from Progress, History detail)
- [x] Plate calculator (bar 20/15/10/0, plates 25/20/15/10/5/2.5/1.25 per side), drawn on a bar
- [x] Backup export/import (JSON, never keys, validated as a whole before anything is written)
- [x] Today cards, bodyweight log (pulled forward in 1.2 / 1.4)
- [x] Polish pass: count-ups, greeting reveal, chart draw-in, spark bursts on logged sets (warm for records), finish celebration, orb pulse on voice commits

Extras in 1.5.0:
- [x] Warm-up ramp (bar, 50%, 70%, 85%) as a tick-off checklist that logging skips and records ignore
- [x] Rest alerts: a notification when rest ends with the screen off (opt-in)
- [x] Voice: friendlier default voice (Achird) with a described list, Flash TTS preferred ("Natural"), runner-up model retry, varied natural replies, Settings shows which engine spoke and why
- [x] Removed the scroll-aware top bar (felt in the way on the phone)

Known: some phones' "dark theme for websites" still re-colours the app even with `color-scheme: dark only`; the fix is in the browser setting.

## 1.6.0: easier logging and smarter weeks (on request)

- [x] Orb mini voice: pressing the orb lifts it out of the dock with rings and a glow (no full screen); pull it up to expand to the full voice screen while it keeps listening; quick tap = hands-free, tap the orb to send, tap outside to cancel
- [x] Session length: "/ ~55 min" next to the clock (the median of this routine's last sessions), "+10 min" in amber once over, and one gentle nudge at +10
- [x] Rest per exercise: ±15 during rest teaches that exercise its rest; remembered across workouts (Settings default stays the fallback)
- [x] "Do this again" on a workout in History (same exercises, weights, reps, rest)
- [x] Muscles this week: working sets per group (primary 1, secondary ½) against a rough target, the group most behind named mid-week (Today and Progress)
- [x] Deload: offered after 6 steady weeks; a deload week halves the sets and takes ~15% off every session until Sunday; "Not now" snoozes 2 weeks
- [x] Auto-advance: the last planned set moves on to the next exercise ("same again" right after still means the one just finished); can be turned off
- [x] Cardio: one-tap "Run 5.2 km again" on Today, "Log again today" on a session, opt-in GPS distance for run/walk/hike/bike (accuracy, noise and speed filtered, pauses start a new segment, prefilled at finish)
- [x] Home-screen shortcuts (long-press the icon): next workout, cardio, talk
- Decisions: GPS only counts while Setline is open (a web app can't track with the screen off; the screen is kept on). No Health Connect / Google Fit / Strava: a static web app can't read them, so cardio stays manual but one tap or one sentence.

## 1.6.1: fixes and feel

- [x] Spoken replies: the stray thump/burst Gemini sometimes adds after the last word is cut (tail detection by energy and zero-crossing rate), DC removed, 70 Hz high-pass, cosine fade; stopping mid-word fades instead of clicking
- [x] Mic opens without echo cancellation (no Android call-audio switch: faster open, first word not clipped, no speaker pop)
- [x] Coach: the pending reply picked up the `.live` pill style (wide empty bar) — renamed; interrupted replies say "Stopped" with Retry instead of dots forever; a stalled stream is cut after 20 s; an empty answer is retried; all-busy (503) goes round once more after a pause
- [x] Orb: follows the finger 1:1 when pulled (rubber band), a flick up expands, a bloom + haptic the moment it's really listening, soft squash-and-stretch with the voice, tapping the dock orb in hands-free sends
- [x] Instant press feedback on every button (Android delays :active), spring release
- [x] Sheets no longer vanish mid-slide when a button inside them finishes a transition
- [x] Tests: every module parses; state classes can't collide with component classes

## 1.6.2: voice ending fix

- [x] Spoken replies: Gemini can split the audio over several parts; only the first was played, so longer replies were cut off mid-word ("broken" ending, thud). All parts are joined now; the tail trim keeps soft endings (−36 dB, 180 ms decay, 120 ms fade); cached clips re-fetched once; synthesis timeout scales with length

## 1.7.0: the daily-life release (on request: 2, 1, 3, 4, 5)

- [x] Meals: snap a photo (or type/say "I ate 3 eggs and toast") → Gemini estimates items, protein, kcal, carbs, fat; portion ½–2×; correct it in words; saved per day with a thumbnail; counts toward the protein goal; Coach sees it
- [x] Google Drive backup: user's own OAuth client ID (setup steps in Settings), hidden app folder (drive.appdata), one file per day, 14 kept, restore any day; runs by itself once a day while signed in, otherwise a one-tap "Back up to Drive" after training (Google needs a tap to sign in again)
- [x] Hands-free workouts (headphones button on the workout): on-device speech detection (adaptive noise floor, pre-roll, learns steady music), only speech goes to Groq as WAV, only workout commands (or anything after "Coach …") are acted on; spoken rest cues ("ten seconds", "Bench press, set 3: 80 kilos for 8"); never listens to itself; off when the workout ends or the app is hidden
- [x] Morning check-in on Today (before 2 pm): sleep, energy, soreness in taps or by voice ("slept 6 hours, legs are sore" / "sov 7 timer, øm i benene") → readiness 1–5 that starts the workout without asking again, or opens the easy-day choice when low; sore muscles in today's routine are flagged; sleep chart in Progress; Coach sees it
- [x] Body screen: weight trend, measurements (waist, chest, arm, thigh, hips, neck) with change and charts, progress photos by pose on this phone only (never uploaded or backed up), before/after slider
- [x] DB v4 (check-ins, measurements, photos; old voice cache cleared); backups carry check-ins, measurements and meals (thumbnails validated)
- Decisions: Drive needs the user's own Google Cloud client ID (a static site can't hold one safely for everyone); hands-free works with the screen on (Android pauses web apps with the screen off); photos stay out of backups because of size and privacy.

## 1.7.1: voice ending, third pass

- [x] Replies: the models sometimes keep "talking" after the text (garbled ghost voice, breaths). The trim now knows how long the text should take and ends at the last pause that fits it; a quiet ghost after a pause is dropped; text always ends with a full stop
- [x] Settings → Voice → Save the last reply: the raw audio as a WAV, to send if an ending still sounds wrong

## 1.8.0: scan, favourites, one-tap check-in, liquid glass

- [x] Check-in is one tap: "How do you feel today?" with five faces; sleep and sore spots are optional one-tap chips on the summary
- [x] Barcode scanner (Today's meal row, the meal sheet, home-screen shortcut): live camera, sweeping laser, corners lock onto the code, torch; Open Food Facts lookup; 1 serving / 100 g / whole pack / custom grams with live numbers; not found → snap the nutrition label (Gemini reads it); scanned products remembered on the phone
- [x] Favourite meals: meals logged twice in 60 days or starred become one-tap chips on Today and in the meal sheet
- [x] Liquid glass: layered fill, specular highlight and a light-catching gradient rim over a saturated blur (dock, sheets, toasts, cards); the tab indicator stretches like liquid; primary buttons are glossy with a sheen on press; a slow aurora behind everything; content blurs under the dock; big titles melt away on scroll; sheets blur the page behind and their content blurs in
- Decision: without the phone's barcode detector (not every browser has it), the scanner offers typing the number or snapping the label instead of shipping a scanning library

## 1.8.1: the real cause of the noise after replies

- [x] Found from the saved reply: newer Gemini voices return a whole WAV file with a metadata chunk after the samples (the SynthID watermark note). It was played as audio → a full-scale burst at the end. The WAV is now parsed chunk by chunk and only the "data" samples are played, per part; cache key bumped so old clips are fetched again

## 1.9.0: knows you, logs the way you talk, goal autopilot, smoother

- [x] "Coach is busy": 429/503 are read properly. A daily free-tier quota skips that model until the reset (midnight Pacific) and moves on; a per-minute limit is waited out once (Google's retry delay); Flash-Lite models are the last resort; a clear message with the reset time when everything is used up
- [x] Natural logging: "I got 9 reps (this time)", "I hit 2 kg more", "two reps more", "one rep short", "as planned", "did it", "9 reps with 2 kg more", "4 plates" (T-bar/landmine/machines = plates, barbells = per side + bar), "same weight 10 reps", Danish too; missing numbers come from what the steppers show; relative phrases correct the last set only within 90 s of logging it, otherwise they log a new set relative to the plan
- [x] Onboarding on first open (asked once for existing users, skippable, editable in Settings): name, age, sex, height, weight, experience, goal, days/week, session length, equipment, injuries, cardio → profile; sets weekly goal, protein per kg and cardio goal; then the Coach builds a plan, or a matching program is added
- [x] The Coach sees everything: profile, the live workout set by set with the next set and rest, deload, muscles this week, usual length, measurements, photos, goals, and a guide to every feature of the app
- [x] Goal autopilot: "goal 100 kg bench by December" (voice or sheet, from Today or an exercise page): estimated max vs a straight line to the target, honest projection from the real trend (capped at a believable rate), this week's aim as a set, Today card, aim line on the workout, Coach sees it
- [x] Smoothness: entrance animations play only when a screen appears (updates no longer replay them); chat messages already shown don't slide in again; meal portions update in place; cards inside screens no longer live-blur (overlays still do); the background is still and swirls only on tab changes; no blur filters in animations; SVG pulses are finite. Idle Today runs no animation frames
- [x] Greeting uses your name; labels on glass cards are readable

## 1.10.0: plans from the Coach, phone edges, tap to talk, themes, tell me about yourself

- [x] Plans straight from the Coach: any plan request ("I need a five-day plan", "make me a 6-day…") builds one; exercise names are locked to the catalog (with a plain retry), close names are matched, unusable days skipped; "Replace my routines" or "Add", both with Undo; the Coach never sends you to its own tab
- [x] Phone edges: the status bar takes the app's top colour (darker under sheets and the voice screen); the top and bottom blur softly when content scrolls under them; the dock tucks in while you scroll down and springs back when you scroll up
- [x] Orb: tap it and talk, it sends by itself when you pause (adaptive to room noise); a hold still works; the flying orb and the dock orb share one animation clock, so handing back is seamless
- [x] Themes and Customize (bottom of Today): Violet, Ocean, Jade, Ember, Rose recolour everything (orb, buttons, glow, charts, status bar); choose which cards Today shows (muscle balance and all routines are off by default; "Other" on Up next opens them); cards that come, go or move glide there instead of popping
- [x] Onboarding starts with "Tell me about yourself": talk (auto-stops on a pause) or type; Gemini fills the profile and keeps the rest as notes for the Coach and plans; only the unanswered questions follow

## 1.10.1: no auto-stop

- [x] On request: tapping the orb (and "Tell me about yourself") keeps listening through pauses until you tap again; recordings can run 60 s so there's time to think
