# Setline design system

How Setline looks and moves, for every AI and every tool. The brand values (colours, font, themes, surfaces, navigation) are in `SPEC.md` §2; this file is how to work with them. The running app is the visual source of truth.

## Two modes

**POLISH (the default).** The direction is locked. Improve execution only: spacing, alignment, hierarchy, density, legibility, touch feedback, motion curves, loading/empty/error states, consistency between screens. Don't change the navigation model, the orb concept, the brand colours or font, the theme philosophy or the information architecture.

**REDESIGN (only when Omar says so in the session: "redesign", "new look", "new design for …").** Direction may change for the scope Omar named. Before building: tag the current version (`git tag pre-redesign-x.y.z`), show the new direction on one screen, and get Omar's yes before rolling it out. Keep every feature and every `data-act` / `data-k` hook. When he approves the result, update `SPEC.md` §2 and approve new baselines with `npm run visual -- --approve`. The `frontend-design` skill is for this mode only.

## Rules (both modes)

- All motion values come from the motion tokens in `css/tokens.css` (`--m-*` durations, `--e-*` easings). No hardcoded durations or easings anywhere else.
- Animate `transform`, `opacity`, `filter` and `clip-path`. Never animate width, height, top, left, margin or box-shadow directly.
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
