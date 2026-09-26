# Setline: build spec

Voice-first strength-training app for one user, used on an Android phone in Chrome and installed to the home screen. You lift, you say it, it's saved. There's also a coach you can talk to.

Quality bar: it should feel like a premium native app, fast, fluid, beautiful and reliable. Every control that's shown must work. Unfinished features are not shown at all.

Priority order when trading off: correctness, then the core workout loop, then reliability, then UX polish, then extra features.

This file replaces every earlier spec and amendment.

---

## 1. Hard constraints

- **Stack:** plain HTML, CSS and JavaScript ES modules. No framework, no bundler, no npm dependencies in the app. It must run by serving the repo root as static files (GitHub Pages at `/<repo>/`), so use relative paths everywhere.
- **Target:** latest Chrome on Android. It must also work in desktop Chrome for development.
- **No backend.** The user types API keys into Settings, and they are stored only in that browser (localStorage). Keys never go into code, commits, logs, error messages or backups.
- **PWA:** `manifest.webmanifest` (name "Setline", display standalone, theme and background `#0D0F15`, PNG icons 192 and 512 plus a maskable icon) and `sw.js` caching the app shell so it opens offline. Bump the cache version on every release and show "Update ready, tap to reload" when a new version is waiting.
- **Tests:** `node --test` with zero dependencies, covering pure logic (parser, set rules, units, PR and 1RM math, backup validation). Keep logic modules free of DOM code so they can be tested.
- **Suggested layout** (adapt sensibly): `index.html`, `manifest.webmanifest`, `sw.js`, `icons/`, `css/tokens.css`, `css/app.css`, `js/` (app, store, db, workout, parser, voice, stt, tts, ai, coach, i18n, ui/…), `data/exercises.js`, `tests/`, `PLAN.md`.

## 2. Design

- **Reference:** the running app is the visual source of truth (the old `design-target.html` mockup was retired once the app outgrew it). `node scripts/screens.mjs` takes screenshots of every main screen into `screenshots/` to check against. Improve execution; don't replace the direction below.
- **Brand:** background `#0D0F15`, card `#191C25`, ink `#F1F0F6`, muted `#9293A6`, accent lavender `#C6BBFA`, violet `#7A67F2`, blue `#5B86FF`, warm `#FFD9A8` (PRs only), hairline `rgba(207,199,255,.09)`. Quiet accent themes (violet, slate, sage, sand, clay, mono) in Customize. Font Manrope with a system fallback. Tabular numerals for all numbers. Tokens live in `css/tokens.css`.
- **Surfaces:** backdrop blur only on the dock, sheets, the Coach and one hero card per screen. Everything else uses translucent fill, hairline border and soft shadow.
- **Motion:** transform and opacity only, timings and easings from the motion tokens in `css/tokens.css`, 60 fps on a mid-range phone. Respect `prefers-reduced-motion` and the in-app motion setting. Decorative motion never delays state updates.
- **Haptics:** `navigator.vibrate` patterns in `js/haptics.js`, behind a setting.
- **Navigation:** floating glass dock with Today, Train, the Orb (center), Food and You. Tapping the Orb blooms the Coach open over the whole screen; holding it is hold-to-talk. Settings opens from the icon on Today and from You. While a workout is active, a mini bar shows elapsed time and the current exercise.

## 3. Data

