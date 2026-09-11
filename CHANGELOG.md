# Changelog — oesc/core-brain

All notable changes to this repository are documented here.
Newest on top.

## [0.3.0] — 2026-09-11

### Changed

- Plugin layout is now **single-folder**: each plugin lives entirely at
  `global/opencode/plugins/<name>/` — source, distribution artifact and npm
  package root in one folder; `check.sh` (import smoke check + typecheck)
  replaces the old `build.sh` copy step. Applies to `todo-list` and
  `context-inject`; the former top-level project folders are removed.

### Added

- `global/opencode/plugins/context-inject/` — `@oesc/context-inject` OpenCode
  V2 plugin: injects
  configured files into sessions at the true start (first admitted prompt) and
  after a completed compaction, per agent (`injections.agents.<AGENT>`,
  reserved `ALL` key); stateless semantics derived from the durable session
  log; config via `options.configPath` or `<pluginDir>/config.json`.
  Migrated from the internal `taulukko-inject-context` plugin (renamed;
  site-specific defaults removed: neutral default log path, cleaned identity
  strings, V1 legacy files dropped); npm-ready manifest
  (`@oesc/context-inject`, `publishConfig` public, `files`).
- `global/opencode/agent/` + `global/opencode/helpers/` — the OESC **agent
  team** (ORACLE, ARCHITECT, DEVELOPER, TESTER, DOCUMENTATION_WRITER,
  SECRETARY, the four Brain Storm personas, plus the `_EXTENDED` pointer
  variants) and the flow/subagent helpers, migrated from the internal taulukko
  config; README §4 documents each role.

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
