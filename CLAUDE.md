# Setline

Voice-first gym web app (PWA) for one user on Android Chrome. Hosted as static files on GitHub Pages.

Before any work, read `SPEC.md` (what to build) and `PLAN.md` (where we are). If `PLAN.md` doesn't exist, create it from SPEC.md section 7 first.

## Rules
- Work only on the current phase in PLAN.md, or on the specific fix the user asks for.
- Plain HTML/CSS/JS ES modules. No frameworks, no npm dependencies, relative paths only.
- `design-target.html` is the visual source of truth. Match it.
- Never write API keys anywhere in the repo, logs or chat.
- Bump the service worker cache version on every release.
- At the end of a phase or fix: run `node --test`, update PLAN.md, commit, push, then reply with a short summary and a phone test checklist.
- Keep chat replies short. Don't paste whole files into chat.
- If something is blocked, stop and explain. Don't invent workarounds or extra features.
