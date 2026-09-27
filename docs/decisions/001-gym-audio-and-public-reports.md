# 001: Cleaning speech audio on the phone, and bug reports as public GitHub issues

**Context.** Dictation was poor in a loud gym, and music took long to come back after the orb. Bug reports (1.50) and one-tap reports (1.53) are sent as GitHub issues on this repository, which is public.

**Decision.**
- Each recording is decoded and cleaned on the phone before it goes to Groq (high-pass at 110 Hz, the noise before and after the words cut, level evened out, 16 kHz mono WAV); a silent recording isn't sent. Whisper large-v3 is the default model.
- The shared AudioContext runs only while something records or plays, then is suspended, so Android gives the audio back to other apps.
- Reports stay GitHub issues (no token, no backend), and the report screens say plainly that the repository is public. A report holds the typed note, what the voice heard, what the app did, at most 300 characters of a Coach reply, the version, screen, phone model and recent errors; never keys.

**Why.** Cleaning before sending is the one lever we have on accuracy without a backend. Issues are the only channel the next coding session can read without a server or a stored token.

**Consequences.** Reports are readable by anyone who finds the repository; if that becomes a problem, make the repository private (issues then need a GitHub login, which Omar has) or move reports to a private repo. Audio sent to Groq is now WAV instead of webm/opus (larger upload, same content, same destination).

**Date.** 2026-09-27
