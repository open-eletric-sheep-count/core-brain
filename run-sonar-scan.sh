#!/usr/bin/env bash
# run-sonar-scan.sh — send this checkout for analysis to SonarQube.
# Plain evaluation (no tests, no coverage): same analysis as a manual
# `npx @sonar/scan` run. Needs Node >= 22.12. Config comes from ./.env
# (see .env.example and README §5).
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

command -v npx >/dev/null 2>&1 || {
  echo "npx not found — install Node >= 22.12" >&2
  exit 1
}

npx @sonar/scan \
  -Dsonar.host.url="$SONAR_HOST_URL" \
  -Dsonar.token="$SONAR_TOKEN" \
  -Dsonar.projectKey="$SONAR_PROJECT_KEY"

echo "dashboard: $SONAR_HOST_URL/dashboard?id=$SONAR_PROJECT_KEY"
