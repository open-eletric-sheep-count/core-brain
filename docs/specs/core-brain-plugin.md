# core-brain — Active Spec (Plan / Contract)

- **Status:** ACTIVE (revision 2) — addresses ORACLE verdict D1–D10; awaiting ORACLE re-acceptance, then handed to TESTER → DEVELOPER
- **Author:** ARCHITECT
- **Date:** 2026-10-01
- **Upstream contract:** `docs/core_brain_specification.md` (65 lines, read in full) — this spec is the executable plan for that contract
- **Working folder:** `/media/gandb/workspace/oesc/core-brain`
- **Artifacts of this task are in English.** The DEVELOPER implements to THIS spec; the ORACLE (judge) attacks it against the 16 USER acceptance criteria below.

> This document is the **law** for the slice. Every path a user (agent) can see, every access rule, and every config error MUST be demonstrated in the running product, not just unit-tested. Green tests are the floor, not the bar.

---

## 0. Scope & non-goals

**In scope (v1):**
- A V2 OpenCode plugin `core-brain` that gives each configured agent an isolated vector namespace + an optional shared global namespace, driven by `config.json`.
- One tool (`core_memory`) the agents call to `who` / `store` / `recall`.
- A real, in-process access-authorization layer + real per-namespace vector storage; a declared **stub-grade** deterministic embedder.
- Dedicated test agents + a two-layer test plan that **runs** the isolation matrix.
- `README.md` + `INSTALACAO.md` (English), MIT + PLUR acknowledgment.

**Out of scope (v1, declared):**
- A production neural embedder (sentence-transformers, onnxruntime, API calls). v1 uses a deterministic hash/n-gram embedder so top-k cosine runs offline with **zero** external calls/dep/network. A production embedder is a follow-up (see §11 Roadmap).
- Context auto-injection into `event.system` for agents (kept OPT-IN; default off). v1 is TOOLS-ONLY by default.
- A network server / MCP / port (PLUR runs a server + `.embeddings-cache.json`; core-brain deliberately does not — no port, no PID file).
- Any **hand-write** to `~/.config/opencode/` by the agents — the mirror is populated **only** via the ORACLE-run `install-global.sh` (USER-authorized, no commit). See §12 [REQ] status + §15.2 repo rules.

---

## 1. Decision register (Q1–Q10)

Each line is a binding decision the DEVELOPER must follow. "Proposed" = an ARCHITECT choice the ORACLE can veto.

