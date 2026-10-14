#!/usr/bin/env bash
# run-sonar-cover.sh — same SonarQube analysis as run-sonar-scan.sh, plus the
# LCOV coverage report (so the dashboard shows coverage, not 0.0%).
# Config comes from ./.env (see .env.example and README §5).
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "missing .env — copy .env.example to .env and fill SONAR_TOKEN (see README §5)" >&2
  exit 1
fi
# shellcheck disable=SC1091
. ./.env
: "${SONAR_HOST_URL:?set SONAR_HOST_URL in .env}"
: "${SONAR_TOKEN:?set SONAR_TOKEN in .env}"
: "${SONAR_PROJECT_KEY:?set SONAR_PROJECT_KEY in .env}"
LCOV="${SONAR_LCOV_PATHS:-coverage/lcov.info}"

if [ ! -f "$LCOV" ]; then
  echo "coverage report not found at $LCOV" >&2
  echo "generate it first with your test runner (e.g. jest/vitest with coverage)" >&2
  echo "or point SONAR_LCOV_PATHS in .env at the right file" >&2
  exit 1
fi

command -v npx >/dev/null 2>&1 || {
  echo "npx not found — install Node >= 22.12" >&2
  exit 1
}

npx @sonar/scan \
  -Dsonar.host.url="$SONAR_HOST_URL" \
  -Dsonar.token="$SONAR_TOKEN" \
  -Dsonar.projectKey="$SONAR_PROJECT_KEY" \
  -Dsonar.javascript.lcov.reportPaths="$LCOV"

echo "dashboard: $SONAR_HOST_URL/dashboard?id=$SONAR_PROJECT_KEY"
