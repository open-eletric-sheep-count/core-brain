# crontab

Scheduled prompts: a list of `{ id, everyMinutes, prompt }` entries, each one fired into a fresh
OpenCode session when its interval is due. It exists on its own so the mechanism can be tested
without memory, dreams or any other feature attached (USER, 2026-11-18).

## Config

`config.json` next to this file:

```json
{
  "enabled": false,
  "tickSeconds": 30,
  "schedulerPrefixes": ["sleep-", "session-", "crontab:"],
  "schedules": [
    { "id": "test-ok", "everyMinutes": 1, "enabled": false,
      "title": "sleep-{timestamp}",
      "prompt": "Answer with the single word OK. Do not use tools." }
  ]
}
```

- **`enabled`** — master switch, **off by default**; a schedule fires only when this and the entry's
  own `enabled` are true.
- **`tickSeconds`** — how often the due check runs (floor 5, default 30). **The config is re-read on
  every tick**, so enabling a schedule works without restarting the host.
- **`everyMinutes`** — interval counted from the last successful run (state file), not from boot.
- **`schedulerPrefixes`** — titles that mark a session as the scheduler's own. They are **excluded
  from the idle measurement**, otherwise a dream session would reset the clock it was triggered by.
- **`title`** — template; `{timestamp}` becomes `YYYYMMDD-HHMM`, so the default name is
  `sleep-20261118-1632`.
- **`prompt`** — the text handed to the session. Placeholders: **`{idleHours}`** (hours since the
  USER's last activity, one decimal) and **`{timestamp}`**.

## State

`~/.local/state/opencode/crontab/state.json` — `{ "<id>": "<ISO instant of the last run>" }`.

## How a run works

1. the timer asks which schedules are due;
2. it lists the sessions to measure idle (the scheduler's own are filtered out);
3. `POST /api/session` (standardised title), then `POST /api/session/<id>/prompt` with the filled text;
4. on success the instant is written to the state file;
5. one run per schedule at a time — a slow session never doubles the next one.

Credentials come from the same `service.json` the Jarvis reads; nothing is hard-coded.

## Test

```bash
node test/schedule.selftest.mjs
```

The rules are pure: interval, titles, idle and placeholders are tested without a timer or a session.