| # | Question | Decision |
|---|----------|----------|
| **Q1** | Where the plugin lives + id | Repo: `global/opencode/plugins/core-brain/` (single folder, same shape as `todo-list`/`context-inject`). Plugin `id: "core-brain"`. npm `name: "@oesc/core-brain"` (NOT `opencode-plur-memory`). Zero-collision proof in §3. |
| **Q2** | Language & structure | TypeScript/Node on the V2 plugin API. Files: `package.json`, `index.ts`, `store.ts`, `types.ts`, `tsconfig.json`, `shims.d.ts`, `check.sh`, dev `config.json` seed, `LICENSE`, `README.md`, `INSTALACAO.md`, plus `test/matrix.selftest.mjs`. Default export = plain object `{ id, setup }`, **no runtime OpenCode SDK import**. Node builtins only (`node:fs/os/path/url`); **zero external npm runtime deps**. |
| **Q3** | `config.json` contract | Authoritative at `~/.core-brain/config.json` (shared across projects — see Q4). Precedence: `options.configPath` > `~/.core-brain/config.json` > `<pluginDir>/config.json` (dev seed). Schema `agents[]` = `{ name (string, required, unique, filename-safe), hasGlobalAccess (boolean, required), private (boolean, required) }`. If any entry has `private===false && hasGlobalAccess===false` → throw `InvalidConfigurationError` (custom `Error` subclass, `.code === "INVALID_CONFIGURATION"`, message names the agent + the rule) **at init**, before any read/write. |
| **Q4** | Storage in `~/.core-brain` | See §4 (layout + persistence) and §5 (vectors: what is real vs stub). Data dir = `~/.core-brain/` (env-overridable `CORE_BRAIN_HOME` for tests). Never in the project root — memory is shared across projects. |
| **Q5** | Access matrix | See §6 (READ datasets + WRITE authorization), implemented exactly per upstream §4 incl. the invalid row. |
| **Q6** | Public API + identity | Single tool `core_memory` (§7). Identity = the session's OpenCode agent name, read from the hook context (`event.agent` / `ctx.session.get`), **never** user-supplied (no impersonation). Looked up in `config.json` by `name`; unlisted agent → fail-closed "not configured" error. |
| **Q7** | Integration without touching current agents | v1 = **TOOLS ONLY**. `prompt` hook only records the active agent; it **never mutates** `event.prompt.text` and **never injects** into `event.system` unless the agent is explicitly OPT-IN listed. No `compaction` hook in v1. Unlisted agents see zero change (§8 non-regression). |
| **Q8** | Dedicated test agents | 4 agents in `global/opencode/agent/` — `global/opencode/agent/CB_ALPHA.md`, `CB_BETA.md`, `CB_GAMMA.md`, `CB_DELTA.md` (`mode: all`, inherited model — see [REQ] R3 + the §9.1 discovery gate). Names match `config.json` `agents[].name`. Two-layer evidence: (a) data-layer functional self-test via `check.sh` against a TEMP dir (`CORE_BRAIN_HOME`) proving matrix rules 7–14 in-process; (b) headless live smoke `opencode2 run --agent CB_<X>` for the identity-resolution aspects of 7/11/13 (§9.1 pre-flight + §9.3). |
| **Q9** | Non-regression (criterion 5) | `opencode2 api GET /api/agent` snapshot **before** and **after** — the baseline count is whatever the snapshot reports (**not asserted**; the "25 agents" figure was unmeasured, per D7). The diff must show **only additions** (`CB_*`); every pre-existing agent byte-identical. `git status` shows only NEW files (no edits to existing `global/opencode/agent/*.md` or `opencode.json`). Prove the `prompt` hook is inert for an unlisted agent (a trivial headless run of an existing agent with no injected block). |
| **Q10** | Install plan | See §10 (becomes `INSTALACAO.md`). |

---

## 2. The 16 USER acceptance criteria (binding, none may be lost)

Renumbered to match the ORACLE/ORACLE brief. The "Proof" column names the executed evidence required — not a test that merely passes, but the *observable* outcome.

| # | Criterion (USER words) | Where it's covered | Required proof (observable) |
|---|------------------------|--------------------|-----------------------------|
| 1 | `README.md` exactly per upstream §5, incl. MIT + explicit PLUR acknowledgment | §3 collision/license, §10 | README file exists; contains `MIT License` line + the PLUR project acknowledgment sentence; DEVELOPER shows the two lines. |
| 2 | `INSTALACAO.md` full install+config step-by-step | §10 | File exists; covers clone → install → config → restart → verify → coexistence. |
| 3 | Zero collision with PLUR (file/executable/script/env/data-dir/port/plugin-id/dep) | §3 table | The §3 table is reproduced in the delivery + a live coexistence check (§10 step 9) shows `~/.plur/` untouched and PLUR still loaded. |
| 4 | Install & execution **tested & validated** in the real environment | §10 | `check.sh` run in the real env is green; a live `opencode2 run` executes `core_memory`. |
| 5 | Existing agents unaffected | §8 | Before/after `/api/agent` diff (§9 Q9) + inert-hook proof. |
| 6 | Dedicated test agents created | §9 Q8 | The 4 `CB_*` `.md` files exist and are listed by `/api/agent`. |
| 7 | `private:true` writes to private; another `private:true` cannot access | §6 rule, test CB_BETA vs CB_GAMMA | `check.sh` matrix line "7" PASS: CB_GAMMA recall from `agent:CB_BETA` returns **blocked/empty**; live smoke confirms identity. |
| 8 | `private:true` writes private; a **public** agent cannot access | §6 rule, test CB_BETA vs CB_ALPHA | `check.sh` matrix line "8" PASS: CB_ALPHA recall from `agent:CB_BETA` → **blocked/empty**. |
| 9 | `private:true` + `hasGlobalAccess:false` → clear error when trying to write global | §6, test CB_GAMMA | `check.sh` matrix line "9" PASS: CB_GAMMA `store target:"global"` → `Error` with `.code`/message naming the rule; observed text captured. |
| 10 | `private:true` + `hasGlobalAccess:true` → writes global; **any** agent with global access retrieves | §6, test CB_BETA then CB_ALPHA | `check.sh` matrix line "10" PASS: CB_BETA `store target:"global"` ok; CB_ALPHA `recall from:"global"` returns that record (literal value echoed). |
| 11 | `private:true` → the agent retrieves its own private memory | §6, test CB_GAMMA | `check.sh` matrix line "11" PASS: CB_GAMMA `store` then `recall` self returns its own record. |
| 12 | `private:false` + `hasGlobalAccess:false` → **init failure** with descriptive `InvalidConfigurationError` | §3, test CB_DELTA | `check.sh` matrix line "12" PASS: init with a CB_DELTA-shaped entry throws `InvalidConfigurationError`, message names the agent + rule; observed. |
| 13 | public (`private:false`) + `hasGlobalAccess:true` → writes global and retrieves | §6, test CB_ALPHA | `check.sh` matrix line "13" PASS: CB_ALPHA `store target:"global"` + `recall from:"global"` returns it. |
| 14 | public tries to write **directly** into a private space → **blocked** with detailed error | §6, test CB_ALPHA → `agent:CB_BETA` | `check.sh` matrix line "14" PASS: CB_ALPHA `store target:"agent:CB_BETA"` → **blocked** `Error`, message names target + "private". |
| 15 | Persistence in `~/.core-brain` (user profile dir, named after the new project), **not** project root, to share across projects | §4 | After a run, files exist under `~/.core-brain/` (or `CORE_BRAIN_HOME` in tests) and **not** under the repo root; a second "project" dir reads the same store. |
| 16 | Market-standard V2 plugin practices, with technical references | §2, §7 | Plugin shape matches `todo-list`/`context-inject` (`package.json`/`index.ts`/`tsconfig.json`/`shims.d.ts`/`check.sh`); references to the V2 plugin API cited in `INSTALACAO.md`. |

