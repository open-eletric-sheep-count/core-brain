# CORE-BRAIN ADMIN — CLI (operator maintenance)

`core_admin` is **no longer an MCP tool**. The MCP server exposes only the four
safe, read-only tools (`core_recall`, `core_status`, `core_doctor`,
`core_receipt`). Maintenance is a **CLI**, run with `bash`:

```
node <pluginDir>/mcp/admin-cli.js <purge|reindex|export|import|compact> [options]
  --ns <label>     target namespace (required for purge; optional filter for
                   reindex/export/compact)
  --file <path>    export/import document — must live INSIDE the core-brain
                   data root (`CORE_BRAIN_HOME`, default ~/.config/core-brain)
  --force          purge a private agent namespace
```

Deployed path: `~/.config/opencode/plugins/core-brain/mcp/admin-cli.js`.

## Actions

- `purge` — hard-deletes one namespace's `memories.json` + vector index
  (`episodes.json` survives). **Destructive.**
- `reindex` — rebuilds a namespace's vector index from its records.
- `export` — dumps every namespace to a JSON document.
- `import` — appends records/episodes from a document (dedup by id only).
- `compact` — drops vectors whose record is retired or missing.

## Why a CLI and not a tool

The MCP server has **no caller identity**: every call arrives on one anonymous
stdio pipe, so it cannot tell ORACLE from any other agent. A maintenance tool
there is a capability leak to restricted agents. A CLI is reachable only by a
process that already has `bash` — i.e. an agent that is already fully
privileged. **Knowledge is not the control; the absence of the tool is.**

Never call `core_admin` as an MCP tool: it does not exist there and answers
`Unknown tool`.
