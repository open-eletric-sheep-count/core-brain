# core-brain

Per-agent memory isolation for OpenCode V2: **one tool** (`core_memory`), a
**private namespace per agent**, and an **optional shared global namespace** —
driven entirely by a small `config.json`. Real per-namespace vector storage and
hybrid retrieval (BM25 + vector, fused by RRF) with a real semantic embedder
(`Xenova/bge-small-en-v1.5`); the Node engine runtime is provisioned once,
outside the plugin tree. See [Engine](#engine--hybrid-retrieval) and
[`INSTALACAO.md`](INSTALACAO.md).

| | |
|---|---|
| Plugin id | `core-brain` |
| npm name | `@oesc/core-brain` |
| Version | `0.1.0` |
| Data root | `~/.core-brain/` (override with `CORE_BRAIN_HOME`) |
| Tool | `core_memory` (`who` \| `store` \| `recall` \| `forget` \| `feedback`) |
| Runtime deps | `@huggingface/transformers` **4.3.0** — the engine runtime, provisioned into `~/.core-brain/runtime` (never inside the plugin tree); the plugin itself imports only `node:*` builtins |
| **License** | **(MIT AND Apache-2.0)** — MIT for core-brain's own files; Apache-2.0 for the four ported `engine/` files — see [`LICENSE`](LICENSE), [`LICENSE-APACHE`](LICENSE-APACHE) and [`NOTICE`](NOTICE) |

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
- **`recall`** — search the namespaces the calling agent is allowed to read
  (hybrid BM25 + vector, fused by RRF; see [Engine](#engine--hybrid-retrieval)),
  and report which namespaces were scanned and the ranking mode used.
- **`forget`** — soft-retire a record by `id` or by `query`; the record leaves
  recall but its text stays on disk.
- **`feedback`** — increment a usefulness counter on a record the caller may
  read, feeding the ranking tie-break.

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
| `op` *(required)* | `"who"` \| `"store"` \| `"recall"` \| `"forget"` \| `"feedback"` | all | the operation |
| `text` | string (non-empty) | store | the memory text to persist |
| `target` | string | store, forget | `self` (default), `global`, `agent:<name>` — `forget` accepts `self` or `global` only |
| `meta` | object | store | optional metadata, stored verbatim |
| `query` | string | recall, forget | text to rank against (cosine); omit to list the most recent records — `forget` retires every active record at/above the match threshold |
| `limit` | integer | recall | maximum results (default 5) |
| `from` | string | recall | `self`, `global`, `agent:<name>`; omitted = every namespace this agent may read |
| `id` | string | forget, feedback | the record id — forget's exact record, or feedback's target record |
| `useful` | boolean | feedback | whether the record was useful |

- **`forget`** — soft retire by `id` or `query`; the record leaves recall but its text stays on disk.
- **`feedback`** — increments a usefulness counter on a record the caller may read.

Results — the tool returns this JSON as its content:

```jsonc
// who
{ "agent": "agent_beta", "name": "agent_beta", "private": true,
  "hasGlobalAccess": true, "dataDir": "/home/<user>/.core-brain" }

// store
{ "ok": true, "id": "<uuid>", "scope": "agent", "ns": "agent:agent_beta" }

// recall
{ "results": [ { "id": "<uuid>", "text": "…", "agent": "agent_beta",
                 "scope": "agent", "score": 0.0325, "rrf": 0.0325,
                 "legs": { "bm25": 5.269, "vector": 0.997 }, "retrievals": 3 } ],
  "scanned": ["agent:agent_beta", "global"],
  "mode": "hybrid", "reranked": 0 }
```

A refusal is a clear `ERROR:` line, never a silent empty result — for example:

```
ERROR: core_memory store: agent 'CB_GAMMA' cannot write to 'global': no global access
```

`recall` ranks by the fused RRF score; the final tie-break is
`rrf desc → feedback.useful desc → raw cosine desc → id asc`. A recall **without
a query** keeps the v1 behaviour (`feedback.useful desc → retrievals desc →
updatedAt desc`) and reports `mode: "hybrid"` with
`legs: { bm25: null, vector: null }` and `reranked: 0`. `recall` increments
`retrievals` on every returned hit, and always reports `scanned` so the caller
can see which namespaces were consulted.

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
    global/index.json          # { embedder, dim, revision, vectors: { "<id>": number[384] } }
    <name>/index.json
```

Every write is **atomic**: the JSON goes to a `*.tmp` file in the same directory
and is then `fs.rename`d over the target, so a crash can never leave a
half-written store. Records are plain JSON — no database engine, no SQLite, no
YAML, no external dependency.

```jsonc
// record shape
{ "id": "<uuid>", "agent": "agent_beta", "scope": "agent", "text": "…",
  "meta": {}, "createdAt": "ISO-8601", "updatedAt": "ISO-8601", "retrievals": 0,
  "retiredAt": "ISO-8601",                  // OPTIONAL — soft retire (forget)
  "feedback": { "useful": 0, "useless": 0 } // OPTIONAL — usefulness (feedback)
}
```

`retiredAt?: string` and `feedback?: { useful, useless }` are **OPTIONAL**: a
record written by v0.1.0 carries neither and still reads as **active** (no
`retiredAt`) and **neutral** (no `feedback`).

## Engine — hybrid retrieval

### Real embedder — `Xenova/bge-small-en-v1.5`

The active embedder is the real sentence-transformer `Xenova/bge-small-en-v1.5`,
loaded through `@huggingface/transformers@4.3.0`:

| | |
|---|---|
| Model id | `Xenova/bge-small-en-v1.5` |
| Dimension | **384** |
| Pooling | **`cls`** (not `mean`) |
| dtype | `fp32` |
| ONNX artifact (download) | **133,093,490 B** (`onnx/model.onnx`, measured) |
| Weights cache | `~/.core-brain/models` (override `CORE_BRAIN_MODELS_DIR`, alias `CORE_BRAIN_MODELS`) |
| Runtime | `~/.core-brain/runtime` (override `CORE_BRAIN_RUNTIME_DIR`; provisioned by `install-runtime.sh`) |

The runtime and the weights live **outside** the plugin tree and the mirror, and
the engine **fails closed**: if the runtime is absent, `store`/`recall` throw a
named `EngineUnavailableError` naming `install-runtime.sh` — there is no silent
fallback. The deterministic `hash-ngram-v1` double (`text → number[256]`) is
kept, but it is only ever selected **explicitly** (offline fixture / v1 indexes),
never chosen implicitly by the real path. See [`INSTALACAO.md`](INSTALACAO.md) §2.

### Hybrid search — BM25 + vector, fused by RRF

The corpus of **both** legs is exactly the set of namespaces `recall` is allowed
to read — the hybrid path never widens the read set.

- **BM25 leg** — `k1 = 1.2`, `b = 0.75`, tokenizer version 4 (ported from PLUR
  `@plur-ai/core@0.21.0`); top `min(corpus, limit × 3)`.
- **Vector leg** — cosine of the embedded query against each record vector; top
  `min(corpus, limit × 2)`.
- **Fusion** — Reciprocal Rank Fusion, `k = 60`: each ranked item contributes
  `1 / (k + rank + 1)`, summed per id, highest first. `limit` defaults to 5.

**Two core-brain constants are refinements the PLUR does NOT have** (declared,
not hidden — they exist to satisfy AC1, the semantic probe):

1. **`MIN_VECTOR_SIMILARITY = 0.05`** — a vector-leg admission floor. A cosine at
   or below the floor is orthogonal (no semantic relation) and must not buy a
   rank; without it an irrelevant record that matches both legs outscores a
   semantically correct record that matches only one.
2. **Deterministic tie-break** — equal `rrf` is broken by the raw cosine
   (descending; absent from the vector leg is worst), then by `id` ascending, so
   the order never depends on map insertion order.

`recall` also reports `mode` (`hybrid` | `hybrid-degraded` | `bm25-only`),
`reranked` (the number of items the reranker reordered) and, per hit, `rrf` plus
the raw `legs` (`{ bm25, vector }`) so an external caller can recompute the
fusion.

### Reranker — OFF by default

An optional cross-encoder (`Xenova/ms-marco-MiniLM-L-6-v2`, dtype `q8`, head
`topK = 50`) can reorder the RRF result. It is **off by default** — turn it on
with `CORE_BRAIN_RERANKER=ms-marco` (or by injecting a `Reranker`). A reranker
failure never reorders silently: it returns the RRF order unchanged, reports
`reranked: 0` and sets `mode: "hybrid-degraded"`.

### Known bound — the literal AC1 criterion is a declared spec defect (not demonstrated)

AC1 asks the engine to rank a **no-shared-word paraphrase above a lexical decoy**
(a record that shares words but is about a different thing). With the **real**
embedder (`Xenova/bge-small-en-v1.5`, pooling `cls`) that literal criterion is
**not demonstrable**, and it is recorded here as a **declared spec defect — not a
resolved behaviour**:

- **The BGE cosine is compressed at the top.** A text with **no relation at all**
  already scores **0.3908**, so the `MIN_VECTOR_SIMILARITY = 0.05` floor admits
  everything and filters nothing.
- **The model prefers lexical neighbours.** A decoy that shares words with the
  query scores **0.5652** — inside, not below, the range of genuine paraphrases
  (**0.6601–0.7811**).
- **RRF counts presence, not score.** A record that appears in **both** legs
  outranks one that appears in a single leg. As long as the decoy clears the
  floor it sits in both legs (`1/61` BM25 + `1/(61+r)` vector), which is strictly
  more than the `1/61` a vector-only paraphrase can score.
- **The reranker does not correct this.** Measured with
  `CORE_BRAIN_RERANKER=ms-marco` (weights downloaded), the order is unchanged and
  the decoy stays at rank 0.

The offline fixture probe (`--probe semantic`, fixture embedder) stays green
because the fixture is a **designed double**; the **real** run fails. What *is*
demonstrated — real hybrid retrieval, the stamped index with the `STALE_INDEX`
refusal, idempotent reindex and the 13/13 isolation matrix — is listed under
[Verified in the real environment](#verified-in-the-real-environment-2026-10-01-re-measured-2026-10-03).

### Stamped index — stale indexes are refused

Every `vectors/<ns>/index.json` header is
`{ embedder, dim, revision, vectors }`, where `revision` is the model-artifact
fingerprint `<modelId>@<dtype>@<first 16 hex of sha256(onnx/model.onnx)>`. If a
namespace holds records but its index was built by a different engine, `recall`
**throws** `STALE_INDEX` (naming the namespace and `reindex`) instead of
silently answering with the wrong vectors. `admin reindex` rebuilds the index
with the active engine and is idempotent (two consecutive runs produce a
byte-identical `index.json`).

### Measured cost (E8)

`du -sb` figures are apparent bytes; `du -sh` (allocated disk) is a different
measure and is never mixed in. No composite total is stated — every line below
is a single measured value.

| Component | Command | Value |
|---|---|---|
| Engine runtime dir | `du -sb "$CORE_BRAIN_RUNTIME_DIR"` | **767,972,854 B** (`~/.core-brain/runtime` — `@huggingface/transformers@4.3.0` and its closure; `du -sb`, measured 2026-10-04) |
| Model weights dir | `du -sb "$CORE_BRAIN_MODELS_DIR"` | **157,662,896 B** (`~/.core-brain/models` — the `bge-small-en-v1.5` embedder **and** the `ms-marco` reranker; `du -sb`, measured 2026-10-04) |
| `bge-small` fp32 `onnx/model.onnx` (download) | measured artifact | **133,093,490 B** |
| `onnxruntime-node` prune (linux/x64 only) | `du -sb` before/after on a copy | **254,789,872 B saved** (574,221,664 B → 319,431,792 B; Fatia 0 / B3 measurement, reproduced by `prune-runtime.sh`) |
| Weights inside the plugin tree | `find … -name '*.onnx' \| wc -l` | **0** (by design: runtime and weights live under `~/.core-brain/`) |

---
## MCP server — `core-brain`

The plugin ships a companion **MCP server** that exposes the store's
administration surface over stdio, so a script, a cron or the USER's own
tooling can read the shared layer without a session. It is declared in
`opencode.json` → `mcp.servers.core-brain` and launched with:

```json
"core-brain": {
  "type": "local",
  "command": ["node", "/home/<user>/.config/opencode/plugins/core-brain/mcp/server.js"]
}
```

No port, no daemon, no PID file — stdio only, and **zero runtime
dependencies**: the newline-delimited JSON-RPC 2.0 transport lives in the repo
(`mcp/jsonrpc.js` + `mcp/server.js`), with no `@modelcontextprotocol/*` and no
`zod`. The store keeps using `node:fs` / `node:path` / `node:os` /
`node:crypto` / `node:url` only.

### The five tools

| Tool | What it returns |
|---|---|
| `core_recall` | reads the **global namespace only** — *"global namespace only — this is not an agent view; per-agent recall goes through the `core_memory` tool."* |
| `core_status` | per-namespace counts (records / retired / retrievals), storage root, config path, embedder and dim — **counts only, never memory text** |
| `core_doctor` | the five health checks, each with an id, an ok flag and a detail |
| `core_receipt` | counted report of what was stored and retrieved |
| `core_admin` | `purge` / `reindex` / `export` / `import` / `compact` |

Invalid requests are JSON-RPC errors (`-32602`); a refusal raised by the store comes back as a tool result with `isError: true` and an `ERROR: …` text — the MCP convention for protocol errors versus tool-level errors.

### Why the agent-facing operations are NOT on the MCP

An MCP server receives **no session and no agent identity** — measured on this
machine: the environment of a local MCP process carries no
`OPENCODE_SESSION_ID` and no agent key. Any per-agent operation exposed over
MCP would therefore have to accept the agent name as a **tool argument**, and
anything the model can type, the model can forge — which would defeat the
isolation this project exists to provide. Identity-needing operations
(`store`, `recall`, `forget`, `feedback`) stay on the plugin tool
`core_memory`, whose identity comes from the running session.

The MCP is the **administration/observability surface**; `core_recall` is the
single read it offers, and it is explicitly a global-namespace view.

### New plugin operations (this slice)

- **`forget`** — retires a record without deleting it (by `id`, or by `query` above the match threshold). A retired record is excluded from recall; its text stays on disk.
- **`feedback`** — records whether a record the caller may read was useful. It feeds the ranking tie-break: `score desc → feedback.useful desc → retrievals desc → updatedAt desc`.

### Coexistence with PLUR

Both MCP servers run side by side during the transition — no identifier is
shared:

| Artifact | PLUR | core-brain MCP |
|---|---|---|
| Server name | `plur` | `core-brain` |
| Command | `npx -y @plur-ai/mcp` | local `node …/mcp/server.js` |
| Tool prefix | `plur_*` | `core_*` |
| Store | `~/.plur/` | `~/.core-brain/` |
| Runtime deps | 5 packages (3 × `@modelcontextprotocol/*` + `zod`) | **zero** |

See [`INSTALACAO.md`](INSTALACAO.md) for the install and verification steps.

---

## Zero collision with PLUR

PLUR Memory stays installed and working next to this plugin; every identifier is
distinct.

| Artifact | PLUR Memory (existing) | core-brain (this plugin) | Collision? |
|---|---|---|---|
| Plugin id | `plur-memory` | `core-brain` | No |
| Plugin dir | `~/.config/opencode/plugins/plur-memory/` | `~/.config/opencode/plugins/core-brain/` | No |
| npm name | `opencode-plur-memory` | `@oesc/core-brain` | No |
| Runtime dependency | `@plur-ai/core` (postgres / sharp / onnxruntime-web / zod) | `@huggingface/transformers` 4.3.0 — an own copy in `~/.core-brain/runtime` (not in the plugin tree, not in the mirror) | No |
| Data dir | `~/.plur/` | `~/.core-brain/` | No |
| Config file | `~/.plur/config.yaml` | `~/.core-brain/config.json` | No |
| Env vars | `PLUR_DEBUG`, `PLUR_PATH` | `CORE_BRAIN_DEBUG`, `CORE_BRAIN_HOME`, `CORE_BRAIN_RUNTIME_DIR`, `CORE_BRAIN_MODELS_DIR`, `CORE_BRAIN_OFFLINE`, `CORE_BRAIN_EMBEDDER`, `CORE_BRAIN_RERANKER` | No |
| Network server / port / PID | yes — MCP server + `server.pid` | **none** — in-process tool | No |
| Embeddings cache | `~/.plur/.embeddings-cache.json` | `~/.core-brain/vectors/<ns>/index.json` | No |
| Tool namespace | `plur_*` (`plur_admin`, `plur_learn`, …) | `core_memory` (single tool) | No |
| License | Apache-2.0 | (MIT AND Apache-2.0) | No |

## v1 vs roadmap

**In v1:** per-agent isolated namespaces plus the shared global namespace; the
authorizer and the error shapes above; real atomic JSON persistence; the **real
semantic embedder** (`Xenova/bge-small-en-v1.5`, `dim 384`, `cls` pooling,
`fp32`) loaded from the provisioned runtime; **hybrid retrieval** (BM25 + vector)
fused by **RRF** (`k = 60`) with the `MIN_VECTOR_SIMILARITY = 0.05` admission
floor and a deterministic cosine tie-break; the **stamped index** with the
`STALE_INDEX` refusal and an idempotent `reindex`; an **off-by-default**
cross-encoder reranker; one tool; an **inert** `prompt` hook that only records
the active agent for debug logging (it never edits the user's prompt and never
injects into the system block); **no** `compaction` hook; and **tools-only**
behaviour, so an agent that is not listed in the config gets the default policy
(`private:false` + `hasGlobalAccess:true`) the moment it calls `core_memory` —
the `prompt` hook stays inert for it. The deterministic `hash-ngram-v1` double
(`text → number[256]`) is still shipped, but only as an **explicit** offline
fixture — never chosen implicitly by the real path.

**Roadmap (declared, not v1 gaps):** opt-in context injection for selected agents
(`inject: true`, off by default); a `compaction` hook that stores salient facts;
optional multi-process safety (a file lock) when two agents write the same
namespace concurrently; automated Layer B smoke in CI.

## Verified in the real environment (2026-10-01; re-measured 2026-10-03)

Measured on a live OpenCode V2 install (Node v24.15.0), not simulated:

- `opencode2 plugin list` → **8 plugins**, including `core-brain` at
  `~/.config/opencode/plugins/core-brain/index.ts`;
- `opencode2 debug agents` → **23 → 27**: `CB_ALPHA`, `CB_BETA`, `CB_GAMMA` and
  `CB_DELTA` added, **none removed**, the 23 pre-existing agents byte-identical;
- `bash global/opencode/plugins/core-brain/check.sh` → **13/13 matrix lines PASS**
  and **7/7 offline search probes PASS**, exit code `0` (8 lines at the
  2026-10-01 baseline; 5 default-policy lines added 2026-10-02) — the
  access-isolation matrix plus the hybrid probes, in-process, on a disposable
  `CORE_BRAIN_HOME`;
- `bash global/opencode/plugins/core-brain/mcp/check.sh` → **19/19 Layer-A lines
  PASS** and **27/27 Layer-B lines PASS**, exit code `0` (the real stdio
  transport, `initialize` → `tools/list` → `tools/call`);
- `tsc` on the plugin sources → **0 errors**;
- three real headless smokes (`opencode2 run --agent <X> --auto "…"`):
  `CB_BETA` stored and recalled its own record; `CB_GAMMA` was refused on
  `store target:"global"` with `no global access`; `CB_ALPHA` wrote and read the
  global space and was refused on `store target:"agent:CB_BETA"` with
  `target is private — cross-agent write not allowed`;
- persistence confirmed under `~/.core-brain/`: `global/memories.json`,
  `agents/<name>/memories.json`, `vectors/<ns>/index.json`, the latter stamped
  `{ embedder, dim, revision, vectors }`. The offline fixture path stamps
  `hash-ngram-v1` / `dim 256`; the real `Xenova/bge-small-en-v1.5` stamp
  (`dim 384`) is **PENDENTE — runtime not provisioned** (see
  [Engine](#engine--hybrid-retrieval));
- coexistence: `~/.plur/` untouched and the `plur` MCP still `connected`.

## Install

See [`INSTALACAO.md`](INSTALACAO.md) for the full step-by-step: install,
configure, reload, verify, coexistence check and troubleshooting.

## License

**(MIT AND Apache-2.0)** — MIT for core-brain's own files (see
[`LICENSE`](LICENSE)); Apache-2.0 for the four files ported from
`@plur-ai/core@0.21.0` — `engine/fts.ts`, `engine/fusion.ts`,
`engine/embedder.ts`, `engine/reranker.ts` — (see
[`LICENSE-APACHE`](LICENSE-APACHE) and [`NOTICE`](NOTICE)). The package as a
whole is declared `"(MIT AND Apache-2.0)"` in `package.json`.