---

## 3. Zero-collision map vs PLUR (criterion 3)

PLUR facts (read-only, from `~/.config/opencode/plugins/plur-memory/`): id `plur-memory`, npm `opencode-plur-memory`, hard dep `@plur-ai/core` (postgres/sharp/onnxruntime-web/zod), data `~/.plur/`, config `~/.plur/config.yaml`, env `PLUR_DEBUG`/`PLUR_PATH`, runs a server (`.pid` + `.embeddings-cache.json`), license Apache-2.0.

| Artifact | PLUR (existing) | core-brain (new) | Collision? |
|----------|-----------------|------------------|:----------:|
| Plugin `id` | `plur-memory` | `core-brain` | No |
| Plugin dir | `~/.config/opencode/plugins/plur-memory/` | `~/.config/opencode/plugins/core-brain/` | No |
| npm `name` | `opencode-plur-memory` | `@oesc/core-brain` | No |
| Core runtime dep | `@plur-ai/core` | **none** (Node builtins only) | No |
| Data dir | `~/.plur/` | `~/.core-brain/` | No |
| Config file | `~/.plur/config.yaml` | `~/.core-brain/config.json` | No |
| Env vars | `PLUR_DEBUG`, `PLUR_PATH` | `CORE_BRAIN_DEBUG`, `CORE_BRAIN_HOME` | No |
| Network server / port / PID | yes (MCP server + `server.pid`) | **none** (in-process tool) | No |
| Embeddings cache | `~/.plur/.embeddings-cache.json` | `~/.core-brain/vectors/<ns>/index.json` | No |
| Tool namespace | `plur_*` (`plur_admin`, `plur_learn`, …) | `core_memory` (single tool) | No |
| License | Apache-2.0 | MIT | No |

**Delivery requirement:** the DEVELOPER reproduces this table in the final report and runs the coexistence check (§10 step 9): `~/.plur/` unmodified + PLUR still loaded after core-brain is active.

---

## 4. Storage layout & persistence (Q4 / criterion 15)

Root = `~/.core-brain/` (override with `CORE_BRAIN_HOME` for the self-test so it runs against a disposable temp dir).

