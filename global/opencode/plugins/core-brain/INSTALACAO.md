# Installing core-brain

Step-by-step installation, configuration, verification and rollback of the
OpenCode V2 `core-brain` plugin, for this repository's layout.

Everything below is **a file copy, one config file and one runtime install**:
the plugin itself has no build step, no daemon, no port and no database engine;
the retrieval engine needs a one-time Node runtime provisioned **outside** the
plugin tree (section 2).

## 0. What you need

- An OpenCode V2 install whose global config directory is `~/.config/opencode/`
  (the default), reachable as `opencode2`.
- Node.js to run the self-test by hand: `--experimental-strip-types` from
  v22.6, or type-stripping on by default from v23.6. Measured reference in this
  environment: **v24.15.0**.
- `npm` on `PATH` for the one-time engine runtime install (section 2).
- This repository cloned anywhere; all commands below are relative to its root.

## 1. Install the files (repo → global mirror)

```bash
cd <path-to>/core-brain
bash global/opencode/install-global.sh
```

The script copies `global/opencode/.` into `~/.config/opencode/`, so afterwards:

| Source (repository) | Destination (mirror) |
|---|---|
| `global/opencode/plugins/core-brain/` | `~/.config/opencode/plugins/core-brain/` |
| `global/opencode/agent/CB_{ALPHA,BETA,GAMMA,DELTA}.md` | `~/.config/opencode/agent/` |

**Never edit the mirror by hand.** It is a generated copy and the next install
overwrites it: change the repository, re-run the script.

## 2. Provision the engine runtime (one time)

The retrieval engine loads `@huggingface/transformers@4.3.0` from a dedicated
runtime directory that is **never** inside the plugin tree and **never** inside
the generated mirror, so neither the repository nor the plugin copy carries the
heavy Node closure:

```text
~/.core-brain/runtime      engine runtime   (override: CORE_BRAIN_RUNTIME_DIR)
~/.core-brain/models       model weights    (override: CORE_BRAIN_MODELS_DIR / CORE_BRAIN_MODELS)
```

Run the provisioning script **once**:

```bash
bash global/opencode/plugins/core-brain/install-runtime.sh
```

It redirects the npm cache to `/tmp/opencode/npm-cache` (so `~/.npm` is never
written), installs the pinned runtime into the directory above, and finally
prints `du -sb` of the result. `--dry-run` prints the exact `npm install`
command and writes nothing. The script refuses a destination inside the mirror,
inside this repository, `/`, `$HOME` or the repository root.

Optional — prune the runtime to `linux/x64` only:

```bash
bash global/opencode/plugins/core-brain/prune-runtime.sh            # dry-run (default)
bash global/opencode/plugins/core-brain/prune-runtime.sh --apply    # copy + prune
```

`onnxruntime-node` ships prebuilt binaries for several OS/arch pairs; on a
linux-x64 host only `linux/x64` is ever loaded, so every other directory is dead
weight. The prune runs on a **copy** (the source runtime is never modified) and
prints the `du -sb` before/after. **Measured saving on this closure:
254,789,872 B** (`onnxruntime-node` 574,221,664 B → 319,431,792 B — the Fatia 0 /
B3 measurement; `prune-runtime.sh` reproduces it and prints the actual delta).

**Fail-closed behaviour.** If the runtime is missing or unresolvable, `store`
and `recall` throw a named `EngineUnavailableError` whose message points at
`install-runtime.sh`. There is **no** silent fallback: the engine never
downgrades to the deterministic `hash-ngram-v1` double on its own.

**Rollback:** `rm -rf ~/.core-brain/runtime` — the plugin returns to the
fail-closed engine; no repository change.

### Environment variables

