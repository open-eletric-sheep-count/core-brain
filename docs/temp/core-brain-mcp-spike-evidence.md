# core-brain MCP — SPIKE evidence (critical path, spec §12)

Recorded by ORACLE, 2026-10-02. All measurements executed on this machine.
Working rig: `/tmp/opencode/cb-spike/` (removed after the run; this file keeps the digests).

## SPIKE-1 — does a local MCP server receive session/agent identity? → **NO**

Two independent measurements:

1. **Live `plur` MCP processes** (spawned by the running opencode service, PID 1794418):
   - `pgrep -af "plur-ai/mcp"` → 5 processes, e.g. PID 1865549, 2099049, 2130650, 2147376, 2159876.
   - `tr '\0' '\n' < /proc/<pid>/environ` → **196 env keys; zero `OPENCODE*` keys, no `AGENT`**
     (only an unrelated `SESSION_MANAGER=local/DEKTOP-EDSON:...` matched).
   - Control: this session's own shell (spawned by opencode in a session) has
     `OPENCODE_SESSION_ID=ses_f04a72bcaffeMdhT5SOzLhMLws`, `OPENCODE_TERMINAL=1`, `AGENT=1`, `OPENCODE=1`.

2. **Throwaway rig** `dump-server.mjs` declared as a local MCP (`cb-spike`, `dump-1.json`):
   - `pid 2165502, ppid 1794418 (opencode serve --service)`, `cwd=/tmp/opencode/cb-spike`,
     `env keys: 196`, `OPENCODE_*/AGENT keys: {}`.

**Conclusion:** MCP servers receive **no session and no agent identity**. The spec's decision M3
(identity-needing ops stay on the plugin host `core_memory`; §4.2) is validated, and §4.4
alternative B (identity via a plugin-written handshake keyed on the MCP's own env) is **impossible**.

## SPIKE-3 — is a local MCP spawned per session or per location? → **PER SESSION**

- One declared server (`plur`) → **5 live processes** with 5 distinct start times:
  `02:57:35`, `06:58:57`, `07:28:01`, `07:45:04`, `07:58:07` (all children of PID 1794418).
- Confirms §4.4A's cost argument: one MCP process per session (per agent that opens a session),
  not one per location — replicating this per agent multiplies processes by the agent count.

## SPIKE-5 — the minimum JSON-RPC conversation opencode needs → **MEASURED**

Captured verbatim from the rig's `calls.log` (newline-delimited JSON, MCP stdio transport):

```
{"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{"elicitation":{"form":{"applyDefaults":true},"url":{}},"roots":{}},"clientInfo":{"name":"cli","version":"2.0.21"}},"jsonrpc":"2.0","id":0}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"method":"tools/list","jsonrpc":"2.0","id":1}
```

- The client sends `initialize` → `notifications/initialized` (a **notification, no id, no reply
  expected**) → `tools/list`.
- The rig answered `initialize` by **echoing the requested `protocolVersion`** with
  `serverInfo {name, version}` + `capabilities {tools:{}}`, answered `tools/list` with one tool
  (`inputSchema: {type:"object"} / {type:"object",properties:{}}`), and was accepted (the next
  request arrived) → the minimal shape is sufficient for `initialize` + `tools/list`.
- `tools/call` was **not exercised** by `mcp list` (it only connects + lists). The server's
  `tools/call` result shape (`{content:[{type:"text",text}]}`) must be verified in-layer by the
  transport self-test and the live Layer-B call (plan D8 / E).
- Reference implementation present on the machine:
  `~/.npm/_npx/386f78daf917651f/node_modules/@modelcontextprotocol/server` (used to cross-check
  `protocolVersion`/`serverInfo`/`capabilities` shape).
- opencode version: `clientInfo.version = 2.0.21`.

## SPIKE-2 — does `mcp.servers.<name>` accept `env`/`cwd` for a local server? → **`environment` yes; `env` NO (silently ignored)**

- **Authoritative writer:** `opencode2 mcp add --env CANON_MARKER=xyz cb-canon -- node ...` wrote,
  into the project config:
  ```json
  "cb-canon": { "type": "local", "command": ["node","..."], "environment": { "CANON_MARKER": "xyz" } }
  ```
  → the **canonical key is `environment`**.
- **`env` is a trap:** a rig declared with `"env": {"CB_SPIKE_MARKER":"abc123"}` produced a process
  with **196 env keys and `CB_SPIKE_MARKER = None`** → `env` is accepted by the parser and
  **silently dropped**.
- **Spec §8 must be corrected:** its example uses `"env": { "CORE_BRAIN_HOME": ... }` — that form
  would be silently ignored. Use `"environment"`.
- `cwd`: the test was inconclusive (the invocation cwd coincided with the configured one) and the
  background service caches the merged server list after the first merge, so re-runs with new names
  were not re-spawned. Not needed for core-brain: the command is an absolute path and the server's
  data root defaults to `~/.core-brain` via `os.homedir()`, with `HOME` inherited (confirmed: the
  MCP process env carries the full user environment).

## Baseline (captured before any code change)

- `git -C /media/gandb/workspace/oesc/core-brain log -1 --format=%H` and `git status --porcelain`:
  captured at job start and re-checked at the end (R1: zero commits).
- Plugin `check.sh` → **13/13 PASS / exit 0** (re-run before and after; AC8).
- `git status` at capture: only the new documentation files created by this job
  (`docs/temp/core-brain-mcp-user-criteria.md`, `.bot-forum/…`, this file).

## Resources released (R5)

- Rig processes `dump-server.mjs`: killed after the run; `/tmp/opencode/cb-spike/` removed.
- No live/global config file was modified for the spikes (project config + `OPENCODE_CONFIG` only).

## CORRECTION (ORACLE self-audit, 2026-10-02 16:05)

A read is NOT side-effect free: `recallOp` increments `MemoryRecord.retrievals` and rewrites `memories.json` for every namespace that produced a hit. So neither `core_recall` nor `core_memory op:"recall"` can serve as a 'no file changed' probe; only `core_status`, `core_doctor` and `core_receipt` are pure reads. The earlier Layer-B wording in the spec/plan was wrong for recall (the ARCHITECT rewrote spec §10).

Also recorded: session ID typo fix — the concurrent session is `ses_f06055d18ffetklAOTycxMjZ8g`.