```
~/.core-brain/
  config.json                     # authoritative agents[] config (user-maintained)
  global/
    memories.json                 # global_db records
  agents/
    <name>/
      memories.json               # agent_db records (one dir per agent name)
  vectors/
    global/
      index.json                  # { "<id>": number[] }  (real)
    <name>/
      index.json                  # { "<id>": number[] }  (real)
```

- **Persistence = JSON**, written **atomically** (write to `*.tmp` in the same dir, then `fs.rename`) — the proven `todo-list` pattern. No DB engine, no SQLite, no YAML, no external dep.
- **Memory record shape** (`types.ts`):
  ```ts
  {
    id: string,          // ULID-like or `crypto.randomUUID()`
    agent: string,       // owning agent name (or "global")
    scope: "agent" | "global",
    text: string,
    meta?: Record<string, unknown>,
    createdAt: string,   // ISO-8601
    updatedAt: string,   // ISO-8601
    retrievals: number   // counter, incremented on each recall hit
  }
  ```
- **Cross-project sharing (criterion 15):** because the root is the user-profile dir, two different project working directories resolve to the **same** `~/.core-brain/`. The self-test proves this by pointing two different `cwd` values at one `CORE_BRAIN_HOME` and reading back the same records.

---

## 5. Vectors — what is REAL vs STUB (Q4, criteria 4 & 15)

The upstream spec §3 says memory lives as "data **and vectors**" in the user dir. We are explicit about what is real so criterion 4 ("real execution") is honest:

- **REAL (implemented, tested):** per-namespace vector index `vectors/<ns>/index.json` = `{ "<id>": number[] }`, and the **access-authorization layer** that decides which namespaces an agent may read/write. The top-$k$ cosine search runs **in-process** over these real vectors. This is exactly what criteria 7–14 exercise.
- **STUB (declared, not a real model):** the **embedder** `embedder: "hash-ngram-v1"` — a deterministic, offline mapping of `text → number[256]` via feature hashing over character n-grams (bag-of-n-grams, L2-normalised). No model weights, no network, no external dep, fully reproducible. It is **good enough for isolation + determinism**, **not** good enough for semantic search quality.
- The memory record stores `text`; the vector index stores the derived vector keyed by record `id`. `embedder` version is stamped in each `index.json` header so a future real embedder can invalidate old vectors.

> **User-accepted for v1 (R4/D6):** the deterministic hash/n-gram stub above is the v1 embedder. A production semantic embedder (local sentence-transformer or API-backed) is a declared **follow-up task**, not a v1 gap. v1 must still *run* top-k retrieval in-process against real stored vectors.

---

## 6. Access & authorization matrix (Q5 — the heart of the slice)

Implemented **exactly** per upstream §4, plus the WRITE side.

### 6.1 READ (recall) — datasets queried by an agent `A`
- `agent_db(A)` — **always** readable by `A`.
- `global_db` — readable iff `hasGlobalAccess(A) === true`.
- `agent_db(B)` for `B ≠ A` — readable iff `private(B) === false` (B is a **public** space). If `private(B) === true`, **blocked** for any `A ≠ B`.

### 6.2 WRITE (store) — target authorization
- `target: "self"` → `agent_db(A)` — **always allowed**.
- `target: "global"` → `global_db` — allowed iff `hasGlobalAccess(A) === true`; else **blocked** with a detailed error.
- `target: "agent:<B>"` → `agent_db(B)` — **blocked** when `B ≠ A` (a cross-agent write into another namespace, private or not, is refused). This conservative superset is what makes criterion 14 true (public `A` cannot write into private `B`).

### 6.3 Rows (must match upstream §4)

| `private` | `hasGlobalAccess` | Status | Datasets read by agent | Readable by others? |
|:---------:|:-----------------:|:------:|------------------------|:-------------------:|
| `false` | `true`  | **Valid** | `agent_db` + `global_db` | Yes (public space) |
| `false` | `false` | **Invalid** | **throws `InvalidConfigurationError` at init** | N/A |
| `true`  | `true`  | **Valid** | `agent_db` + `global_db` | No (private) |
| `true`  | `false` | **Valid** | `agent_db` only | No (private) |

