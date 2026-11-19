# core-brain — Test Contract (Layer A: executable isolation matrix)

- **Author:** TESTER
- **Date:** 2026-10-01
- **Spec:** `docs/specs/core-brain-plugin.md` §2 (criteria), §6 (access matrix), §7 (API), §9.2 (test plan);
  lines 15–19 pin `docs/specs/core-brain-default-policy-spec.md` §7 (default policy for absent/incomplete rows)
- **Artifacts:** `test/matrix.selftest.mjs`, `check.sh`
- **STATUS: EXECUTED (2026-10-01) for lines 7–14; EXTENDED (2026-10-02) and
  IMPLEMENTED for lines 15–19.** The plugin implementation exists (`store.ts` +
  `types.ts` + `index.ts`, installed and loaded). All lines were run by the ORACLE:
  **13/13 lines PASS, exit code 0** (Node v24.15.0), including lines 15–19, which
  pin `docs/specs/core-brain-default-policy-spec.md` §7 (absent/incomplete config
  rows default to `private:false` + `hasGlobalAccess:true`).

> This file is the law for Layer A. The DEVELOPER implements production code to
> satisfy it; the ORACLE judges the delivery against it. Any divergence between
> the spec and this file is resolved by the ORACLE, not silently by either side.

---

## 1. How to run

```bash
bash global/opencode/plugins/core-brain/check.sh
```

`check.sh` creates a disposable `CORE_BRAIN_HOME="$(mktemp -d)"`, writes the
4-agent `config.json`, runs `test/matrix.selftest.mjs`, prints the table
`7 PASS … 19 PASS` (13 rows), removes the temp root (rule 21) and exits non-zero
if any line fails. The selftest also writes the default-policy fixtures (§3). Node type-stripping is feature-detected (`--experimental-strip-types`
on Node ≥ 22.6; plain `node` on ≥ 23.6).

---

## 2. Test-facing contract (the seam the DEVELOPER must expose)

The spec pins the `core_memory` **tool JSON** (§7) but not the TypeScript export
names. §9.2 requires this layer to *instantiate the real store + authorizer*, so
the seam is pinned to the internal module §2 names (`store.ts`). Required named
exports:

```ts
// store.ts
export class InvalidConfigurationError extends Error {
  code: "INVALID_CONFIGURATION"; // §6.4
}

export function createEngine(options?: {
  home?: string;        // data root; defaults to CORE_BRAIN_HOME ?? ~/.config/core-brain
  configPath?: string;  // explicit config file (spec Q3 precedence)
  embedder?: Embedder;  // D4 test/runtime seam — see §8. Never a core_memory input
  reranker?: Reranker;  // D4 test/runtime seam — see §8
}): Engine;

interface Engine {
  // `agentName` is TRUSTED infrastructure identity (session agent), injected by
  // the tool layer from the hook — NOT a `core_memory` input field (§7.1).
  // `invoke(agent, req)` is exactly `core_memory(req)` with that identity supplied.
  // SLICE 1 (D3, §8.1): invoke is ASYNC — callers must `await` it. `createEngine`
  // stays SYNCHRONOUS (the init throw of lines 12/17/18 is unchanged).
  invoke(agentName: string, request: CoreMemoryRequest): Promise<CoreMemoryResult>;
}

type CoreMemoryRequest =
  | { op: "who" }
  | { op: "store"; text: string; target?: "self" | "global" | `agent:${string}`; meta?: object }
  | { op: "recall"; query?: string; limit?: number; from?: "self" | "global" | `agent:${string}` };
```

Result shapes = spec §7.2 exactly:

- `who` → `{ agent, name, private, hasGlobalAccess, dataDir }`.
- `store` → `{ ok: true, id, scope, ns }`; throws on denial.
- `recall` → `{ results: [{ id, text, agent, scope, score, retrievals }], scanned: [ns…] }`.
  A cross-namespace read into a **private** target is **omitted, not errored** (§7.2):
  `results` is empty and `scanned` must not mention the private namespace.

**Why this seam and not the registered tool:** `setup(ctx)` needs the live V2
plugin context, which cannot be instantiated offline; §9.2 explicitly says this
layer drives the real store + authorizer. Driving `store.ts` exercises the SAME
authorizer the tool calls, with zero SDK dependency (spec Q2).

**VERIFIED (2026-10-01):** the export names above are exactly the ones the shipped
implementation exposes (`createEngine` and `InvalidConfigurationError` from
`store.ts`), and the full matrix runs green against them. Any future rename must
update this file and `matrix.selftest.mjs` together — the test is the contract,
so it changes first or not at all.

### Memory shape — 600 characters, refused above it (USER, 2026-11-19)

`store` refuses a `text` longer than **600 characters** and the message names both the limit and
how much has to go:

```
core_memory store: 'text' has 700 characters, the limit is 600 — summarise it and send again (cut at least 100)
```

It is a **refusal, not a truncation**: cutting silently would keep the first half of a thought and
lose the half that mattered. `600` exactly is accepted. Ledger: `hooks.selftest.mjs` **S1**.
The cap lives in `storeOp`; memories created by `dream` are written elsewhere and are **not**
covered by it yet.

### Namespace labels
`scanned` entries are matched by **substring** (`"CB_BETA"`), so the exact label
format (`agent:CB_BETA` vs `CB_BETA`) is not over-pinned. A namespace that the
agent may not read must not appear in `scanned`.

---

## 3. Fixtures

| File | Written by | Content |
|------|-----------|---------|
| `$CORE_BRAIN_HOME/config.json` | `check.sh` | the 4 agents, **including** the invalid `CB_DELTA` row |
| `$CORE_BRAIN_HOME/config.valid.json` | `matrix.selftest.mjs` | `CB_ALPHA`, `CB_BETA`, `CB_GAMMA` only (drops the invalid row) |
| `$CORE_BRAIN_HOME/config.omitted.json` | `matrix.selftest.mjs` | `{ agents: [ { name: "CB_OMITTED" } ] }` — row omits **both** fields |
| `$CORE_BRAIN_HOME/config.partial-invalid.json` | `matrix.selftest.mjs` | `{ agents: [ { name: "CB_HALF", hasGlobalAccess: false } ] }` — omitted `private` defaults to `false`, so the resolved row is invalid |
| `$CORE_BRAIN_HOME/config.badtype.json` | `matrix.selftest.mjs` | `{ agents: [ { name: "CB_BADTYPE", hasGlobalAccess: true, private: "yes" } ] }` — present non-boolean |
| `$CORE_BRAIN_HOME/config.badtype2.json` | `matrix.selftest.mjs` (inside line 18) | `{ agents: [ { name: "CB_BADTYPE2", hasGlobalAccess: "yes" } ] }` — present non-boolean |

Lines 7–11 and 13–14 run on `config.valid.json`. Line 12 runs on the
`check.sh`-written `config.json` whose `CB_DELTA` entry must fail the whole init.
Line 15 runs on `config.valid.json` (the caller `CB_UNLISTED` is simply absent
from it). Line 16 runs on `config.omitted.json`; line 17 on
`config.partial-invalid.json`; line 18 on `config.badtype.json` plus the
`config.badtype2.json` it writes; line 19 runs on `config.valid.json` after line
15 wrote `CB_UNLISTED`'s self namespace.
Markers are unique per run (`cb-selftest-<nonce>-<tag>`) to prevent cross-line
contamination in the shared `global` namespace.

---

## 4. The 13 matrix lines — setup, observation, literal expectation

Every line asserts the **observable value**, never a bare boolean. Literal
asserted substrings are written `"…"`.

### Line 7 — private cannot be read by another private
- **Setup:** `CB_BETA` `store self` (marker) → `CB_GAMMA` `recall from:"agent:CB_BETA"`.
- **Observe:** `results` is an empty array; `scanned` is an array that does **not**
  contain the substring `"CB_BETA"`.
- **Covers:** USER criterion 7.

### Line 8 — private cannot be read by a public agent
- **Setup:** `CB_BETA` wrote its private record in line 7 → `CB_ALPHA` `recall from:"agent:CB_BETA"`.
- **Observe:** `results` empty; `scanned` does not contain `"CB_BETA"`.
- **Covers:** USER criterion 8.

### Line 9 — private without global access cannot write global
- **Setup:** `CB_GAMMA` `store target:"global"`.
- **Observe:** it **throws** an `Error` whose `message` contains `"CB_GAMMA"` **and**
  the reason `"no global access"` (§6.4). Nothing is written.
- **Covers:** USER criterion 9.

### Line 10 — private with global access writes global; a global agent reads it
- **Setup:** `CB_BETA` `store target:"global"` (marker `M10`) → `CB_ALPHA` `recall from:"global"`.
- **Observe:** `results` contains a record whose `text === M10` (the **echo** of the
  stored text, not a boolean).
- **Covers:** USER criterion 10.

### Line 11 — an agent reads its own private memory
- **Setup:** `CB_GAMMA` `store self` (marker `M11`) → `CB_GAMMA` `recall from:"self"`.
- **Observe:** `results` contains a record whose `text === M11`.
- **Covers:** USER criterion 11.

### Line 12 — invalid config fails at init (criteria 12 = configuration)
- **Setup:** `createEngine({ configPath: "$CORE_BRAIN_HOME/config.json" })`, whose
  `CB_DELTA` entry is `private:false` + `hasGlobalAccess:false`.
- **Observe:** it **throws** `InvalidConfigurationError` with
  `.code === "INVALID_CONFIGURATION"` and a `message` containing `"CB_DELTA"` **and**
  the rule `"public agent without global access"` (§6.4). Thrown at init — before
  any read/write.
- **Covers:** USER criterion 12.

### Line 13 — public with global access writes and reads global
- **Setup:** `CB_ALPHA` `store target:"global"` (marker `M13`) → `CB_ALPHA` `recall from:"global"`.
- **Observe:** `results` contains a record whose `text === M13`.
- **Covers:** USER criterion 13.

### Line 14 — public cannot write into another agent's private space
- **Setup:** `CB_ALPHA` `store target:"agent:CB_BETA"`.
- **Observe:** it **throws** an `Error` whose `message` contains `"CB_BETA"` **and**
  the reason `"private"` (§6.4). Nothing is written.
- **Covers:** USER criterion 14.

### Line 15 — an agent absent from `config.json` gets the default policy and can use it
- **Setup:** `CB_UNLISTED` is **absent** from `config.valid.json` → `who`; then
  `store target:"global"` (marker `M15g`) → `recall from:"global"`; then
  `store target:"self"` (marker `M15s`) → `recall from:"self"`.
- **Observe:** `who` reports `agent`/`name` `"CB_UNLISTED"`, `private === false`,
  `hasGlobalAccess === true`; the global store returns `{ ok:true, ns:"global" }`;
  the global recall echoes `M15g`; the self recall echoes `M15s`.
- **Covers:** spec §2 rule A, §4.1/§4.2, AC2. Never throws for the absent agent.

### Line 16 — a row omitting both fields loads and resolves to the defaults
- **Setup:** `createEngine({ configPath: "config.omitted.json" })` (row `CB_OMITTED`
  omits `private` **and** `hasGlobalAccess`) — must **not** throw → `who("CB_OMITTED")`;
  then `who("CB_ALSO_ABSENT")` (a name absent even from that config).
- **Observe:** both report `private === false`, `hasGlobalAccess === true`.
- **Covers:** spec §3 B1, AC3.

### Line 17 — omitted `private` + `hasGlobalAccess:false` is still an invalid row
- **Setup:** `createEngine({ configPath: "config.partial-invalid.json" })`
  (`{ name:"CB_HALF", hasGlobalAccess:false }`; `private` is omitted).
- **Observe:** it **throws** `InvalidConfigurationError` with
  `.code === "INVALID_CONFIGURATION"` and a `message` containing `"CB_HALF"` **and**
  `"public agent without global access"` — the omitted `private` resolves to `false`
  first, then the unchanged invalid-row rule fires.
- **Covers:** spec §3 B1–B3, AC4 (the interaction most likely to be missed).

### Line 18 — a present non-boolean is still rejected (defaults are not coercion)
- **Setup:** `createEngine({ configPath: "config.badtype.json" })`
  (`private:"yes"`), then line 18 writes `config.badtype2.json`
  (`hasGlobalAccess:"yes"`) and calls `createEngine` on it.
- **Observe:** each call **throws** `InvalidConfigurationError` whose `message`
  names the agent (`"CB_BADTYPE"` / `"CB_BADTYPE2"`) **and** contains `"boolean"`.
- **Covers:** spec §3 B2, AC6.

### Line 19 — an absent agent's namespace is NOT a read target for others
- **Setup:** `CB_UNLISTED` `store self` (marker) → `CB_ALPHA`
  `recall from:"agent:CB_UNLISTED"`; then `CB_ALPHA recall` (default union).
- **Observe:** the direct read returns an empty `results` **and** `scanned` does not
  contain `"CB_UNLISTED"`; the default union's `scanned` also does not contain
  `"CB_UNLISTED"`.
- **Covers:** spec §4.3 union decision, AC7.

---

## 5. Pass / fail semantics

- The selftest prints one line per matrix row: `7 PASS … 19 PASS` (or `FAIL` with
  the literal mismatch as detail) and a `n/13 lines PASS` summary.
- `check.sh` exits `0` only when all 13 rows PASS; any FAIL → non-zero.
- A row that does not discriminate (e.g. passes while the authorizer is bypassed)
  is a **defect in the test**, not a pass: the assertions above name the forbidden
  namespace / required message, so a no-op authorizer fails lines 7, 8, 14 and 19.
- Lines 15–19 pin
  `docs/specs/core-brain-default-policy-spec.md` §2/§3, now implemented: they PASS
  against the shipped `store.ts`. Their RED run (before implementation) was the
  evidence that they discriminate. Line 18 (present non-boolean) passes both before
  and after, because it pins unchanged behaviour.
- **Precondition:** `who("CB_BETA")` must resolve to `private:true`,
  `hasGlobalAccess:true`; if it fails the run aborts with exit code `2`.
