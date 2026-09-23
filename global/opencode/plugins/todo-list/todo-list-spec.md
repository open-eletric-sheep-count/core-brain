# SPEC — Todo List plugin for OpenCode V2 (`@oesc/todo-list`)

- Status: **DRAFT** — grill closed 2026-09-10 (Q1–Q15 resolved); ready for spike + implementation
- Date: 2026-09-10
- Project: `oesc/core-brain` (open source). Closed project `taulukko/project-generator` is the migration source.
- Authors: USER (PO) + ORACLE

This spec exists so the decisions taken during the grill session of 2026-09-10
survive context loss. It is the contract for the implementation.

---

## 1. Goal

Give OpenCode **V2** a real todo list that the assistant can maintain and the
user can watch:

1. A **model-facing tool** (`todo`) with genuine incremental updates — add,
   remove, mark done / in-progress / cancelled.
2. A **live panel in the TUI sidebar**, below the existing MCP block, showing
   the list (cancelled/completed items struck through).
3. **No printing** of the todo into the conversation anymore.

## 2. Hard constraints (non-negotiable)

1. **Never modify OpenCode's own code, binary or database.** Plugin-only.
   Persistence is ours (plugin storage or our own JSON/SQLite).
2. **`AGENTS.md` stays lean (SRP)** — it is re-injected every session, so it
   must not carry plugin contracts. The plugin's usage contract is injected
   **separately** via the `context-inject` plugin.
3. **Only the ORACLE operator** uses the list. Enforced by permissions
   (global deny + ORACLE allow), not by trusting the model.
4. **One list per session** (keyed by `sessionID`), not per project.
5. Plugin lives **outside** the taulukko repo, in `oesc/core-brain`.

## 3. Background / evidence

Verified 2026-09-10 (see `../../docs/`… note: findings memo was first written at
`project-generator/docs/temp/todo-tool-v2-findings.md`):

- **OpenCode V2 has no todo tool.** Tool catalog: read, write, shell, edit,
  patch, glob, grep, question, skill, subagent, webfetch, websearch. No
  `/api/todo` endpoint. No `todo` permission action.
- **V1 had it**: `todowrite` (148 string hits in the V1 binary) + `todoread`,
  plus `GET /session/{id}/todo` and the `todo.updated` plugin event.
