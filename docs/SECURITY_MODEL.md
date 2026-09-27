# Setline security model

Setline has no backend and one user, so the main risks are: a key leaking, the AI doing something it shouldn't, bad data wiping good data, and personal data leaving the phone without Omar knowing. This file says what is protected, where data crosses a boundary, and what a security-sensitive change must answer. Note: the GitHub repository is public, so everything committed is public.

## 1. What we protect

| Asset | Where it lives |
|---|---|
| Groq and Google API keys | `localStorage` (`setline.keys`) via `js/keys.js`, only in that browser |
| Google Drive access token | `localStorage` next to the keys (`driveToken`, about 1 hour), from Google Identity Services (`js/drive.js`), scope `drive.appdata` only |
| Training, food, body data, body photos, Coach memories, chat | IndexedDB `setline` (`js/db.js`, `js/store.js`) |
| Backups | exported JSON files and the hidden Drive app folder, one file per day |
| Voice audio | only in memory while recording; never stored |

## 2. Where data leaves the phone

| Destination | What is sent | How it's authorized |
|---|---|---|
| Groq `api.groq.com` (speech-to-text) | the recording + a short context prompt (exercise names) | `Authorization: Bearer` header (`js/stt.js`) |
| Google Gemini `generativelanguage.googleapis.com` | command text, the compact Coach context, reply text for speech | `x-goog-api-key` header (`js/ai.js`, `js/tts.js`) |
| Google Drive `googleapis.com` | backup JSON (no keys) | OAuth token, `drive.appdata` scope |
| Open Food Facts | barcode numbers and food search words | none |
| GitHub "new issue" page | a bug report Omar opens and submits himself: his text, app version, screen, settings, device, **last voice transcripts**, recent errors | Omar's GitHub session. The repo is public, so submitted issues are public |
| Google Fonts, Google Identity script | normal page requests | none |

Keys go in headers, never in URLs. Any new destination, or new data sent to an existing one, is a class D change and gets a row here.

## 3. Trust boundaries (what we never trust)

- **AI output.** Coach replies can contain `CHANGE:`, `ACTION:` and `REMEMBER:` lines. They are parsed by `js/planedit.js` and `js/appedit.js`, checked against allow-lists (`SETTABLE`, `PAGES`, the plan forms), applied with Undo, and hidden from the reply. `{"do": "…"}` runs text through the same command pipeline as Omar's own words, so it must hit the same confirmations (finish, discard, delete).
- **Imported backups and Drive restores.** Validated by `validateBackup` in `js/backup.js`; a bad file never changes existing data.
- **Anything shown as HTML.** AI text, transcripts, food names, exercise names, imported data: always through `esc()` from `js/ui/dom.js`.
- **Third-party scripts.** Only the Google Identity Services script, loaded for Drive. Adding any other script is class D.

## 4. Known open points

- Bug reports put recent voice transcripts into a public GitHub issue. Omar sees the page before submitting, but a transcript can contain personal details (weight, food, health). Decide: keep, trim, or make transcripts opt-in per report.
- No test yet proves a Coach `{"do": "discard workout"}` stops at a confirmation. Add one (unit test on the command path, or a golden flow with a mocked Gemini reply).
- `innerHTML` is used widely in `js/ui/`. `npm run risk` flags new HTML so each new interpolation gets checked; existing code isn't audited line by line.

## 5. Security gate (answer each line in the report for class D and E)

1. **Keys:** can a key end up in code, a log, an error message, a URL, a backup, a bug report or a screenshot? (`npm run verify` scans for real key shapes.)
2. **AI actions:** can model output now do something new? Is it allow-listed, validated, undoable, and confirmed when destructive?
3. **Data leaving:** what new data leaves the phone, to whom, and does Settings still describe it honestly? Is it the minimum needed?
4. **HTML:** is every new interpolated value escaped?
5. **Storage:** can a failed write, migration or import leave data half-changed? Is there a schema version bump with a migration and a test?
6. **Service worker:** does the new version precache every production module (`tests/app.test.js` checks), and does an update keep the app opening offline (`npm run golden`)?
7. **Mic:** is the stream released on stop and when the page hides, and is the mic only open when the UI shows it?
8. **Dependencies:** did `package-lock.json` change? Why, and is it dev-only?

## 6. Deeper scans

For big class D/E changes or every few months, a full AI scan is worth running on top of this checklist, for example OpenAI's Codex Security CLI (`npx @openai/codex-security scan .`, needs Codex Security access; scans run with your local permissions without asking, so run them in a cloud session or CI, not on a machine holding other secrets). A scan adds findings; it never replaces §5.
