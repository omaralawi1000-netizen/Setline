# Setline release history

A log of every release, oldest first. It is not a description of the app: several releases were later undone (1.24.0–1.31.0 were replaced by 1.32.0, which went back to the 1.23 design; 1.37.0 was undone by 1.38.0). For what the app is now, read PLAN.md.

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

## 1.34.0: the Gemini voice back, faster, no automatic mic

- [x] Why replies used the robot voice: the default was still "Instant" (the phone's voice) from 1.22; every reply was split into two Gemini requests (the free voice quota is only a few requests a minute), and any "limit reached" answer switched to the phone voice for a whole hour. Now: Gemini is the default again (your old automatic switch is undone once), one request per normal reply, a per-minute limit is waited out for a minute, only the daily limit waits for Google's overnight reset, and Settings says which one it was
- [x] Faster: the voice is requested the moment the answer is in, instead of after the words finished appearing on screen (that was the 3–5 s)
- [x] Talking to the Coach: after the answer is spoken it rests; the mic only opens when you tap the orb
- [x] Bug sweep: every button on every screen tapped (111) with no errors; the shrunk bar's lens fix from 1.33 confirmed

## 1.35.0: the workout, polished

- [x] Found and fixed: the "set landed" animation never played (logging redraws the screen twice and the second redraw wiped it). Every workout moment is now timed from when it happened, so redraws continue it instead of losing or restarting it
- [x] Logging a set: the row drops into place with a spring, a ring of light fades off it, the check pops and draws itself, the numbers rise in; the log button gives a firm press and its set number ticks over; a firm log haptic
- [x] Records: warm light on the row, the PR tag springs in, a "New record" chip slides in and out, a drum-roll haptic
- [x] Rest: the card drops in with a spring; the ring drains in one smooth continuous motion (was a jump every second); the last 3 seconds breathe with a soft glow (no filters); when rest is over the ring fills back up, a check draws in the middle and the card glows once
- [x] Finishing: the workout's page opens with a ring that draws around and a check that draws inside it, "Workout complete", then the title, numbers, highlights and each record arrive one after another, with sparks from the check and warm ones from each record

## 1.36.0: set by number, save a workout as a routine, your own program, the week decides Up next, voice, no dark flashes

- [x] Voice: "set one is done, but I only did nine reps instead of ten", "set 2 done", "first set done at 82.5", "sæt 3 er færdigt men kun ni gentagelser": that set of the current lift, with its planned numbers and what you said; an already-done set is corrected; "3 sets…" and "set my calories…" are left alone. ("set 2 done 9 reps" used to log 2 kg)
- [x] Finished workout → "Save as a routine": opens the routine editor filled with what you did (name it, pick its day, adjust, save); the button goes once saved
- [x] Add a program → "Your own program": paste or type it any way; the Coach reads it into routines with their weekdays, to add or replace yours
- [x] Up next follows the week: today's routine if you haven't trained, else the next day that has one (a rest day now shows tomorrow's, not the one done longest ago); the card says when ("Up next · Tomorrow")
- [x] Reply voice after turning on billing: an earlier "daily limit" made the app wait for Google's overnight reset; now limits only pause it for 30 s (per minute) or 10 min (daily), the old rest is dropped, a missing voice model is looked up again, and Settings → Voice → test says exactly what happened (model and error)
- [x] Bug sweep: measured frame by frame, every tab or page change dipped 10–15 % darker for a moment (the old screen faded before the new one's cards showed): gone; Coach open/close and sheets measured clean; 111 buttons tapped without errors

## 1.33.1: design tooling

- [x] `css/motion.css`: motion tokens (4 durations, out / in-out / spring curves, press scale), button press, root View Transition, reduced-motion fallback; loaded before all other CSS and precached
- [x] `.claude/skills/frontend-design/SKILL.md` (upstream skill, with the note that Setline's direction is locked)
- [x] `scripts/screens.mjs` (Playwright, dev only): 12 screenshots at 390×844 into `screenshots/` (git-ignored): onboarding, home, food, you, history, settings, Coach, readiness check, active workout, rest timer, voice listening (lifted orb and full screen)
- [x] Cloud sessions run `npm install` on start (`.claude/hooks/session-start.sh`); Chromium is pre-installed there
- [x] CLAUDE.md: design and motion rules
- [x] `npm run motion` (`scripts/motion.mjs`, dev only): every animation on an emulated phone (390×844 @2x, touch, CPU 4×): contact sheet of every painted frame (CDP screencast), rAF smoothness (FPS, p95, frames over 16.7 ms, longest), CDP trace for layout and large paints, and a prefers-reduced-motion pass; `motion/REPORT.md`, previous run kept in `motion/previous/`. First run: 0 of 26 pass (headless has no GPU, so compare runs rather than read absolute FPS)
- Not yet done (existing code predates the rules): `tokens.css` keeps its own motion tokens (`--m-*`, `--e-*`), `app.css` and the JS animations still hardcode durations and easings, and page changes use CSS classes rather than the View Transitions API


## 1.37.0: one spring system, smoother everywhere

- [x] Motion (motion.dev 13.4.4, MIT) vendored as one ES module, `js/vendor/motion.js` (15 KB: `animate` from motion/mini on the Web Animations API, `spring`, `stagger`); no npm dependency in the app
- [x] `js/motion-tokens.js`: the only spring presets: tap, fast, default, expressive, fade. `css/motion.css` carries the same curves as CSS easings (`--spring-*`, generated by `scripts/springs.mjs`; a test fails if they drift)
- [x] Active workout: presses scale to 0.96 and spring back (tap); set rows rise in 40 ms apart on arrival and on a new exercise; added rows rise in, removed rows fade out in place while the rest glide into the gap, undone rows settle back; the set-saved confirmation (row landing, check, PR tag, toast) is on the expressive spring. The 1.35 landing stays in CSS so redraws never cut it short
- [x] Sheets rise on the expressive spring (a strip under the sheet hides the overshoot); the page behind settles on the default spring; with reduced motion the page no longer animates behind a sheet (it did for 0.3–0.8 s)
- [x] Found with the motion lab: the pulsing dot on Today's record card was a scaling SVG circle, which re-laid out the page every frame for ~10 s, even behind other tabs (57 layouts a second at rest). Now an HTML dot on the compositor, and animations on hidden screens pause: at rest, 0 layouts
- [x] Count-up numbers only touch the page when the number changes; the status-bar colour is only set when it changes (it restyled the whole page on every sheet and voice change); in voice, the words you said step aside when the command card comes up (they overlapped it)
- Motion lab, whole app: layout work during animations went from 30–210 per animation to 0–20; frame rates here are software-rendered (no GPU), so they read low for everything

## 1.38.0: back to 1.36.0

- [x] The app is exactly 1.36.0 again (every app file restored; only the version number moves forward so phones update by themselves). Undone from 1.37.0: the Motion library and spring presets, the workout-screen spring layer, the spring sheets, the record-pulse and count-up changes, and `css/motion.css` (it was never part of 1.36)
- Kept, dev only and never loaded by the app: `node scripts/screens.mjs`, `npm run motion`, the design skill and the cloud-session hook

## 1.39.0: the Coach changes your plan; a more beautiful Coach

- [x] Tell the Coach and it changes the app: "I have wrestling today" → today says Wrestling (in the week strip, and Up next skips it); "rest on Saturday", "do chest on Tuesday instead", "move legs to Thursday from now on", "swap leg extension for hack squat", "4 sets of 6 on hack squat", "add lateral raises to legs", "remove leg curls". It confirms in a sentence and shows what changed under its reply, with Undo. The Coach now sees the next 7 days with dates; one-off day changes are kept a few weeks
- [x] Opening the Coach: a thin ring of light ripples out of the orb with the bloom, the last messages rise in one after another, and the message-box orb lands with a pulse of light
- [x] Thinking: soft gradient clouds of the theme colour drift and breathe up behind the conversation (no live blur), with one quiet shimmering line of what it's doing ("Reading your log…"), no bubble and no second orb
- [x] Found with the motion lab (from main's design tooling, now merged in): the pulsing dot on Today's record card scaled an SVG circle, which re-laid out the page every frame, and animations kept running on hidden screens. Fixed: layout work during animations fell from 1,993 to 482 across the lab (at rest 121 → 0, tab changes 149 → 3, sheets 23–30 → 0–1); frame rates are unchanged within this machine's noise (software rendering, no GPU)


## 1.40.0: thinking in the message box, a livelier listening orb

- [x] Thinking shows inside the message box (shimmering steps over a drifting gradient glow) instead of filling the screen; the background veil drifts slowly while the Coach thinks
- [x] Reply words blur in slower and softer
- [x] Listening orb (Coach and hold-to-talk on the main screens): a halo that grows with your voice, faster colour, a ring that ripples out
- [x] Haptics: a rising buzz as the Coach blooms open, a tap when it lands
- [x] Version number bumped to 1.40.0 in a follow-up commit (the first push left it at 1.39.0, so phones kept the old files)

## Docs tidy (no app release)

- [x] PLAN.md now describes the app as it is; this history moved to docs/HISTORY.md; the outdated `design-target.html` mockup removed; SPEC.md and CLAUDE.md match the current app; the motion rule compares against the previous run

## 1.41.0: the ring reaches the top, thinking without words, a gliding thread, a softer status bar

- [x] Status bar: the app's colour at the very top, then a soft progressive blur (the dark band under it is gone)
- [x] Opening the Coach: the ring of light is drawn at full-screen size and grows from the orb to the top of the screen as a fine line; closing, it comes back down into the orb
- [x] Thinking: the step words ("Reading your log…") are gone; the message box fills with two drifting gradients, and soft clouds move in the background again. The box's dark drop shadow is off while thinking, and the Coach's background light fades out evenly (it had a darker ring above the box)
- [x] While a reply or plan comes in, the thread follows it down in one smooth motion (it used to restart a smooth scroll every 140 ms); touching the thread lets go
- [x] Bug: the empty Coach said "No answer came back. Try again." (two texts shared one name)

## 1.42.0: smoother Coach, a thinking light round the box

- [x] Opening the Coach: fixed two glitches seen on the phone recording. The page underneath showed through for two frames (the background's fade ended by itself mid-way; now everything settles together), and about 1.4 s after opening the whole conversation blinked and faded in again (the messages switched to a second entrance animation)
- [x] Lighter to draw: the blurred screen edges step aside while the Coach opens or closes and while it thinks; the whole-screen background drift is gone (the clouds still move); the message box has no live blur while lit; reply words use a lighter blur and are added every ~4 frames instead of every 2
- [x] Thinking: a ring of the theme colours turns round the edge of the message box with a soft glow outside it, the inside stays dark (the gradients inside had become a grey smear in the mono theme)

## 1.43.0: the orb travels, the light follows the voice

- [x] Opening the Coach: the orb flies from the bar into the message box on a short arc (swelling a little at the top, settling to the box's size) while the bloom and ring of light go up; the box comes up to meet it and the orb lands with its pulse and the haptic tap. Closing: it flies home and the bar takes it back with a pulse
- [x] While the Coach speaks, the light round the message box moves with its voice: faster and brighter on the loud parts, calm in the pauses (the loudness is worked out once from the voice clip, so it costs nothing while playing; the phone's own voice gets a gentle beat)
- [x] A finished reply (or plan) gets one sweep of light across it, and the box's glow lets go in a soft swell
- [x] The dock orb gives quickly under your finger (it used to take half a second) and its light gathers while pressed

## 1.44.0: back to the calm Coach, the orb lands with a bounce, iOS-style send, the Coach runs the app

- [x] Reverted from 1.41–1.43 on request: the ring of light reaching the top of the screen (back to the small ripple), the glowing lines round the message box (thinking and speaking), and the sweep of light over replies. Kept: the orb flying into the message box, the orb moving with the Coach's voice, the soft thinking gradients in the box and the clouds, smooth follow-scroll, and the glitch and speed fixes
- [x] The orb lands in the message box with an impact bounce: it squashes and wobbles back to round, a ring of light rings out, the box gives a little, the phone taps
- [x] Sending a typed message: the words lift out of the message box as a bubble and glide up into the chat (a stand-in flies so a re-render can't cut it off)
- [x] The Coach runs the app: besides plan changes it now changes settings (with Undo), does anything the app understands from words (log food, water, weight, cardio, sets, targets, start a routine) and opens pages; it sees the current settings and answers questions about the app
- [x] Bug: on the Food screen, "Say it" logged anything as food ("what's going on?"). Questions and small talk now go to the Coach, and a meal estimate that comes back "not food" hands the words to the Coach
- [x] Bug: a long one-word day in the week strip ("Wrestling") was cut off to "Wrestli"; it now breaks onto the second line
- [x] Bug: 1.43's reply sweep had replaced the press shine on primary buttons (same animation name); gone with the sweep

## 1.45.0: "Do it" chips, Gemini Live, hands-free words, follow-along, Up next into the workout

- [x] "Do it" chips: the Coach offers what it suggests (ACTION lines) as up to two chips under its reply; a tap applies it with Undo (a failed one says so); "yes" / "do it" (said or typed) takes the first; they hide while you type and once you've said something new
- [x] Gemini Live (js/live.js): the Coach's message-box orb holds a real conversation over one WebSocket when the key has a Live model (native audio preferred): 16 kHz mic in, 24 kHz voice out, interruptions, a live caption in the box, transcripts into the chat, tools change_app (the same changes as CHANGE lines, with Undo notes) and remember; it ends on a tap, when leaving the Coach or the app, or after 60 s of silence; falls back to turn-taking talk if it can't start (a note says so); hands-free pauses while it runs; a fallback stops the mic while it speaks if the phone's echo cancelling lets its voice cut itself off. Settings → Voice: on/off, the model, how fast the last reply started. Tested here against a fake Live server (no real key in the cloud), so the phone test decides
- [x] Hands-free words: "done" = the planned set (was: finish workout); "done, 7" / "got 7" = 7 reps at the planned weight; "that felt heavy" / "easy" = the rest of that lift's sets 2.5 kg (5 lb) lighter or heavier; "yes" / "do it" = confirm (was: guessed an exercise to add); English and Danish
- [x] Replies: the orb pulses once as the answer starts and the first line rises out of the box; while it's read out, the sentence being spoken stays bright (timed from the voice clip, or the phone voice's word events)
- [x] Up next → workout: the card's surface opens out into the workout page under the arriving cards; Today no longer flips to its Resume card (and its glide no longer shows over the workout) in the moment it's left
- [x] After finishing: today's dot in the week strip fills in with a pop, a ring and a tick the next time Today or Train is shown
- [x] The orb's landing in the message box now also sends a soft light along the box

## 1.46.0: no Live, a harder landing, smooth streaming, iOS send, liquid glass

- [x] Gemini Live removed (it listened all the time and felt less clever). The Coach stays on the newest Flash with capped thinking; new Settings → Voice → Coach brain: Fast (Flash) or Smartest (Pro, slower)
- [x] Talking through the message-box orb: after the answer is spoken it listens again by itself only when the answer ended with a question ("Should we start the workout?"); otherwise it rests
- [x] The orb's landing: it drops hard into the box (faster fall, deep squash and wobble), a double shockwave, light floods the box, the box is pushed down and shakes a little, and a strong haptic thump (42-30-18 ms, was a 14 ms tick)
- [x] Streaming replies: finished lines are drawn once and only the line being written is redrawn (the whole reply used to be rebuilt every few frames); words used to be cut off 200 ms before their blur-in ended, which made each one jump
- [x] Sending: the bubble lifts off where you typed on a spring, and the conversation above glides up to make room instead of jumping; the send button gives a little
- [x] Top of the screen: the status bar's colour flows down into the page as a gradient over a progressive blur. New Customize → Glass (Liquid: this, a frosted fade behind the bottom bar and a clearer, brighter-rimmed bar; Soft; Off) and Background glow (On / Soft / Off)

## 1.47.0: a straight landing, calmer edges, a faster workout start, no stray words

- [x] The orb flies in one straight line from the bar into the message box, speeding up into it (no hop over the page), and hits it: squashed along the way it travelled, the box pushed the same way, a stronger haptic thump (65-35-25 ms; short pulses are hard to feel on Samsung phones). It flies straight home too
- [x] Edges calmer: the top gradient hugs the status bar (58 px, was 110) with a lighter blur; the bottom fade sits low under the bar and is lighter
- [x] Starting a workout: the warm-ups added at the start used to kick off Today's card glide, whose snapshot landed ~130 ms later over the workout, redrew it and cross-faded the whole page. Now one draw, no cross-fade; the longest frame halved (430-550 → 235-265 ms in the motion lab). The stepper numbers no longer re-lay out the page once per number, and the status-bar colour is no longer recomputed (a full style pass) on every class change
- [x] The thinking look and the offers hiding while you type use two plain classes instead of :has() selectors on the whole app
- [x] A single stray word from the hold-to-talk orb ("with", "doing") that isn't a command shows "Didn't catch that" instead of going to the Coach

## 1.48.0: "Ok" isn't food, a quick launch, a seamless status bar, two-tone themes, a smarter Coach

- [x] Bug: short replies were matched to foods by their first letters ("ok" → beef mince via "okse", "no" → noodles, "hi" → raspberries), so typing "Ok" in the Coach logged a meal. Short words now count only as a food's own name or alias, and replies are never meals
- [x] The orb launches at once and slows just before the message box (330 ms, was a 380 ms slow start), then hits
- [x] Status bar: the gradient under it starts as exactly its colour (solid for a moment) and only then fades, so nothing bright shows at the seam
- [x] Bottom: no band across the screen; a soft blur feathers out around the navigation bar only (follows the pill). The bar: the indicator slides with a liquid stretch (no width animation), the chosen icon springs, presses give at once
- [x] Two-tone themes: Aurora (lavender + teal), Sunset (peach + rose), Ocean (sky + mint) with two-colour buttons, chips, done dots, your chat bubbles, orb and background glow
- [x] The Coach knows more: the last 7 days of food against targets, the latest 6 workouts, a compact base of training science, and the newest app features in its guide

## 1.49.0: a Coach that watches your goals, lock-screen logging, trend, usuals, records wall, loadable weights

- [x] After each session the app checks every lift against its plan (hit, missed, skipped; the plan is kept on each exercise when the workout starts) and works out next time's targets. Up next shows them ("Bench press 82.5 × 8 ↑")
- [x] When most of a session's plan was missed, a lift stalls into a deload, or the week's workout goal can't be reached in the days left (rest and sport days counted), the Coach pins a note at the top of the Coach and on Today with "Talk it through" / "Put away". The debrief is told what was missed and why it might be, and can only offer changes as chips
- [x] The Coach only changes things when told to directly; anything it thinks would help (moving legs away from wrestling, a new calorie target) is offered as a "Do it" chip. The context shows leg days next to marked sport days (HARD DAYS)
- [x] Rest notification (lock screen and watch): "Log 75 kg × 8" logs the planned set at the moment of the tap and starts the next rest without opening the app; "+15 s" adds time. Picked up by the app when it comes back
- [x] Body: a smoothed weight trend (weigh-ins as faint dots) with the rate per week and % of bodyweight; the Coach sees it and the Monday check-in offers a calorie change if fat loss isn't 0.5–1 % a week
- [x] Food: "Your usuals" (the same foods together in the same meal on 2+ days of the last 30), and "same as yesterday's lunch" / "samme frokost som i går" by voice or text
- [x] Progress: a records wall (best set, estimated max, date; a record from the last week glows). A record mid-workout drops a warm banner from the top with sparks
- [x] Plate-aware suggestions: only weights you can load (bar + plate pairs, dumbbell steps, your own steps)
- [x] Smooth haptics: single short pulses, no buzzing trains
- [x] Orb jump-in: the message box is already there when the orb arrives (it used to still be sliding up), the orb shrinks mostly on the way in, and the squash is gentler
- [x] Status bar gradient only just below the bar; the navigation bar's blur halo a little stronger

## 1.49.1: stabilization, offline repair, safer handoff

- [x] Offline cold-start bug: `js/appedit.js` is now included in the service-worker app shell, so the Coach's app-edit dependency is available when the PWA starts without a network connection
- [x] Regression guard: tests now crawl Setline's static production module graph from `js/app.js` and fail if a production module is missing from the offline shell
- [x] IndexedDB recovery: a blocked database open clears the cached rejected promise so a later attempt can retry cleanly instead of requiring a reload
- [x] CI: GitHub Actions runs `npm test` automatically on pull requests and on pushes to main
- [x] Codex handoff: concise `AGENTS.md` points Codex to the same `PLAN.md`, `SPEC.md`, test, screenshot and motion rules already used by the project
- No product scope, visual direction, Coach behavior, workout logic or animation design changed in this patch

## 1.50.0: silence isn't a set, a seamless orb, calm reply text, the status bar everywhere, bug reports, five new helpers

- [x] Bug: saying nothing (or gym noise) could log "Bænkpres 82,5 kilo 8 gentagelser": Whisper, given silence, repeats the example in its prompt. The example now uses numbers nobody lifts, anything that comes back as the prompt is dropped, and a sentence heard twice counts once
- [x] Bug: a sheet that redraws itself (Customize, memories, weight steps, food) jumped back to the top on every tap
- [x] Settings: the Pro "Coach brain" choice is gone; chats always use the quick model
- [x] The orb's flight: the stand-in carries both looks (the bar's orb and the message box's orb) and melts from one into the other on the way, landing at exactly the box orb's size, so nothing swaps when it hits; it still has some speed when it arrives
- [x] Reply text: words fade in at a steady pace, a few at a time (no blur or colour sweep across whole paragraphs)
- [x] Status bar: matches the Coach's background, the voice screen and open sheets too (it used to be the page colour or near-black there)
- [x] The navigation bar: a fuller, wider gradient blur around it
- [x] Report a bug or idea (Settings, the home-screen shortcut, or say/type "bug: …", "idea: …", "note for Claude: …" anywhere): kept on the phone and sent as a GitHub issue on the app's repository, with the version, screen, phone, the last things heard by voice and recent errors. Errors the app hits are kept (the last 12) and offer a Report button once
- [x] A timer between warm-up sets (45 s, 75 s before the first working set) that says what's next
- [x] Up next offers "Go lighter" after a short night, a low-energy morning or a sport day yesterday
- [x] Muscles this week: when a group is behind, "Add 3 sets" puts its main lift into the running workout (or ask the Coach how to fit it in)
- [x] Progress: your month as a picture (sessions, volume, records, biggest moves, bodyweight, cardio) to share or save
- [x] Home-screen shortcut: Report a bug or idea

## 1.51.0: the app understands which exercise you mean, a full gym's library, motion-blur orb, thinking text, quicker voice

- [x] The library is a full gym now: 156 exercises (was 68), with the machines, cables, Smith and plate-loaded variations (machine preacher curl, reverse pec deck, chest-supported row, pendulum squat, rope pushdown, hip thrust machine, ab crunch machine, …) in English and Danish
- [x] Names are matched word by word and forgive the usual mishearings ("preacher kill", "hammer girls", "lateral rays", "cable flies"); a kit word you add or leave out costs a little, a word that isn't in the name rules it out; an exercise in today's workout wins a close call ("preacher curl" is the machine preacher curl you're doing)
- [x] Bug: a name the app didn't know put the set on the exercise you were on (a machine preacher curl logged as a hammer curl). Now it asks: the nearest one, the one you're on, or "Add …" (it becomes your own exercise and the set goes on it). The same for the AI fallback
- [x] Saying a name moves to that exercise (added if it isn't in the workout) and logs there; without a name it's the exercise you're on. "Next set was only nine reps", "only 9 reps", "sættet var kun 9" log the planned set with those reps
- [x] Bug: "preacher curl 30 kg 10 reps" was read as a records question ("pr…")
- [x] Weight steps removed from Settings: the app uses a full gym's steps (bars and machines 2.5 kg, dumbbells 2 kg)
- [x] Spoken replies start sooner: the first sentence's voice is made while the reply is still being written, so it plays the moment the answer is in
- [x] 30 Gemini voices (was 10), the most natural first
- [x] Voice commands you undo right away are noted as likely mix-ups and go along with bug reports
- [x] The orb's flight has motion blur (stretched along its path, a little soft at speed) and a soft light trail; the landing pushes the box a little more
- [x] Thinking: the message box says what it's doing ("Thinking…", "Reading your log…", "Looking at your lifts…", "Putting it together…"), each phrase blurring in letter by letter along a colour gradient
- [x] Status bar: under a scrolled page the blur used to re-saturate the colour below the bar (a bluer band on blue themes); now the colour sits over the blur and matches exactly

## 1.52.0: drag to reorder your program, your workout and Settings

- [x] One drag-to-reorder for the whole app: grab a row's pull tab (or hold the row still for a moment) and drag; the row lifts, the others slide aside, the list scrolls by itself at the top and bottom edges, and the row settles into its slot (transform only, a tick per slot)
- [x] Routines: reorder exercises in the routine editor ("put the chest machine press after the preacher curl"), with a hint above the list
- [x] A running workout: Exercises sheet rows have pull tabs; the exercise you're on stays current, and when the workout came from a routine, "Keep for next time" saves that order to the routine
- [x] Settings: every section has a pull tab on its heading; drag sections into your own order (kept in settings)

## 1.53.0: music comes straight back, clearer dictation in a loud gym, a softer reply stream, one-tap reports

- [x] Bug: after talking to the orb, music took long to come back in the headphones: the app's audio engine stayed on after recording, a spoken reply or a chime, and Android keeps other apps paused while it runs. It now runs only while the mic records or something plays, and switches off 0.6 s after
- [x] Dictation in the gym: the recording is cleaned before it's sent (rumble and bass filtered out, the noise before and after the words cut, the level evened out, 16 kHz mono); silence isn't sent at all; the accurate speech model (Whisper large-v3) is the default now (everyone moved over once); the "not speech" filter is less eager, so quiet words in noise aren't dropped
- [x] Coach replies: the newest words blur in and rise a touch as they arrive at a steady pace, so the reply has a soft, blurred leading edge that settles behind it (only the last few words are ever moving)
- [x] One-tap reports right where it went wrong: a flag on the voice result card (undoes it and asks what went wrong) and under every Coach reply; what was heard, what it did or answered, filled in; one tap on "Misheard me", "Wrong exercise", "Wrong numbers", "Too slow", "Didn't get me", … sends it

## 1.54.0: the orb, polished

- [x] The orb's flight between the bar and the Coach's message box: no more blur or heavy stretch (it looked out of focus). The orb stays sharp and leaves a soft comet of its own light behind it, longest when it's fastest and drawn back into it as it lands; the glow around it rises in flight and settles on landing; a barely-there stretch at top speed
- [x] Fixed a seam through the flying orb: its two looks both faded halfway, so the dark disc behind the dock orb showed through. The new look now fades in over the old one
- [x] The voice screen's orb (and the small floating one) leaves the same trail flying up and back into the bar; the bar takes it home with a small settle
- [x] Rest on the dock orb: a thin ring drains to the end of the rest (two halves turning, transform only), and the orb glows "go" when it's over
- [x] A set logged by voice sends a spark from the dock orb to its row, which bursts on its check (gold for a record)
- [x] Records: a gold flare on the dock orb (gold ring, gold wash in the core, sparks), for voice and tapped sets
- [x] Didn't understand: the orb shakes its head (voice screen, floating orb, or the dock orb when the card shows)
- [x] Thinking: a slow swirl turns inside the orb (voice screen, floating orb, message box)
- [x] Listening: the body of your voice (90–500 Hz) swells the orb's core, the sharp sounds (2–6 kHz) light its rim
- [x] Now and then a soft glint of light crosses the dock orb
- [x] All of it transform/opacity only, with a reduced-motion fallback

## 1.54.1: typed messages glide into the chat

- [x] Sending a typed message: the words lift out of the box exactly where they were typed and rise as a bubble on a soft curve (up a touch ahead of across), slowing into place without a bounce, and no longer squashed at the start. Its landing spot is measured again every frame, so the keyboard going down, the thread redrawing or scrolling mid-flight can't make it land beside its place and jump; the real message takes over in the same frame

## 1.54.2: Coach replies flow in smoothly

- [x] Pace: one word at a time at a steady rate (14–70 words a second) that eases up or down with how much of the reply has arrived, instead of bursts of up to four words whenever a chunk landed and a dead stop in the pauses
- [x] No restarts: the line being written used to be redrawn about 20 times a second, restarting the fade of every word still settling; now only new words are added (a line is redrawn only when its shape changes, like a word turning bold)
- [x] Lighter on the phone: settled words drop their animation, and words no longer each ask for their own GPU layer
- [x] No jump at the end: the report flag's place beside the reply is kept free while it streams, so the text doesn't re-wrap when the reply finishes

## 1.54.3: bug hunt: less work per frame

- [x] Swept every screen's buttons (114 taps) and the voice logging flows: no errors
- [x] Every render rewrote the theme attributes on the page root (motion, glow, glass, text size, dock, two-tone) even when nothing changed, making the phone re-check the styles of the whole page many times a second while a voice command or a workout start redrew. Now written only when they change (voice result: 38 → 22 layouts, 105 → 35 ms)
- [x] Count-up numbers (Today, Progress, Food) rewrote their text every frame even when the digits hadn't changed; each write lays the page out again. Now only when they change
- [x] The rest timer and the cardio clock rewrote their text 4 times a second (the clock's tick) for a value that changes once a second; the cardio GPS map was redrawn 4 times in a row every 5 s. Now once (set logged: 9 → 5 layouts)

## 1.54.4: Progress and workout start, lighter; nothing runs in the background

- [x] Progress: the bar charts are drawn as plain boxes (same look) so their grow-in runs on the GPU; bars growing inside an SVG made the phone lay the chart out again on every frame. The line chart's dots and the record halo are boxes over the line for the same reason. Chart cards only lay out themselves (Progress layout time ~65 → ~45 ms in the test)
- [x] A workout's moving exercise figure kept animating on the workout screen after you'd left it, laying the page out every frame for as long as the workout ran; figures now move only on the screen that's showing
- [x] The live dot (Up next, the workout mini bar, listening) pulsed by animating a shadow, repainting every frame on every tab during a workout; it's a ring that grows and fades on the GPU now
- [x] Sitting on Today with a workout running: 76 layouts and 171 paints in 2 s before, 2 and 6 now

## 1.55.0: seamless orb landings, delete workouts

- [x] The orb no longer hits the message box: no squash, wobble, box push or shake. It decelerates to a stop exactly in its place (the landing frames match the resting orb), a soft light spreads through the box, one light haptic. Closing glides it home the same way; the bar takes it with a faint ring instead of a squash-and-settle
- [x] Delete a finished workout from its page: a confirm sheet, then it's gone with an Undo. Records are rebuilt from the remaining history in one transaction, so a record the deleted workout held moves back to whichever workout holds it now

## 1.56.0: polish: titles, pill buttons, record medals

- [x] The Today greeting in two weights: the first word bold, the rest lighter and softer ("**Good** evening.")
- [x] Page titles (and the greeting) arrive word by word, each blurring in and rising a touch, on every page entrance
- [x] Buttons are full pills
- [x] Records wall: every record carries a glossy medal (lavender; gold for one set in the last week), and pressing a tile tilts it towards your finger in 3D with the medal shifting and a shine sliding across; it springs back on release (transform only)

## 1.57.0: thinking orbs, voice glow, border beam (Libraries.dev)

- [x] Ported from the MIT-licensed Libraries.dev sources (github.com/Jakubantalik/Libraries.dev; licence notices kept in each file): no React, no build, only what Setline uses
- [x] Thinking orbs (`js/orbs.js`, `js/ui/thinkorb.js`): the original engine's maths for four states, checked dot-for-dot against the library's golden vectors (`tests/orbs.test.js`). While the Coach really thinks, a 32 px orb sits where the answer will appear and follows the message box's phrase: breathing → searching (reading your log) → working → composing (putting it together), crossfading between them; gone when the first words arrive. Tinted with the theme's light accent; paused off screen and when the app is hidden; one still frame with reduced motion
- [x] Voice glow (`js/ui/voiceglow.js`): the library's seven lobes and three layers (edge stroke with a white core, inner light, bloom), its envelope, frequency bands, flow and processing sweep, `mobile` tuning with a lower reach. Along the bottom of the voice screen and the floating orb; driven by the recorder's own analyser (no second stream), on only while recording or while the words are being worked out, off at once otherwise. Moved by transform/opacity instead of the original's per-frame gradient repaints; Setline's colours; the band line, displacement warp and colour filters left out for cost; the original's adaptive half-rate pacing kept
- [x] Border beam (`js/ui/beam.js`): the `md` type, ocean palette, round Today's card while a workout or run is live (not while a run is paused). The rotating window is a mask on a square turning by transform with the colours counter-rotating inside, so the phone only composites; still off screen, on other tabs and with reduced motion
- [x] Liquid gooey left out: nothing in Setline splits or merges, the dock's one moving indicator already has a transform-only liquid stretch, and a gooey trail would add an SVG blur+contrast pass per frame under the dock's live glass

## 1.57.1: calmer voice and Coach

- Floating orb: the dock steps aside while it's up (nothing left in it), the orb sits low where the dock was, the page dims properly behind it, and the words stack in one column: status just above the orb, your words above that, at most three lines with the newest at the bottom.
- Coach: opening no longer throws a big ring of light; sending moves only the messages on screen (moving the whole thread made the phone redraw it and it went blank for a moment); a finished reply keeps the exact width it was typed at, so it no longer re-wraps and jumps; the thinking orb is drawn at 64 px so it reads.

## 1.58.0: the dotted orb

- The Orb is now a sphere of lit dots turning in 3D (`js/ui/dotorb.js`), in the theme's colours, everywhere: the dock, the message box, the floating orb, the voice screen, onboarding and the interview. All orbs turn together on one clock and one spin, and a handover passes on how swollen or lit it is, so flying up, opening full screen, landing back and flying into the message box are seamless. It breathes at rest, ripples with your voice, a bright meridian sweeps it while it thinks, and it pulses while the Coach speaks. Drawn in colour batches (a few dozen fills a frame), at half rate at rest, rarely while hidden, still with reduced motion.
- The old ball's blurred, screen-blended blobs are gone (the likely cause of the square flicker around the floating orb), and so is its white rim and glint.
- The Coach's thinking orb in the thread is gone: the message box's own orb shows the thinking now. (`js/orbs.js`, `js/ui/thinkorb.js` and their golden test removed.)
- The floating orb sits back up where it was, above the dock's place.
- The voice screen has a solid backdrop instead of blurring the whole page behind it on every frame (the lag opening it full screen).
- Opening the Coach: its bloom of light fades out inside the screen's edges instead of being cut off by them (it showed as a hard-edged square).

## 1.59.0: deep water glass (redesign)

- New look across the app: Geist as the one font, a deep-water base with soft light drifting in the sea behind every screen (in each theme's colours), cards as tinted glass with a rim of light, labels in sentence case instead of small capitals. Ocean becomes mint on deep blue.
- Split bar: the four tabs in one capsule of liquid glass and the orb in its own drop beside it, with real refraction at their edges (`js/lib/liquid-glass.js`, MIT, Deepika Rao; Chromium, plain frost elsewhere). It still collapses to the current tab and the orb on scroll.
- The chosen tab's icon moves: the house pops, the dumbbell lifts, the bowl stirs, the person waves.
- Today: Up next is the hero, with the session's name big, next time's weights as big numbers and a sheen now and then on Start workout.
- Restore point before the redesign: tag `pre-redesign-1.58.0`.

## 1.59.1: calmer and cleaner

- Font back to Manrope (Geist didn't suit it).
- The bar: the liquid-glass refraction is gone (on the phone it dropped the blur); a strong frost with a quiet rim instead, and the chosen tab's lens is a soft, colourless pill that slides without stretching. Tab icons just lift once and settle. (`js/lib/liquid-glass.js` removed.)
- Today is calmer: softer sea light, no sheen on Start workout, smaller headings.
- Opening and closing the Coach: no more burst of light (with the orb at the end of the bar it was cut off in a hard edge); the orb's flight and the background fade carry it. When the orb lands in the message box, the box gives under it and springs back up.
- Talking to the Coach: once the answer starts, the message box stops thinking and says it's speaking (the thinking look used to carry on while it spoke).
- The message box's orb is bigger and doesn't spin or pulse as a whole any more; its dots do the moving: they swell, brighten and ripple in waves with the Coach's voice, react more to yours, and a slow ripple travels round it while it thinks.
- The floating orb sits higher over the page.

## 1.60.0: smooth voice and Coach (perf, one listening screen, chat in place)

Fixes the flashes, lag and half-drawn frames in the voice → Coach recording, in three steps. Nothing was restyled (the screenshots match 1.59.1's).
- Budget: only transform and opacity animate, and only the bar and the message box are frosted (at most 16 px, solid while screens move; cards, sheets, the scrim and the edge strips are solid tints now). The new check found 238 breaks in 1.59.1 (54 of them blurs on other surfaces) and finds 0 now. No standing `will-change`, the sea light and clouds hold still, and Home is hidden (and inert) under the voice sheet and the Coach. `tests/motion-rules.test.js` keeps it that way.
- One animation frame for everything that draws per frame (`js/ui/frame.js`); it stops when nothing draws or the app is hidden. The dotted orb stamps its dots from one pre-drawn sheet (no gradients or shadows per dot), at most 2× pixel density. The voice glow is one still gradient that fades and scales. No comet trails. `?perf=1` shows a frame meter (`?perf=0` hides it).
- One listening screen: holding the dock orb opens the voice sheet at once (the small floating orb is gone). The sheet's background is opaque and fades in over 220 ms, the orb flies up in 420 ms, the chrome rises in after it, and the top bar and controls stay put until it closes. Labels cross-fade in place; heard words appear one by one; "Working it out" only after 0.6 s, then for at least 0.8 s; the rings fade out on release.
- Voice → Coach without Home: the Coach is laid out under the sheet, scrolled to the end; the sheet fades while its orb flies into the message box. Exactly one orb shows at any moment.
- Chat: the thread is patched, never rebuilt; the bubble a reply streams into becomes the final message (same width, no second copy, no blank list); at most one write per frame; it follows the reply only within about 80 px of the end; words fade in (no blur); one placeholder line cross-fades "Thinking…" and "Ask your coach"; the Do it chips fade in without moving the thread.
- New golden flows: voice-to-coach (one orb per frame, Home never shows, the sheet's chrome stays) and chat-stream (message nodes keep their identity, one reply node of unchanged width).

## 1.61.2: Revert to 1.60.0

- The code is exactly 1.60.0 again: the 1.61.0 / 1.61.1 hold-to-talk rework (state machine, frost layer, review sheet, tuning panel) was unstable on the phone and is gone. The version number moved up (not back) so the phone's service worker takes the update. The database is unchanged (schema 4 throughout), so nothing logged is affected. The rework is kept on the branch backup-before-revert-1.60.0.

## 1.62.0: the 1.59.1 design is back (master fix, phase 1)

- Omar chose 1.59.1's design: the floating mini orb over the page, pulling up into the full voice screen, frosted glass and the sea light. The app (index.html, css, js, sw.js, manifest, icons, SPEC.md, PLAN.md, visual baselines) is exactly 1.59.1 again (2e5ef25); the checks added since (golden flows, motion checker, `npm run motion`) are kept. The 1.60 budget test and the voice-to-coach / chat-stream golden flows describe 1.60's design, so they report without failing until phase 2 brings them up to date.
- The database is schema 4 in both, so nothing logged changes. The version moved up so the phone takes the update. What came before is on the branch backup-before-restore-1.59.1.
- Next (phases 2–4): make it fast without changing the look (blur audit, background holds still, one frame loop), fix the voice → Coach and chat flow bugs, then review-before-send and voice-reactive dots.

## 1.62.1: same look, drawn for less (master fix, phase 2)

- Nothing restyled. Numbers, root causes and the blur audit are in docs/PERF.md.
- Hold → release → Coach no longer stalls on the command parser (a faster, bounded word match, warmed
  up while idle) or on the dotted orb forcing a style pass every frame.
- One shared animation frame for everything that draws per frame; `?perf=1` shows a frame meter.
- The voice glow is one canvas (it was ~25 layers); no layer is kept just in case; the sea, clouds and
  the Coach's glow hold still while scrolling, while screens or sheets move and under the voice UI.
- The floating orb's scrim stays up until the voice screen has covered the page (the flash where the
  page showed through at the pull-up).
- `tests/motion-rules.test.js` is blocking again (no layout animation except a documented few), and the
  `voice-to-coach` golden flow follows 1.59.1's flow (floating orb → pull up → voice screen → Coach).

## 1.62.2: voice and Coach flows (master fix, phase 3)

- Asking from the voice screen goes straight into the Coach: it is laid out under the screen (at the end
  of the thread) while that still covers everything, then the screen fades while its orb, the only
  orb, flies into the message box, which gives under it and springs back. Home never shows. Asked over
  the floating orb, the Coach opens with that orb flying straight in (not back into the bar first).
- Tap the orb / Back: the page is gone before the Coach's words come up, and back again only once the
  conversation has gone: never two screens readable at once. (The Android back swipe already skipped
  the app's own animation.)
- The chat is patched in place: one node per message for its whole life, a streamed reply finishes in
  the node it streamed into (no second copy, same width), the thread keeps to the end only within 80 px
  and is at the end before the first paint. At most about ten words blur in at once.
- Talking to the Coach: your bubble appears with shimmering dots the moment you stop and fills in when
  the words arrive. `?perf=1` shows how long hearing and the first words took.
- Labels: "Thinking…" fades out before "Ask your coach" fades in; a gap between the floating orb's
  status and "Pull up for more". "Working it out" only after 0.6 s, then for at least 0.8 s. The
  listening rings fade out on release.
- Golden flows: voice-to-coach (one orb per frame, no Home frame), home-coach, spoken-reply, and
  chat-stream blocking again. `node scripts/snap.mjs` films all three voice/Coach flows.

## 1.62.3: review before sending, and dots that answer your voice (master fix, phase 4)

- Pull up while holding and let go: what you said shows big in the middle (tap it to change it), with
  Send, "Say more" (adds to it) and ✕ to throw it away. Nothing is sent until Send; then it goes to the
  Coach the same way as before. Letting go over the floating orb still sends straight away.
- The mic: it starts at the hold; a cancel always resets; nothing empty is ever sent; if it hasn't
  opened in 4 s it says "Mic didn't start – tap to retry" (and why, in `?perf=1`). Dragging the floating
  orb down lets go of it all.
- The dotted orb answers the voice in eight bands (each with its own quick-rise, slow-fall envelope):
  the lows swell it a little, the middle ripples its surface through a drifting noise field like
  liquid, the highs shimmer at its rim. It breathes at rest, a wave runs round it while it thinks, and
  it moves with the Coach's voice while it speaks. One canvas per orb, pre-drawn sprites, nothing
  allocated per frame. `?orbtest=1` drives it with a voice sample.
- Golden flows voice-gestures (hold → listening within 1 s; hold + release → one send; pull up +
  release → none until Send, then one; drag down → none; tap → the Coach; nothing left over) and
  mic-stuck.

## 1.62.4: the Coach's reply no longer doubles

- Root cause: the hidden lines at the end of a reply (ACTION:, REMEMBER:, CHANGE:) were hidden only once
  "ACT…" / "REM…" / "CHA…" had arrived, so a chunk ending in "\nA" briefly made the reply's last
  paragraph a finished line; when the next chunk hid it again the line count went back, and the
  streamed words were drawn a second time below (blurring in), until the final text redrew the bubble.
  Now a last line that could still become a hidden one waits a chunk, and a finished line is never
  drawn twice. Messages are matched by id only: thinking, streaming, final and chips all in one node.
- The thread no longer jumps when a reply ends: the streaming cursor takes no room in the line (it
  could wrap onto a line of its own that vanished).
- The action chips rise out of the reply on a soft spring (staggered 60 ms) while the thread glides
  up to make room; a chip is pressed on the frame your finger lands, and its check draws in.
- New golden flow reply-real-stream: replies streamed chunk by chunk through a real SSE body (plain,
  ending in a chip, ending in a memory, 200 chunks), checked on every frame. It failed on 1.62.3
  (the reply twice in 41 and 47 frames, 3 jumps).

## 1.62.5: one choreography for Home, the orb, the voice screen and the Coach

- Measured first: `?slowmo=N` (js/ui/slowmo.js) slows the app's own clock and every animation, and
  `node scripts/choreo.mjs` films the four transitions at 6× and checks them at full speed with an
  in-page frame probe (orbs, each screen's content opacity, the message box) and the compositor's
  own frames (luminance). Before: all four failed (early landings, two or no orbs, double exposure,
  dips to 10.8 of ~24).
- One orb flight everywhere (`arcFly`, js/ui/choreo.js): a single stand-in carrying the source's
  dots, on an arc bowing 12 % of the distance, 380–520 ms by distance, cubic-bezier(0.32, 0.72, 0, 1),
  size from source to target, fully opaque, a small squash on landing, both real orbs hidden in
  flight and swapped in the same frame. The old streak/trail flight is gone.
- The message box no longer hops: it recoils in depth from the landing point (0.97, one soft
  overshoot to 1.008, 420 ms) and its light brightens 20 % at impact.
- Home ↔ Coach: the dock pill's glass reshapes into the message box (one clip-path layer) while the
  tabs fade; Home fades out in 80 ms, the Coach rises in over 220 ms; Back is the reverse, and the
  Coach's light leaves with its words, so Home is never hidden under it (that was the dip to black).
- Floating orb → Coach and Send → Coach: your words fly into your message (the message's own node,
  inverted onto them, its glass fading in as it lands); the frost / voice screen give way as the
  Coach comes up; the Coach's bloom rises where the orb and the Send button were, so the screen never
  empties; the orb lands in the box only once it's there; the Thinking row waits ~120 ms after.
- Reduced motion: the same transitions as 150 ms fades, nothing flying.
- Golden flows `move-*` (and `move-*-reduced`) assert these on every frame.

## 1.62.6: no trail on the voice screen's orb either

- The orb flying between the dock and the voice screen (and the floating orb) no longer draws its
  comet trail; the streak code (orbStreak, .orbstreak) is gone. One solid orb on every frame.

## 1.63.0: the orb lives in the bottom-right corner

Omar tried 1.62.6 on the phone: the checks passed, but the transitions felt worse (an empty stretched
bar, the orb crawling across it, a see-through orb over the text, old messages over the voice screen,
words sliding off the edge, a pink fog and a flash). From here, how it looks on the phone is the goal;
the frame checks are only a safety net.
- The message box is the dock grown: one pill of the dock's own glass, as tall as the dock, with its
  orb at the right end in exactly the dock orb's place and size. That spot has three faces, cross-faded
  in 150 ms: the orb (empty field, tap to talk), the send arrow (typing), the stop button (a reply
  streaming in). While a reply is still thinking the orb stays; tapping it stops the reply.
- Home ↔ Coach: the orb never moves. It gives a small press as the finger lifts; the tabs fade in 90 ms
  and the box grows out of the orb leftwards (its glass layer clipped from the orb's circle to the whole
  box, a spring from rest over 320 ms), "Ask your coach" fading in at 70 %. Home fades out in 90 ms, the
  Coach in over 200 ms from 60 ms, rising 10 px, already at its latest message. Back is the reverse;
  Chrome's own back-swipe (`still`) skips it. The Coach is painted in advance, invisibly, while the
  finger is on the orb (on the phone its first paint used to hold the first frame back).
- Voice → Coach (the floating orb let go, or Send): the orb and the controls answer on the same frame;
  the Coach is drawn just after (so the orb's flight and the fades keep moving while it's laid out), and
  every delay counts from the tap. What you said flies into your message as one piece, never wider than
  the screen, shrinking early; its glass grows in under it over the last 40 %; it's the message's own
  node. The orb (with a drop of glass under its dots, so it's solid over anything) flies one curve to the
  box's orb spot, round behind your words, and the box takes it with a small press in depth (no light).
  The frost or the voice screen stays until the Coach comes in, then fades as it arrives; the old
  conversation holds at a third while your words fly across it. Only the one new message ever appears;
  nothing shifts after it lands; the box's spot stays the orb until it has landed.
- Closing the voice screen (✕): the orb flies home (the dock, or the box's spot in the Coach) on the same
  kind of curve while the screen fades (its words drop to a fifth while the backdrop still covers the
  page, then both go: no dark frame, no double exposure).
- Glow: the bloom and the landing flash are gone; the message box has no light of its own; the orb halos
  and the floating orb's glow reach at most ~20 % past the orb's edge.
- Keyboard: on Android the keyboard now lies over the page while the message box is typed in
  (VirtualKeyboard), so the page knows its height as it starts to move: the box glides up with it and the
  conversation's newest messages glide with it, anchored to the bottom (elsewhere, a FLIP of the resize).
  The room under the thread no longer changes when the field is focused.
- Speed: the review text is parsed while it's on screen (Send used to parse it first); the handoff measures
  the page before writing to it; the flying orb's canvas is drawn at 1×.
- Reduced motion: every transition is a 150 ms fade; nothing flies or scales.
- `node scripts/strips.mjs` (new): contact strips from the frames the compositor really showed at full
  speed (0–560 ms), timed from the event; `CHOREO_LONG=1` for a long conversation. The frame checks
  (`scripts/choreo.mjs`, golden `move-*`) now also cover ✕, typing and the keyboard, and check that the
  orb stays put on Home ↔ Coach, never passes over your words, and that exactly one new message appears.

## 1.64.0: Bug pass (mic, voice → Coach, glow, streaming)

From Omar's phone recording of 1.63.0.
- The mic sometimes didn't start (the pill said "Ready"): a second hold landed on the floating orb's frost,
  which covers the dock, so it never reached the orb, and the first hold's late "stop" closed the mic as it
  opened. Presses on the dock orb now go through the frost; a new hold drops any pending stop; opening the
  mic is serialised (one getUserMedia at a time, a cancelled opening closes its stream). The voice state
  machine keeps a trail of its last 40 steps, logged with any error; the "Something went wrong" toast waits
  until the voice UI has closed; an error message never closes a new hold.
- The pull-up shows one orb: the floating orb is hidden the moment its flight to the voice screen starts.
- The floating orb no longer slides sideways as it rises (its x eases without overshoot; only y springs).
- Voice → Coach (release or Send) rebuilt: on the tap's frame your message's node is placed at the end of
  the Coach and the conversation glides up to make room; your words fly straight to it, shrinking smoothly
  the whole way, and hand over to the message as its glass forms (timed together on the compositor). The
  conversation stays dim until they land, so they're never over its text. The orb sets off on the same frame
  (after a short wait when needed) on the shortest curve that keeps clear of the words (planned against their flight) and lands within
  ~380 ms. The tap's own work is a few ms (the orb's path search is plain precomputed arithmetic).
- Glow: the pink bloom rising from the bottom while you talk is gone (voiceglow.js removed); the message
  box's orb pulse is small and soft, within ~20 % of its edge.
- Streaming: the thread no longer jumps as a reply grows: messages glide up by the new line's height, and
  the view follows once per frame only within ~80 px of the end.
- Checks: golden `mic-hold-twice`, `mic-after-reply`, `mic-pullup-starting` (with a slow mic);
  `strips.mjs --cpu=4` (phone pace) and `--long` with the new `stream-reply` flow.


## 1.65.0: Connected glass and compact voice

From Omar's Apple motion references and Setline brief (29 Sep 2026).
- The split dock joins into the composer; the Coach unfolds from it. One reversible progress value coordinates the joined contour, edge highlight, readable content and a single particle orb at the bottom-right anchor. Back can interrupt the opening without restarting or leaving duplicate orbs.
- Holding keeps voice compact at the original thumb target, with a real-level meter. Release opens an editable review; explicit Send delivers once, while Say more appends. Pull up still expands voice. Voice errors remain beside their origin with retry/type actions.
- Pointer cancellation, backgrounding and delayed microphone permission clean up the recording. Late AI classification cannot reopen a cancelled session. Keyboard entry, reduced motion and opaque glass alternatives are supported.
- The expanded voice background clears sooner during Send so controls do not leave a dark gap.
- Conflicting old visual restrictions in CLAUDE.md, SPEC.md and the design guide now defer to this brief. Data, security, working controls and regression checks remain required.
- Validation and real-phone limits: docs/CONNECTED_MOTION.md.


## 1.65.1: Cancel the voice waiting card with its session

- Expanded voice's AI classification card belongs to its voice-session token. Cancelling clears it immediately; a late classification cannot leave a permanent spinner or navigate back to the Coach.
- `scripts/connected-motion.mjs` now delays classification, cancels after the waiting card appears and checks both immediate dismissal and the late response. Motion and data behavior otherwise unchanged.

## 1.65.2: Rollback to 1.59.1

Omar asked for the app exactly as 1.59.1 (2e5ef25). Every app file, test and script is 1.59.1's again;
only the version number is new, so phones update. 1.62.0–1.65.1 are undone. Kept from the latest version:
this history, PLAN.md's version line, CLAUDE.md, AGENTS.md and `.claude/`. The database is untouched
(schema 4 in both; no stored format changed). Backup of 1.65.1: branch `backup-before-rollback-1.59.1`.
