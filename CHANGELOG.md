# Changelog — oesc/core-brain

All notable changes to this repository are documented here.
Newest on top.

## [0.2.1] — 2026-09-11

### Changed

- Guidance (tool description + injected how-to): before adding an item, check
  the existing list for a fitting **parent** and nest sub-steps
  (`after: <parent id>` + `depth: <parent depth + 1>`) instead of defaulting
  everything to the root.

## [0.2.0] — 2026-09-11

### Changed

- `todo-list` 0.2.0 — structured list: items carry an optional `depth`
  (0 = root). The hierarchical numbering (`1)`, `1.1)`) is **derived from
  order + depth** at display time (tool dump + sidebar panel) — never stored
  and never written by the agent; legacy text prefixes are stripped on input
  and display. `add` accepts `after: <id>` to insert right after an item;
  level jumps are clamped and reported (`issues`). Spec updated (Q8, §5.2,
  §6).

## [0.1.0] — 2026-09-11

### Added

- `todo-list/` — `@oesc/todo-list` OpenCode V2 plugin (contract:
  `todo-list/todo-list-spec.md`):
  - Server entry (`src/index.ts`): single `todo` tool (ops `read` / `write` /
    `add` / `update` / `remove` / `clear`; stable integer ids; statuses
    `pending` / `in_progress` / `completed` / `cancelled`; priorities
    `high` / `medium` / `low`) and a prompt hook that injects **at most one
    line per round**, only when the session's list is non-empty.
  - TUI entry (`src/tui.tsx`): live sidebar panel
    (`append: "sidebar.content"`, below the MCP block) with glyphs
    `[ ]` `[~]` `[x]` `[!]` and strikethrough for `completed` / `cancelled`
    items; hidden when the list is empty.
  - Storage: per-session JSON at `~/.local/share/opencode-todo/<sessionID>.json`
    with atomic writes (tmp + rename). OpenCode's DB is never touched.
  - Tooling: `build.sh` (import smoke check + optional typecheck + copy into
    `global/opencode/plugins/todo-list/`), `README.md`.
- `global/opencode/install-global.sh` — mirrors `global/opencode/.` into
  `~/.config/opencode/` (same interface as the taulukko installer:
  `-s` / `-d`; aborts when the source is missing).
- `global/opencode/install-vars.sh` — writes `OESC_CORE_BRAIN_HOME` into the
  user environment (`/etc/environment` when writable, plus a marker block in
  `~/.bashrc`; idempotent re-runs).

### Integration (host repo: taulukko/project-generator)

- `global/opencode/opencode.json`: `todo` permission — global deny + ORACLE
  allow (same pattern as `journal-log`).
- `src/install-global.sh`: calls this repository's installer when
  `OESC_CORE_BRAIN_HOME` is set (spec §10 wiring).
