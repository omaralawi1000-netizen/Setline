# Phone check (about 5 minutes)

What the cloud session can't prove. Do the lines the report lists under DEVICE, on the installed app on Omar's phone. When they pass, the release gets its `good-x.y.z` tag.

## Update and install
- [ ] Open the installed app: "Update ready, tap to reload" appears; after the tap, Settings shows the new version.
- [ ] Close the app completely, turn on flight mode, open it: it loads and a workout can be started.

## Voice
- [ ] Hold the orb: the Android mic indicator appears, the orb reacts to your voice.
- [ ] Say "bench press 80 kilo 8 reps": the set is logged correctly. Then "samme igen" (Danish).
- [ ] Let go and stay silent: nothing is logged, and the mic indicator disappears.
- [ ] Lock the phone while the mic is open: the mic indicator disappears.
- [ ] A spoken reply plays in Gemini's voice; with the network off it falls back to the phone's voice.

## Workout
- [ ] Log a set, swipe the app away, reopen: the workout and the rest timer are still right.
- [ ] Rest notification on the lock screen: "Log …" and "+15 s" work without opening the app.
- [ ] Haptics fire on log and on the orb (if haptics are on).

## Coach and data
- [ ] Ask the Coach to change rest to 2 minutes: it changes, and Undo works.
- [ ] Ask the Coach to discard the workout: it asks for confirmation instead of doing it.
- [ ] Google Drive backup (when Drive code changed): back up now, then restore; the data matches.

Found a problem? Report it with "bug: …" in the app, and the fix must add a guard (`AGENTS.md` §4).
