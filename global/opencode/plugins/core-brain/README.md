# core-brain

Per-agent memory isolation for OpenCode V2: **one tool** (`core_memory`), a
**private namespace per agent**, and an **optional shared global namespace** —
driven entirely by a small `config.json`. Real per-namespace vector storage,
in-process cosine ranking, and a deterministic offline embedder with **zero
runtime dependencies** (Node builtins only).

| | |
|---|---|
| Plugin id | `core-brain` |
| npm name | `@oesc/core-brain` |
| Version | `0.1.0` |
| Data root | `~/.core-brain/` (override with `CORE_BRAIN_HOME`) |
| Tool | `core_memory` (`who` \| `store` \| `recall`) |
| Runtime deps | **none** — `node:fs`, `node:path`, `node:os`, `node:crypto`, `node:url` |
| **License** | **MIT License** — see [`LICENSE`](LICENSE) and the repository root |

## Acknowledgment — a fork/substitute built on PLUR Memory

**core-brain is a fork of, and a deliberate substitute for, the PLUR Memory
project.** It was built upon and inspired by PLUR Memory, and this
acknowledgment is required by the original specification
([`docs/core_brain_specification.md`](../../../../docs/core_brain_specification.md) §5):

> **Original project acknowledgment:** built upon and inspired by the original
> PLUR Memory project — <http://linkhere.github.com>.

