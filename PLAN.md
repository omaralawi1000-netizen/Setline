# Setline plan

All five phases from SPEC.md section 7 are done. Work now happens as fixes and polish the user asks for. The current version is in `js/version.js` (1.42.0). The release log, including releases that were later undone, is in `docs/HISTORY.md`; read it only when you need the story behind something.

## What's in the app now

**Navigation.** A floating glass dock: Today, Train, the orb in the middle, Food, You. Tapping the orb blooms the Coach open over the whole screen; holding it is hold-to-talk for a voice command. Settings opens from the icon on Today and from You. The status bar is the app's own colour, with a soft blur beneath it when content scrolls under. Pages and sheets animate in; sheets are iOS-style (the page behind shrinks back) and close with a swipe down. The Android back swipe is respected.

**Today.** Greeting and streak, "How do you feel today?" check-in, Up next (follows the weekday plan and one-off day changes, says "· Tomorrow" when relevant), the week strip, week cards (workouts ring, cardio, last session, run, latest record).

**Train.** Start a routine or an empty workout. Active workout: steppers, log set, previous performance, set rows that land with a glow and a "New record" chip, swipe to delete, rest ring with ±15 and skip, auto-advance, auto warm-ups, plate calculator, wake lock, finish with a hero ring and check, "Save as a routine". Routines: editor, starter programs, "Your own program" (pasted text read by the Coach), plans from the Coach. History and progress charts.

**Food.** Meals split into items, food search (Danish database), barcode and photo scan, favourite meals, protein and calorie targets.

**You.** Profile, progress, body (bodyweight, measurements, monthly photos), history, what the Coach remembers, customize (themes: violet, slate, sage, sand, clay, mono), settings (keys, voice, units, backup, Google Drive backup).

**Voice.** Groq Whisper speech-to-text with junk filtering and a Danish re-run; a local English/Danish parser (sets in any order, "set one is done but only nine reps", "same again", "one more rep", …); Gemini fallback for anything else. Spoken replies use Gemini's natural voice by default, with short quota pauses and the phone's own voice as a fallback. The mic never reopens by itself after a reply.

**Coach.** Streaming chat that knows your log, routines, food and the next 7 days. It remembers facts (`REMEMBER:` lines) and changes the plan (`CHANGE:` lines: a day becomes Wrestling or rest, routines move days, exercises are swapped, added or removed), always with Undo. Tapping the orb sends a fine ring of light up to the top of the screen, and closing brings it back down into the orb. While it thinks, light runs round the edge of the message box with a soft glow outside it (no words), and soft clouds move in the background. Reply words blur in and the thread glides down after them; touching the thread stops the follow. The orb reacts to your voice with a halo and ripples; the bloom has haptics.

## Next

Nothing is queued. Ideas the user has raised but not approved:
- A Gemini Live "talk naturally" mode on the orb (two-way voice with interruptions, using the existing Google key).