| Variable | Meaning | Default |
|---|---|---|
| `CORE_BRAIN_RUNTIME_DIR` | engine runtime (the `@huggingface/transformers` install) | `~/.core-brain/runtime` |
| `CORE_BRAIN_MODELS_DIR` (alias `CORE_BRAIN_MODELS`) | model-weight cache (`transformers.env.cacheDir`) | `~/.core-brain/models` |
| `CORE_BRAIN_OFFLINE` | `1`/`true` → `allowRemoteModels=false`: load weights only from the cache, never fetch | off |
| `CORE_BRAIN_EMBEDDER` | `real` (default, `Xenova/bge-small-en-v1.5`) \| `fixture` (offline test double; tests only) | `real` |
| `CORE_BRAIN_RERANKER` | `off` (default) \| `ms-marco` (enable the cross-encoder) | `off` |
| `CORE_BRAIN_HOME` | data root (records + vectors) | `~/.core-brain` |
| `CORE_BRAIN_DEBUG` | `1` → append diagnostics to `<data root>/debug.log` | off |

The first real `embed()` downloads the `Xenova/bge-small-en-v1.5` fp32 weights
(measured `onnx/model.onnx` artifact: **133,093,490 B**) into
`CORE_BRAIN_MODELS_DIR`. To load them purely offline on later runs, set
`CORE_BRAIN_OFFLINE=1`.

## 3. Do NOT add a `plugins` entry to `opencode.json`

The `plugins/` directory is **auto-discovered** by OpenCode V2 — a plugin living
at `<config-dir>/plugins/<id>/index.ts` is loaded with no array entry. Proof from
this environment: `todo-list` and `context-inject` are loaded and working while
the live `plugins` array holds only other ids.

`core-brain` reads its policy from `~/.core-brain/config.json` (step 4), not from
an array entry's `options`, so no `opencode.json` change is required. If you do
configure the object form, the only supported options are `configPath` (explicit
config file, `~` allowed) and `home` (data root).

## 4. Write the policy — `~/.core-brain/config.json`

```bash
mkdir -p ~/.core-brain
```

```json
{
  "agents": [
    { "name": "agent_alpha", "hasGlobalAccess": true,  "private": false },
    { "name": "agent_beta",  "hasGlobalAccess": true,  "private": true  },
    { "name": "agent_gamma", "hasGlobalAccess": false, "private": true  }
  ]
}
```

- `name` must match the OpenCode **agent name** exactly — the identity is read
  from the running session, never supplied by the model.
- Use your real agents, or the shipped test agents
  (`CB_ALPHA`, `CB_BETA`, `CB_GAMMA`) to run the isolation matrix end-to-end.
- Deliberately **do not** add `CB_DELTA` to a working config: its row
  (`private: false` + `hasGlobalAccess: false`) is the invalid configuration used
  by the configuration gate, so a config containing it refuses to start.
- An agent **not** listed here is no longer refused: it gets the default policy
  `private: false` + `hasGlobalAccess: true` (see the plugin `README.md`).

## 5. Reload

```bash
opencode2 reload
```

or restart OpenCode. The plugin is loaded, its config is validated, and the
`core_memory` tool becomes available to the listed agents from that moment.

## 6. Verify

```bash
opencode2 plugin list                              # must list core-brain
opencode2 debug agents                             # must list your agents (e.g. the CB_* ones)
bash global/opencode/plugins/core-brain/check.sh   # must print 13/13 matrix lines + the probes, and exit 0
```

The third command is the executable check: it runs the real store and authorizer
against a disposable `CORE_BRAIN_HOME` created with `mktemp -d`, prints one line
per rule of the isolation matrix (`7 PASS … 19 PASS`) plus the offline search
probes, and removes the temp root when it exits. Measured reference: **13/13
matrix lines PASS** and **7/7 probes PASS**, exit code `0` (Node v24.15.0).

## 7. Smoke it for real (headless run)

```bash
opencode2 run --agent CB_BETA --auto "Call core_memory with op:'who'; then op:'store' with text 'beta-marker' and target 'self'; then op:'recall' with from 'self'. Report the raw JSON of each call."
```

