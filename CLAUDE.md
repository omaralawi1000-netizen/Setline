# Setline

Voice-first gym web app (PWA) for one user on Android Chrome. Hosted as static files on GitHub Pages.

Before any work, read `PLAN.md` (what's in the app now) and `SPEC.md` (the rules it's built to). `docs/HISTORY.md` is the old release log, including undone releases; read it only when you need the story behind something.

## Rules
- Work only on the specific fix or feature the user asks for.
- Plain HTML/CSS/JS ES modules. No frameworks, no npm dependencies, relative paths only.
- The running app is the visual source of truth; keep new UI consistent with it.
- Never write API keys anywhere in the repo, logs or chat.
- Bump the service worker cache version on every release.
- At the end of a phase or fix: run `node --test`, update PLAN.md ("What's in the app now") and add the release to docs/HISTORY.md, commit, push, then reply with a short summary and a phone test checklist.
- Keep chat replies short. Don't paste whole files into chat.
- If something is blocked, stop and explain. Don't invent workarounds or extra features.

## Design & motion rules (non-negotiable)
- Design direction in SPEC.md is LOCKED. Improve execution, never replace the direction.
- All motion values come from the motion tokens in css/tokens.css (--m-*, --e-*). No hardcoded durations or easings anywhere else.
- Animate ONLY transform and opacity (filter/backdrop-filter sparingly). Never animate width, height, top, left, margin or box-shadow directly.
- Every animation needs a prefers-reduced-motion fallback.
- Screen changes use the View Transitions API with a fallback for unsupported browsers.
- Nothing in the UI unless it works. No placeholder buttons.
- After any UI change: run node scripts/screens.mjs, look at the screenshots, check them against SPEC.md, and fix issues before reporting done.
- Work one screen at a time. Never refactor working logic just to restyle it.
- After changing any animation: run npm run motion, look at the contact sheets in motion/sheets/ and compare with motion/previous/. Fix anything that got worse (more layouts, lower fps, broken frames). The absolute PASS/FAIL marks can't be met on the cloud machine (no GPU, so even good versions fail), so judge by comparison, not by the marks.
