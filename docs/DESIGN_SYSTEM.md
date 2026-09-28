# Setline design system

How Setline looks and moves, for every AI and every tool. The brand values (colours, font, themes, surfaces, navigation) are in `SPEC.md` §2; this file is how to work with them. The running app is the visual source of truth.

## Direction

Omar wants Setline as beautiful and premium as it can be. Any screen may be redesigned: layout, hierarchy, colour, type, surfaces, motion, even the orb's look. Show a big change on one screen first, tag the version before a wide rollout (`git tag pre-redesign-x.y.z`), keep every feature and every `data-act` / `data-k` hook, and update `SPEC.md` §2 and the `npm run visual` baselines when the result is approved. Use the `impeccable`, `emil-design-eng` and `frontend-design` skills.

## Rules

- All motion values come from the motion tokens in `css/tokens.css` (`--m-*` durations, `--e-*` easings). No hardcoded durations or easings anywhere else.
- Never animate layout (width, height, top, left, margin, padding). Everything else may animate; if it stutters on the phone, shrink the effect rather than drop it.
- Every animation has a `prefers-reduced-motion` fallback and respects the in-app motion setting. Decorative motion never delays a state update.
- Screen changes use the View Transitions API with a fallback.
- Tabular numerals for every number.
- Nothing in the UI unless it works.
- Work one screen at a time. Never refactor working logic just to restyle it.

## Proving a UI change

1. `npm run visual`: compares the main screens (fixed clock, seed data, reduced motion) with `visual/baseline/`. Every CHANGED picture must be intended and explained in the report; `visual/diff/` shows where it moved.
2. `node scripts/screens.mjs`: full screenshot tour (onboarding, rest timer, voice screen) in `screenshots/`. Look at the pictures, check them against SPEC.md §2, fix issues before reporting.
3. Motion changed: `npm run motion`, compare `motion/sheets/` with `motion/previous/`. Fix anything that got worse (more layout work, lower fps, broken frames). The cloud machine has no GPU, so judge by comparison, not by the absolute marks.
4. Approve new baselines (`npm run visual -- --approve`) when the change is the one Omar asked for. Never approve to hide an unintended change.
