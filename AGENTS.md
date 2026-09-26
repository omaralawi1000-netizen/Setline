# Setline repository guide for Codex

Setline is a voice-first gym PWA for one user on Android Chrome, hosted as static files on GitHub Pages.

Before substantial work:
1. Read `PLAN.md` for the current product state.
2. Read `SPEC.md` for product and architecture requirements.
3. Preserve working functionality. Do not redesign, rewrite, or add scope unless the user explicitly asks.
4. Use plain HTML/CSS/JavaScript ES modules, relative paths, and the existing architecture.
5. Never write API keys into code, logs, commits, tests, or backups.

For UI or motion work, also follow the design and motion rules in `CLAUDE.md`. Those rules are repository rules, not Claude-specific product decisions.

Before finishing a code change:
- Run `npm test`.
- If UI changed, run the existing screenshot review in `scripts/screens.mjs`.
- If animation changed, run `npm run motion` and compare against the previous motion results.
- Update `PLAN.md` only when the current app state actually changes.
- Add a release note to `docs/HISTORY.md` for a shipped fix/release.
- Keep `js/version.js` and the service-worker version in `sw.js` synchronized.

Prefer the smallest safe fix. Do not refactor working code merely for style or tidiness.
