# SPEC — Todo List plugin for OpenCode V2 (`@oesc/todo-list`)

- Status: **DRAFT** — grill in progress; open questions in §11
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
   **separately** via the `taulukko-inject-context` plugin.
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
  `graphify`, `opencode-anti-loop`, `taulukko-inject-context`).

## 4. Decisions taken (grill 2026-09-10)

| # | Decision | Value |
| --- | --- | --- |
| Q1 | Approach | Plugin with a **tool** + a **TUI panel** (no more printing) |
| Q2 | UI placement | TUI sidebar, **below the MCP block** → `append: "sidebar.content"`; exact ordering is an **empirical validation item** (fallback: `sidebar.footer`) |
| Q3 | Storage | **Our own JSON**, atomic write (`tmp` + rename). OC DB untouched |
| Q4 | Tool surface | **Single tool `todo`** with an `op` field (context economy) |
| Q5 | Data model | **Stable, never-reused numeric ids**; ops `write/add/update/remove/read` (+ complete clear); statuses `pending`/`in_progress`/`completed`/`cancelled` |
| Q6 | Injection | **Minimum**: at most **one line per round**, only when the list **exists and is non-empty**. The API usage contract is injected via `taulukko-inject-context`, not per message. API supports **complete removal** |
| Q7 | Ownership | **Only the ORACLE** operates the list; **one list per session** (by `sessionID`), not per project |
| Q7b | Maintenance | New skill **`cleanup-todo-list`** — dry-run by default; deletes only *our* todo files whose session no longer exists (reads the session list from the V2 API) |
| Q8 | Shape | **Flat list** (no `depth` field). Depth is encoded in the item text with a leading enumeration: `1)`, `1.1)`, `1.2)` |
| Q9 | AGENTS.md | The whole `## Todo tracking (fixed standard)` section is **removed**. Nothing about the plugin goes in AGENTS.md |
| Q9b | Plugin identity | `@oesc/todo-list`, folder `/media/gandb/workspace/oesc/core-brain/todo-list`, in **TypeScript** |
| Q10 | Module shape | **(b)** plain-object default export + **local structural types**, **zero runtime dependencies** |
| Q11 | Source vs distribution | Plugin **source** at `core-brain/todo-list/` with a **`build.sh`** that builds and copies the artifact into **`../global`** (`global/opencode/plugins/todo-list/`). `install-global.sh` ships the latest built version → plugin is **auto-discovered** (no path in `opencode.json`). Build = typecheck + bundle to plain JS |

## 5. Architecture (proposed)

```
core-brain/
  todo-list/                     # SOURCE project (TypeScript) — never installed directly
    build.sh                     # typecheck + bundle + copy artifact into ../global
    package.json                 # name "@oesc/todo-list"
    src/index.ts                 # server: plain-object default { id, setup(ctx) }
    src/tui.tsx                  # TUI: sidebar panel (JSX/Solid + OpenTUI)
    src/store.ts                 # JSON persistence (atomic write) — our own storage only
    src/types.ts                 # local structural types (no runtime deps)
    README.md
  global/                        # DISTRIBUTION tree (shipped by install-global)
    opencode/
      install-global.sh          # copies global/opencode/. -> ~/.config/opencode/ (same as taulukko)
      install-vars.sh            # writes the migration env vars into the standard Linux user env
      plugins/
        todo-list/               # BUILT artifact (generated by todo-list/build.sh) -> auto-discovered
```

### 5.1 Server plugin (tools + injection)
- Registers the single `todo` tool.
- Persists per-session lists as JSON (Q3/Q7).
- Injects at most one line per round when the list is non-empty (Q6).

### 5.2 TUI plugin (panel)
- Renders the current session's list in the sidebar via `context.ui.slot`
  (`append: "sidebar.content"`), below the MCP block.
- Renders: checkbox glyphs + status; `completed` and `cancelled` **struck
  through**; `in_progress` marked; priority shown; `1)`/`1.1)` enumeration as
  written in the content.
- Reads the data source decided in **Q11** (open).

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
  "items": [ { "content": "1.1) Write the spec", "priority": "high" } ]
}
```

Item:
```jsonc
{ "id": 3, "content": "1.1) Write the spec", "status": "in_progress", "priority": "high" }
```
- `id`: integer, stable, never reused.
- `status`: `pending | in_progress | completed | cancelled`.
- `priority`: `high | medium | low`.
- `op=write` replaces the whole list (empty array = clear); `op=clear` is an
  explicit complete removal (Q6).

## 7. Injection contract (draft)

- Non-empty list → **one line** per round, e.g.
  `TODO: 4 items, 1 in progress — update it if something changed.`
  (final wording to be improved).
- Empty/removed list → nothing per round; the **API usage how-to** is injected
  separately by `taulukko-inject-context` (a file), not in the message stream.

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

## 11. Open questions (to resolve before implementation)

- **Q11 — RESOLVED** (see §4): source at `core-brain/todo-list/`, `build.sh`
  copies the artifact into `core-brain/global/opencode/plugins/todo-list/`, and
  `install-global.sh` ships it to `~/.config/opencode/plugins/todo-list/` where
  V2 auto-discovers it. Still to validate in a spike: the built form (bundled
  plain JS vs TS transpiled at runtime) and whether the TUI entry needs
  `@opentui/*` peers installed or gets them from the host.
- **Q12** — Panel render details: exact glyphs, `strikethrough` support in
  OpenTUI/Solid, section/numbering rendering, max items shown, empty state.
- **Q13** — Storage path: `~/.local/share/opencode-todo/<sessionID>.json`?
  Should it be env-configurable like the migration vars?
- **Q14** — Loading order/placement validation: confirm `append:
  "sidebar.content"` lands **below the MCP block** on the installed beta.
- **Q15** — Does the injected line go through `taulukko-inject-context`
  config, or through the plugin's own session hook? (Two owners of injection —
  pick one to avoid duplication.)

## 12. Next steps

1. Close Q11–Q15 in the grill.
2. Implement `@oesc/todo-list` (server + TUI) in TypeScript.
3. Add the `plugins[]` entry and the `todo` permissions in the taulukko
   `global/opencode/opencode.json`.
4. Remove the AGENTS.md section and fix the two skills.
5. Add the `taulukko-inject-context` contract file.
6. Create the `cleanup-todo-list` skill.
7. Create `core-brain/global/opencode/install-global.sh` + `install-vars.sh`;
   wire taulukko's `install-global.sh` to call core-brain's.
8. Validate: no plugin load errors, tool callable, panel visible below MCP,
   update/remove/mark/cancel + strikethrough all working.
