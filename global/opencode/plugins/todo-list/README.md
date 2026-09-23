# @oesc/todo-list

> Part of the **OESC OpenCode plugin suite** (hub: [`core-brain`](https://github.com/open-eletric-sheep-count/core-brain) — installs everything). Standalone: `opencode2 plugin add @oesc/todo-list`.

OpenCode V2 plugin: a real todo list the assistant maintains and the user
watches live.

- **Server entry** (`index.ts`): registers the single `todo` tool and a context
  hook that adds **at most one reminder line** to the **system block** while the
  session's list is non-empty (never to the USER's prompt text, v0.2.2).
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
| `add`    | append items (new ids assigned and reported)                  |
| `update` | change `content`/`status`/`priority`/`depth` of items addressed by id |
| `remove` | delete items by id                                             |
| `clear`  | delete the entire list (storage file removed)                 |

Statuses: `pending` `[ ]` · `in_progress` `[~]` · `completed` `[x]` `(struck)` ·
`cancelled` `[!]` `(struck)`. Priorities: `high` `medium` `low`.

Items carry an optional **`depth`** (0 = top; children +1). The hierarchical
numbering (`1)`, `1.1)`) is **generated** from depth + order at display time —
never stored nor written in content (legacy prefixes are stripped); it
renumbers automatically on add/remove, and `add` accepts **`after: <id>`** to
insert right after an existing item.

## Check

```bash
cd global/opencode/plugins/todo-list && ./check.sh
```

Import smoke check (node native TS) + typecheck (uses `tsc` when available,
else `npx typescript@5.9.2`). **Single-folder layout**: this directory is
both the source and the distribution artifact — the installer copies it
as-is (in-place TS, no bundling — the loader loads TS directly; the host
supplies OpenTUI and solid-js; zero runtime deps). `npm publish` also runs
from here (`files`: the flat `.ts`/`.tsx` entries + `README.md`).

## Install

```bash
core-brain/global/opencode/install-global.sh
```

Copies `global/opencode/.` into `~/.config/opencode/` (auto-discovery; no
`opencode.json` entry needed). The plugin only becomes usable after the `todo`
permission entries exist in the host `opencode.json` (global deny + ORACLE
allow).

## How-to injection (`context-inject`)

A static **how-to** (`TODO_TOOL_HOWTO.md`) is injected into sessions by the
`context-inject` plugin (core-brain `global/opencode/plugins/context-inject/`),
so agents know the tool contract before the first call. (The dynamic one-line
`TODO: …` reminder stays owned by this plugin's own **context hook**
(`event.system`, v0.2.2 — it was moved off the prompt text so it can never look
like the USER's own words) — spec §7/Q15.
The sidebar panel and that reminder are agent-agnostic; scope applies to the
static how-to and the tool permission.)

**Current scope: `ORACLE` only** — matching the tool's permission model
(global `todo` deny + ORACLE allow). It fires on `session.created` and
`session.compacted`.

Files (source of truth: `global/opencode/plugins/context-inject/` in this
repo; shipped to the mirror by the installers):

- `global/opencode/plugins/context-inject/TODO_TOOL_HOWTO.md`
- `global/opencode/plugins/context-inject/config.json`:

```jsonc
"injections": {
  "agents": {
    "ORACLE": {
      "session.created": ["TODO_TOOL_HOWTO.md"],
      "session.compacted": ["TODO_TOOL_HOWTO.md"]
    }
  }
}
```

After install, the file lives at
`~/.config/opencode/plugins/context-inject/TODO_TOOL_HOWTO.md`.

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
   resolved id is wrong, adjust `resolveSessionID` in `index.ts`.
2. **Slot placement**: if the panel does not land below the MCP block, switch
   `append: "sidebar.content"` to `append: "sidebar.footer"` in `tui.tsx`.
3. **Layout**: the panel root uses `flexShrink={0}`/`flexGrow={0}` and NO
   `scrollbox` — an inner scrollbox squeezed the MCP block above it (garbled
   rows) whenever the list existed (bug found 2026-09-11). Bounded scrolling
   for long lists is a follow-up iteration.