- Missing implementation / missing exports → exit code `2` with an explicit
  message (not silently green).

---

## 6. Scope — what these artifacts do NOT cover / assert

- **Execution (Layer A):** all 13 lines were executed 2026-10-02 — `check.sh`
  printed the `7 PASS … 19 PASS` table (13/13 lines PASS) and exited `0` (Node
  v24.15.0). Lines 7–14 were first executed 2026-10-01; lines 15–19 were pinned
  2026-10-02 and are now GREEN after `store.ts` implemented the default-policy spec.
- **Default policy for absent/incomplete rows:** the old fail-closed rule is gone
  by design — an unlisted agent is **no longer refused**; it gets
  `private:false` + `hasGlobalAccess:true` (line 15), and a row that omits those
  keys gets the same defaults (line 16). The only remaining config refusal is the
  explicit invalid row `private:false + hasGlobalAccess:false`, which now also
  catches a row that omits `private` while declaring `hasGlobalAccess:false`
  (line 17). An absent agent's namespace is **not** part of other agents' read
  union (line 19, spec §4.3).
- **Layer B (headless `opencode2 run --agent CB_X`):** out of scope of these
  artifacts (§9.3) — no `opencode2` invocation is declared here. It was executed
  separately by the ORACLE (2026-10-01): `CB_BETA`, `CB_GAMMA` and `CB_ALPHA` ran
  headless and returned the expected results and refusals.
- **Criteria 1–6 and 15–16 of the plugin spec** (README/INSTALACAO/zero-collision/
  non-regression/persistence/V2 shape): out of scope of Layer A; the matrix covers
  lines 7–19 (criterion 12 is the configuration rule, proven by line 12).
- **Embedder quality / persistence layout:** not asserted here.
- The `chmod +x` bit on `check.sh` was not applied by TESTER (no shell at
  authoring); run it as `bash check.sh`.
- The test-facing export names (§2) are the ones the shipped implementation
  exposes — **verified** against it (2026-10-01).

---

## 7. Non-negotiables (repo rules)

- This is test code, never production code; the DEVELOPER owns `index.ts`,
  `store.ts`, `types.ts`, `package.json`, `tsconfig.json`, `shims.d.ts`.
- No `git commit` / `git add` / `git stash`; no writes under `~/.config/opencode/`.
- No resource left open: `check.sh` removes its `CORE_BRAIN_HOME` on exit (rule 21).

---

## 8. Slice 1 contract delta (D3/D4/D5) — landed by TESTER before the engine

- **Authority:** `docs/specs/fatia1-engine-plan.md` §4 (D3), §5 (D4), §6 (D5), §7
  Phase 0, §9 (AC handoff). This section is the delta the DEVELOPER implements;
  the engine's async seam CANNOT be implemented before these tests exist.
- **Date:** 2026-10-03. **Status: LANDED (tests only; no production code).**
- **Rule that makes this section first:** §2 — *"the test is the contract, so it
  changes first or not at all."*

### 8.1 `invoke` becomes async (D3)

`Engine.invoke(agent, req): Promise<CoreMemoryResult>` (was `CoreMemoryResult`).
`createEngine(options)` stays **synchronous**; its init-time
`InvalidConfigurationError` (lines 12/17/18) is thrown synchronously and is
unchanged. Every caller uses one rule: `await engine.invoke(...)`.
`mcp/jsonrpc.js` awaits `onRequest(...)` before writing, with an ordered promise
chain (a bare `await` inside the `data` callback lets the next line overtake).
`mcp/server.js` `callTool`/`handle` become async; `index.ts` adds `await`.

### 8.2 `EngineOptions.embedder` / `EngineOptions.reranker` (D4)

Test/runtime injection seams, never a `core_memory` input:

```ts
export interface Embedder {
  id: string;        // "Xenova/bge-small-en-v1.5" | "fixture-bge-small" | "hash-ngram-v1"
  dim: number;       // 384 (fixture + bge-small)
  revision: string;  // model-artifact fingerprint (D5); fixture uses "fixture-v1"
  embed(text: string): number[] | Promise<number[]>;
}
export interface Reranker {
  name: string;      // "off" | "ms-marco-minilm-l6" | "fixture-rerank"
  scoreBatch(query: string, docs: string[]): number[] | Promise<number[]>;
}
```

Resolution order: `options.embedder` → env `CORE_BRAIN_EMBEDDER`
(`real` default | `fixture`) with `CORE_BRAIN_FIXTURE_DIR` (default
`<pluginDir>/test/fixtures`) → real. Same for the reranker:
`options.reranker` → env `CORE_BRAIN_RERANKER` (`off` default | `ms-marco` |
`fixture`) → off. The fixture double lives in `test/fixtures/embedder.mjs` and
exports `createFixtureEmbedder()` / `createFixtureReranker()`.

### 8.3 `recall` result gains `mode` and `reranked`; `RecallHit` gains `rrf` (D4/D6/D7)

```ts
export interface RecallHit {
  id: string; text: string; agent: string; scope: MemoryScope;
  score: number;   // unchanged key; now carries the same FUSED value as `rrf`
  rrf: number;     // the RRF fused score: Σ 1/(60 + rank + 1) over the legs
  retrievals: number;
}
export type RecallMode = "hybrid" | "hybrid-degraded" | "bm25-only";
export interface RecallResult {
  results: RecallHit[];
  scanned: string[];
  mode: RecallMode;
  reranked: number;   // count of candidates the reranker actually reordered (0 when off)
}
```

The corpus of both legs is **exactly** the records of the namespaces returned by
`authorizeRead` (retired excluded) — the hybrid path never widens the read set
(AC5). A query-less recall keeps today's behaviour and is **not** labelled
`bm25-only`. Degradation: embedder throws → `mode: "hybrid-degraded"`,
BM25-only result; embedder unavailable by config → `mode: "bm25-only"`.

### 8.4 Stale index makes `recall` throw `.code === "STALE_INDEX"` (D5, AC6)

This is a **behaviour change** from today's silent empty-vector answer. When a
namespace has records and an index whose `embedder`/`dim`/`revision` differ from
the active engine — or records and no index — `recall` throws an error with
`.code === "STALE_INDEX"` whose message names the namespace label **and**
`reindex`. A namespace with no records and no index returns empty, no error.
`VectorIndex` gains `revision: string`; `doctor` check `embedder-dim` requires
`revision` too. `admin reindex` re-stamps and is idempotent (byte-identical
`index.json` on two consecutive runs).

### 8.5 The 13 matrix rows keep the SAME observables (D3)

Every row body in `test/matrix.selftest.mjs` becomes `async` and awaits
`engine.invoke(...)`; the asserted values are **unchanged** (§4). Barrier stays
`13/13` and `exit 0`. `mcp/test/engine.selftest.mjs` and
`mcp/test/transport.selftest.mjs` get the same async conversion; the transport
spawns `mcp/server.js` with `CORE_BRAIN_EMBEDDER=fixture` +
`CORE_BRAIN_FIXTURE_DIR`.

### 8.6 Probe runner and the optional raw-leg diagnostic

`test/search.selftest.mjs` is the runner for the AC probes named in plan §9:
`semantic`, `fusion`, `rerank`, `rerank-real`, `isolation-hybrid`,
`stale-index`, `reindex`, `offline`, `fusion-verbose`. Each prints its probe
name plus **literal values**; a probe never passes on a bare boolean.

**Non-binding diagnostic (for ORACLE ruling).** Plan §9 asks `--probe fusion
--verbose` to print the *raw* BM25 score and *raw* cosine per candidate. Those
two fields are **not** part of the pinned `RecallHit` shape above. This contract
does **not** bind them: the probe prints them **if** a hit carries an optional
`legs` array (`{ id, bm25Rank, bm25Score, vectorRank, cosine, rrf }`), and
otherwise prints `legs=absent`. Whether to pin `legs` is an OPEN QUESTION the
ORACLE must rule on; until then the RRF value (`rrf`) and its recomputation
`Σ 1/(60+rank+1)` remain the binding observables.

### 8.7 Fixture format (D4/B4)

- `test/fixtures/vectors.bin` — N=518, dim=384, float32 LE → **795,648 B exact**.
- `test/fixtures/manifest.json` — `{ embedder, dim, revision, byteLength,
  entries: [{ text, key, sha256, offset, length }] }`, key = `sha256(normalised)`.
- Generated by `node test/fixtures/generate.mjs` (deterministic; `--check`
  verifies the byte count). The committed vectors are the deterministic double,
  **not** model output — B4's real embed run stays a **declared open item**.

### 8.8 What is RED until the engine lands (the point of Phase 0)

`bash check.sh` runs **both** suites. Against the current synchronous,
`hash-ngram-v1` engine: `search.selftest.mjs` is **RED for the right reason**
(no hybrid/RRF, no `mode`, no `rrf`, no `STALE_INDEX`, the seam is ignored); the
13-row isolation matrix may stay green where the row still holds (allowed by
plan §8 step 1) — the RED probe run is the evidence the rows discriminate.

---

## 9. Slice 2 contract delta (Fatia 2) — the automatic layer (A1–A3; A4 `UNKNOWN`)

- **Authority:** `docs/specs/fatia2-automatic-layer-plan.md` §1–§7 (A1–A4, D1–D7,
  REQ-1..REQ-6 and the AC).
- **Date:** 2026-10-04. **Status: LANDED (tests only; no production code).**
- **Artifact:** `test/hooks.selftest.mjs` — run by `check.sh` after the matrix
  and the probes.
- **Rule that makes this section first (same as §8):** this file is the law; the
  test changes first, the DEVELOPER implements against it.
- **No UI is touched by Fatia 2** — no visual pass applies (declared, not implied).

### 9.1 New agent-policy key: `inject` (opt-in, default `false`)

The accepted agent row gains an **optional** boolean `inject`:

- Omitted key, or an agent **absent** from `config.json`, resolves to
  `inject: false`.
- `inject: true` is the **only** way an agent receives the automatic block.
  `name`, `private` and `hasGlobalAccess` do **not** enable it.
- The `CB_*` fixtures and every unlisted agent stay **non-opted-in** unless the
  row explicitly says `inject: true`.
- A present non-boolean `inject` is refused by the engine at init, exactly like
  the other booleans (`InvalidConfigurationError`, message naming the agent and
  `"boolean"`).
- The engine must resolve this flag for the plugin; the plugin resolves the
  agent through `ctx.session.get`, never from the caller.

The test-facing row shape the selftest writes (proof it is a **separate** key):

```json
{ "name": "CBA_INJ1", "hasGlobalAccess": true, "private": false, "inject": true }
```

**Block size is ONE global setting (USER, 2026-11-19).** The count of memories the
block carries is no longer the literal `5` in the hook, and it is **not** per agent:

- `config.json` accepts an optional file-wide `memoriesPerContext` (default `5`);
- an invalid value (negative, non-finite) falls back to the default `5`;
- `0` is honoured and means «no block at all»;
- **the value is PER HALF (USER, 2026-11-19):** the block carries up to
  `memoriesPerContext` records from the **global** space (the most voted) **plus**
  up to the same number from the **agent's own** space, so the default block holds
  up to 5 + 5 = 10 memories. Cross-agent spaces are NOT read for the block;
- both hooks (A1 `context` and A3 `compaction`) build the same two halves through
  `collectBlock`, and read the size through `engine.memoriesPerContext()`.

**The block follows the conversation (USER, 2026-11-19).** There is no query at
session start — no prompt, no history, no speech — so the first block is chosen by
strength. From the moment a USER prompt exists, `collectBlock` receives it as the
`query` of both halves, and the marker stops meaning «skip»: A1 **replaces** the
marked part in place with the new block (identical content is still a no-op), so a
session that changes subject changes its block instead of keeping the first five
forever.

### 9.2 Hook registration

`setup(ctx)` registers **three** session hooks on the existing defensive
envelope (each `typeof hook === "function"` inside `try/catch`, each
`Registration` disposed by the returned disposer):

| Hook | Deliverable | Role |
|------|-------------|------|
| `context` | A1 | automatic injection (read side) |
| `prompt` | A2 | automatic learning (write side, read-only over the event) |
| `compaction` | A3 | checkpoint carry + learn from the discarded |

A4 registers **nothing** (see §9.6).

### 9.3 A1 — `context`: automatic injection

- **Gate order (binding):** resolve the agent (`ctx.session.get`) → read
  `inject`; if **not** opted in, return **without calling recall** (the
  non-opted-in agent pays no read cost).
- **Inject (binding):** only when opted in — recall, compose the block, then
  `if (Array.isArray(event?.system)) event.system.push({ type: "text", text: block })`.
- The block is a **non-empty** string with a stable marker and the recalled
  record text.

Observables asserted by `hooks.selftest.mjs`:

| Ledger | Setup | Literal expectation |
|--------|-------|---------------------|
| **A1.a** | opted-in agent, one seeded record `M` | `event.system.length === 1`; the part is `type:"text"` with a non-empty `text` **containing `M`** |
| **A1.b** | non-opted-in agent, one seeded record `M` | `event.system.length === 0`; one observation `recall` returns the record with `retrievals === 1` (a single observation counts once) |
| **A1.c** | opted-in agent, `event.system` **absent** | the hook returns without throwing |
| **A1.d** | opted-in agent, `event.system` **non-array** | the hook returns without throwing |
| **A1.e** | agent **absent** from `config.json`, one seeded record | `event.system.length === 0` (unlisted ⇒ nothing by default) |
| **A1.f** | opted-in agent, one seeded record `M` marked useful twice, then the context hook | the block carries `M`; the observation `recall` afterwards returns `retrievals === 1` — **the hook's own read counted nothing** |

**A hook read never counts a retrieval (2026-11-19).** The hook reads on the
model's behalf, so `recallTexts` passes `countRetrievals: false` (an INTERNAL
field, never offered in the tool schema). Before this, the injection incremented
the very ranking it is ranked by: the injected records gained +5 retrievals
across a handful of reads, and with 70 3xx retrievals at the top nothing new
could ever enter the block. `A1.b`'s `retrievals === 1` therefore no longer
proves "the hook did not call recall" — `A1.f` does.

### 9.4 A2 — `prompt`: learning, read-only

- The hook **reads** `event.prompt.text` to extract durable statements and
  writes each through `engine.invoke(agent, { op: "store", … })`.
- `event.prompt` is **never** mutated: `event.prompt.text` is byte-identical
  before/after, and no `system` is injected here (injection is A1's job).
- A non-opted-in agent stores nothing.
- Dedupe key = `text + origin` (`origin = prompt`): the same statement twice ⇒
  exactly one record.
- **The cue gate is bilingual (2026-11-19, USER).** A statement is durable when it
  carries at least one cue — English (`always`, `never`, `prefer`, `remember`,
  `convention`, `standard`, `rule`, `decided`) **or** Portuguese (`nunca`,
  `jamais`, `sempre`, `prefiro`, `prefere`, `lembra`, `lembre`, `regra`,
  `regras`, `convenção`/`convencao`, `padrão`/`padrao`, `decidi`, `decidimos`,
  `proibido`, `obrigatório`/`obrigatorio`, `a partir de agora`). The English cues
  are unchanged: the Portuguese ones were **added**, never substituted.

| Ledger | Setup | Literal expectation |
|--------|-------|---------------------|
| **A2.a** | opted-in, `prompt.text = "convention: always use pnpm"` | `prompt.text` and the whole `prompt` object byte-identical; a self `recall` finds **exactly 1** record containing `"pnpm"` |
| **A2.b** | the identical statement invoked twice | **still 1** record (dedupe holds) |
| **A2.c** | non-opted-in agent | self `recall` finds **0** records containing the distinctive token |
| **A2.d** | opted-in, `prompt.text = "Nunca usar tabs neste repositório — regra do Gand"` | self `recall` finds **exactly 1** record containing the Portuguese sentence (the gate accepts a Portuguese cue) |
| **A2.e** | opted-in, `prompt.text = "Hoje o café estava bom e vi o jogo à noite"` | self `recall` finds **0** records: ordinary Portuguese chatter carries no cue |

### 9.5 A3 — `compaction`: carry + learn from the discarded

- Re-injects the marked block into `event.system` (same guard as A1) and learns
  from `event.messages` (`origin = compaction`, same dedupe key).
- **Never** sets `event.result` — the host's summary stays untouched.
- **Test-facing `event.messages` shape (binding):** an array of `{ role, content }`
  (OpenCode-style); a message's text is readable from `content` (string) and/or
  `parts[].text`. The selftest supplies both on the same message, so either
  reader finds it and dedupe keeps one record.

| Ledger | Setup | Literal expectation |
|--------|-------|---------------------|
| **A3.a** | opted-in, one seeded record `M`, one discarded message with a durable statement | `event.result === undefined`; `event.system.length === 1`, the part contains `M`; self `recall` finds **exactly 1** record learned from the messages |
| **A3.b** | non-opted-in agent | `event.system.length === 0`, `event.result === undefined`, **0** learned records |

### 9.6 A4 — closing ritual: `UNKNOWN`, not tested

The session-hook list is **closed** (`prompt, context, compaction, generate,
title, model.request, http.request, http.response, experimental.ws.*, retry`)
and has **no** session-end member (plan D5). No hook is registered for A4 and
`hooks.selftest.mjs` emits an explicit **SKIP** naming this reason. A4 stays
`UNKNOWN` until the `openapi.json` spike (plan §4.4) produces a finding.

### 9.7 The selftest and the RED-then-GREEN contract

- `test/hooks.selftest.mjs` drives the **real** plugin: it imports the default
  export, calls `setup(ctx)` with a captured fake context (`tool.transform` +
  `session.hook` + `session.get`), captures the registered hooks and the
  `core_memory` tool, and seeds/observes **through that tool**
  (`store` / `recall`).
- **RED today, for the right reason:** `setup` registers only the inert
  `prompt` hook, so `context` and `compaction` are absent (A1, A3 fail) and
  `prompt` learns nothing (A2 fails). The GREEN run is the proof the layer
  landed.
- **Declared dependency:** the plugin builds its engine with
  `createEngine({ home, configPath })` — no injectable embedder. The suite
  therefore needs the engine embedder to be available: the provisioned real
  runtime, or `CORE_BRAIN_EMBEDDER=fixture` honoured by that path. `check.sh`
  exports `CORE_BRAIN_EMBEDDER=fixture`; the suite is otherwise self-contained
  (its own temp root, removed on exit — rule 21).
- Exit codes mirror the matrix: `0` only when every ledger passes; `1` on any
  FAIL; `2` when the plugin/tool cannot be loaded. The A4 **SKIP** does not
  affect the exit code.
- `mcp/test/engine.selftest.mjs` is **unchanged**: the hook delta adds no engine
  export that the MCP layer already pins. (If the `inject` field is later
  surfaced in `who`/`status`, re-check the MCP status-shape assertions.)

---

## 10. Slice 3 contract delta (Fatia 3) — the episodic timeline (T1–T5, AC-TL1..AC-TL6)

- **Authority:** `docs/specs/fatia3-timeline-plan.md` §1–§7; source spec
  `docs/specs/core-brain-v2.md` §12 (lines 166–224); deliverables T1–T5 in
  `docs/specs/core-brain-migration-plan.md:73-79`.
- **Date:** 2026-10-04. **Status: LANDED (tests only; no production code).**
- **Artifact:** `test/timeline.selftest.mjs` — run by `check.sh` after the hooks
  suite. `check.sh` exits `0` only when the matrix (13/13), the probes, the hooks
  AND the timeline all pass.
- **Rule that makes this section first (same as §8/§9):** this file is the law;
  the test changes first, the DEVELOPER implements against it. The plan's §7.1
  explicitly hands the episodes-section shape to the TESTER.
- **No UI is touched by Fatia 3** — no visual pass applies (declared, not
  implied).

### 10.1 The `Episode` object (spec §12.1)

```ts
interface Episode {
  id: string;            // EP-<epoch ms>-<4 chars> — readable, sortable, the PLUR shape
  at: string;            // ISO 8601 timestamp of the event
  agent: string;         // who wrote it — the caller's SESSION identity, never a tool argument
  summary: string;       // the narrative: what happened
  sessionId?: string;
  channel?: string;
  tags?: string[];
  engramIds?: string[];  // set by `dream` — the memories that came out of this episode
}
```

`id` and `at` and `summary` are always present. `agent` is **required** on any
episode created by the `episode` op (always the session identity, §10.3), and is
copied **verbatim** on imported episodes; an imported entry whose source carried
no owner keeps no `agent` key — the importer invents nothing (plan §4).

### 10.2 The three ops on the single `core_memory` tool (spec §12.2 / plan §2)

```
episode  { op:"episode", summary:string, tags?:string[], sessionId?:string, target?:"self"|"global" }          -> { ok:true, id:string, ns:string }
timeline { op:"timeline", query?:string, since?:string, until?:string, tags?:string[], limit?:number, from?:NamespaceTarget } -> { results:Episode[], scanned:string[] }
dream    { op:"dream", episodeIds?:string[], memories?:Array<{text:string, meta?:object}>, force?:boolean } -> { ok:true, episodes?:Episode[] , dreamId?:string, memories?:string[] }
```

Exactly one tool is registered — no second tool, no second identity path
(spec §12.2/`:198`).

**Pinned resolutions of the plan's ambiguous cells** (the plan's table omits the
arguments that make its own isolation cell reachable; the TESTER fixes them,
the ORACLE may rule):

