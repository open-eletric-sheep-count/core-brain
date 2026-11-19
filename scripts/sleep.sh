#!/usr/bin/env bash
# sleep.sh — the manual for the dream pass, a setup gate, and the manual trigger.
#
#   ./sleep.sh help                 this text
#   ./sleep.sh setup                a gate over every dream setting, one question at a time
#   ./sleep.sh setup --dry-run      shows what would be written, writes nothing
#   ./sleep.sh status               current config, last dream and how many memories it wrote
#   ./sleep.sh now                  dream everything that is waiting, right now
#   ./sleep.sh now --dry-run        print the session title and the prompt, send nothing
#
# The scheduled path waits for 4 h of idle; `now` is the deliberate override.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_FILE="${OPENCODE_SERVICE_FILE:-$HOME/.local/state/opencode/service.json}"
DATA_ROOT="${CORE_BRAIN_HOME:-$HOME/.config/core-brain}"
CRONTAB_CONFIG="$HOME/.config/opencode/plugins/crontab/config.json"
CORE_CONFIG="$DATA_ROOT/config.json"

read_core() {
  python3 -c "
import json, os, sys
p = os.path.expanduser('$CORE_CONFIG')
try:
    d = json.load(open(p))
except Exception:
    d = {}
print(d.get(sys.argv[1], sys.argv[2]))" "$1" "$2"
}

read_schedule_state() {
  python3 -c "
import json, os
p = os.path.expanduser('$CRONTAB_CONFIG')
try:
    d = json.load(open(p))
except Exception:
    d = {}
rows = [s for s in d.get('schedules', []) if s.get('id') == 'sleep']
if not rows:
    print('off (no sleep entry)')
elif rows[0].get('enabled'):
    print('on, every %s min' % rows[0].get('everyMinutes', '?'))
else:
    print('off')"
}

help() {
  cat <<'EOF'
SLEEP — reads the episodes that never became memories and writes the memories

What it does
  Reads the episodes that never became memories and writes the memories.

When it runs
  - scheduler — every hour, only when the rest reaches the configured idle threshold;
  - triggered by the USER — the idle is ignored and it starts immediately.

Configured now
EOF
  printf '  %-22s %s\n' "dreams per day" "$(read_core dreamPerDay 1)"
  printf '  %-22s %s\n' "idle hours" "$(read_core dreamIdleHours 4)"
  printf '  %-22s %s\n' "episodes per dream" "$(read_core dreamEpisodesPerPass 5)"
  printf '  %-22s %s\n' "schedule" "$(read_schedule_state)"
  cat <<'EOF'

Accepted commands
  sleep.sh now            dream what is waiting, up to the configured episodes per dream
  sleep.sh now --dry-run  show the prompt, send nothing
  sleep.sh status         the current state
  sleep.sh setup          change the settings
  sleep.sh help           this text

Where it is configured
  ~/.config/core-brain/config.json — dreamPerDay · dreamIdleHours · dreamEpisodesPerPass.
  ~/.config/opencode/plugins/crontab/config.json — the schedule.

Where to look
  ~/.config/core-brain/logs/dream.log — START / END / ERROR.

When it is refused
  Unknown episode · already dreamed · more episodes than the config allows · not enough rest
  (a pause, not an error). A refusal writes nothing.
EOF
}

now() {
  local dry=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run) dry=1; shift ;;
      *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
  done

  [ -f "$SERVICE_FILE" ] || { echo "ERROR: service file not found: $SERVICE_FILE" >&2; exit 1; }
  local url password auth title limit prompt session
  url="$(python3 -c "import json;print(json.load(open('$SERVICE_FILE')).get('url',''))")"
  password="$(python3 -c "import json;print(json.load(open('$SERVICE_FILE')).get('password',''))")"
  [ -n "$url" ] && [ -n "$password" ] || { echo "ERROR: service file without url/password" >&2; exit 1; }
  auth="$(python3 -c "import base64;print(base64.b64encode(('opencode:$password').encode()).decode())")"

  title="sleep-$(date +%Y%m%d-%H%M)"
  prompt="Load the skill \`sleep\` with the skill tool and execute it now. MANUAL dream: the idle threshold does not apply — the USER asked for it. Follow the skill exactly: list the episodes waiting, respect dreamEpisodesPerPass from the config, decide what is worth keeping, write the memories in one call (with force:true, a manual run), and close with the numbers."

  echo "session: $title"
  echo "prompt:  $prompt"
  if [ "$dry" -eq 1 ]; then echo "(dry-run: nothing was sent)"; return 0; fi

  session="$(curl -sS -X POST "$url/api/session" \
    -H "Authorization: Basic $auth" -H "Content-Type: application/json" \
    -d "{\"title\":\"$title\"}" \
    | python3 -c "import json,sys;print((json.load(sys.stdin).get('data') or {}).get('id',''))")"
  [ -n "$session" ] || { echo "ERROR: the session could not be created" >&2; exit 1; }

  curl -sS -o /dev/null -w "%{http_code}\n" -X POST "$url/api/session/$session/prompt" \
    -H "Authorization: Basic $auth" -H "Content-Type: application/json" \
    -d "$(python3 -c "import json,sys;print(json.dumps({'text': sys.argv[1]}))" "$prompt")"
  echo "dream requested in session $session"
}

setup() {
  local dry=0
  [ "${1:-}" = "--dry-run" ] && dry=1

  local current_limit current_idle current_pass current_enabled current_every
  current_limit="$(python3 -c "
import json, os
p = os.path.expanduser('$CORE_CONFIG')
try:
    d = json.load(open(p))
except Exception:
    d = {}
print(d.get('dreamPerDay', 1))")"
  current_idle="$(python3 -c "
import json, os
p = os.path.expanduser('$CORE_CONFIG')
try:
    d = json.load(open(p))
except Exception:
    d = {}
print(d.get('dreamIdleHours', 4))")"
  current_pass="$(python3 -c "
import json, os
p = os.path.expanduser('$CORE_CONFIG')
try:
    d = json.load(open(p))
except Exception:
    d = {}
print(d.get('dreamEpisodesPerPass', 5))")"
  current_enabled="$(python3 -c "
import json, os
p = os.path.expanduser('$CRONTAB_CONFIG')
try:
    d = json.load(open(p))
except Exception:
    d = {}
rows = [s for s in d.get('schedules', []) if s.get('id') == 'sleep']
print('y' if rows and rows[0].get('enabled') else 'n')")"
  current_every="$(python3 -c "
import json, os
p = os.path.expanduser('$CRONTAB_CONFIG')
try:
    d = json.load(open(p))
except Exception:
    d = {}
rows = [s for s in d.get('schedules', []) if s.get('id') == 'sleep']
print(rows[0].get('everyMinutes', 60) if rows else 60)")"

  echo "sleep setup — Enter keeps the value in brackets"
  echo

  local limit enabled every
  read -r -p "1) dreams per day [${current_limit}] (0 = never automatic): " limit
  limit="${limit:-$current_limit}"
  [[ "$limit" =~ ^[0-9]+$ ]] || { echo "ERROR: dreams per day must be a whole number" >&2; exit 2; }

  read -r -p "2) hours of rest before a dream [${current_idle}]: " idle
  idle="${idle:-$current_idle}"
  [[ "$idle" =~ ^[0-9]+([.][0-9]+)?$ ]] || { echo "ERROR: hours must be a number (e.g. 4 or 2.5)" >&2; exit 2; }

  read -r -p "3) episodes per dream pass [${current_pass}] (0 = no ceiling): " perpass
  perpass="${perpass:-$current_pass}"
  [[ "$perpass" =~ ^[0-9]+$ ]] || { echo "ERROR: episodes per pass must be a whole number" >&2; exit 2; }

  read -r -p "4) enable the hourly schedule? [${current_enabled}] (y/n): " enabled
  enabled="${enabled:-$current_enabled}"
  case "$enabled" in
    y|Y|yes|s|sim) enabled="y" ;;
    n|N|no|nao) enabled="n" ;;
    *) echo "ERROR: answer y or n" >&2; exit 2 ;;
  esac

  read -r -p "5) minutes between scheduler runs [${current_every}]: " every
  every="${every:-$current_every}"
  [[ "$every" =~ ^[0-9]+$ ]] && [ "$every" -ge 5 ] || { echo "ERROR: minutes must be a whole number >= 5" >&2; exit 2; }

  echo
  echo "will write:"
  echo "  $CORE_CONFIG           dreamPerDay = $limit, dreamIdleHours = $idle, dreamEpisodesPerPass = $perpass"
  if [ "$enabled" = "y" ]; then
    echo "  $CRONTAB_CONFIG   sleep.enabled = true, everyMinutes = $every"
  else
    echo "  $CRONTAB_CONFIG   sleep.enabled = false"
  fi

  if [ "$dry" -eq 1 ]; then echo "(dry-run: nothing was written)"; return 0; fi

  python3 - "$CORE_CONFIG" "$CRONTAB_CONFIG" "$limit" "$enabled" "$every" "$idle" "$perpass" <<'PY'
import json, sys

core_path, crontab_path, limit, enabled, every, idle, perpass = sys.argv[1:8]

core = {}
try:
    core = json.load(open(core_path, encoding="utf-8"))
except Exception:
    pass
core["dreamPerDay"] = int(limit)
core["dreamIdleHours"] = float(idle)
core["dreamEpisodesPerPass"] = int(perpass)
with open(core_path, "w", encoding="utf-8") as handle:
    json.dump(core, handle, ensure_ascii=False, indent=2)
    handle.write("\n")

try:
    crontab = json.load(open(crontab_path, encoding="utf-8"))
except Exception:
    crontab = {"enabled": True, "schedules": []}
crontab.setdefault("schedules", [])
row = next((s for s in crontab["schedules"] if s.get("id") == "sleep"), None)
if row is None:
    row = {
        "id": "sleep",
        "title": "sleep-{timestamp}",
        "prompt": "Load the skill `sleep` with the skill tool and follow it. The machine has been idle for {idleHours} hours. If that is below 4, do nothing and end. Do not touch anything else.",
    }
    crontab["schedules"].append(row)
row["enabled"] = enabled == "y"
row["everyMinutes"] = int(every)
if enabled == "y":
    crontab["enabled"] = True
with open(crontab_path, "w", encoding="utf-8") as handle:
    json.dump(crontab, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
print("written")
PY

  echo
  echo "done. The agent side reads it on the next tick; nothing needs a restart."
}

status() {
  python3 - "$CORE_CONFIG" "$CRONTAB_CONFIG" "$DATA_ROOT" <<'PY'
import json, os, sys

core_path, crontab_path, root = sys.argv[1:4]

def load(path, fallback):
    try:
        return json.load(open(path, encoding="utf-8"))
    except Exception:
        return fallback

core = load(core_path, {})
crontab = load(crontab_path, {})
rows = [s for s in crontab.get("schedules", []) if s.get("id") == "sleep"]
schedule = rows[0] if rows else {}

spaces = []
candidates = [("global", os.path.join(root, "global", "dreams.json"))]
agents_dir = os.path.join(root, "agents")
if os.path.isdir(agents_dir):
    for name in sorted(os.listdir(agents_dir)):
        candidates.append((f"agent:{name}", os.path.join(agents_dir, name, "dreams.json")))
for label, path in candidates:
    dreams = load(path, [])
    if dreams:
        spaces.append((label, path, dreams))

print("SLEEP STATUS")
print(
    "  config      "
    f"dreams per day {core.get('dreamPerDay', 1)} · "
    f"idle hours {core.get('dreamIdleHours', 4)} · "
    f"episodes per dream {core.get('dreamEpisodesPerPass', 5)}"
)
if schedule:
    every = schedule.get("everyMinutes", "?")
    if schedule.get("enabled"):
        print(f"  schedule    ON — the scheduler calls the skill every {every} min")
    else:
        print(f"  schedule    OFF — nothing automatic; if switched on it would call the skill every {every} min")
else:
    print("  schedule    no 'sleep' entry in the crontab config — nothing automatic")

if not spaces:
    print("  last dream  none yet")
else:
    label, path_used, dreams = max(spaces, key=lambda row: max(str(d.get("at", "")) for d in row[2]))
    last = max(dreams, key=lambda d: str(d.get("at", "")))
    created = len(last.get("memories") or [])
    reinforced = len(last.get("reinforced") or [])
    print(f"  last dream  {last.get('id')} · {last.get('at')} · {label}")
    print(f"              episodes = {len(last.get('episodes') or [])} · memories created = {created} · reinforced = {reinforced}")
    episodes_path = os.path.join(os.path.dirname(path_used), "episodes.json")
    episodes = load(episodes_path, [])
    waiting = [e for e in episodes if "dreamedAt" not in e]
    print(f"  episodes    waiting = {len(waiting)} of {len(episodes)} in {label}")

print(f"  log         {os.path.join(root, 'logs', 'dream.log')}")
PY
}

case "${1:-help}" in
  help|-h|--help) help ;;
  now) shift; now "$@" ;;
  setup) shift; setup "$@" ;;
  status) shift; status "$@" ;;
  *) echo "unknown command: $1 (try: ./sleep.sh help)" >&2; exit 2 ;;
esac
