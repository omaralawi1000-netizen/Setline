#!/bin/bash
# Cloud sessions: install the dev tooling (Playwright for scripts/screens.mjs).
# Chromium comes pre-installed in the cloud image, so no browser download.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund
