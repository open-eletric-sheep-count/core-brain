# core-brain — Active Spec: the `core-brain` MCP server (Plan / Contract)

- **Status:** DRAFT for USER review — no implementation has started.
- **Date:** 2026-10-01
- **Author:** ORACLE (flow: `ORACLE does it all`)
- **Repo:** `oesc/core-brain` — file at `docs/specs/core-brain-mcp.md`
- **Upstream spec:** `docs/core_brain_specification.md` (USER)
- **Sibling spec:** `docs/specs/core-brain-plugin.md` (the v0.1.0 plugin, delivered + verified)
- **Related ADR:** `docs/adr/0001-core-brain-memory-isolation.md` (D1–D14)
- **Trigger:** USER, 2026-10-01 — *"faça uma spec no core-brain pra fazer agora o MCP do core-brain no mesmo molde, pra não ficar capenga ao trocar o PLUR por ele."*

---

## 0. Problem — what "capenga" actually means

PLUR reaches the agents through **two** pieces, not one:

| Piece | What it does today |
|---|---|
| plugin `plur-memory` | **automatic layer** — recall per user turn, renders the memory block into the outgoing `system[]`, carries memory across compaction, learns from the user's text |
| MCP `plur` (`npx -y @plur-ai/mcp`) | **explicit layer** — 12 top-level tools + 33 behind an admin gateway |

core-brain v0.1.0 shipped **neither of PLUR's two pieces**: it shipped a third thing (an in-process tool with per-agent isolation). Measured today on this machine:

```
core_memory { op: "who" }  →  ERROR: agent 'ORACLE' is not configured in core-brain config.json
```
(the plugin is live and answering. **Historical observation (2026-10-01), superseded:** it was fail-closed because `~/.core-brain/config.json` did not exist and the seed listed only the three acceptance agents `CB_ALPHA/CB_BETA/CB_GAMMA`. Per `docs/specs/core-brain-default-policy-spec.md` the plugin no longer refuses an absent agent — it now resolves to the default policy `{ private:false, hasGlobalAccess:true }`).

So the swap PLUR → core-brain has **three** gaps, and the MCP is only one of them:

| # | Gap | What is lost on swap | Covered by |
|---|---|---|---|
| **G1** | **agent-facing explicit ops** | `plur_forget`, `plur_feedback`, session lifecycle | **this spec** |
| **G2** | **the automatic layer** | the injected memory block, per-turn recall, learning from the user's text, carry across compaction (`inject` is `false` by default in the plugin; there is no `compaction` hook) | **a companion slice — NOT this spec** (§14) |
| **G3** | **observability / maintenance** | `plur_status`, `plur_doctor`, `plur_receipt`, `plur_admin` (purge/export/reindex) | **this spec** |

**Scope of this document: G1 + G3 only.** It must not be read as "the swap is done when this ships" — §14 names the companion slice and what it must contain.

---

## 1. What the PLUR MCP actually is — measured, not recalled

Measured 2026-10-01 from the installed package `@plur-ai/mcp@0.20.1` (npx cache `~/.npm/_npx/386f78daf917651f/node_modules/@plur-ai/mcp`), via its own side-effect-free subpath export `@plur-ai/mcp/tools`:

- `bin: { "plur-mcp": "dist/index.js" }`, `type: module`, 296 KB installed.
- **Dependencies:** `@modelcontextprotocol/server`, `/client`, `/core` (all `2.0.0-beta.4`), `zod ^3.23.0`, `@plur-ai/core@0.20.1`.
- **Tool profiles:** `full` = **44** tools · `lean` = **12** · `cursor` = **12**. The host runs `lean`.
- **The 12 (lean), verbatim:** `plur_learn`, `plur_recall`, `plur_feedback`, `plur_forget`, `plur_packs_uninstall`, `plur_status`, `plur_receipt`, `plur_doctor`, `plur_session_start`, `plur_session_end`, `plur_tensions_purge`, `plur_admin`.
- **The 33 behind `plur_admin`:** `plur_learn_batch`, `plur_recall_hybrid`, `plur_inject`, `plur_inject_hybrid`, `plur_pin`, `plur_capture`, `plur_timeline`, `plur_ingest`, `plur_packs_preview/install/list/discover/export`, `plur_sync`, `plur_outbox`, `plur_sync_status`, `plur_extract_meta`, `plur_meta_engrams`, `plur_validate_meta`, `plur_provenance`, `plur_session_scope`, `plur_stores_add/list`, `plur_suggest_scope`, `plur_scopes_discover`, `plur_promote`, `plur_rescope`, `plur_tensions`, `plur_episode_to_engram`, `plur_history`, `plur_report_failure`, `plur_similarity_search`, `plur_profile`.

### 1.1 The fact that breaks a blind "same mold" copy

**The PLUR MCP has no agent identity at all.** Measured: the env vars it reads are `PLUR_PATH`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `CLAUDE_SESSION_ID`, plus two test-only hooks; the only trust concept in its bundle is the store-level `plur.yaml` gate (`plur trust <dir>`). There is no per-agent namespace, no per-agent policy, no caller identity.

core-brain's entire reason to exist is **per-agent isolation** (upstream §4; ADR D2/D5). So the MCP cannot be copied verbatim: **identity is the new, unavoidable design problem of this slice**, and §4 is where it is decided.

---

## 2. Decision register

| # | Decision | Rationale / alternative rejected |
|---|---|---|
| **M1** | **One store implementation.** The MCP imports the *existing* `store.ts` (`createEngine`, `InvalidConfigurationError`); no second store, no fork of the record format. | SRP + the D14 zero-dep promise; a fork would drift and break the isolation proof. |
| **M2** | **Tool names `core_*`**, one per mirrored operation. No `plur_*` identifier is ever reused. | zero collision (ADR D1/criterion 3). |
| **M3** | **One surface, two hosts.** Every operation is defined once (name · input · output · isolation rule) and then **assigned to the host that can enforce identity correctly**: the plugin tool `core_memory` when the op needs the caller's agent identity, the MCP when it does not. | This is the decision that makes the slice honest: an MCP cannot see the session, so any op that needs "who is calling" would have to take the name **from the tool input** — which §7.1 of the sibling spec forbids and which would destroy the isolation matrix. |
| **M4** | **Identity is never a tool argument.** Enforced by construction in M3: identity-needing ops live in the plugin (identity from `ctx.session`). | ADR D6; plugin spec §7.1. |
| **M5** | **The MCP is the admin/observability surface** + a single read-only global read (`core_recall`) that is explicitly documented as *not* per-agent isolated. | G3 is exactly this. See §4.3 for the one nuance. |
| **M6** | **The MCP server has zero runtime dependencies.** JSON-RPC 2.0 over stdio is implemented in the repo (`mcp/`), no `@modelcontextprotocol/*`, no `zod`. | Keeps D14 ("only `node:fs/path/os/crypto/url`"), avoids the `2.0.0-beta.4` dependency collision with PLUR, and the protocol surface needed (initialize / tools/list / tools/call) is small. *Alternative rejected:* depend on `@modelcontextprotocol/server` — a beta dep and a second source of truth. |
| **M7** | **`~/.core-brain/` layout is extended, never replaced.** Existing files stay loadable; new record fields are optional. | the store already holds data (`agents/CB_BETA`, `agents/CB_GAMMA`, `global/`); a migration would be a silent data risk. |
| **M8** | **`core_forget` is a soft retire, never a delete.** The record keeps its text and history; recall excludes it. A hard delete exists only behind `core_admin`, and it is `destructiveHint: true`. | mirrors `plur_forget` ("marks it as no longer active without deleting history"); irreversibility is not a default. |
| **M9** | **The MCP is a *consumer* of the engine, never a writer of raw files.** Every mutation goes through the §6 authorizer. | same as the plugin: one choke point. |
| **M10** | **The MCP ships with its own `check.sh` + a headless smoke**, in the same two-layer shape as the plugin. | the plugin's proof standard is the repo's bar; a lower bar here would be a regression in rigour. |

---

## 3. The mirrored surface, operation by operation

Legend — **Host:** `P` = plugin tool `core_memory` (identity from the session) · `M` = MCP server `core-brain` (no session identity). **Gap:** `G1`/`G3` from §0.

| # | PLUR today | core-brain counterpart | Host | Input | Output | Isolation applied |
|---|---|---|---|---|---|---|
| 1 | `plur_learn` | `core_learn` (=`core_memory store`) | **P** | `{ text, target?: "self"\|"global"\|"agent:<n>", meta? }` | `{ ok, id, scope, ns }` | §6.2 write matrix |
| 2 | `plur_recall` | `core_recall` (=`core_memory recall`) | **P** *and* **M (read-only global)** | `{ query?, limit?, from? }` | `{ results[], scanned[] }` | **P:** §6.1 union of permitted namespaces. **M:** `global` only, see §4.3 |
| 3 | `plur_forget` | `core_forget` **(new, G1)** | **P** | `{ id? , query? , target?: "self"\|"global" }` | `{ ok, retired: [ids] }` | §6.2 write matrix — an agent can retire **only its own** records and, with `hasGlobalAccess`, global ones |
| 4 | `plur_feedback` | `core_feedback` **(new, G1)** | **P** | `{ id, useful: boolean }` | `{ ok, id, usefulness }` | the record must be **readable** by the caller (§6.1) — feedback on an unreadable record is refused |
| 5 | `plur_session_start` | `core_session` (=`who`) | **P** | `{}` | `{ agent, private, hasGlobalAccess, dataDir }` | absent agent → default policy `{ private:false, hasGlobalAccess:true }` (`docs/specs/core-brain-default-policy-spec.md`) — no refusal |
| 6 | `plur_session_end` | *no counterpart in v1* | — | — | — | PLUR's tool asks the model to extract learnings before closing; core-brain has no auto-learn yet (G2). Declared **not closed by this slice** (§13). |
| 7 | `plur_status` | `core_status` **(new, G3)** | **M** | `{ ns? }` | `{ storageRoot, configPath, embedder, dim, namespaces: [{ ns, records, retired, retrievals }], totals }` | read-only aggregate; **counts only** — never memory text |
| 8 | `plur_doctor` | `core_doctor` **(new, G3)** | **M** | `{}` | `{ ok, checks: [{ id, ok, detail }] }` | see AC6 for the check list |
| 9 | `plur_receipt` | `core_receipt` **(new, G3)** | **M** | `{ ns?, days? }` | `{ stored, retrieved, hits, byNamespace[] }` | read-only counters |
| 10 | `plur_admin` | `core_admin` **(new, G3)** | **M** | `{ action, args }` | dispatcher (one validation path, one error shape) | maintenance: `purge`, `reindex`, `export`, `import`, `compact` |
| 11 | `plur_capture` | `core_memory op:"episode"` **(new — the episodic timeline; DEFERRED to the v2 engine slice, USER decision 2026-10-02)** | **P** | `{ summary, tags?, sessionId? }` | `{ ok, id, ns }` | write matrix §6.2 |
| 12 | `plur_timeline` | `core_memory op:"timeline"` / MCP `core_timeline` **(new — the episodic timeline; DEFERRED to the v2 engine slice, USER decision 2026-10-02 — `core_timeline` is NOT shipped by this slice)** | **P** (own view) · **M** (global, admin) | `{ query?, since?, until?, tags?, limit? }` | `{ results: Episode[], scanned[] }` | read matrix §6.1; the MCP view reads `global` only |
| 13 | `plur_episode_to_engram` | `core_memory op:"promote"` **(new — the episodic timeline; DEFERRED to the v2 engine slice, USER decision 2026-10-02)** | **P** | `{ episodeId, text, tags? }` | `{ ok, episodeId, memoryId }` | the episode must be readable by the caller; the memory follows §6.2; the episode gains the id in `engramIds` |
| 14 | `plur_packs_*` | **out of scope** | — | — | — | PLUR-specific feature; no equivalent is promised (§14) |
| 15 | `plur_tensions_purge` | `core_admin { action: "purge" }` | **M** | — | PLUR-specific concept → folded into the admin purge |
| 16 | the 33 admin ops | **only the named ones** (`purge`, `reindex`, `export`, `import`, `compact`, plus the three episodic ops above) | **M** | — | the rest are PLUR-store features (sync, remote stores, scopes, provenance, profiles) with no core-brain counterpart and no requirement |

**The episodic timeline** (rows 11–13) is specified in full — object, storage, isolation, the migration of the existing 34, AC-TL1–AC-TL6 — in **`core-brain-v2.md` §12**. It is first-class, not a tag. **It is DEFERRED to the v2 engine slice (USER decision 2026-10-02):** with the declared stub embedder (`hash-ngram-v1`) a timeline search could only match spelling, and the v2 spec §8 puts the engine first — shipping the timeline now would promise a search quality this slice cannot deliver.

**Surface size (corrected to what actually shipped — 2026-10-02):** the plugin registers **one** tool (`core_memory`) with **5** ops (`who`, `store`, `recall`, `forget`, `feedback`); the MCP exposes **5** tools (`core_recall`, `core_status`, `core_doctor`, `core_receipt`, `core_admin`). **`core_timeline` is deferred** (rows 11–13), so the earlier "8 ops / 6 tools" counts no longer apply. Deliberately smaller than PLUR's 12+33: every tool kept closes a stated gap in §0.

---

## 4. Identity — the core design problem of this slice

### 4.1 The constraint
The plugin resolves the agent from `ctx.session` / `event.agent` (sibling spec §7.1) — the hook context **is** the identity. An MCP server receives no hook, no session and no agent: the MCP protocol carries only the caller's arguments. Therefore any MCP tool that behaves per-agent would have to receive the agent name **inside the arguments**, and anything the model can type, the model can forge. That would silently defeat §4 of the upstream spec — the very property core-brain exists to provide.

### 4.2 The decision (M3)
Ops that need "who is calling" **are not exposed over MCP**. They stay on the plugin tool, whose identity channel is the session. This is not a workaround: it is the only shape in which the isolation proof (`check.sh`, 13/13) remains true, and it keeps the plugin as the single writer path.

### 4.3 The one nuance — `core_recall` over MCP
`core_recall` is the single operation exposed on **both** hosts, and the difference is deliberate and must be in the tool description:

- **P (`core_memory recall`)** — the agent's own view: the union of the namespaces §6.1 permits *for that agent*.
- **M (`core_recall`)** — an **administration view**, `global` namespace only, with no per-agent claim. It exists because a script, a cron or the USER's own tooling has no session and still needs to read the shared layer.

The MCP tool description must say, verbatim: *"global namespace only — this is not an agent view; per-agent recall goes through the `core_memory` tool."* A cross-namespace read over MCP is **never** offered.

### 4.4 Rejected alternatives (recorded so they are not re-litigated)
- **A. One MCP instance per agent** (`command: ["node", "<dir>/mcp/server.js", "ORACLE"]`), mirroring PLUR's per-tool ergonomics for every agent. Rejected: measured today there are already **5 live `npm exec @plur-ai/mcp` processes for a single declared PLUR server**, and the platform fights an MCP-per-dead-session leak (orchestrator `config.ts` `mcp_reap_minutes`); replicating that per agent multiplies it by the agent count — the spawn unit (per session vs per location) is **SPIKE-3**, unresolved. Second reason, also pending SPIKE-4: MCP servers are declared globally, so every agent would see every other agent's server and the isolation would rest on a complete per-agent deny list rather than on construction.
- **B. Single MCP resolving identity from a plugin-written handshake** (`~/.core-brain/sessions/<sid>.json`, written by the plugin; the server reads `OPENCODE_SESSION_ID` from its own environment). Elegant, but it rests on two unknown contracts (SPIKE-1/SPIKE-2, §12) and on launch-time ordering. **Kept as the follow-up path** if the USER wants agent-facing MCP tools after the spikes are measured.
- **C. Agent name as a tool argument, validated against `config.json`.** Rejected outright: it is exactly the impersonation the ADR closed (D6).

---

## 5. Isolation applied to every new operation

The §6 matrix of the sibling spec is untouched; what this slice adds is the rule for the **new** operations:

| Operation | Read set | Write set | Refusal / default behaviour |
|---|---|---|---|
| `core_forget` (P) | the record(s) matched | same namespace as the records retired | absent agent → default policy `{ private:false, hasGlobalAccess:true }` (`docs/specs/core-brain-default-policy-spec.md`) — no longer refused |
| `core_feedback` (P) | the record | the record's counters | feedback on a record the caller may not read → refuse, naming the namespace and the reason |
| `core_status` / `core_doctor` / `core_receipt` (M) | store metadata only | none | read-only; never returns memory text |
| `core_admin { purge }` (M) | — | one namespace, named explicitly | refuses a **private** agent namespace unless the namespace is named explicitly **and** `--force` is passed; the refusal names the namespace |
| `core_admin { import/export }` (M) | any | any | export writes a file the caller names; import merges and **never** overwrites an existing record id |

Rule inherited from the plugin, **as changed by `docs/specs/core-brain-default-policy-spec.md`**: an agent absent from `config.json` no longer gets an error — it resolves to the default policy `{ private:false, hasGlobalAccess:true }` and may use its own namespace and `global`. The old error `agent '<name>' is not configured in core-brain config.json` is **removed from production**. **Resolved for the built MCP (2026-10-02):** the MCP never resolves a caller — it fixes its engine identity to the constant `core-brain-admin`, which is unlisted and therefore takes the default policy `{ private:false, hasGlobalAccess:true }` — and `core_recall` hard-codes `from:"global"`. There is no caller-supplied identity on the MCP surface, so the unlisted-agent question does not arise there.

---

## 6. Store changes required (M7 — additive only)

`types.ts`/`store.ts` gain, without breaking the on-disk format already in `~/.core-brain/`:

```ts
// MemoryRecord — two new OPTIONAL fields; a record without them reads as active + neutral.
retiredAt?: string;                                  // soft retire (M8)
feedback?: { useful: number; useless: number };       // core_feedback signal
// retrievals already exists and is already incremented on recall hits.
```

New engine operations (same seam — `engine.invoke(agentName, request)`; the MCP calls the same functions with `agentName` fixed to the admin identity):

| op | Semantics |
|---|---|
| `forget` | matches by `id` or by `query` (cosine, above the configured threshold), sets `retiredAt`; returns the retired ids |
| `feedback` | `useful: true/false` increments the counter; the ranking tie-break becomes `score desc → feedback.useful desc → retrievals desc → updatedAt desc` |
| `status` | per-namespace counts + storage root + embedder/dim + config file in use |
| `doctor` | the check list of AC6 |
| `receipt` | counters from `MemoryRecord.retrievals` + the store's write log |
| `admin` | `purge` (hard delete, destructive), `reindex` (rebuild `vectors/*/index.json` from records), `export`/`import` (portable JSON), `compact` (drop vectors of retired records) |

**Whatever is added must keep `bash global/opencode/plugins/core-brain/check.sh` green — 13/13, unchanged.** That check is the isolation contract and this slice does not get to weaken it.

---

## 7. Zero collision with PLUR (extends the plugin spec §3 table)

| Artifact | PLUR | core-brain MCP |
|---|---|---|
| MCP server name | `plur` | `core-brain` |
| Command | `npx -y @plur-ai/mcp` | `node <repo>/global/opencode/plugins/core-brain/mcp/server.js` |
| npm package | `@plur-ai/mcp` | none published (local path only) |
| Tool prefix | `plur_*` | `core_*` |
| Store | `~/.plur/` | `~/.core-brain/` (already) |
| Env var | `PLUR_PATH` | `CORE_BRAIN_HOME` (already) |
| Runtime deps | 5 packages incl. 3 `@modelcontextprotocol/*` + zod | **zero** (M6) |
| Port | none (stdio) | none (stdio) |

Both can run side by side during the transition, as criterion 3 requires.

---

## 8. Transport, launch and install

- **Transport:** stdio (the same shape PLUR uses). No port, no daemon, no PID file.
- **Launch entry in `opencode.json` → `mcp.servers`:**
  ```json
  "core-brain": {
    "type": "local",
    "command": ["node", "<abs>/global/opencode/plugins/core-brain/mcp/server.js"],
    "environment": { "CORE_BRAIN_HOME": "/home/<user>/.core-brain" }
  }
  ```
  **Correction (SPIKE-2, measured 2026-10-02):** the canonical key is **`environment`, not `env`**. `opencode2 mcp add --env k=v` writes `environment`; an entry written with `"env": { … }` is accepted by the parser and **silently dropped** (measured: the spawned process carried 196 env keys and none of the marker). The shipped live entry uses `environment`. `CORE_BRAIN_HOME` itself remains optional — without it the server resolves `~/.core-brain` from the inherited `HOME`.
- **Install:** the plugin's existing `install-global.sh` path already copies `plugins/core-brain/`, so `mcp/` travels with it; the only **USER** action is the `opencode.json` entry (the mirror is generated) + `opencode2 reload`.
- **Diagnostics:** `CORE_BRAIN_DEBUG=1` prints one line per tool call to stderr, the same switch the plugin uses.

---

## 9. Acceptance criteria (binding)

- **AC1** — `opencode2 mcp list` shows `core-brain` **connected**, with `plur` still connected (coexistence).
- **AC2** — `core_status` / `core_doctor` / `core_receipt` / `core_recall` / `core_admin` exist and each returns the JSON shape of §3, asserted verbatim in the self-test.
- **AC3** — every new operation respects §5: the self-test proves the refusal messages, not just the happy path.
- **AC4** — `core_forget` retires without deleting: after retire, recall excludes it, `core_status` counts it as `retired`, and the record's `text` is still on disk.
- **AC5** — `core_feedback({ useful: true })` demonstrably moves ranking: two records with identical cosine, one with positive feedback, the feedbacked one ranks first.
- **AC6** — `core_doctor` detects, one check each, and reports a failing `detail`: (a) an invalid config row (`private:false && hasGlobalAccess:false`), (b) an `embedder`/`dim` mismatch against `EMBEDDER_ID`/`EMBEDDING_DIM`, (c) an unwritable store root, (d) an orphan vector (vector without record) and a record without vector, (e) a `vector` whose dimension ≠ `dim`.
- **AC7** — `core_recall` over MCP reads **only** `global`; the per-agent view stays on the plugin. **Resolved (recorded result, 2026-10-02):** the MCP has no caller identity — it reads the `global` namespace only and rejects a `from` argument with `-32602` — while the plugin tool `core_memory` carries the per-agent identity from the session. The transport self-test pins it: `bash global/opencode/plugins/core-brain/mcp/check.sh` → **18/18 PASS, exit 0**, asserting `tools/list` advertises exactly the five tools, the `core_recall` description carries the verbatim §4.3 sentence, a `from` argument is refused, and the read's `scanned` is exactly `["global"]`. The old open decision about an unlisted agent is closed by construction: the MCP never resolves a caller, so there is no unlisted-agent surface to decide.
- **AC8** — the mirror's existing `plugins[]` behaviour and `check.sh` are untouched: **13/13 PASS, exit 0** — the same command and exit code the plugin is accepted on.
- **AC9** — zero runtime dependencies: `plugins/core-brain/` has no `node_modules` and no `package.json` dependency beyond the current empty set; the MCP server starts under `node --experimental-strip-types` alone.
- **AC10** — a `INSTALACAO.md` section and a `README.md` section exist for the MCP, in the same voice as the plugin's, and the `CHANGELOG.md` carries the entry.

---

## 10. Test plan — two layers, same bar as the plugin

