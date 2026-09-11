# @oesc/todo-list

OpenCode V2 plugin: a real todo list the assistant maintains and the user
watches live.

- **Server entry** (`index.ts`): registers the single `todo` tool and a prompt
  hook that injects **at most one line per round**, only when the session's
  list is non-empty.
- **TUI entry** (`tui.tsx`): live panel in the sidebar (`sidebar.content`,
  below the MCP block) showing the current session's list.

Contract: `todo-list-spec.md` (Q1–Q15 decisions).

## Storage

One list per session, in our own JSON store — OpenCode's DB is never touched:

```
~/.local/share/opencode-todo/<sessionID>.json
```

Writes are atomic (tmp file + rename). An empty/absent list means "no list":
the panel hides and nothing is injected.

## Tool contract (`todo`)

Single tool, `op` field (ids are stable integers, never reused):

| op       | effect                                                        |
| -------- | ------------------------------------------------------------- |
| `read`   | return the current list                                       |
| `write`  | replace the whole list (`items`; empty array clears)           |
| `add`    | append items (new ids assigned and reported)                   |
| `update` | change `content`/`status`/`priority`/`depth` of items addressed by id |
| `remove` | delete items by id                                             |
| `clear`  | delete the entire list (storage file removed)                  |

Statuses: `pending` `[ ]` · `in_progress` `[~]` · `completed` `[x]` `(struck)` ·
`cancelled` `[!]` `(struck)`. Priorities: `high` `medium` `low`.

Items carry an optional **`depth`** (0 = top; children +1). The hierarchical
numbering (`1)`, `1.1)`) is **generated** from depth + order at display time —
never stored nor written in content (legacy prefixes are stripped); it
renumbers automatically on add/remove, and `add` accepts **`after: <id>`** to
insert right after an existing item.

## Build

```bash
cd todo-list && ./build.sh
```

Typechecks (when `tsc` is available) and copies the artifact into
`global/opencode/plugins/todo-list/` (in-place TS, no bundling — the loader
loads TS directly; the host supplies OpenTUI and solid-js; zero runtime deps).

## Install

```bash
core-brain/global/opencode/install-global.sh
```

Copies `global/opencode/.` into `~/.config/opencode/` (auto-discovery; no
`opencode.json` entry needed). The plugin only becomes usable after the `todo`
permission entries exist in the host `opencode.json` (global deny + ORACLE
allow).

## How-to injection (`taulukko-inject-context`)

A static **how-to** (`TODO_TOOL_HOWTO.md`) is injected into sessions by the
`taulukko-inject-context` plugin, so agents know the tool contract before the
first call. (The dynamic one-line `TODO: …` reminder stays owned by this
plugin's own prompt hook — spec §7/Q15. The sidebar panel and that reminder
are agent-agnostic; scope applies to the static how-to and the tool
permission.)

**Current scope: `ORACLE` only** — matching the tool's permission model
(global `todo` deny + ORACLE allow). It fires on `session.created` and
`session.compacted`.

Files (source of truth: the taulukko repo):

- `global/opencode/plugins/taulukko-inject-context/TODO_TOOL_HOWTO.md`
- `global/opencode/plugins/taulukko-inject-context/config.json`:

```jsonc
"injections": {
  "agents": {
    "ALL": { "session.created": ["GOLDEN_RULES.md"], "session.compacted": [] },
    "ORACLE": {
      "session.created": ["TODO_TOOL_HOWTO.md"],
      "session.compacted": ["TODO_TOOL_HOWTO.md"]
    }
  }
}
```

After install, the file lives at
`~/.config/opencode/plugins/taulukko-inject-context/TODO_TOOL_HOWTO.md`.

### Expanding to other agents

1. **Injection config** — add the agent under `injections.agents.<AGENT>`
   (or use the reserved `ALL` key to inject for every session). For one
   event, `ALL` files come first, then the agent's; relative entries resolve
   against the plugin directory, `/...` entries are used as-is, dedup by
   resolved absolute path.
2. **Permission** — grant the `todo` tool to that agent in
   `global/opencode/opencode.json` (the global deny stays), inside the
   agent's `permissions` array:

   ```json
   { "action": "todo", "resource": "*", "effect": "allow" }
   ```

3. **Install** — `bash <taulukko>/src/install-global.sh` (it chains the
   core-brain installer; the mirror `~/.config/opencode/` is updated by the
   USER).

Example — also enabling `DEVELOPER`:

```jsonc
"agents": {
  "ALL": { "session.created": ["GOLDEN_RULES.md"], "session.compacted": [] },
  "ORACLE": {
    "session.created": ["TODO_TOOL_HOWTO.md"],
    "session.compacted": ["TODO_TOOL_HOWTO.md"]
  },
  "DEVELOPER": {
    "session.created": ["TODO_TOOL_HOWTO.md"],
    "session.compacted": ["TODO_TOOL_HOWTO.md"]
  }
}
```

## Empirical items (first live test)

1. **Execute context**: the shape of `execute(input, tool)`'s second argument
   is undocumented; the plugin resolves `sessionID` defensively and writes the
   observed keys once to `~/.local/share/opencode-todo/debug.log`. If the
   resolved id is wrong, adjust `resolveSessionID` in `src/index.ts`.
2. **Slot placement**: if the panel does not land below the MCP block, switch
   `append: "sidebar.content"` to `append: "sidebar.footer"` in `src/tui.tsx`.
3. **Layout**: the panel root uses `flexShrink={0}`/`flexGrow={0}` and NO
   `scrollbox` — an inner scrollbox squeezed the MCP block above it (garbled
   rows) whenever the list existed (bug found 2026-09-11). Bounded scrolling
   for long lists is a follow-up iteration.