Expected: `who` reports `"private": true` and `"hasGlobalAccess": true`; `store`
returns `{"ok":true,…}`; `recall` returns the marker you just stored. Repeat with
`--agent CB_GAMMA` (its `store target:'global'` must come back as
`ERROR: … no global access`) and `--agent CB_ALPHA` (`store target:'global'` then
`recall from:'global'` must echo the record).

## 8. Coexistence with PLUR Memory

`core-brain` is meant to live next to PLUR Memory, not to replace the running
install:

```bash
opencode2 mcp list     # the plur MCP must still be there and connected
ls -la ~/.plur/        # still owned and written by PLUR — untouched by core-brain
```

The two share nothing: distinct plugin id, directory, npm name, data directory,
config file, environment variables, tool namespace and license (see the
collision table in [`README.md`](README.md#zero-collision-with-plur)).

## 9. Troubleshooting

| Symptom | Cause | What to do |
|---|---|---|
| `ERROR: … EngineUnavailableError … could not load "@huggingface/transformers" …` | the engine runtime was never provisioned (or `CORE_BRAIN_RUNTIME_DIR` points nowhere) | run step 2 (`bash …/install-runtime.sh`); the message names the script |
| `ERROR: … STALE_INDEX … run core_admin { action: "reindex", args: { ns: … } }` | the namespace's index was built by a different embedder/dim/revision than the active engine | run the `reindex` admin action for that namespace; the message names it |
| first `recall` with a query is slow / hits the network | the weights are not cached yet, or `CORE_BRAIN_OFFLINE` is unset | let the first download finish into `CORE_BRAIN_MODELS_DIR`, then set `CORE_BRAIN_OFFLINE=1` to stay offline |
| an agent **not** listed in the policy | expected — it now gets the default policy (`private:false` + `hasGlobalAccess:true`); the old `agent '<name>' is not configured in core-brain config.json` error no longer exists | no action needed to use `self`/`global`; add an explicit `agents[]` row whose `name` matches exactly only if you want to override the default |
| `ERROR: InvalidConfigurationError (INVALID_CONFIGURATION): … public agent without global access …` | a row has `private: false` **and** `hasGlobalAccess: false` | fix that row (make it `private: true`, or give it global access) |
| `ERROR: core_memory store: agent '<A>' cannot write to 'global': no global access` | `hasGlobalAccess` is false for that agent | expected behaviour — write to `self`, or grant access |
| `ERROR: core_memory store: agent '<A>' cannot write to 'agent:<B>': target is private — cross-agent write not allowed` | cross-agent write | expected behaviour — writes only go to your own space |
| the `core_memory` tool does not appear | the mirror was not installed, or OpenCode was not reloaded | re-run step 1, then step 5 |
| where is the data? | the data root is the user profile | `~/.core-brain/`: `global/memories.json`, `agents/<name>/memories.json`, `vectors/<ns>/index.json` |
| I want the hook's diagnostics | the prompt hook is silent by default | run with `CORE_BRAIN_DEBUG=1`; it appends to `~/.core-brain/debug.log` |
| I want to start over | the store is plain JSON | stop OpenCode, then `rm -rf ~/.core-brain` (this also deletes your `config.json` and the engine runtime) |
| I want a different data root | for tests or throwaway runs | set `CORE_BRAIN_HOME=/some/tmp/dir` before starting OpenCode |
| right after `opencode2 reload`, `plugin list` shows fewer plugins and the MCP tools vanish from the session | observed transient reload behaviour (measured: 7 → 1 plugins listed, MCPs gone from the live catalogue) | it recovers by itself on the next command (8 plugins, MCPs back) — re-run the command once; only restart OpenCode if it does not recover |

A refused call is always a clear `ERROR: …` string naming the target and the
reason — never a silent empty answer.

## 10. Uninstall

1. Remove `~/.config/opencode/plugins/core-brain/` and the four
   `~/.config/opencode/agent/CB_*.md` from the mirror (or re-run the installer
   after removing their sources from the repository).
2. `opencode2 reload`.
3. Optionally reclaim the engine: `rm -rf ~/.core-brain/runtime` (and
   `~/.core-brain/models`). Keep or delete `~/.core-brain/` — it is your memory
   data, and it is never touched by the uninstall.

## 11. Technical references (OpenCode V2 plugin API)

The plugin follows the same V2 patterns as the plugins already in this
repository, and no runtime SDK package is imported at all (the default export is
a plain `{ id, setup }` object):

- plugin authoring, tool registration through `ctx.tool.transform` +
  `editor.add(...)`, and the session hooks `ctx.session.hook("prompt", …)` /
  `ctx.session.get({ sessionID })` — <https://opencode.ai/v2/docs/build/plugins>;
- in-repo precedents: `global/opencode/plugins/todo-list/index.ts` (tool
  registration, session-id resolution from the tool's second argument) and
  `global/opencode/plugins/context-inject/index.ts` (prompt hook, defensive
  handling of the `ctx.session.get` beta envelope);
- CLI used above (`run`, `plugin list`, `debug agents`, `mcp list`, `reload`) —
  <https://opencode.ai/v2/docs/cli/commands> and `/cli/plugins`.

---

## 12. Installing the MCP server

The MCP server is part of the plugin; installing the plugin copies it too
(it travels inside `plugins/core-brain/mcp/`). Only the `opencode.json` entry
is added by hand.

### Step 1 — add the `mcp.servers` entry

In `~/.config/opencode/opencode.json`, inside `mcp.servers`:

```json
"core-brain": {
  "type": "local",
  "command": ["node", "/home/<user>/.config/opencode/plugins/core-brain/mcp/server.js"],
  "environment": { "CORE_BRAIN_HOME": "/home/<user>/.core-brain" }
}
```

**The key is `environment`, not `env`.** Measured on this machine: an entry
written with `"env": { … }` is accepted by the parser and **silently dropped** —
the variable never reaches the server. (`opencode2 mcp add --env k=v` writes
`"environment"` for the same reason.)

Notes:

- The path must point at the **mirror** the running engine loads
  (`~/.config/opencode/…`), not at the repository.
- `CORE_BRAIN_HOME` is optional: without it the server resolves `~/.core-brain`
  from the user's home. Keep it when the store lives elsewhere.
- The MCP process reads the same engine runtime (section 2); the same
  `CORE_BRAIN_RUNTIME_DIR` / `CORE_BRAIN_MODELS_DIR` / `CORE_BRAIN_RERANKER`
  variables apply to it.

### Step 2 — reload

```bash
opencode2 reload
```

so the running service spawns the new server. (A local MCP server is spawned
per session; a reload makes it visible to new sessions.)

### Step 3 — verify

```bash
opencode2 mcp list
```

`core-brain` must show **connected**, and so must `plur` — the two coexist.

### Step 4 — smoke test

```bash
bash ~/.config/opencode/plugins/core-brain/mcp/check.sh
```

Expected: **19/19 Layer-A lines PASS** and **27/27 Layer-B lines PASS**, exit
code 0. The check drives the real server over stdio (`initialize` →
`notifications/initialized` → `tools/list` → `tools/call`) and asserts that
responses arrive in request order (the async seam).

### Step 5 — coexistence

Confirm `~/.plur/` is untouched and the `plur` MCP is still connected in the
same `mcp list` output. Nothing in this plugin reads or writes PLUR data.

### Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `mcp list` does not show `core-brain` | the path in `command` is wrong — it must be the mirror (`~/.config/opencode/…`); then `opencode2 reload` |
| data appears in an unexpected directory | `CORE_BRAIN_HOME` in the `environment` block points elsewhere, or the key was written as `env` and ignored |
| a change under `~/.config/opencode` disappeared | that tree is generated — edit the **source** (`global/opencode/`) and re-run the installer |
| `core_recall` returns only global results | by design: it is an administration view, not an agent view; per-agent recall uses `core_memory` |