- **Storage:** IndexedDB through a small hand-written wrapper, with stores for exercises, workouts, routines, prs, bodyweight, chat and ttsCache. The active workout is its own record, written on every change so a killed tab loses nothing. Keep a schema version and migrations.
- **Units:** store kg. Display kg by default, lb optional, converted only when shown or entered.
- **Time:** store timestamps (`startedAt`, `restStartedAt`, `restEndsAt`) and derive remaining time on render and on resume. Never keep a timer only as an in-memory countdown.
- **Set:** `{id, type: normal|warmup|drop|failure, kg, reps, rir|null, note, done, completedAt}`. Only normal sets are editable in the UI for now; the other fields exist for later.
- **Set rules:** a set is planned or done. Logging fills the first planned set of that exercise, otherwise appends a new one. Rest starts only when a set is logged. "Correct" edits the last done set.
- **Limits:** kg 0-1500 with confirmation above 500. Reps 1-300 with confirmation above 100, and 0 is rejected. Max 100 sets per exercise and 60 exercises per workout. Bodyweight 20-400 kg, one entry per date.
- **PRs:** heaviest weight, best estimated 1RM (Epley `kg × (1 + reps/30)`, reps 1 means 1RM equals kg) and most reps at a given weight. Stored with workout, set and date. Warm-up sets never count.
- **Catalog:** about 60 real exercises, each with English and Danish names, aliases (bænkpres, dødløft, militærpres, knæbøj/squat, roning, pull-ups/pullups, …), muscle group and equipment. Custom exercises allowed. No padding with duplicates.
- **Starter data:** a real, editable Push Day routine. Dev-only seed data behind `?seed=1`, never shown otherwise.
- **Wake lock** (`navigator.wakeLock`) during an active workout, re-acquired on `visibilitychange`, released on finish or discard.
- **Backup:** export and import JSON, never including keys. Validate everything; a bad file never changes existing data.

## 4. Voice pipeline (the heart of the app)

The goal is a Wispr Flow feel: hold, speak, release, and the result shows in about a second on 4G.

1. **Capture:** hold-to-talk on the Orb by default, with tap-to-toggle as a setting. Use `getUserMedia` and `MediaRecorder` (webm/opus, mono) with a 30 s max. The mic is visibly open and its stream is released on stop and whenever the page hides. Show a live level meter (Web Audio analyser) driving the Orb ripples. Unlock the `AudioContext` on the first gesture.
2. **Speech-to-text:** Groq `POST https://api.groq.com/openai/v1/audio/transcriptions`, model `whisper-large-v3-turbo` (setting: `whisper-large-v3` for accuracy), `temperature` 0, `language` from settings (auto, da or en). Always pass a short `prompt` for context: the current exercise, recently used exercise names in both languages, and a sample like "Bænkpres 82,5 kilo 8 gentagelser. Bench press 80 kg for 8." Timeout 6 s with one retry.
3. **Route:** the transcript goes to the local parser first. High confidence becomes an intent immediately. Anything else goes to the AI fallback (section 5). Questions go to the Coach.
4. **Confirm:** every command shows an intent card with what was understood. Low-risk commands auto-commit after about 1.5 s with Undo. Finish, discard and delete always need explicit confirmation. Ambiguous or implausible input asks instead of guessing, with tappable chips when two exercises match closely.
5. **Reply:** a short spoken confirmation per the setting (off, minimal, full), always also shown as text. Never speak while the mic is open; starting a recording stops any speech.
6. **Type instead:** a text box that feeds the same pipeline from step 3, for noisy gyms and testing.

**Parser** (`js/parser.js`, pure, English and Danish):
- Numbers as digits with `.` or `,` decimals ("82,5"), English and Danish number words including Danish compounds (femogtyve 25, tres 60, halvfjerds 70, firs 80, halvfems 90, "to og firs" 82), "komma fem", "and a half"/"og en halv".
- Shapes: "80 kilo 8 gentagelser", "80 for 8", "3 x 8", "3 sæt af 8". Recognizers mishear "for" as "4" ("80 4 8"), so handle it when context is clear. Danish "to" (2) vs English "to" must be resolved by context and covered by tests.
- Units: kg, kilo, kilos, kilogram, lb, lbs, pounds, pund.
- Intents: LogSet, RepeatLast ("same again", "samme igen"), AdjustLast ("add 2.5", "læg 2,5 til", "one more rep", "en rep mere"), EditLast, DeleteLast, Undo, NextExercise, PrevExercise, AddExercise, SwapExercise, StartRoutine, StartEmpty, Finish, Discard, StartRest, AdjustRest, SkipRest, Query (last time, PR, sets left, rest left), Cancel, Help.
- Context: "10 reps" keeps the last weight. Never infer missing values without enough context.
- Fuzzy exercise matching using aliases, normalized spelling, edit distance and the user's usage frequency.
- At least 60 meaningful tests split across English and Danish, including real mishearings.

