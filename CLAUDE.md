# Setline: Claude Code notes

Read `AGENTS.md` first: it is the workflow for every AI on this repo, and it points to `SPEC.md`, `PLAN.md`, `docs/DESIGN_SYSTEM.md` and `docs/SECURITY_MODEL.md`. Nothing product-related lives in this file.

Claude-specific:
- Cloud sessions run `.claude/hooks/session-start.sh`, which installs Playwright for the check scripts (Chromium is pre-installed in the cloud image).
- The `frontend-design` skill is for REDESIGN mode only (see `docs/DESIGN_SYSTEM.md`). For polish, follow the design system.
- Superpowers, if installed, is for class C, D and E tasks only (`AGENTS.md` §2).
- Keep chat replies short. End code tasks with the report in `AGENTS.md` §5.