- `episode` gains an **optional `target`** mirroring `store` (`"self"` default;
  `"global"` only with `hasGlobalAccess`). The plan's isolation cell — *"own
  namespace always; `global` iff `hasGlobalAccess`"* — is only reachable with a
  target, and `global/episodes.json` is listed as storage (§3). `agent:<X>` is
  **not** accepted for episodes: the diary is own-space or global only.
- `timeline` gains an **optional `from`** identical to `recall`
  (`"self"` | `"global"` | `"agent:<X>"`; omitted = the readable union), because
  the plan's isolation cell says *"read matrix §6.1 — identical to recall"*.
- `ns` uses the **same label format as `store`/`scanned`**: `agent:<A>` for a
  self episode, `"global"` for a global episode.
- `at` is set by the engine to the current ISO time; it is **not** a request
  field (imported episodes carry it from the document, §10.5).
- A query-less `timeline` returns episodes **most-recent-first** (`at` desc). The
  default `limit` is an implementation choice and is **not** pinned here.
- `dream` is the only way an episode becomes a memory (USER, 2026-11-19: `promote` was removed as
  obsolete). With no payload it LISTS the episodes without `dreamedAt`; with `episodeIds` and
  `memories` it performs the pass: each memory is stored in the caller's **own** namespace with
  `meta.derivedFrom` (the first episode) and `meta.dreams` = `[{id, at}]` (the dream and its DATE),
  each episode is marked `dreamedAt` and gains the ids in `engramIds`, and one dream record links
  both sides (`dreams.json`).
- A **duplicate** memory is REINFORCED, never duplicated: the existing record gains this dream, its
  `retrievals` and `feedback.useful` go up, and the episode is still marked. Real refusals: unknown
  episode, already-dreamed episode, daily limit (`force:true` bypasses it for a manual run).