- **Official answer:** `anomalyco/opencode` issue **#42421**
  ("runtime: todowrite/todoread TODO tools missing in V2, model cannot update
  its todo list", opened 2026-08-13) — **closed as not planned**.
  → The tool was **removed**, not renamed.
- V1 `todowrite` semantics were **replace-full-list** (no true update). Hence
  this plugin implements incremental operations beyond V1.
- V2 DB still has a legacy `todo` table (no current writer) — untouched by us.
- **V2 plugin API** (docs `https://opencode.ai/v2/docs/build/plugins` and
  `/build/plugins/cli`): a plugin has a server entry (`index.ts`) and an
  optional TUI entry (`tui.ts`/`tui.tsx`). CLI plugins expose:
  `context.ui.slot` (slots: `app`, `home.footer`, `prompt.footer`,
  `prompt.footer.status`, `prompt.footer.file`, `session.composer.top`,
  **`sidebar.content`**, `sidebar.footer`), `context.ui.panel`
  (`session.panel` contributions), `context.keymap`, `context.theme`,
  `context.renderer`, `context.storage`, `context.data.*`, `context.client`,
  `context.data.on(...)`.
- **Local precedent (proven on this machine):** the loader validates only the
  module shape; a **plain-object default export** `{ id, setup(ctx) }` with
  **no runtime import** of the plugin package is what works (used by
  `graphify`, `opencode-anti-loop`, `context-inject`).

## 4. Decisions taken (grill 2026-09-10)

| # | Decision | Value |
| --- | --- | --- |
| Q1 | Approach | Plugin with a **tool** + a **TUI panel** (no more printing) |
| Q2 | UI placement | TUI sidebar, **below the MCP block** → `append: "sidebar.content"`; exact ordering is an **empirical validation item** (fallback: `sidebar.footer`) |
| Q3 | Storage | **Our own JSON**, atomic write (`tmp` + rename). OC DB untouched |
| Q4 | Tool surface | **Single tool `todo`** with an `op` field (context economy) |
| Q5 | Data model | **Stable, never-reused numeric ids**; ops `write/add/update/remove/read` (+ complete clear); statuses `pending`/`in_progress`/`completed`/`cancelled` |
| Q6 | Injection | **Minimum**: at most **one reminder line**, only when the list **exists and is non-empty**, delivered as **system context** (`ctx.session.hook("context")` → `event.system`) — **never** by editing the USER's prompt text (0.2.2; that edit became the canonical user input and glued the reminder to the USER's own words). The API usage contract is injected via `context-inject`, not per message. API supports **complete removal** |
| Q7 | Ownership | **Only the ORACLE** operates the list; **one list per session** (by `sessionID`), not per project |
| Q7b | Maintenance | New skill **`cleanup-todo-list`** — dry-run by default; deletes only *our* todo files whose session no longer exists (reads the session list from the V2 API) |
| Q8 | Shape | **0.2 (2026-09-11), supersedes the original "flat list, enumeration in the text":** items carry an optional **`depth`** (0 = root, children +1); the hierarchical numbering `1)`, `1.1)`, `1.2)` is **derived** from order + depth at display time (tool dump + panel) — never stored, never written by the agent; legacy text prefixes are stripped on input and display. `add` accepts **`after: <id>`** to insert right after an item; level jumps are clamped and reported as issues |
| Q9 | AGENTS.md | The whole `## Todo tracking (fixed standard)` section is **removed**. Nothing about the plugin goes in AGENTS.md |
| Q9b | Plugin identity | `@oesc/todo-list`, folder `global/opencode/plugins/todo-list` (this repo), in **TypeScript** |
| Q10 | Module shape | **(b)** plain-object default export + **local structural types**, **zero runtime dependencies** |
| Q11 | Source vs distribution | **Single-folder**: the plugin lives entirely at **`global/opencode/plugins/todo-list/`** — source, distribution artifact and npm package root in one folder (one `package.json`; `main`/`exports` → `./index.ts`, `./tui` → `./tui.tsx`). **`check.sh`** validates in place (import smoke check + typecheck; no copy step). `install-global.sh` ships the tree → plugin is **auto-discovered** (no path in `opencode.json`). **In-place TS, no bundling** (the loader loads TS in place — local precedent); **no `@opentui/*` peers** — the host bundles OpenTUI and supplies it to the TUI entry |

## 5. Architecture (proposed)

```
core-brain/
  global/                        # DISTRIBUTION tree (shipped by install-global)
    opencode/
      install-global.sh          # copies global/opencode/. -> ~/.config/opencode/ (same as taulukko)
      install-vars.sh            # writes the migration env vars into the standard Linux user env
      plugins/
        todo-list/               # SINGLE-FOLDER plugin (source + artifact + npm package root) -> auto-discovered
          check.sh               # import smoke check + typecheck (in place; no copy — in-place TS, no bundling)
          package.json           # name "@oesc/todo-list" (main/exports → ./index.ts, ./tui → ./tui.tsx)
          index.ts               # server: plain-object default { id, setup(ctx) }
          tui.tsx                # TUI: sidebar panel (JSX/Solid + OpenTUI)
          store.ts               # JSON persistence (atomic write) — our own storage only
          types.ts               # local structural types (no runtime deps)
          format.ts              # display helpers (derived numbering)
          README.md              # usage + tool contract summary
          todo-list-spec.md      # this contract (Q1–Q15 decisions)
```

