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

## 1.11.0: smart pause, mini dock, talk to get started

- [x] Smart pause (on request, replaces 1.10.1): tap the orb and talk; at a pause it listens to what it has so far and sends only if it sounds finished. Trailing "and / for / with / um / med / øh…" or Whisper's "…" means you're still thinking: it says "Take your time… I'm listening" and waits (sends after 6 s of quiet, or tap to send). Talking again cancels a pending send. A finished sentence isn't uploaded twice
- [x] "Keep talking" on a card that didn't understand you: what you say next continues the old sentence, no retyping
- [x] Dock minimizes like iOS while you scroll down: a small pill with the current tab and the orb; scroll up or tap the pill to open it again
- [x] Status bar: every theme-color tag (and the manifest) carries the app's top colour from the first paint, per theme. An installed app picks up a new manifest colour only after it's reinstalled or Chrome refreshes it. Android doesn't let web apps draw or blur under the status bar
- [x] Onboarding is a conversation: "Let's get to know you". The Coach asks out loud, listens with the smart pause (or you type), reacts like a friend and asks only what it doesn't know yet; profile and notes fill in as you talk; the question screens that follow skip everything covered

## 1.12.0: quicker voice, tidy dock, full screen, your split, exercise figures

- [x] Voice: sends about 0.85 s after a finished sentence (was 1.3 s), and waits at most 3 s when you trail off (was 6 s); tap to send any time; swipe the orb up for the full screen
- [x] Dock pill: the orb sits inside the pill, the dark ring behind it fades, one smooth easing for every part (no bounce on layout)
- [x] Settings → Full screen: hides Android's status bar so the app runs edge to edge (it asks on the next tap; comes back after leaving the app)
- [x] Spoken replies start sooner: the first sentence of a longer reply is made on its own and plays while the rest is made
- [x] The getting-to-know-you chat asks for your current split day by day (exercises, sets, reps) and offers "Use my split" to save it as your routines; "Build my plan" passes it to the Coach
- [x] Exercise figures: a little figure for every exercise (about 30 movements), still in the exercise picker, moving on the workout screen and the exercise page
- [x] Taps were sometimes swallowed while Today's cards glided (a view transition takes over input): cards now glide only when they really come, go or reorder, never on the first paint
- [x] Restraint pass (on request, from a "looks vibecoded" checklist): one quiet glow instead of the purple-to-blue wash and aurora, no film grain, solid cards on the page (glass only on the dock, sheets and toasts), flat primary buttons, neutral labels, more contrast in grey text; the orb stays the one bold thing

## 1.13.0: Food, and a rest ping in the background

- [x] Food screen (Today's Food card → Food): calorie ring with "kcal left", protein/carbs/fat bars against daily targets; targets worked out from the profile and bodyweight (Mifflin-St Jeor, activity from training days and cardio, goal adjustment, protein per kg, fat ≥ 0.8 g/kg), editable by tapping the ring; Scan / Photo / Say it / Type; favourites; water glasses; meals by breakfast, lunch, dinner, snacks (tap: move, log again, favourite, delete with undo); a 7-day chart with the target line; earlier days
- [x] Motion: numbers, the ring and the bars glide from their old values when anything is logged; a new meal arrives with a glow; a deleted one folds away; parts rise in on entry; changing day slides the page; water glasses fill with a spring
- [x] The Coach sees today's calories, macros and water against the targets
- [x] Rest ping in the background: the service worker is handed the rest's end time and waits it out itself, so the notification comes even when the app is frozen in the background, in another app or closed (up to ~4.5 min rests; longer ones fall back to the page's timer). The first rest asks once whether to turn it on

## 1.13.1: faster, smoother scanner

- [x] Reads every camera frame (was ~9 a second); a 12–13 digit code with a valid check digit is trusted on the first read (8-digit codes still need two); the camera opens while support is checked; continuous focus and a slight zoom where the phone allows
- [x] The product lookup starts the moment a code is seen, runs during the lock animation (shortened to 0.36 s), and gives up after 7 s instead of hanging; the product photo loads while you pick the amount, so Add closes at once
- [x] Recent products as one-tap chips on the camera; the amount you had last time is preselected; the camera fades in once it's live and dims when a code locks
- [x] Measured: code in view → product card in ~0.8 s with a slow (300 ms) server; a recent product in ~0.2 s

