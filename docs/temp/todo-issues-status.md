# Official V2 todo — known state (no new verification)

Date: 2026-09-29. Methodology: 3 (ORACLE does it all).

## What is already established in the local repo
- OpenCode V2 has no native todo tool. V2 catalog: read, write, shell, edit, etc. No `todo` action, no `/api/todo` endpoint.
- V1 had: `todowrite` (148 hits in the V1 binary) + `todoread`, plus `GET /session/{id}/todo` and the `todo.updated` event.
- V2 still has the legacy `todo` table in the DB, with no current writer — untouched by the plugin.
- The issue cited in the spec: opened on 2026-08-13 with the approximate title "runtime: todowrite/todoread TODO tools missing in V2, model cannot update its todo list" — closed as **not planned**.
- Source: `global/opencode/plugins/todo-list/todo-list-spec.md` (§ context, Q1–Q15) in `oesc/core-brain`.
- The existing global block (`global deny + ORACLE allow` for `action: todo`) belongs to the `@oesc/todo-list` plugin (the one Gand built), not the official one. Current scope: ORACLE only.

## What is still pending (not verified in this attempt)
- A new search in the official channel's issues to confirm whether the "not planned" decision still stands or whether they reopened/are discussing something new.
- The delegation to SECRETARY (session ses_f10dfc6fcffeaAPsqg5cRXWL3z) came back `cancelled` — the child may have kept running. The ledger/report verification was blocked by a wedged shell call (302s, 300s limit, run interrupted).
- Next step once unblocked: check `launch-ledger.sh` with `timeout 20`, look for a recent SECRETARY artifact on disk, and only then re-dispatch in background if nothing was produced. Do not resend blindly.

## Honest answer to Gand
Without the new search, the situation remains as in the spec: the official tool is absent in V2 by the maintainers' decision (not planned), and the local plugin is the only functional `todo`. Nothing indicates a change until the official channel verification is done.