### 6.4 Errors (shapes the DEVELOPER must emit; the test asserts on these)
- `InvalidConfigurationError` (extends `Error`), `.code === "INVALID_CONFIGURATION"`, `message` includes the offending `name` and the rule ("public agent without global access").
- Cross-namespace/private access: a normal `Error` (or typed `AccessDeniedError`) whose `message` names the **target namespace** and the reason (`"private"` / `"no global access"` / `"cross-agent write not allowed"`). Fail-**closed**: any unresolvable or unlisted agent = deny.

---

## 7. Public API + agent identity (Q6)

### 7.1 Identity
The agent's identity is the **OpenCode agent name of the running session**, obtained from the V2 hook context (`event.agent` on `prompt`, or `ctx.session.get({ sessionID })`). It is **trusted infrastructure data**, never a tool argument — an agent cannot pass `"agent": "someone_else"` to impersonate. The name is looked up in `config.json` `agents[]`:
- found → its `{ hasGlobalAccess, private }` policy is used;
- **not found** → fail-closed `Error: "agent '<name>' is not configured in core-brain config.json"` (no default allow, no fallback to global).

### 7.2 The single tool: `core_memory`
One tool, sub-ops by `op`:

```
core_memory({ op: "who" })
  -> { agent, name, private, hasGlobalAccess, dataDir }

core_memory({ op: "store", text: string, target: "self" | "global" | "agent:<name>", meta?: object })
  -> { ok: true, id, scope, ns }            // or throws AccessDenied / InvalidConfiguration

core_memory({ op: "recall", query?: string, limit?: number /* default 5 */,
             from?: "self" | "global" | "agent:<name>" })
  -> { results: [ { id, text, agent, scope, score, retrievals } ], scanned: [ns...] }
     // `from` defaults to the union of all permitted READ namespaces (§6.1)
     // cross-namespace recall into a private B from A is omitted, not errored
```

- `recall` merges the permitted namespaces, ranks by cosine (tie-break `updatedAt` desc), increments `retrievals` on hits, and returns `scanned` so the caller can see *which* namespaces were consulted (evidence for the matrix).
- No write path exposes the raw store; all writes go through the §6.2 authorizer.

---

## 8. Integration layer — hooks, without touching current agents (Q7 / criterion 5)

- **v1 is TOOLS ONLY.** The only registered surface the current agents see is the `core_memory` tool.
- **`prompt` hook:** records the active agent (for logging/debug via `CORE_BRAIN_DEBUG`). It **never** mutates `event.prompt.text` and **never** injects anything into `event.system` unless the agent is explicitly OPT-IN listed in `config.json` (a separate, off-by-default flag, e.g. `inject: true`). Default: **no injection**.
- **No `compaction` hook in v1.**
- **Unlisted agents:** because identity is fail-closed and injection is off by default, an agent not in `config.json` experiences **zero** behavioural change from this plugin. This is the invariant the non-regression proof (§9 Q9) asserts.

---

## 9. Test agents + two-layer test plan (Q8 / criteria 6–14)