The two projects are independent: they share no code, no dependency, no data
directory, no config file, no environment variable, no port and no tool
namespace (the full map is in [Zero collision with PLUR](#zero-collision-with-plur)).
Acknowledgment is a matter of origin and credit, not of shared machinery.

## What it is

OpenCode V2 plugins run in-process. This one registers a single tool that an
agent calls to remember and to recall:

- **`who`** — report the calling agent's configured policy.
- **`store`** — persist a text record into `self` (its own namespace) or into
  `global` (the shared namespace), when the policy allows it.
- **`recall`** — search the namespaces the calling agent is allowed to read,
  rank the records by cosine similarity, and report which namespaces were
  scanned.

The **calling agent's identity is never an input field**. It is resolved from
the running session (the trusted plugin context) and looked up in
`config.json`; a caller cannot name itself, and an agent that is not in the
config gets the **default policy** (`private:false` + `hasGlobalAccess:true`)
instead of being refused.

## Configuration — `~/.core-brain/config.json`

```json
{
  "agents": [
    { "name": "agent_alpha", "hasGlobalAccess": true,  "private": false },
    { "name": "agent_beta",  "hasGlobalAccess": true,  "private": true  },
    { "name": "agent_gamma", "hasGlobalAccess": false, "private": true  }
  ]
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `name` | string | yes | Unique, filename-safe identifier. It maps directly to the agent's isolated namespace (`agents/<name>/`, `vectors/<name>/`). |
| `hasGlobalAccess` | boolean | no (default `true`) | Whether this agent may read and write the shared `global` namespace. |
| `private` | boolean | no (default `false`) | Whether this agent's own namespace is closed to every other agent. |

**Precedence** (first existing file wins):

1. `options.configPath` — plugin options, when the plugin is configured with an
   object form in `opencode.json(c)`;
2. `$CORE_BRAIN_HOME/config.json`;
3. `~/.core-brain/config.json`;
4. `<dataRoot>/config.json`;
5. `<pluginDir>/config.json` — the development seed shipped in this folder.

### Validation rules

The whole file is validated **at init, before any read or write**:

- every entry needs a non-empty, filename-safe `name` (`[A-Za-z0-9][A-Za-z0-9._-]*`);
  `hasGlobalAccess` and `private`, when present, must be booleans — omitting
  either key takes its default (`hasGlobalAccess` → `true`, `private` → `false`),
  while a present `null`, string or number is rejected;
- names must be unique;
- **`private: false` + `hasGlobalAccess: false` is invalid** and aborts the
  engine with `InvalidConfigurationError` (`.code === "INVALID_CONFIGURATION"`,
  message naming the offending agent and the rule). A *public* agent that cannot
  reach the shared layer is a contradiction: it neither contributes to shared
  knowledge nor keeps its own space readable-by-others. The rule is applied
  **after** the defaults are resolved, so a row with `hasGlobalAccess: false`
  and no `private` still aborts (its `private` defaults to `false`).

An agent that is **not** listed in `config.json` is no longer refused: it gets
the synthesized default policy `private: false` + `hasGlobalAccess: true`, so it
can use `self` and `global` like any public agent. Its namespace does **not**
join another agent's public read union and is not readable through
`agent:<name>` — a namespace becomes readable by others only by being a
configured row with `private: false` (see the access matrix below).

## Access matrix

Read (which datasets an agent `A` may query, from `docs/core_brain_specification.md` §4):

| `private` | `hasGlobalAccess` | Status | Datasets read by the agent | Readable by other agents? |
|:---------:|:-----------------:|:------:|----------------------------|:-------------------------:|
| `false` | `true`  | **Valid** | `agent_db(A)` + `global_db` | Yes (public agent space) |
| `false` | `false` | **Invalid** | **throws `InvalidConfigurationError` at init** | N/A |
| `true`  | `true`  | **Valid** | `agent_db(A)` + `global_db` | **No** (private to this agent) |
| `true`  | `false` | **Valid** | `agent_db(A)` only | **No** (private to this agent) |
| `false` | `true`  | **Valid** (default for an absent row, or a row omitting the key) | `agent_db(A)` + `global_db` | **No** (unlisted namespace stays out of the union) |

Write rules (target authorization):

| Target | Allowed when |
|---|---|
| `self` | always → `agents/<A>/` |
| `global` | `hasGlobalAccess(A) === true`; otherwise refused with `agent '<A>' cannot write to 'global': no global access` |
| `agent:<B>` with `B ≠ A` | **always refused** — `target is private — cross-agent write not allowed` (or `cross-agent write not allowed` when `B` is public) |
| `agent:<A>` | treated as `self` |

A cross-namespace **read** into a private namespace is *omitted, not errored*:
`recall` returns `results: []` and the private namespace does not appear in
`scanned`.

## The `core_memory` tool

Input schema (JSON Schema, `additionalProperties: false` — there is deliberately
**no** identity field):

| Field | Type | Used by | Meaning |
|---|---|---|---|
| `op` *(required)* | `"who"` \| `"store"` \| `"recall"` | all | the operation |
| `text` | string (non-empty) | store | the memory text to persist |
| `target` | string | store | `self` (default), `global`, `agent:<name>` |
| `meta` | object | store | optional metadata, stored verbatim |
| `query` | string | recall | text to rank against (cosine); omit to list the most recent records |
| `limit` | integer | recall | maximum results (default 5) |
| `from` | string | recall | `self`, `global`, `agent:<name>`; omitted = every namespace this agent may read |

Results — the tool returns this JSON as its content:

```jsonc
// who
{ "agent": "agent_beta", "name": "agent_beta", "private": true,
  "hasGlobalAccess": true, "dataDir": "/home/<user>/.core-brain" }

// store
{ "ok": true, "id": "<uuid>", "scope": "agent", "ns": "agent:agent_beta" }

// recall
{ "results": [ { "id": "<uuid>", "text": "…", "agent": "agent_beta",
                 "scope": "agent", "score": 0.87, "retrievals": 3 } ],
  "scanned": ["agent:agent_beta", "global"] }
```

A refusal is a clear `ERROR:` line, never a silent empty result — for example:

```
ERROR: core_memory store: agent 'CB_GAMMA' cannot write to 'global': no global access
```

`recall` ranks by cosine similarity (tie-break: `updatedAt` descending),
increments `retrievals` on every returned hit, and always reports `scanned` so
the caller can see which namespaces were consulted.

## Storage

Root: `~/.core-brain/` — override with the **`CORE_BRAIN_HOME`** environment
variable (the self-test points it at a disposable temp directory). The root is
the **user profile** directory on purpose, so every project on the machine
shares one memory store, and nothing is ever written into the project tree.

```
~/.core-brain/
  config.json                  # the authoritative policy (see above)
  debug.log                    # only when CORE_BRAIN_DEBUG is set
  global/
    memories.json              # global_db records
  agents/
    <name>/
      memories.json            # agent_db records, one directory per agent
  vectors/
    global/index.json          # { embedder, dim, vectors: { "<id>": number[256] } }
    <name>/index.json
```

Every write is **atomic**: the JSON goes to a `*.tmp` file in the same directory
and is then `fs.rename`d over the target, so a crash can never leave a
half-written store. Records are plain JSON — no database engine, no SQLite, no
YAML, no external dependency.

```jsonc
// record shape
{ "id": "<uuid>", "agent": "agent_beta", "scope": "agent", "text": "…",
  "meta": {}, "createdAt": "ISO-8601", "updatedAt": "ISO-8601", "retrievals": 0 }
```

## Embedder — `hash-ngram-v1` (declared stub)

v1 ships a **deterministic, offline, dependency-free** embedder: `text →
number[256]` by feature hashing of character n-grams (n = 2..4, lowercased,
whitespace-collapsed, space-padded), double-hashed into 256 buckets with a
signed second hash, then L2-normalised. The embedder id and the dimension are
stamped in every `vectors/<ns>/index.json`, so swapping the embedder invalidates
old vectors instead of silently mixing them.

**It is a stub, and it is declared as one.** It is good enough for isolation and
determinism — the access matrix and top-k retrieval run for real, in-process,
over real stored vectors — but it is **not** good enough for semantic search
quality. A production semantic embedder is a declared follow-up (see
[v1 vs roadmap](#v1-vs-roadmap)).

## Zero collision with PLUR

PLUR Memory stays installed and working next to this plugin; every identifier is
distinct.

| Artifact | PLUR Memory (existing) | core-brain (this plugin) | Collision? |
|---|---|---|---|
| Plugin id | `plur-memory` | `core-brain` | No |
| Plugin dir | `~/.config/opencode/plugins/plur-memory/` | `~/.config/opencode/plugins/core-brain/` | No |
| npm name | `opencode-plur-memory` | `@oesc/core-brain` | No |
| Runtime dependency | `@plur-ai/core` (postgres / sharp / onnxruntime-web / zod) | **none** — Node builtins only | No |
| Data dir | `~/.plur/` | `~/.core-brain/` | No |
| Config file | `~/.plur/config.yaml` | `~/.core-brain/config.json` | No |
| Env vars | `PLUR_DEBUG`, `PLUR_PATH` | `CORE_BRAIN_DEBUG`, `CORE_BRAIN_HOME` | No |
| Network server / port / PID | yes — MCP server + `server.pid` | **none** — in-process tool | No |
| Embeddings cache | `~/.plur/.embeddings-cache.json` | `~/.core-brain/vectors/<ns>/index.json` | No |
| Tool namespace | `plur_*` (`plur_admin`, `plur_learn`, …) | `core_memory` (single tool) | No |
| License | Apache-2.0 | MIT | No |

## v1 vs roadmap

**In v1:** per-agent isolated namespaces plus the shared global namespace; the
authorizer and the error shapes above; real atomic JSON persistence; real
in-process cosine top-k; the `hash-ngram-v1` stub embedder; one tool; an
**inert** `prompt` hook that only records the active agent for debug logging (it
never edits the user's prompt and never injects into the system block); **no**
`compaction` hook; and **tools-only** behaviour, so an agent that is not listed
in the config gets the default policy (`private:false` + `hasGlobalAccess:true`)
the moment it calls `core_memory` — the `prompt` hook stays inert for it.

**Roadmap (declared, not v1 gaps):** a production semantic embedder (local
sentence-transformer or API-backed) replacing the stub; opt-in context injection
for selected agents (`inject: true`, off by default); a `compaction` hook that
stores salient facts; optional multi-process safety (a file lock) when two
agents write the same namespace concurrently; automated Layer B smoke in CI.

## Verified in the real environment (2026-10-01)

Measured on a live OpenCode V2 install (Node v24.15.0), not simulated:

- `opencode2 plugin list` → **8 plugins**, including `core-brain` at
  `~/.config/opencode/plugins/core-brain/index.ts`;
- `opencode2 debug agents` → **23 → 27**: `CB_ALPHA`, `CB_BETA`, `CB_GAMMA` and
  `CB_DELTA` added, **none removed**, the 23 pre-existing agents byte-identical;
- `bash global/opencode/plugins/core-brain/check.sh` → **13/13 matrix lines PASS**,
  exit code `0` (8 lines at the 2026-10-01 baseline; 5 default-policy lines added
  2026-10-02) — the access-isolation matrix, in-process, on a disposable
  `CORE_BRAIN_HOME`;
- three real headless smokes (`opencode2 run --agent <X> --auto "…"`):
  `CB_BETA` stored and recalled its own record; `CB_GAMMA` was refused on
  `store target:"global"` with `no global access`; `CB_ALPHA` wrote and read the
  global space and was refused on `store target:"agent:CB_BETA"` with
  `target is private — cross-agent write not allowed`;
- persistence confirmed under `~/.core-brain/`: `global/memories.json`,
  `agents/<name>/memories.json`, `vectors/<ns>/index.json` with
  `embedder=hash-ngram-v1` and `dim=256`;
- coexistence: `~/.plur/` untouched and the `plur` MCP still `connected`.

## Install

See [`INSTALACAO.md`](INSTALACAO.md) for the full step-by-step: install,
configure, reload, verify, coexistence check and troubleshooting.

## License

MIT — see [`LICENSE`](LICENSE).