**Text-to-speech** (`js/tts.js`): Gemini API `generateContent` with `responseModalities: ["AUDIO"]` and a prebuilt voice from settings. Default is the natural Flash TTS model (Flash-Lite TTS and the phone's own voice are options), auto-selected from the model list; a quota error only pauses Gemini briefly. The response is base64 16-bit PCM, 24 kHz mono; play it through Web Audio. Style: brief, calm and upbeat, like a training partner. Cache audio in IndexedDB keyed by text plus voice so repeated phrases ("Rest, 90 seconds") play instantly. If there's no key or it fails, fall back to `speechSynthesis` with a da-DK or en voice, and never block the UI.

## 5. AI brain and Coach

- **Model selection:** call `GET https://generativelanguage.googleapis.com/v1beta/models` on key test and pick the newest stable matches: a Flash-Lite text model for command fallback, a Flash text model (not lite, tts, image or live) for the Coach, a Flash-Lite TTS model for speech. Show the chosen ids in Settings with an override.
- **Command fallback:** send the transcript and small context (current workout, current exercise, last sets, catalog names) to Flash-Lite with JSON schema output (`responseMimeType: application/json` and a response schema). The response is either intents matching the parser's intent shape or `{type: "question"}`. Validate strictly and reject anything invalid. Timeout 4 s, then "Didn't catch that" with Retry and Edit. Local commands are never blocked by an AI request in flight. If the state changed meanwhile, show the result as a suggestion to confirm.
- **Coach:** opened from the Orb; a chat thread with a text box and a small orb for dictation. Questions asked through the Orb also land here, so the thread is the full conversation. Stream answers (`streamGenerateContent?alt=sse`) and speak them when complete, per the spoken-reply setting.
- **Coach context:** a compact summary built locally, not raw history: the current workout; per exercise the best set, e1RM trend and last three sessions; weekly volume for 8 weeks; routines; bodyweight trend; the last ~12 chat turns. Keep it under about 6k tokens.
- **Coach system prompt:** experienced strength coach; answers in the user's language; voice-friendly, three sentences or fewer unless asked for detail; uses only the provided data and says so when data is missing; for pain or injury, gives general guidance and suggests seeing a professional.
- **Privacy:** only the text needed for a request leaves the phone. No audio is stored. Settings says which provider receives what.

## 6. Settings

App language (auto, Dansk, English), voice input language (auto, da, en), units, default rest (30-300 s, default 90), spoken replies (off, minimal, full), voice with a preview button, mic mode, haptics, motion, Groq and Google keys (masked, each with a Test button and a link to where to get one), advanced model ids, backup export/import, reset all data (confirmed twice).

## 7. Phases (all done)

The five build phases (foundation, voice, AI and Coach, routines and plans, progress and extras) are finished; their details are in `docs/HISTORY.md`. Work now is fixes and polish on request: build it, run `node --test`, update `PLAN.md`, commit and push, then reply with what changed and a short phone test checklist.

## 8. Definition of done

Hands-free after tapping Start: "Start push day", "80 kilo 8 gentagelser", "samme igen", "læg 2,5 til", "one more rep", "skip rest", "next exercise", "what did I do last time?", then "finish workout" with a confirmation. The workout appears in History with correct volume and PRs. Asking the Coach "how's my bench progressing?" gives a correct spoken answer based on real data. Closing the app mid-workout loses nothing. With the mic denied, the whole workout can be done by touch.

## 9. Don'ts

No frameworks or npm dependencies in the app. No keys in the repo. No fake data in production. No dead buttons or placeholder screens. No features beyond this spec without asking. Don't restructure working code without a concrete reason. If a requirement is blocked (for example a provider refuses calls from the browser), stop and explain rather than inventing a workaround.