## 1.13.2: second restraint pass (the "looks vibecoded" list, whole app)

- [x] No violet-to-lilac/blue gradients left outside the orb: progress bars, toast and card timers, goal and muscle bars, onboarding bar and slider, voice wave, week ring and sparklines are one solid colour; "done" states are solid green
- [x] No tinted gradient cards (Drive nudge, avatar, chat bubbles, meal numbers); state shows by colour alone
- [x] One spacing rhythm on Today and Food: 28 px above a section title, 10 px below, 12 px between cards
- [x] Copy: no symbols in labels ("Favourited"), and "Your log lives on this phone" instead of claiming everything stays on the phone (voice and Coach go to Groq and Gemini)
- Kept on purpose: the orb (the app's one bold thing), Manrope (not Inter), the app's own icons, no emoji, no em dashes, glass only where something floats

## 1.14.0: a look over the whole app

- [x] Workout: weight and reps each sit in their own panel with bigger −/+ (they crowded into each other around the ×); the panel you're typing in lights up
- [x] Settings: rows with a long description or a wide control (reply voice, languages) wrap the control under the label instead of squeezing the label into a thin column
- [x] Session highlights on every workout (shown right after Finish): "Stronger on 2 of 3 lifts", volume against the last time you did that routine, where the week stands, and each lift's best set against last time (↑ ↓ = or first time), compared by estimated max

## 1.15.0: say it however you like; Food gets its own tab

- [x] Long, natural sentences give the gist: "Just started my back workout. I'm on T-bar row. I have 80 kilos on. I did 9 reps. (mumble)" → T-bar row 80 × 9. Weight, reps and the exercise are pulled from any clause (a cue like "I'm on…" lets misheard names through: "C bar row" → T-bar row); noise is ignored; "start my back workout" starts the matching routine or an empty one
- [x] Logging a set with no workout running just starts one (the named routine, or an empty workout) and logs it, instead of asking; with no routines at all it never asks
- [x] Tabs: Today · Workout · orb · Food · Coach. Food is a tab of its own (quick protein +20/+30/+40 moved there); History is the clock button on the Workout tab (and Last session on Today), with a back button; after Finish, back goes to Today
- [x] Today is lighter: no meal row, favourites or protein chips (they live in Food); the Food card on Today shows calories left and opens the tab; a clean fork-and-knife icon for food

## 1.16.0: black bar blends in, "I benched…", patient Coach, customizable Food

- [x] Status bar: the user's phone keeps it black whatever the page asks (Samsung / installed-app behaviour), so the app's top edge is now the same pure black and melts into the page below; theme-color and manifest are #000 too, so it's seamless everywhere. Full screen (Settings) plus the phone's own camera-cutout setting removes the bar entirely
- [x] Voice: past-tense lifts ("I benched…", "squatted 140 for 5", "deadlifted 180 kilos for 3 reps") name the exercise; "3 sets of 100 kilos for 8 reps" reads 100 as the weight, not the reps
- [x] Coach: waits up to 45 s for the first words (thinking models are quiet at first), thinking capped so answers start sooner (asked again without the cap on models that refuse it), a timeout moves on to the next model, busy servers get three patient rounds
- [x] Food → Customize: switch calories, carbs, fat, water, favourites, quick protein buttons and the week chart on or off; with calories off the ring (and Today's card) follows protein; Daily targets from the same sheet

## 1.17.0: make it yours (the useful kind of customization)

- [x] Quick add buttons: calories or protein, with your own three amounts (Food → Customize); quick calories log as a "Quick add" entry that counts and can be edited or undone
- [x] Edit a logged meal: name, calories, protein, carbs, fat, or scale the whole portion (×0.5 … ×2); the day's totals move by the difference; undo
- [x] Reorder: Today's cards and the Food tab's sections move up and down in Customize (and still switch on/off); a running workout always leads Today
- [x] Weight steps (Settings → Workout): the −/+ step for barbells, dumbbells and machines (0.5–5 kg); the progression suggestions use the same steps
- [x] Real maintenance: after 14+ days of food and 6+ weigh-ins, Daily targets shows the maintenance your own intake and scale imply (intake minus the weight trend × 7700 kcal/kg) and offers it, adjusted for your goal, as the calorie target

## 1.18.0: say a set in any order; never "add an exercise first"

- [x] Word order doesn't matter: the sets, the weight, the reps and the exercise are found wherever they are ("tricep pushdowns with two sets and 50 kilograms for eight reps", "two sets of tricep pushdowns at 50 kilos for 8", "I did 8 reps of tricep pushdown at 50 kilograms, 2 sets", "rope pushdown 25 kg 12 reps 3 sets"); it also fills an exercise or a set count a stricter reading dropped
- [x] No exercise named and none on screen: "Which exercise was that?" with your most-trained lifts as one tap, or Pick another (the list), then the set is logged; never a dead end
- [x] Empty workout: your lifts as one-tap starts (with their figures) and an example of what to say

## 1.19.0: a whole session in one breath, a Coach that remembers, Monday check-ins

- [x] Say a whole session: "bench 3x8 at 80, then rows 3x10 at 60, then lateral raises 3 by 15 with 10" / "squats 5 sets of 5 at 120. After that leg press 3 sets of 12 at 200. Then leg curls 3 by 12 at 45" logs every lift and set in one card with one Undo; starts a workout if none is running (works during or after the gym)
- [x] Coach memory: when you tell the Coach something lasting (dislikes, injuries, schedule, events, equipment), it keeps it ("Remembered: hates lunges" under the reply) and uses it in every answer, plan and check-in; Settings → What your coach knows lists it, add your own, delete any
- [x] Weekly check-in: on the first open of a new week the Coach quietly writes a look back (sessions vs goal, lifts that moved or stalled, records, food vs targets, weight, sleep, goals) and this week's plan with concrete targets; a card on Today until you've read it; on/off in the memory sheet

## 1.20.0: Danish food search, smart warm-ups, plateau fixes, monthly photos

- [x] Food → Search (replaces Type): ~250 common Danish foods built in (rugbrød, skyr, frikadeller, leverpostej, remoulade, smørrebrød, drinks…) with typical values and real portions, found as you type in Danish or English (æ/ø/å optional, works offline); Danish products from Open Food Facts join while online; tap one → the amount card (portion / 100 g / custom); recent products first; "Estimate with AI" for anything else
- [x] Smart warm-ups: added automatically before the first lift for each muscle, worked out from the working weight (bar ramp for barbells, longer when heavy; two lighter sets for dumbbells and machines; one feeler set on muscles already worked); unticked ones drop away at the first work set; hands-free speaks them; say "warm up" / "warm-up done", or just the warm-up numbers; Settings → Workout → Smart warm-ups
- [x] Plateau: when a lift in your plan has had no new best in 3 sessions over 2+ weeks, a Today card offers a concrete change applied to every routine in one tap (switch rep range, or swap for a close variation), with Undo, "Ask the Coach", or "Not now"; the Coach sees stalled lifts too
- [x] Monthly photos: Body screen shows your latest photo beside the one from about a month before (same pose), with the weight and waist change and a "Coach's take" (numbers only; photos never leave the phone); a Today card when a new month is ready, and a photo-day nudge when the last photo is a month old

## 1.21.0: your own routine, a Coach brief, "one more rep on pushdowns", status bar, customization

- [x] Paste (or say) your own routine in the Coach ("this is my routine: …"): copied as written, not redesigned: days with weekdays, every exercise with its sets and weights; exercises the catalog lacks (Incline Smith press, Chest-supported row…) are created; anything unconfirmed is left out and named; card → Use this plan / Add
- [x] Coach brief (Settings → What your coach knows): paste who you are and how to coach you (up to 5000 characters); it leads every Coach answer, plan and check-in
- [x] Smarter Coach: judges trends not single days, flags problems unasked with one concrete fix, doesn't just agree, never invents targets, names your own lifts and numbers; routines with planned weights and stalled lifts in its context
- [x] Voice: "I did one more rep on tricep pushdown today", "2 kg more on leg press", "one rep less on bench", "I did 12 on pushdowns", "en gentagelse mere på bænkpres", "I needed one more rep" (= one short): relative to that lift's plan (this workout, else your routine, else last time), starting a workout if needed; asks for the weight when none is known
- [x] Status bar: the app's own background colour (no black band); the black top fade is gone
- [x] Fixed: huge arrows on Settings rows
- [x] Make it yours (Today → Customize, or Settings → Make it yours): opens on Today/Workout/Food/Coach, text size, background glow on/soft/off, Today greeting on/off, tab names on/off, workout screen figure and last/best line on/off, smart warm-ups and coach tips; plus colours and Today cards as before

## 1.22.0: a smarter, smoother Coach; liquid-glass bar; weekly plan; rest bell; synced targets

- [x] Coach uses Gemini Pro first when the key has it (deeper thinking, slower), Flash as fallback; Settings keeps Flash-only as an option (coachBrain)
- [x] "The plan from my brief" / "set up my routines" copies the routine written in the brief (no new design); Brief sheet has "Set up the routine in my brief"
- [x] Coach replies: thinking state (orb + shimmer, "thinking it through" after 7 s), words glide in smoothly (typewriter that catches up), bubbles spring in, a soft glow when done; keyboard goes down after sending
- [x] Composer: a small orb beside the text box: tap, talk, the words land in the box; the bottom bar steps aside while typing
- [x] Replies speak instantly with the phone's voice by default (Instant); Natural/Fast Gemini voices still in Settings
- [x] Rest bell: 3-2-1 ticks and a bell + strong buzz when rest ends, on any tab (Settings → Workout → Rest bell)
- [x] Food targets: calories and macros move together (calories move carbs, then fat; macros move calories); split bar
- [x] Hands-free (headphones) button hidden by default; Customize → Hands-free button brings it back
- [x] New tab icons (duotone when active), liquid-glass bottom bar with a stretching lens, springier shrink to a pill and back (opens again at the end of a page)
- [x] Top edge: a soft progressive blur into the status bar
- [x] Four more colours: Lime, Gold, Crimson, Graphite
- [x] Workout tab is now "Train": your week (routines by weekday, done/today/missed), Up next, Progress / History / Body tiles, cardio, routines; routine editor has day chips; "Your week" can also go on Today
- [x] Up next picks today's routine by weekday
- [x] Coach debrief after every workout: what moved, what dropped, exact targets for next time (toast + Today card; Customize toggle)

## 1.23.0: one orb for everything, a Coach you can talk to, calmer screens

- [x] Chat always uses Flash (fast); Pro only does background work (weekly check-in, after-workout debrief)
- [x] The orb understands food: "2 eggs and toast", "for lunch chicken and rice", "200 g skyr", "to æg og en skive rugbrød" → counted from the Danish list instantly (offline); anything else is estimated in the voice card; logged with Undo. On the Food screen, anything that isn't a command is food. "Two glasses of water", "set my calories to 2400" (macros follow). The AI fallback knows food, water and which screen you're on
- [x] Typing a clear command in the Coach box does it (with the card and Undo) instead of discussing it
- [x] Coach: the orb flies out of the dock into the message box (dock closes the gap); tap it to talk: sends when you pause, answers aloud, listens again (a real conversation); tap to send early or to stop
- [x] Replies: no box, words blur in lit by the accent and settle; thinking = a glow running round the bubble, breathing orb, steps ("Reading your log…"); the box lifts with the keyboard (transform only), send button appears only when there's text; the Undo card sits above the box
- [x] No routines yet → "Tell Setline how you train" card: set up from the brief in one tap, or tell the coach, or pick a program
- [x] Lock screen: with Rest alerts on, the rest timer counts down in a silent notification every second, then rings (Settings → Workout → Lock-screen countdown)
- [x] Food: "Same breakfast as yesterday" rows; a bookmark on a meal group saves it as a one-tap Saved meal (long-press to remove); water is one calm row with − / +
- [x] Status bar: the top edge is the background with a touch of the theme glow, and the status bar gets exactly that colour, so the glow runs under it; the top overlay only appears when content scrolls under it
- [x] Calmer: Today without the brand line, cardio lives on Train by default, the week strip only when routines have days, less space above titles

## 1.23.1: animation fixes from the screen recording

- [x] Tab switches: the old screen fades out in 0.13 s and the new one arrives just after, with a small directional slide: the two never show at once (they overlapped for ~0.3 s)
- [x] The dock keeps its shape on the Coach tab (the orb leaves its slot instead of the slot closing), so the tab lens never lands in the wrong place or lags
- [x] Orb flight: sizes come from the layout (it no longer flies back tiny and pops), the copy starts where it takes off on the very first frame, both real orbs hide instantly while it flies, and it hands over with a short cross-fade
- [x] Tab lens: quicker spring (0.44 s) and a smaller stretch

## 1.24.0: the bar squishes, wow motion, style choices, reliable spoken replies

- [x] On Coach the bottom bar squishes together where the orb was (springy), and stretches back when you leave; the tab lens glides and tracks its tab every frame so it never drifts
- [x] Spoken replies (phone voice): waits for voices to load, a beat after cancelling, sentence by sentence with a watchdog and one retry, primed on the first tap (Android only speaks after a touch); conversation mode waits for the real end of speech
- [x] Motion setting: Calm / Lively / Wow (default). Wow: screens arrive out of a soft blur with a spring, tab icons bounce, cards and toasts pop in, a light ripples from your finger on big buttons and tiles; presses spring everywhere
- [x] Orb style: Aurora / Glass / Ring / Dot; Bottom bar: Glass / Solid / Minimal; Cards: Soft / Glass / Outline (Customize → Look and feel)

## 1.25.0: the orb is the Coach, a new bar, cards that open into their page, haptics

- [x] Bar: a glass pill with Today / Train / Food and the orb as its own round button beside it (the Coach tab is gone). Scrolling down, it shrinks as one piece (one spring): shorter, narrower pill, labels slip away, icons get small, the orb shrinks too; it grows back when you scroll up or reach the end. The tab lens tracks its tab every frame
- [x] Orb: tap = the Coach, which grows out of the orb (a circle opening over the tab you're on) and closes back into it (✓ button or Back); everything it said is there to read. Hold = a quick voice command from anywhere (as before). The "Orb: hold/tap" setting is gone
- [x] Cards open into their page: Food card, Progress / History / Body tiles and past workouts grow into the new screen (shared-element transition; off with Motion: Calm)
- [x] Haptics matched to motion: a tick for tabs and sheets, a soft double for opening a card or the Coach, a firm press for logging, a drum roll for records

## 1.26.0: one calm look, the orb in the middle, food split into items, smoother everything

- [x] Bar: Today · Train · orb · Food · You, the orb in the middle where the thumb is. The glass now really blurs what's behind it (a view-transition name on the wrapper had cut it off, same for the top edge). Scrolling down, the whole bar scales down from its bottom edge (transform only, nothing re-lays out), labels slip away; the lens stays on its tab
- [x] You tab: profile card, Progress, Body, History, What your coach knows, Make it yours, Settings
- [x] Coach: the orb flies from the bar into the message box when it opens and back when it closes (landing spot from the layout, so the moving bar can't skew it); no bounce; Today's numbers don't count up again when you close it
- [x] Food said together is logged as separate items in one group ("500 g blueberries and 100 g skyr" → two rows with their own kcal and macros under "2 foods · time"), from voice, the Coach box and meal photos; Undo removes the group
- [x] One look: Motion, Orb style, Bottom bar, Cards, Glow and Dock labels settings removed (glass bar, aurora orb, soft cards, soft glow)
- [x] Quieter colours: Violet, Slate, Sage, Sand, Clay, Graphite (old colours map to their nearest)
- [x] Lag: no blur filters in any animation (screens, pop-ups, sheets, coach words, thinking steps), no full-screen blur behind sheets, no blur on every chat bubble; a sheet's content no longer ran a second slide on top of the sheet's own
- [x] Talk mode: a lone noise word ("Sink.") is ignored and it keeps listening

## 1.27.0: polish: voice you can trust, one motion system, calmer screens

- [x] Speech-to-text: segments Whisper marks as "probably not speech" and its film-subtitle ghosts ("Danske tekster af …", "Tak fordi du så med", "Thanks for watching") are dropped before anything is sent; a pause with only noise keeps listening; on Auto, anything heard as Norwegian/Swedish is transcribed again as Danish
- [x] Coach: answers what you just said first, never repeats an earlier point ("you haven't logged anything"), asks when a message looks misheard, speaks in plain natural sentences; the app guide knows the new bar and You tab
- [x] Reply voice: after Gemini's free daily limit (429) the phone voice takes over for an hour with no waiting; the status line says Instant when that's the choice, and explains the limit instead of "Gemini failed (429)"
- [x] One motion system (tokens.css: 4 speeds, 3 curves): tabs and pages hand over cleanly (the old one is gone before the new one arrives, a small slide in the direction you went, cards rise in); every pop-up is the same sheet (long ease up, quicker down; new content in the same sheet fades in); voice cards and toasts share one rise; presses one squeeze. Removed: the card-grows-into-page effect (it ghosted over its neighbours), the sheet's second animation, the pop-in bounce, the fade on Coach close
- [x] Less work while moving: the background glow and orbs pause during screen and sheet moves; the hidden message-box orb no longer animates
- [x] Calmer screens: Progress with no data is one card with "Start your first workout"; sub pages show their title once (the small header title appears only after scrolling); Train no longer repeats the Progress / History / Body tiles that live on You

## 1.27.1: the Coach opens and closes cleanly

- [x] The Coach screen is solid (its own copy of the background glow), so the page under the circle never shows through it: no two pages on top of each other while it opens or closes
- [x] The tab under the Coach stays perfectly still while the circle covers or uncovers it (it used to slide, fade and replay its card animation underneath)
- [x] No flash at the end of closing: the Coach is hidden before the circle lets go (the clean-up ran in the same frame as the animation's end, so the whole Coach faded out over Today)
- [x] Orb flight: takes off from where the orb really is (also when the bar is shrunk), lands where the other one will settle; the message box no longer jumps up 76 px as it fades; the bar comes back without a bounce, so the orb lands on it exactly; the bar's orb no longer shrinks to 20 % while hidden
- [x] Fast back-and-forth: each open or close tidies up the previous one first; the background glow no longer drifts when the Coach opens

## 1.28.0: the orb becomes the Coach, a thinking aurora, glass, sheets you can swipe away

- [x] Coach opens by the orb's light blooming out of it until it fills the screen (a bright rim sweeps across) and stays as the Coach's background, glowing up from where the orb was; the conversation and message box rise into it and the message-box orb pops in. Closing pulls the light back into the orb, which condenses back in the bar. One soft element that only scales and fades: no circle cut-out and no flying copy of the orb (both could flicker or pop on Android)
- [x] Thinking: a slowly turning aurora rises from the bottom behind the conversation; the orb swirls fast, a comet of light circles it and a halo breathes (rotation and opacity only)
- [x] Glass: three soft pools of the theme colour behind everything, cards are tinted glass with a light top edge, more blur on the bar and message box
- [x] Sheets: swipe down from anywhere once the content is at its top (1:1 with the finger, flick or a third of the way closes, otherwise springs back); no more Android stretch pulling the content away from the sheet (it looked like two sheets); the glass blur switches on only once the sheet has stopped moving

## 1.28.1: closing without a flash, one thinking light, words that blur in

- [x] Closing the Coach: the conversation vanishes first (80 ms), then the page shows through the light as it thins and pulls back into the orb: no dark empty moment and no Coach-over-Today double image
- [x] One thinking animation: the separate "Reading your log…" bubble is gone (kept for screen readers); the aurora behind the conversation is bigger and brighter and the message-box orb breathes in it
- [x] Coach replies: each word arrives out of a soft blur, lit in the accent, and settles into the text colour
- [x] Talk mode: stray letters and fragments ("L", "Jd") are never sent; it keeps listening and rests after three

## 1.28.2: updates install by themselves

- [x] A ready update no longer waits for a tap on the small Update pill: it goes in while the app is starting, or silently the moment you leave the app (the reload happens out of sight, after saving). The pill only shows for an update that arrives mid-use

## 1.29.0: depth and scroll

- [x] Cards float up into place as they scroll onto the screen (scroll-driven, on the GPU)
- [x] Sheets push the page back (it shrinks a little and dims) and it comes forward as the sheet leaves; sheets are near-solid while moving, so the page never shows through them mid-slide
- [x] Coach depth: as the orb's light blooms, the page sinks back and dims; closing, it comes forward again as the light returns to the orb

## 1.30.0: no dark flashes, a cascade everywhere

- [x] Pages and tabs never fade through black (the recording showed a near-black moment on every change): the old page goes at once, the new one is there at once and its cards glide in one after another from the side you moved towards
- [x] Closing the Coach is a soft crossfade: the conversation sinks toward the orb, the light fades as it draws in a little, the page comes forward through it and the orb pops back; no sweeping ring, no dark moment
- [x] Sheets: their contents cascade up as the sheet rises
- [x] The tab you pick pops

## 1.30.1: never dim

- [x] Page and tab changes: the new page is at 92 % brightness or more from its first frame (it started at 20–50 %, which the recording showed as a dim flash); only a short glide says which way you went
- [x] Coach: the conversation rises in with the light instead of after it, so there is no empty dark moment; the bloom is quicker

## 1.31.0: the Coach's light rebuilt, no keyboard jump, a calmer orb

- [x] The recording showed the screen dark for about a second after closing the Coach: the light was one disc scaled to about five times the screen, which the phone has to draw thousands of pixels wide. Now two screen-sized layers: a burst of light that grows out of the orb and fades, and the Coach's own background fading in under it. Open ≈ 0.8 s, close ≈ 0.7 s, both slower and softer; the page sinks back as the light comes and comes forward as it gathers back into the orb, which takes it in last
- [x] Keyboard: the page now shrinks above the keyboard (viewport interactive-widget=resizes-content) instead of Android sliding the whole view up while the app also lifted the message box; the chat keeps its latest message in view as the keyboard comes and goes
- [x] The orb moves slowly and softly: longer swirls, a slower thinking breath and aurora

## 1.32.0: back to the 1.23 design, with everything since

Your feedback over the last day says the look and motion started going downhill at 1.24 ("we're beginning to degrade the app", then "transitions have degraded", then flashes). So the design, navigation and motion are back to 1.23.1: the liquid-glass bar with the orb in the middle (tap to talk, hold for the full voice screen), the Coach as a tab with the orb flying into its message box, blur-in replies with the thinking glow, stable tab switches, the old sheets and pop-ups. Kept from 1.24–1.31 (all engine, or small additions in the 1.23 style):
- [x] Foods said together are separate rows under one meal line (voice, Coach box, photos), Undo removes the group
- [x] Speech-to-text drops the subtitle ghosts and non-speech; Norwegian/Swedish guesses are redone as Danish; stray letters never sent in talk mode
- [x] Coach answers what you said, doesn't repeat itself, asks when a message looks misheard
- [x] Reply voice: Gemini's daily limit falls back to the phone voice for an hour without waiting; clearer status line
- [x] Quiet colours (Violet, Slate, Sage, Sand, Clay, Graphite) and the trimmed Customize
- [x] Sheets: swipe down from anywhere
- [x] Updates install by themselves
- [x] Keyboard: the page shrinks above it, the chat keeps its latest message in view (no jump)
- [x] Top-edge glass blur actually blurs (a view-transition name had cut it off); no live blur behind chat bubbles
- [x] Progress with no data: one calm card; Today doesn't count up again after the Coach
- Left out on purpose: the You tab (Progress, History and Body are on Train again, Settings on Today), the orb-as-Coach bloom, the 1.24+ bar and motion experiments

## 1.33.0: the orb opens the Coach again, iOS-style sheets, Android back-swipe

- [x] Tap the orb in the middle: its light blooms out and becomes the Coach, the conversation rises into it and the bar steps aside; ✓ or Back pulls the light back into the orb. Hold the orb: quick voice command, as before. The 1.31 light (screen-sized layers only, no flash) in the 1.23 design; the fourth tab is You again (Progress, History, Body, What your coach knows, Make it yours, Settings) and Train no longer repeats those tiles
- [x] Thinking: one slow aurora behind the conversation, the message-box orb breathes in it
- [x] Sheets, like iOS: the page behind shrinks back with rounded corners and dims as a sheet rises (iOS curve); swiping the sheet down, the page follows your finger back to full size; let go and it settles back, flick or pull past a third and it closes
- [x] Android back-swipe from the left edge: Chrome draws its own animation there, so the app no longer plays a second, generic one on top (it now matches the right-edge back)
- [x] The shrunk bar's lens sits exactly on its tab

## 1.33.1: design tooling

- [x] `css/motion.css`: motion tokens (4 durations, out / in-out / spring curves, press scale), button press, root View Transition, reduced-motion fallback; loaded before all other CSS and precached
- [x] `.claude/skills/frontend-design/SKILL.md` (upstream skill, with the note that Setline's direction is locked)
- [x] `scripts/screens.mjs` (Playwright, dev only): 12 screenshots at 390×844 into `screenshots/` (git-ignored): onboarding, home, food, you, history, settings, Coach, readiness check, active workout, rest timer, voice listening (lifted orb and full screen)
- [x] Cloud sessions run `npm install` on start (`.claude/hooks/session-start.sh`); Chromium is pre-installed there
- [x] CLAUDE.md: design and motion rules
- [x] `npm run motion` (`scripts/motion.mjs`, dev only): every animation on an emulated phone (390×844 @2x, touch, CPU 4×): contact sheet of every painted frame (CDP screencast), rAF smoothness (FPS, p95, frames over 16.7 ms, longest), CDP trace for layout and large paints, and a prefers-reduced-motion pass; `motion/REPORT.md`, previous run kept in `motion/previous/`. First run: 0 of 26 pass (headless has no GPU, so compare runs rather than read absolute FPS)
- Not yet done (existing code predates the rules): `tokens.css` keeps its own motion tokens (`--m-*`, `--e-*`), `app.css` and the JS animations still hardcode durations and easings, and page changes use CSS classes rather than the View Transitions API


## 1.34.0 (branch `redesign`): Motion springs on the active workout screen

- [x] Motion (motion.dev 13.4.4, MIT) vendored as one ES module, `js/vendor/motion.js` (15 KB: `animate` from motion/mini on the Web Animations API, `spring`, `stagger`); no npm dependency in the app
- [x] `js/motion-tokens.js`: the only presets for Motion animations: tap, fast, default, expressive, fade
- [x] Active workout only (`js/ui/workout-motion.js`, view code; no logic, data, voice or AI changes): buttons scale to 0.96 on press and spring back (tap); set rows rise in with a 40 ms stagger on arrival and on a new exercise (default); rows that are added rise in, rows that leave fade out in place while the rest glide into the gap, rows that move (rest card, removed warm-ups) glide (default); undone rows settle back (default + fade); the set-saved confirmation (the row's check, the Log button and the toast) uses the expressive spring
- [x] prefers-reduced-motion and Settings → Motion off: no Motion animations at all
- Motion lab before → after (CPU 4×, no GPU, so noisy): set-logged longest frame 367 → 83 ms, FPS 19.5 → 22.2; set-saved 22 → 23.4 FPS; set-undone 21.4 → 25.1 FPS; still FAIL overall (baseline layout from the PR pulse on Today, software rendering)