### 5.1 Server plugin (tools + injection)
- Registers the single `todo` tool.
- Persists per-session lists as JSON (Q3/Q7).
- Adds at most **one reminder line** to the **system context** while the list is
  non-empty (Q6). 0.2.2 moved it off the prompt text: a `prompt`-hook edit
  becomes the canonical persisted user input, so the reminder used to appear as
  if the USER had typed it.

### 5.2 TUI plugin (panel)
- Renders the current session's list in the sidebar via `context.ui.slot`
  (`append: "sidebar.content"`), below the MCP block.
- Renders: ASCII checkbox glyphs — `[ ]` pending, `[~]` in progress, `[x]`
  completed, `[!]` cancelled; `completed` and `cancelled` **struck through**;
  priority shown; hierarchical numbering (`1)`, `1.1)`) **derived from
  `depth` + order** at display time (0.2 — never stored nor written by the
  agent; legacy text prefixes are stripped). All items shown (no cap); the
  panel wraps the list in `ScrollArea` when needed.
- Reads the list from our own JSON store
  (`~/.local/share/opencode-todo/<sessionID>.json`, Q13).

### 5.3 Permissions (taulukko `opencode.json`)
- Global: `{ "action": "todo", "resource": "*", "effect": "deny" }`
- ORACLE agent: `{ "action": "todo", "resource": "*", "effect": "allow" }`
- Same pattern already used for `jarvis_*`/`pt_*`/etc.

## 6. Tool contract (draft)

```jsonc
// tool name: todo
// op: "read" | "write" | "add" | "update" | "remove" | "clear"
{
  "op": "add",
  "items": [
    { "content": "Write the spec", "priority": "high", "depth": 1 },
    { "content": "Inserted right after id 3", "depth": 1, "after": 3 }
  ]
}
```

Item:
```jsonc
{ "id": 3, "content": "Write the spec", "status": "in_progress", "priority": "high", "depth": 1 }
```
- `id`: integer, stable, never reused.
- `status`: `pending | in_progress | completed | cancelled`.
- `priority`: `high | medium | low`.
- `depth` (0.2): nesting level (0 = top, 1 = child, …); a level never jumps
  more than one step below the previous item (clamped + reported). Numbering
  is derived from order + depth — do not write numbers in `content`.
- `after` (0.2, `add` only): insert right after this item id (default:
  append at the end).
- `op=write` replaces the whole list (empty array = clear); `op=clear` is an
  explicit complete removal (Q6).

## 7. Injection contract (draft)

- Non-empty list → **one reminder line**, e.g.
  `TODO: 4 items, 1 in progress — update it if something changed.`, pushed into
  the **system block** of the model request (`event.system`), not into the
  message stream and never into the USER's prompt text.
- Empty/removed list → nothing; the **API usage how-to** is injected
  separately by `context-inject` (a file), not in the message stream.

## 8. AGENTS.md changes

- Remove the entire `## Todo tracking (fixed standard)` section
  (`project-generator/global/opencode/AGENTS.md`).
- Also fix the two skills that reference the standard:
  `skills/a-new-brain-storm/SKILL.md` (l.131) and
  `skills/batman-e-robin/SKILL.md` (l.33).
- Nothing about the plugin is written into `AGENTS.md`.

## 9. Cleanup skill (`cleanup-todo-list`)

- Reads the existing sessions from the V2 API (`GET /api/session`).
- Deletes only **our** todo files whose `sessionID` no longer exists.
- **Dry-run by default**; removal only on explicit opt-in (mirrors
  `podman-cleanup-orphans-volumes`).
- Never touches OpenCode data.

## 10. Migration to core-brain (open source) — new requirement (2026-09-10)

- `taulukko` is the **closed** project; everything agent/AI related will
  eventually migrate to the **open-source** `oesc/core-brain`.
- **Create** `core-brain/global/opencode/install-global.sh` behaving exactly
  like taulukko's `src/install-global.sh` (copy `<repo>/global/opencode/.` →
  `~/.config/opencode/`, `-s`/`-d` options, abort if source missing).
