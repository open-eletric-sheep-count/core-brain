# @oesc/context-inject

> Part of the **OESC OpenCode plugin suite** (hub: [`core-brain`](https://github.com/open-eletric-sheep-count/core-brain) — installs everything). Standalone: `opencode2 plugin add @oesc/context-inject`.

OpenCode V2 plugin: injects configured files into sessions — project rules at
the true start of a session (its first admitted prompt ever) and a
re-injection after a completed compaction. Per-agent configuration.

Migrated from the internal `taulukko-inject-context` plugin; renamed for OESC.

## Behavior

- `session.created` — fires only when the durable session log shows NO user
  message and NO compaction control (genuine first prompt of a new session);
  resumed sessions never re-inject.
- `session.compacted` — fires on the first admitted prompt after a completed
  compaction. Both decisions are derived from the durable session log: no
  in-memory state, so behavior survives service restarts and instance reloads.
- Injected content is PREPENDED to the admitted prompt text (content first,
  user text after).

## Configuration

`config.json`:

```json
{
  "logging": { "enabled": true },
  "log_path": "~/.local/share/opencode-context-inject/output.txt",
  "injections": {
    "agents": {
      "ORACLE": {
        "session.created": ["TODO_TOOL_HOWTO.md"],
        "session.compacted": ["TODO_TOOL_HOWTO.md"]
      }
    }
  }
}
```

- `injections.agents.<AGENT>.<event>` — file lists; the reserved `ALL` key
  feeds every session; other keys match the session agent exactly.
- Relative entries resolve against the plugin directory; `/...` entries are
  used as-is; duplicates (by resolved path) inject once per event, `ALL` first.
- Config resolution: `options.configPath` (plugin options in
  `opencode.json(c)`) → `<pluginDir>/config.json`. With neither, nothing is
  injected (a warning is logged).
- `log_path` defaults to `~/.local/share/opencode-context-inject/output.txt`.

## Install

Local (dev distribution):

```bash
core-brain/global/opencode/install-global.sh
```

From npm (published package):

```bash
opencode2 plugin add @oesc/context-inject
```

Or via `opencode.json(c)`, pointing at your config file:

```jsonc
{
  "plugins": [
    {
      "package": "@oesc/context-inject",
      "options": { "configPath": "~/.config/opencode/context-inject.config.json" }
    }
  ]
}
```

## Check

```bash
cd global/opencode/plugins/context-inject && ./check.sh
```

Import smoke check (node native TS) + typecheck (uses `tsc` when available,
else `npx typescript@5.9.2`). **Single-folder layout**: this directory is
both the source and the distribution artifact — the installer copies it
as-is, no build/copy step. `npm publish` also runs from here (`files`:
`index.ts` + `README.md`; `config.json` and the injected markdown stay out
of the package).