### 9.1 Dedicated test agents (criterion 6)
Four agents in **`global/opencode/agent/`** (the repo's agent dir; 17 existing `*.md` live there), `mode: all`, **inherited model** (no `model` field → OpenCode V2 documents: "a subagent uses its configured model, or inherits the parent session's model when none is configured"). Their `name` equals the `config.json` `agents[].name`:

| Agent file | name | `private` | `hasGlobalAccess` | Matrix row | Used to prove |
|-----------|------|:---------:|:-----------------:|:----------:|:-------------:|
| `global/opencode/agent/CB_ALPHA.md` | `CB_ALPHA` | `false` | `true`  | row 1 (valid) | 13, 8, 14 |
| `global/opencode/agent/CB_BETA.md`  | `CB_BETA`  | `true`  | `true`  | row 3 (valid) | 10, 7, 11 |
| `global/opencode/agent/CB_GAMMA.md` | `CB_GAMMA` | `true`  | `false` | row 4 (valid) | 9, 11, 7 |
| `global/opencode/agent/CB_DELTA.md` | `CB_DELTA` | `false` | `false` | row 2 (invalid) | 12 |

`mode: all` (not `subagent`) is deliberate: each must be launchable BOTH as a subagent (normal ORACLE flow) AND as the primary of a headless `opencode2 run --agent CB_X` smoke (Layer B). A `mode: subagent` agent cannot be a `run` primary, so `subagent` would break Layer B. (Grounded in the V2 docs: `all` = "Runs either as a primary agent or a subagent".)

Each `.md` frontmatter mirrors `TESTER.md` (`description`, `mode: all`); the body is a tiny instruction: "you are an isolation test agent; your only job is to call `core_memory` and report the raw JSON it returns."

**Discovery gate (mandatory, per D4 — UNVERIFIED):** every existing agent `.md` in this repo has a matching entry in the live `opencode.json` `agents` block; **there is no observed proof that a `.md`-only agent is auto-discovered**. Therefore, before relying on the 4 agents:
1. Run the real CLI to list agents: `opencode2 debug agents` and/or `opencode2 api GET /api/agent`.
2. Confirm `CB_ALPHA`, `CB_BETA`, `CB_GAMMA`, `CB_DELTA` all appear.
3. **If any is missing → STOP and report to the ORACLE.** Adding `agents`-block entries to `opencode.json` is USER territory, not an agent's. Do not proceed to Layer B until the 4 are confirmed listable.

### 9.2 Layer A — data-layer functional self-test (`check.sh`, criteria 7–14 **proven in-process**)
`check.sh` (mirrors `todo-list/check.sh`):
1. `CORE_BRAIN_HOME="$(mktemp -d)"` — a disposable temp root.
2. Writes `$CORE_BRAIN_HOME/config.json` with the 4 agents above.
3. Runs `node test/matrix.selftest.mjs` (native TS type-stripping via `node --input-type=module -e "await import('...')"` on Node ≥ 22, plus optional `tsc`).
4. The self-test instantiates the **real** store + authorizer and asserts each row:

| Line | Setup (agent, op) | Expected observable |
|------|-------------------|---------------------|
| 7  | CB_BETA store self → CB_GAMMA recall `from:"agent:CB_BETA"` | blocked/empty; `scanned` excludes CB_BETA |
| 8  | CB_BETA store self → CB_ALPHA recall `from:"agent:CB_BETA"` | blocked/empty |
| 9  | CB_GAMMA store `target:"global"` | **throws**, message names "no global access" |
| 10 | CB_BETA store `target:"global"` → CB_ALPHA recall `from:"global"` | CB_ALPHA returns that record (echo its `text`) |
| 11 | CB_GAMMA store self → CB_GAMMA recall | returns its own record |
| 12 | init with a `CB_DELTA`-shaped entry | **throws** `InvalidConfigurationError`, `.code==="INVALID_CONFIGURATION"` |
| 13 | CB_ALPHA store `target:"global"` → CB_ALPHA recall `from:"global"` | returns it |
| 14 | CB_ALPHA store `target:"agent:CB_BETA"` | **blocked**, message names "CB_BETA" + "private" |

Output = a printed table `7 PASS … 14 PASS`, and **exit code 0** only if all 8 PASS; any FAIL → non-zero. This is the executable proof of the isolation matrix (not a static read).

### 9.3 Layer B — headless live smoke (identity-resolution aspects of 7/11/13)
`opencode2 run --agent CB_BETA "<prompt>"` where the prompt is: "Call `core_memory` with `op:'who'`; then `op:'store'` text `'beta-private-marker-<ts>'` target `'self'`; then `op:'recall'` from `'self'`. Report the raw JSON of each."
- **Expected observable:** the `who` JSON = `{ agent:"CB_BETA", private:true, hasGlobalAccess:true }`, and the recall returns the marker. Repeat for `CB_GAMMA` (private:true, hasGlobalAccess:false — recall of own only) and `CB_ALPHA` (public). This proves the **real OpenCode process** maps session-identity → config policy (the part Layer A cannot see, because it drives the store directly).
- A second run as `CB_DELTA` (if it is listable) is **optional**; the invalid-row proof is already authoritative in Layer A (line 12), because a live init would refuse to start that agent anyway.

**CLI contract (per D5):** the subcommand/flag syntax (`run --agent`, `--format json`, `plugin list`, `api GET <route>`, `debug agents`) is grounded in the official OpenCode V2 docs (`opencode.ai/v2/docs/cli/commands`, `/cli/plugins`, `/agents`, `/api`). The on-host binary is **`opencode2`** (`/home/gandb/.opencode/bin/opencode2`). This ARCHITECT has `shell: deny`, so the **exact runtime invocation is UNVERIFIED** — the executor runs `<bin> --help` / the command first and corrects syntax if it differs from the docs.

> Why two layers: Layer A proves the **logic** deterministically and cheaply; Layer B proves **identity wiring** in a real engine. Neither alone is the bar — both are required before "READY".

---

## 10. Non-regression (Q9 / criterion 5)

1. **Before:** `opencode2 api GET /api/agent` → snapshot to `docs/temp/agents-before.json`. **The baseline count is whatever the snapshot reports — do NOT assert a number** (the "25 agents: 5 native + 20 ours" claim was unmeasured; per D7 the true count comes from this snapshot + the `git status` diff).
2. Implement the slice.
3. **After:** `opencode2 api GET /api/agent` → `docs/temp/agents-after.json`. Diff must show **only additions** (`CB_*`); every pre-existing agent byte-identical.
4. **`git status`** must list only NEW files (`global/opencode/plugins/core-brain/**`, `global/opencode/agent/CB_*.md`, this spec, `docs/temp/*`). **No edit** to any existing `global/opencode/agent/*.md`, `global/opencode/plugins/{todo-list,context-inject}/**`, or `opencode.json`.
5. **Inert-hook proof:** a trivial headless run of an existing, unlisted agent (e.g. `tester`) shows no `core_memory` block in its system prompt and unchanged behaviour.

---

## 11. Install plan (Q10 → becomes `INSTALACAO.md`)

Sanctioned install path (per D3, USER-authorized): **repo → `bash global/opencode/install-global.sh` → mirror.** The script runs `cp -r global/opencode/. ~/.config/opencode/`. Nobody edits the mirror by hand; nobody `git commit`s.

1. `git clone <repo>` → `cd core-brain`.
2. `bash global/opencode/install-global.sh` — copies `global/opencode/` → `~/.config/opencode/`. The plugin lands at `~/.config/opencode/plugins/core-brain/` and the 4 `CB_*.md` land at `~/.config/opencode/agent/CB_*.md`.
3. **No `opencode.json` `plugins`-array entry needed (per D2, R1 CLOSED).** The `plugins/` directory is **auto-discovered** by OpenCode — evidenced by `todo-list` and `context-inject`, which are loaded and working in this environment **without** any `plugins`-array entry (the live array holds only `opencode-anti-loop`, `sglang-guard`, `plur-memory`, `dcp-guard`), and by the V2 docs ("OpenCode also discovers plugins under the global config directory … `<global-config>/plugins/<id>/index.ts`"). `core-brain` needs no array entry because it reads its config from `~/.core-brain/config.json`, not from the array's `options`. If `opencode2 plugin list` later shows it is **not** loaded, that is an open defect → STOP and report (do not paper over it by hand-editing the mirror).
4. **[USER step]:** create `~/.core-brain/config.json` with the `agents[]` the user wants (start with the 4 `CB_*` to run the test agents).
5. Restart OpenCode.
6. `opencode2 plugin list` → shows `core-brain` (auto-discovered; contract grounded in V2 docs, binary invocation UNVERIFIED — run first, correct syntax if needed).
7. `bash global/opencode/plugins/core-brain/check.sh` → green (the §9.2 matrix).
8. Run the §9.1 discovery gate (confirm the 4 `CB_*` are listable) and then the §9.3 headless smoke against `CB_BETA`/`CB_GAMMA`/`CB_ALPHA`.
9. **Coexistence check (criterion 3):** confirm `~/.plur/` is unmodified and PLUR is still loaded (`plur_*` tools present) while `core_memory` is also present.

---

## 12. [REQ] items — status (R1/R2/R4 CLOSED by ORACLE/USER; R3 UNVERIFIED)

- **R1 — CLOSED (D2).** No `plugins`-array entry is required; the `plugins/` dir is auto-discovered (evidence: `todo-list`/`context-inject` load without array entries; V2 docs confirm discovery from `<global-config>/plugins/<id>/`). See §11 step 3.
- **R2 — CLOSED (D3).** For this task the USER authorized writing to `~/.config/opencode/` **only** via the sanctioned path `bash global/opencode/install-global.sh` (USER-authorized, **no git commit**, **no hand-edits** to the mirror). The 4 `CB_*` `.md` and the plugin all land there via that script.
- **R3 — UNVERIFIED (D4).** The 4 agents are created as in-repo `global/opencode/agent/CB_*.md` + `config.json` entries with an **inherited model**. **No observed proof that a `.md`-only agent is auto-discovered** (every existing agent has a matching `opencode.json` `agents` entry). Mandatory discovery gate in §9.1: list agents via the real CLI; **if the 4 do not all appear → STOP and report to the ORACLE** (adding `agents`-block entries is USER territory, not an agent's).
- **R4 — CLOSED (D6).** The USER **accepted** the deterministic hash/n-gram stub embedder for v1 "real execution" (isolation + top-k retrieval runnable in-process, zero external calls/dep). A production semantic embedder is a declared **follow-up task**, not a v1 gap.

---

## 13. What the ARCHITECT did NOT verify (honest disclosure)

- Did **not** run `check.sh` or any node/self-test — that is the DEVELOPER's job against this contract. The §9.2 table is a *specification* of expected output, not an executed result.
- Did **not** run a live `opencode2 run --agent CB_*` smoke (Layer B) — no execution here.
- **CLI contracts (D5):** the `opencode2` subcommand/flag syntax is grounded in the official OpenCode V2 docs, but this ARCHITECT has `shell: deny` and **could not execute the binary** at `/home/gandb/.opencode/bin/opencode2` — so the **exact runtime invocation is UNVERIFIED**. The executor must run `<bin> --help` / the command first and correct any syntax drift.
- **Agent auto-discovery (D4/R3):** UNVERIFIED — see the §9.1 discovery gate.
- **R1–R4 status:** R1, R2, R4 are CLOSED by ORACLE/USER (see §12); R3 remains UNVERIFIED pending the §9.1 gate.
- Read the PLUR plugin **read-only** for the collision map; did not modify it. Did not write to `~/.config/opencode/` at all.

---

## 14. Roadmap beyond v1 (non-blocking, declared)

- Production embedder (replace `hash-ngram-v1`): local sentence-transformer or API-backed; version-bump the vector index.
- Opt-in context auto-injection (`inject: true`) for selected agents.
- `compaction` hook: summarise/store salient facts at compaction.
- Optional multi-process safety (file lock) if two agents write the same namespace concurrently.

---

## 15. Deliverables, repo rules & handoff

### 15.1 Required deliverables (all in the delivery)
- The plugin: `global/opencode/plugins/core-brain/**` (per Q2).
- The 4 test agents: `global/opencode/agent/CB_{ALPHA,BETA,GAMMA,DELTA}.md` (per §9.1).
- `README.md` + `INSTALACAO.md` (English) inside the plugin folder.
- This spec: `docs/specs/core-brain-plugin.md`.
- **`CHANGELOG.md` (repo root):** a new plugin is a **permanent behaviour change** (AGENTS.md rule 3) → a mandatory entry recording the `core-brain` addition. *(Per D8.)*
- **`TASKS.md`:** the item corresponding to this task must exist and carry its status. *(Per D8.)*

### 15.2 Repo rules (binding, per D9)
- **No agent** performs `git commit`, `git add`, or `git stash` in this task (the USER wants full reversibility).
- **No agent writes to `~/.config/opencode/`** by hand. The mirror is populated **only** by the ORACLE running `bash global/opencode/install-global.sh` with USER authorization (D3/R2).

### 15.3 Resource hygiene (per D10 / rule 21)
Every process, port, browser session, or temp workspace opened during testing — **including the headless `opencode2 run` sessions and every `mktemp -d` `CORE_BRAIN_HOME`** — MUST be closed/removed at the end. A leftover temp root or running server starves the next agent.

### 15.4 Handoff
- **To:** TESTER (define the executable validation per §2 + §9), then DEVELOPER (implement to this spec).
- **Gate:** no "READY" until Layer A (§9.2) is green **and** the §9.1 discovery gate passes **and** Layer B (§9.3) shows the identity wiring **and** the non-regression diff (§10) is clean **and** the deliverables (§15.1) are complete **and** the visual/live pass declares `VISUAL PASS EXECUTED` with evidence, or `I AM BLIND` is declared and escalated.