- **Wire the migration:** taulukko's `install-global.sh` must **call** the
  core-brain `install-global.sh`.
- The core-brain **location must be defined by environment variables** (no
  hardcoded path in taulukko).
- The directory holding the core-brain `install-global.sh` must also contain
  **`install-vars.sh`**, which writes those variables into the standard Linux
  user environment (e.g. `/etc/environment` and/or the user's shell profile).
- *Note:* taulukko has no `install-vars.sh` today; `/etc/environment` variable
  writing is only planned there (`docs/TASKS.md`). Verify the intended
  `install-vars` convention before implementing.

## 11. Open questions — all resolved (grill 2026-09-10)

- **Q11 — RESOLVED (grill follow-up; layout updated 2026-09-11)**: **in-place
  TS, no bundling** — the plugin lives entirely at
  `core-brain/global/opencode/plugins/todo-list/` (single-folder: source +
  artifact + npm package root; `check.sh` = import smoke check + typecheck, no
  copy; `main`/`exports` → `./index.ts`, `./tui` → `./tui.tsx`; the loader
  loads TS in place, proven by local precedent); **no `@opentui/*` peers** —
  the host bundles OpenTUI and supplies it to the TUI entry. The spike must
  still validate: (a) in-place loading of `tui.tsx` JSX; (b) that the host
  actually supplies OpenTUI to the TUI entry.
- **Q12 — RESOLVED**: glyphs `[ ]` pending, `[~]` in progress, `[x]`
  completed, `[!]` cancelled; `completed` + `cancelled` struck through
  (OpenTUI strikethrough support confirmed in the host binary); all items
  shown, no cap, panel wraps the list in `ScrollArea` when needed; empty or
  removed list → section is not rendered.
- **Q13 — RESOLVED**: `~/.local/share/opencode-todo/<sessionID>.json`, fixed
  path, **no** env var (YAGNI; `cleanup-todo-list` targets the same dir).
- **Q14 — RESOLVED (method)**: empirical **spike before full implementation**
  — toy plugin with a `sidebar.content` entry and a long list; run the TUI,
  screenshot the sidebar and verify by vision that the panel lands **below
  the MCP block**, that JSX renders in place, and that overflow scrolls.
  Fallback slot: `sidebar.footer`.
- **Q15 — RESOLVED (revised 2026-09-23, v0.2.2)**: split by content — the
  **dynamic one-line reminder** is owned by the plugin's own
  `ctx.session.hook('context')`, which pushes one line into `event.system`
  (system block, rebuilt by the host per model request — never accumulates);
  the **static API how-to file** is injected via `context-inject` config. Each
  owner handles one content kind → no duplication. The earlier choice of
  `ctx.session.hook('prompt')` was **withdrawn**: a prompt-hook edit becomes the
  canonical persisted user input, so the reminder was glued to the USER's own
  message in the transcript (defect measured 2026-09-23).

## 12. Next steps

1. ~~Close Q11–Q15 in the grill~~ — done 2026-09-10 (see §11).
2. **Spike** (Q14): toy `sidebar.content` panel → placement below MCP
   (screenshot + vision), in-place JSX loading, scroll behavior; decide slot.
3. Implement `@oesc/todo-list` (server + TUI) in TypeScript.
4. Add the `plugins[]` entry and the `todo` permissions in the taulukko
   `global/opencode/opencode.json`.
5. Remove the AGENTS.md section and fix the two skills.
6. Add the `context-inject` contract file.
7. Create the `cleanup-todo-list` skill.
8. Create `core-brain/global/opencode/install-global.sh` + `install-vars.sh`;
   wire taulukko's `install-global.sh` to call core-brain's.
9. Validate: no plugin load errors, tool callable, panel visible below MCP,
   update/remove/mark/cancel + strikethrough all working.