- **Layer A (in-process, deterministic):** `mcp/check.sh` driving the engine directly (no MCP transport) + **a transport test** driving the built server over stdio with a scripted JSON-RPC conversation (`initialize` → `tools/list` → `tools/call`), asserting: the 5 tool names, their schemas, the refusal shapes of §5/AC3, the retire semantics of AC4, the ranking of AC5, every `core_doctor` check of AC6.
- **Layer B (live, headless):** a real `opencode run` calls `core_recall` over the MCP — the MCP exposes no caller identity (AC7, resolved 2026-10-02: `global` only, `from` refused), so there is no unlisted-agent surface to measure — and the store is inspected before/after (`~/.core-brain/`) to prove no memory record was added, removed or edited by the read. (The `retrievals` counter of returned hits is updated by recall, exactly as the plugin's `recall` already does; the inspection is about memory text, not that counter.)
- **Evidence to record, per the repo's rule 16/17:** the exact commands and their digests; screenshots are not applicable (no UI).

---

## 11. Non-regression

- The plugin's `check.sh` **13/13** and its `test/matrix.selftest.mjs` stay green and unmodified in meaning.
- The 23 pre-existing agents stay byte-identical; the four `CB_*` test agents keep working.
- `~/.plur/` and the `plur` MCP are untouched (coexistence, criterion 3).
- Existing store files load unchanged (M7): a store written by v0.1.0 must open under the new code with no migration step.

---

## 12. Unknown contracts — SPIKE list (must be measured BEFORE any code)

Per rule 10, none of these may be assumed:

| # | Question | Why it matters | How to measure |
|---|---|---|---|
| **SPIKE-1** | Does a local MCP server process in opencode V2 receive any **session or agent identity** in its environment (e.g. `OPENCODE_SESSION_ID`)? | decides whether alternative B (§4.4) is ever possible | launch a throwaway MCP that dumps `process.env` to a file, `opencode2 mcp list`, read the file |
| **SPIKE-2** | Does `mcp.servers.<name>` accept `env` (and `cwd`) for a `local` server? | §8 install block | same rig, two entries with and without `env` |
| **SPIKE-3** | Is a local MCP server spawned **per session** or **per location**? | the process-cost argument that rejected alternative A | count processes across two sessions |
| **SPIKE-4** | How are MCP tools named in an agent's catalog, and can `agents.<NAME>.permissions` deny one MCP server's tools wholesale? | closes the rejection argument of alternative A (§4.4) | `debug agents` on a rig with a deny rule |
| **SPIKE-5** | Minimum JSON-RPC conversation opencode needs for `tools/list` + `tools/call` (protocol version string, capabilities) | M6 (hand-rolled server) | capture the traffic of a throwaway server, then read `@modelcontextprotocol/server`'s `initialize` response for the exact shape |

SPIKE-1/2/3/5 are on the **critical path** — the implementation does not start before they are answered with a recorded digest.

---

## 13. The swap checklist — what "not capenga" requires, end to end

Taking PLUR out is a **three-part** operation. This spec closes 1 and 3; part 2 needs its own slice.

1. **This slice (G1 + G3)** — agent-facing `forget`/`feedback`, and the MCP's `status`/`doctor`/`receipt`/`recall`/`admin`.
2. **Companion slice (G2 — REQUIRED before the swap, not covered here):** the plugin's automatic layer — `context` injection into `system[]` (opt-in flag per agent, off by default → and the swap turns it **on**), learning from the user's text, and the `compaction` hook that carries memory across the cut. Without it, an agent that swaps to core-brain **silently stops receiving any memory** — which is precisely the "capenga" the USER is trying to avoid.
3. **Config + governance cut-over, in this order:**
   - create `~/.core-brain/config.json` with the **real** agents and their policy (`private` / `hasGlobalAccess`) — today it does not exist, so every real agent falls back to the default policy (`private:false` + `hasGlobalAccess:true`, `docs/specs/core-brain-default-policy-spec.md`); creating the file is how each real agent gets its intended policy;
   - add the `core-brain` MCP entry (§8);
   - rewrite `AGENTS.md` rule 8b (`plur_learn`/`plur_recall`/`plur_session_*` → the `core_*` counterparts) — **requires explicit USER OK; the mirror is the USER's to update**;
   - remove `mcp.servers.plur` and, when G2 ships, `plugins/plur-memory`;
   - keep `~/.plur/` on disk (do not delete a store until the new one has been read back).

**Not covered by this slice — classified, because "not covered here" must not be read as "impossible":**

| PLUR capability | Why PLUR has it | Why it is not in this slice |
|---|---|---|
| `plur_session_end`'s "extract learnings before closing"; `plur_inject` as a callable tool | extraction and injection are *model* actions driven by the tool description; PLUR pairs them with `auto_learn` / `plur_capture` / `plur_ingest` | **Not a limitation — it is slice G2** (§0): the plugin's automatic layer. Buildable exactly as PLUR builds it. |
| packs | a pack is a bundle of engrams (`~/.plur/packs/`; empty on this install) | **Not a limitation** — no use case today. A JSON bundle + an import behind `core_admin` closes it in one dispatch. |
| scopes / provenance / profiles | PLUR addresses memory on a *scope* axis (project/global/user) plus which episode produced an engram | **Another data model, not a missing feature** — core-brain addresses by *namespace* (agent/global). A scope axis is additive and is a deliberate later choice. |
| tensions + `plur_tensions_purge` | PLUR detects conflicts between engrams — and the purge exists because the detector accumulated **false positives** (the `.tensions-purged` marker is on this install) | **Nothing to copy yet** — core-brain has no conflict detector, so there is nothing to purge. |
| remote stores, `plur_sync`, `plur_outbox`, `plur_sync_status` | PLUR runs a **server** (`~/.plur/server.pid`) with auth and conflict handling | **Requires an architecture change, not a tool**: the core-brain store is deliberately local, file-based, atomic, with no port and no PID (ADR D7). Adding sync means adding a server, an auth model, conflict resolution — and the multi-process lock that is already an open risk. |
| **hybrid recall, `plur_similarity_search`, the cross-encoder rerank** | PLUR embeds with **real models** (`Xenova/all-MiniLM-L6-v2`, `Xenova/bge-base-en-v1.5` / `bge-small-en-v1.5`) and reranks with `Xenova/ms-marco-MiniLM-L-6-v2`, behind a 4 MB embedding cache | **This is the one real gap.** core-brain's embedder is a declared stub — `hash-ngram-v1`, 256 dims, FNV-1a over character n-grams — so cosine measures *closeness of spelling*, not of meaning. Promising "similarity search" on top of it would be a lie. The production embedder is follow-up #1 **and the keystone**: with real vectors, hybrid recall, similarity search and injection quality all arrive together. |

---

## 14. Out of scope for this slice

- Any change to the isolation matrix (§4 upstream) or to the plugin's `core_memory` semantics beyond the two new ops.
- The automatic layer (G2) — separate spec, named in §13.
- A published npm package for the MCP. It is a local path, like the plugin.
- Multi-process locking, a production embedder, and remote stores — the three risks already open in ADR 0001 §Consequences stay open.

---

## 15. Deliverables & handoff

| Deliverable | Where |
|---|---|
| The MCP server (zero deps, stdio) | `global/opencode/plugins/core-brain/mcp/server.js` + `mcp/jsonrpc.js` (the hand-rolled JSON-RPC transport) |
| Store additions (`forget`/`feedback`/`status`/`doctor`/`receipt`/`admin`) | `store.ts`, `types.ts`, `shims.d.ts` |
| Plugin tool additions (`core_memory` ops `forget`, `feedback`) | `index.ts` |
| Self-test + transport test | `mcp/check.sh`, `mcp/test/transport.selftest.mjs` |
| Docs | `README.md`, `INSTALACAO.md`, `CHANGELOG.md` (repo root), `TASKS.md` |
| Proof of the 5 spikes | recorded digests, appended to this spec or to a `docs/temp/` file |

**Repo rules:** no commits (USER instruction for this repo, 2026-09-30); nothing written under `~/.config/opencode/` by an agent — the mirror is the USER's; every resource opened for testing is released in the same task.

**Handoff:** this spec is a contract for the implementation slice. It is **DRAFT** until the USER accepts it; the acceptance of the code later must cite AC1–AC10 by number, with the executed evidence, per the repo's mutual-verification rule.
