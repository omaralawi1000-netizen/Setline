# Setline: Claude Code notes

Follow `AGENTS.md`. It's short on purpose; don't read more than the task needs.

- Cloud sessions run `.claude/hooks/session-start.sh`, which installs Playwright for the check scripts.
- For design and animation work, follow `docs/DESIGN_SYSTEM.md`. The `frontend-design` skill is only for a full redesign Omar asks for.
- Keep chat replies short.

## Motion & performance rules
28 Sep 2026: Omar restored the 1.59.1 design (floating orb, pull-up voice screen, frosted glass, sea light). Fix its speed without changing how it looks. Never remove the floating orb mode, the pull-up, or the frosted look to gain speed. If a fix seems to need a visible change, ask Omar first.
- Animate only transform and opacity. Blur values never animate; fade blurred layers with opacity.
- Real backdrop blur only where content visibly moves behind it: the split bar/dock, the Coach message box, the floating orb's scrim over the page, and sheets over the page. Max ~4 blurred layers on screen at once. Everywhere else: a tint matched to what's behind it, so it looks the same.
- Background motion (ambient, clouds, sea) holds still during scrolling, transitions and while any overlay, voice screen or Coach is open.
- Exactly one orb visible at a time; no comet trails. Never cross-fade two full screens.
- Chat: never rebuild the thread with innerHTML; one DOM node per message for its whole life; one DOM write per frame.
- will-change only just before an animation, removed after. Canvases ≤ 2× DPR, never resized in the loop.
