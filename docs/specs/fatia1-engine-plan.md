# core-brain — Slice 1 executable plan: the real engine

- **Status:** PLAN for ORACLE review → TESTER (contract delta) → DEVELOPER (implement). Nothing is implemented in this slice.
- **Date:** 2026-10-03
- **Author:** ARCHITECT (EXTENDED), flow *Tico and Teco Think*, launcher `ses_efecb20b5ffehMHiwoZWdOCdl8`
- **Repo:** `oesc/core-brain` — file at `docs/specs/fatia1-engine-plan.md`
- **Authority (read in this order):** `docs/specs/core-brain-v2.md` §2/§3/§4 (M1–M8)/§5 (R1–R9)/§6/§7 (AC1–AC10)/§8/§10; `docs/specs/core-brain-migration-plan.md` §2 (E1–E8); `docs/specs/core-brain-plugin.md` §4/§5(superseded)/§6/§7/§8/§9; `docs/temp/fatiga0-decisoes.md` (B1–B5, closed — **not re-opened**); `global/opencode/plugins/core-brain/{store.ts,index.ts,types.ts,check.sh,test/CONTRACT.md,test/matrix.selftest.mjs,mcp/server.js,mcp/jsonrpc.js,mcp/check.sh,mcp/test/engine.selftest.mjs}`.
- **Evidence discipline:** every number below is quoted from `docs/temp/fatiga0-decisoes.md` / `docs/temp/fatiga0-architect-measurements.txt`, from the shipped code, or from a `grep`/`read` of `@plur-ai/core@0.21.0` on this machine (commands cited inline). Anything unmeasured is marked **UNVERIFIED** and is not a decision input.

---

## 0. Scope, deliverable, hard rules

**In scope (Slice 1 — the engine):** E1 real embeddings, E2 hybrid BM25+vector fused by RRF over the permitted namespaces only, E3 configurable reranker, E4 shared model cache, E5 stamped index + stale refusal + idempotent reindex, E6 Apache-2.0 compliance, E7 `check.sh` 13/13 exit 0, E8 measured cost in `README.md`. The isolation matrix (§6 of the plugin spec), the store layout (`~/.core-brain/` JSON), the single tool `core_memory`, the MCP surface and the default policy are **untouched law**.

**Out of scope (declared):** G2 (automatic layer), the episodic timeline, M1–M12 migration, PLUR packs/scopes/profiles/tensions, query rewriting parity, concurrency (file lock).

**Hard rules (binding, from the USER via the ORACLE):** zero commits (git read-only); nothing written under `~/.config/opencode/` by an agent; `~/.plur/` never written or deleted; nothing under `~/.npm` modified; every memory-writing step idempotent or with a named rollback; the isolation is not touched; `check.sh` must stay green; no claim without a measured number; every resource opened for a test is released in the same task (rule 21).

---

## 1. Corrections this plan makes to upstream (spec-correction flags — the ORACLE rules on each)

These are **findings against the spec**, not silent edits. Each is a defect in a document this plan is bound by.

**C1 — M7 says "reranker on by default where PLUR has it on"; PLUR has it OFF.**
Measured in the installed `@plur-ai/core@0.21.0`:
```
$ grep -n 'DEFAULT_RERANKER' /home/gandb/.npm/_npx/386f78daf917651f/node_modules/@plur-ai/core/dist/index.js
2982: var DEFAULT_RERANKER = "off";
```
Parity therefore means **reranker OFF by default** in core-brain, switched on by configuration. M7's clause "on by default where PLUR has it on" resolves to *off*; the "documented switch to turn it off" becomes a documented switch to turn it **on**. This plan implements that reading; the ORACLE must confirm before the DEVELOPER starts.

**C2 — B1's latency was measured with the wrong pooling for `bge-small`.**
PLUR's `bge-small` adapter uses **`pooling: "cls"`**, not `mean`:
```
$ grep -n 'makeBgeSmallAdapter' -A8 .../@plur-ai/core/dist/chunk-VNFYIPQL.js
67: function makeBgeSmallAdapter() { return makeTransformersAdapter({ name:"bge-small", dim:384, modelId:"Xenova/bge-small-en-v1.5", pooling:"cls", normalize:true, dtype:"fp32" }); }
```
The B1 latency run used `pooling: 'mean'` (`docs/temp/fatiga0-architect-measurements.txt` §A, script line: `pipe(t, { pooling: 'mean', normalize: true })`). Same model, same dimension (384, measured twice) and the same order of magnitude of cost — but the vectors are **different**. B1's numbers stand as a cost estimate; the E1 implementation must use `cls` and the E1 evidence must be re-run with `cls`. No re-measurement is ordered here as a blocker (rule: don't repeat measurements), but the **first executed E1 run must use `cls` and its digest is the evidence**.

**C3 — filename drift:** the repo ships `INSTALATION.md` (one `T`) while `README.md` links `INSTALACAO.md` and the plugin spec §10 calls it `INSTALACAO.md`. One of the two is broken. Fix in this slice (rename to `INSTALACAO.md`, or fix the links) and record the choice.

**C4 — the closure that B1/B3 measured is PLUR's, not core-brain's.** `983,658,321 B` is the closure of `@plur-ai/mcp` (which pulls `@plur-ai/core`, PGlite, `@modelcontextprotocol`, zod, **and** the transformers runtime). Decision D2 below changes what core-brain installs, so the E8 figure is a **new** measurement (`du -sb` on the core-brain runtime), not a copy of 983,658,321 B. Marked UNVERIFIED until E8 runs.

**C5 — engine closure attribution is not measured.** The B3 table attributes bytes per package; this plan counts as "avoided" only the packages PLUR declares and core-brain does not need, whose individual sizes are measured (B3 table). A single composite "core-brain closure size" is **not** stated here (it would be an unmeasured claim); E8 measures it.

---

## 2. D1 — Where the engine lives (the brief's question 1)

**Candidates considered, with the measured facts in hand:**

| Option | What it means | Measured cost / risk |
|---|---|---|
| **A. Inside the plugin tree** (`global/opencode/plugins/core-brain/node_modules`) | `dependencies` in the plugin `package.json`, installed in place | The plugin tree is copied verbatim into the mirror by `install-global.sh` (`cp -r global/opencode/. ~/.config/opencode/`). Either the ~730 MB closure enters the repo (repo bloat, 983,658,321 B closure measured) or the mirror must be `npm install`-ed, i.e. **an agent-adjacent write inside `~/.config/opencode/`**, forbidden. Also duplicated per plugin copy. **Rejected.** |
| **B. Vendorize the source** | copy PLUR's source into the repo and build it | B2 already rejected it: the vendored artifact would be the closure, and rebuilding `onnxruntime`/`sharp` is a fork. `@plur-ai/core` package itself is only 1.9M, but nothing works without the runtime. **Rejected.** |
| **C. Resolve from PLUR's npm `_npx` cache** | `import()` an absolute path under `~/.npm/_npx/<hash>/…` | The hash `386f78daf917651f` is npm's cache key — unstable across npx runs/updates; couples core-brain's runtime to PLUR's install lifecycle (M9 deletes PLUR's plugin/MCP, and possibly its npx cache). Also `~/.npm` is a **do-not-touch** tree. **Rejected.** |
| **D. Dedicated runtime dir outside the plugin tree** — `~/.core-brain/runtime/` (env-overridable `CORE_BRAIN_RUNTIME_DIR`) | one `npm install` of the engine's runtime, shared by the plugin path and the MCP path; weights in `~/.core-brain/models/` | Keeps the repo and the mirror small; matches M5's spirit (nothing heavy duplicated inside the plugin tree); both hosts already share `store.ts` (R9). Cost: a one-time provisioning step the **USER** runs, and a resolver that imports the package by absolute path. **Chosen.** |

### DECISION D1 — the engine runtime lives in `~/.core-brain/runtime/`, the weights in `~/.core-brain/models/`

- **Runtime root:** `CORE_BRAIN_RUNTIME_DIR` → default `~/.core-brain/runtime`. The engine package (decision D2) is installed there once by a **USER-run** script (`install-runtime.sh`, §7 file `install-runtime.sh`). It is *not* inside the plugin tree and *not* inside the mirror.
- **Weights root (E4/M5):** `CORE_BRAIN_MODELS` → default `~/.core-brain/models`; `transformers.env.cacheDir = CORE_BRAIN_MODELS`.
- **Resolution mechanism (must be in the plan because it decides every import):**
  ```ts
  // engine/embedder.ts (shape, not final code)
  import { createRequire } from "node:module";
  import { pathToFileURL } from "node:url";
  const req = createRequire(join(runtimeDir, "package.json"));
  const entry = req.resolve("@huggingface/transformers");       // absolute file path
  const tf = await import(pathToFileURL(entry).href);
  ```
  `createRequire` + `resolve` is the same mechanism B1 used successfully with an absolute `file://` import (`docs/temp/fatiga0-architect-measurements.txt` §Archived scripts).
- **Fail-closed when the runtime is absent:** with no injected embedder and no resolvable runtime, `store` and `recall` throw a typed `EngineUnavailableError` whose message names the fix (`run global/opencode/plugins/core-brain/install-runtime.sh`). They never silently fall back to `hash-ngram-v1` (a silent fallback would answer by spelling and hide the defect — the exact v1 failure v2 exists to fix).
- **Rollback:** delete `~/.core-brain/runtime` → back to the fail-closed engine; no repo change.

**Measured justification for "outside the tree":** the closure B3 measured is **983,658,321 B apparent** (`du -sb`), dominated by `onnxruntime-node` 574,221,664 B, `onnxruntime-web` 145,475,100 B and `@huggingface` 144,451,853 B — bytes that must not be copied into the repo or the mirror. Prune #1 (D8) removes 254,789,872 B of that, and the weights (133,805,935 B cache dir for `bge-small`, per B3) are shared, not duplicated.

---

## 3. D2 — Depend on what, vendor what (brief question 1 + E6)

**Measured baseline (installed `@plur-ai/core@0.21.0`, Apache-2.0):**
- deps: `@electric-sql/pglite ^0.4.6`, `js-yaml ^4.3.1`, `tar ^7.5.21`, `zod ^3.23.0`; **optional** `@huggingface/transformers ^4.2.0` (installed **4.3.0**).
- `@plur-ai/core/dist` **never** mentions `onnxruntime-web`/`onnxruntime-node`; it loads transformers lazily at 3 sites (`chunk-VNFYIPQL.js` ×2, `index.js` ×1) — B3a, static evidence.
- `sharp` **is** really imported (`@huggingface/transformers/dist/transformers.node.cjs:19821`), so `sharp`+`@img` = 29,499,541 B is **not** removable (B3 correction).

**The genuine fork in the road:** reuse `@plur-ai/core`'s exported `hybridSearchWithMeta`/`rrfMerge`/embedders/reranker (maximal code reuse, R-0 at its most literal), or depend only on the runtime and port the ~150 pure lines.

| | Reuse `@plur-ai/core` | Depend on `@huggingface/transformers` + port the pure code |
|---|---|---|
| Parity | exact by construction | reproduced by copying PLUR's own constants (below) |
| Extra closure | + `@plur-ai/core` 1,920,000 B + `@electric-sql` 25,607,855 B + `better-sqlite3` 12,511,193 B + `js-yaml` 960,180 B + `zod` 3,594,196 B (B3 table; all measured) ≈ **+44.6 MB** minimum, plus `@modelcontextprotocol` 32,219,060 B if `@plur-ai/mcp` were pulled (it is not needed) | none of those |
| Coupling | core-brain records must be shaped as PLUR `Engram`s; PLUR's `embeddingSearch` wants a `storagePath` and its own `.embeddings-cache.json` — two stores for derived data | none; the index stays core-brain's `vectors/<ns>/index.json` (M2) |
| E6 (Apache-2.0 for copied files) | trivial (one dependency, no copied file) | **meaningful**: 4 ported files get headers + `NOTICE` |

### DECISION D2 — depend on the **runtime only** (`@huggingface/transformers@4.3.0`, pinned), and **port the four small pure algorithm files** from `@plur-ai/core` under Apache-2.0

Porting here means **copying PLUR's code** — explicitly allowed by R-0 ("pode copiar o código plur é open source") — not reinventing. The ported files are pure functions with no store coupling, so the index stays core-brain's and M2 holds.

**Exact provenance (file:line, installed 0.21.0 — this is the citation that must appear in `NOTICE`):**

| Ported file (new, in `engine/`) | Source in `@plur-ai/core/dist` | What is copied verbatim |
|---|---|---|
| `engine/fts.ts` | `chunk-TMRCNWX6.js` lines 1–179 | `STOP_WORDS`, `MIN_TOKEN_LENGTH = 2`, `TOKENIZER_VERSION = 4`, `SPACELESS_RUN`, `MAX_SPACELESS_RUN_CHARS = 512`, `DENSE_SCRIPT`, `ftsTokenize`, `engramSearchText`→`recordSearchText`, `computeIdf`, `ftsScore` (**`BM25_K1 = 1.2`, `BM25_B = 0.75`**), `searchEngrams` (incl. the all-zero-IDF fallback) |
| `engine/fusion.ts` | `index.js` line 3078 | `rrfMerge(resultSets, k = 60)` — `rrfScore = 1 / (k + rank + 1)` summed per id, sorted desc |
| `engine/embedder.ts` | `chunk-VNFYIPQL.js` lines 5–89, 292–346 | the `loadPipeline`+`embedOne` adapter shape, `bge-small` config (`modelId`, `dim:384`, `pooling:"cls"`, `normalize:true`, `dtype:"fp32"`), the dim assertion, `HF_HUB_DISABLE_XET=1` |
| `engine/reranker.ts` | `index.js` lines 2919–2981, 3150–3175 | `makeTransformersCrossEncoder` (`AutoTokenizer` + `AutoModelForSequenceClassification`, `scoreBatch` reading `logits[i*numLabels]`), `MS_MARCO_MINILM_L6_MODEL_ID = "Xenova/ms-marco-MiniLM-L-6-v2"`, `dtype "q8"` default, `applyReranker` (topK default 50, head/tail split, failure → return RRF order) |

**Constants that must match PLUR — the parity checklist (each grep-backed):**
```
BM25_K1 = 1.2            (chunk-TMRCNWX6.js:139)
BM25_B  = 0.75           (chunk-TMRCNWX6.js:140)
TOKENIZER_VERSION = 4    (chunk-TMRCNWX6.js:31)
rrf k   = 60             (index.js:3078)
reranker default = "off" (index.js:2982)          [C1]
reranker model  = Xenova/ms-marco-MiniLM-L-6-v2, dtype q8 (index.js:2921, 2945)
reranker topK default = 50 (index.js:3157)
leg limits (non-aggregation): bm25Limit = limit*3, embLimit = limit*2 (index.js:3120–3121)
embedder default = "bge-small" (chunk-VNFYIPQL.js:300) — matches B1's choice
```

**Declared parity gaps (not ported, recorded):** PLUR's `rewriteLexicalQuery` / `isQueryRewriteDisabled`, `isAggregationQuery` (exhaustive-search widening), the OpenAI/embedding-gemma embedders, `bge-reranker-v2-m3`, and PLUR's `embeddingContentHash` cache. None is required by E1–E8 or AC1–AC10; each is a follow-up, not a silent omission.

**Licence field:** `package.json` `"license"` becomes `"(MIT AND Apache-2.0)"` (core-brain's own files MIT, the 4 ported files Apache-2.0). `LICENSE` (MIT) stays; `LICENSE-APACHE` and `NOTICE` are added (E6, §7).

---

## 4. D3 — The async seam (the central risk; a contract change that must precede implementation)

**Measured fact:** `@huggingface/transformers` is asynchronous at both load and call:
```
docs/temp/fatiga0-architect-measurements.txt §A:
  pipe = await tf.pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5', { dtype: 'fp32' });
  const v = await pipe(t, { pooling: 'mean', normalize: true });
```
and PLUR's own `embedOne`/`hybridSearch` are `async` (`chunk-VNFYIPQL.js:28`, `index.js:3114`).

**Measured fact about today's seam:** `Engine.invoke` is **synchronous** (`store.ts:1173`) and every caller relies on it:
- `test/matrix.selftest.mjs` — 13 rows call `engine.invoke(...)` **without await**, and `row()`/`body()` are sync (lines 154–324).
- `mcp/test/engine.selftest.mjs` — same, ~40 call sites, `scenario(name, fn)` sync (line 45).
- `mcp/server.js` — `callTool()` calls `engine.invoke(...)` synchronously (line 196); `mcp/jsonrpc.js` `handleLine` calls `onRequest(...)` synchronously (line 34) and writes `result` immediately (line 44).

**A synchronous seam cannot carry an async engine.** No `Atomics.wait`/worker bridge is planned (fragile, and it would be a second engine implementation — R9 violation). Therefore:

### DECISION D3 — `Engine.invoke` becomes async: `invoke(agent, req): Promise<CoreMemoryResult>`; `createEngine` stays synchronous

- `createEngine(options)` stays sync — config load/validation is sync, and **`createEngine` throwing `InvalidConfigurationError` at init (the matrix's line 12/17/18) is unchanged**.
- Only `invoke` changes shape. All ops (including sync ones) resolve through the same Promise, so callers have one rule: `await invoke(...)`.
- `mcp/jsonrpc.js` becomes `async`-capable: `handleLine` awaits `onRequest(...)` before writing the response (`writeResponse` after `await`), and the `try/catch` must wrap the `await` so a rejection still produces the JSON-RPC `error` object. `serveStdio`'s data handler must not reorder responses: the simplest correct form is an internal promise chain (`queue = queue.then(...)`), which preserves request order — a plain `await` inside the `data` callback is **not** enough (it lets the next line overtake).
- `mcp/server.js` `callTool` and `handle` become `async`/return promises.
- `index.ts` already has an `async execute()` — it only adds `await` (line 482).

**This is the contract delta the TESTER must land FIRST** (test/CONTRACT.md §2 says: *"Any future rename must update this file and matrix.selftest.mjs together — the test is the contract, so it changes first or not at all."*). The delta to write into `test/CONTRACT.md`:
1. `invoke(...): Promise<CoreMemoryResult>` (was `CoreMemoryResult`).
2. `EngineOptions` gains `embedder?` / `reranker?` (D4) — test-only injection, never a `core_memory` input.
3. `recall` result gains `mode: "hybrid" | "hybrid-degraded" | "bm25-only"`; `RecallHit` gains `rrf: number` (the fused score; `score` keeps the same key and now carries the same fused value).
4. A stale index makes `recall` **throw** with `.code = "STALE_INDEX"` and a message naming the namespace + `reindex` (AC6) — this is a **behaviour change** from today's silent empty-vector answer (`store.ts:185`).
5. All 13 matrix rows must be updated to `await` while asserting **the same observables**; the bar stays `13/13` and exit `0`.

**Risk called out to the ORACLE:** if the ORACLE prefers to keep the sync seam, the only honest alternative is to move embedding out of `invoke` into the tool/MCP layer and pass vectors in — which changes the *request* shape and leaks the engine into the hosts (worse for R9). This plan chooses async and states the trade.

---

## 5. D4 — Embedder/reranker as an injectable seam (B4's fixture enters here)

**Why injection is mandatory, not optional:** the offline test path (B4) must not download or load the model, and the selftest stores unique nonce texts (`cb-selftest-<nonce>-…`) that cannot possibly be precomputed.

### DECISION D4 — the engine takes `embedder`/`reranker` seams; the default is the real one

```ts
// types.ts (shape)
export interface Embedder {
  id: string;          // "Xenova/bge-small-en-v1.5" | "fixture-bge-small" | "hash-ngram-v1"
  dim: number;         // 384
  revision: string;    // model-artifact fingerprint (D5)
  embed(text: string): number[] | Promise<number[]>;   // await normalises both
}
export interface Reranker {
  name: string;        // "off" | "ms-marco-minilm-l6" | "fixture-…"
  scoreBatch(query: string, docs: string[]): number[] | Promise<number[]>;
}
export interface EngineOptions { home?: string; configPath?: string; embedder?: Embedder; reranker?: Reranker; }
```

**Resolution order:** `options.embedder` → env `CORE_BRAIN_EMBEDDER` (`real` default | `fixture`) with `CORE_BRAIN_FIXTURE_DIR` (default `<pluginDir>/test/fixtures`) → real. Same shape for the reranker: `options.reranker` → env `CORE_BRAIN_RERANKER` (`off` default | `ms-marco` | `fixture`) → off. The env route exists so the **MCP child process** (`mcp/server.js`, spawned by `mcp/test/transport.selftest.mjs`) can be put on the fixture without changing its code.

**The fixture embedder (`test/fixtures/embedder.mjs`), B4 applied:**
- `test/fixtures/vectors.bin` — the committed binary fixture. B4 measured the format: `N × dim × 4 B`; at N=518, dim=384 → **795,648 B** exact (JSON would be 3,909,315 B = 20.35 %, hence binary is the format of record).
- `test/fixtures/manifest.json` — `{ embedder, dim, revision, entries: [{ text, sha256, offset, length }] }`. Entries cover (a) the pinned probes for AC1/AC2/AC3/AC5 and (b) the 518 imported engrams (the measured store count), whose vectors must come from one real embed run (B4's declared open item; that run's wall cost is **UNVERIFIED**).
- Lookup = `sha256(normalisedText)`; **hit** → the real vector; **miss** → the deterministic `hash-ngram-v1` stub (kept in `engine/embedder.ts` as `fallbackEmbed`) so the matrix's arbitrary nonce markers still work offline and deterministically. The miss is reported in the selftest output (never silent).
- Consequence recorded honestly: in fixture mode, isolation lines 7–19 never embed a query (all recalls there are query-less), and the hybrid path is proven by the dedicated probes; in `CORE_BRAIN_EMBEDDER=real` mode the same probes run against the actual model. **Both runs are required** (see the AC table).

**Rollback:** unset the env / pass no seam → real engine; the fixture files are test-only and deletable.

---

## 6. D5–D9 — the remaining engine decisions

### D5 (E5) — index stamp + stale refusal + idempotent reindex

Index header becomes `{ embedder, dim, revision, vectors }` (`types.ts VectorIndex`). `revision` is the **model-artifact fingerprint**: `<modelId>@<dtype>@<first 16 hex of sha256(onnx/model.onnx)>`, computed once on first load and memoised to `~/.core-brain/models/.core-brain-model.json`; the fixture uses `revision: "fixture-v1"`. (This is the honest reading of "model revision": PLUR pins via the HF cache; core-brain records what bytes it actually loaded. **UNVERIFIED:** that the memoisation cost is negligible — the DEVELOPER records the first-load cost of the sha256 in E1 evidence.)

`recallOp` becomes fail-closed:
1. namespace has an index file whose `embedder`/`dim`/`revision` ≠ active → **throw** `StaleIndexError` (`.code = "STALE_INDEX"`), message: `core_memory recall: namespace 'agent:CB_BETA' has an index built by embedder 'hash-ngram-v1' dim 256, but the active engine is 'Xenova/bge-small-en-v1.5' dim 384 — run core_admin { action: "reindex", args: { ns: "agent:CB_BETA" } } to rebuild it`.
2. namespace has records but **no** index file → same refusal (an unindexed namespace is a stale state; answering it silently is the defect AC6 forbids).
3. index absent **and** no records → empty, no error (a namespace that was never written is not stale).
4. `doctor` check `embedder-dim` (already present, `store.ts:830`) becomes the diagnostic; it must also require `revision`.

`admin reindex` walks every active namespace, re-embeds every record with the **active** embedder and writes the stamped index; **idempotent**: two consecutive runs produce byte-identical `index.json` (same insertion order, same JSON formatting — `writeFileAtomic` is deterministic given the same records). The proof is `sha256sum` before/after the second run (AC7).

### D6 (E2) — hybrid over the permitted set only

- The corpus of both legs is **exactly** the records of the namespaces returned by `authorizeRead` (`store.ts:382`), retired records excluded. `bm25` and `vector` legs never read a namespace outside that list → R3 ("hybrid must never widen the read set") is structural, and AC5's proof is that `scanned` is unchanged while the query path is live.
- BM25: `ftsTokenize(query)` → `computeIdf(corpus, queryTokens)` → `ftsScore` → top `min(corpus, limit*3)` (PLUR's non-aggregation limit).
- Vector: cosine over the same corpus → top `min(corpus, limit*2)`. Query vector = `embedder.embed(query)`.
- Fusion: `rrfMerge([bm25Results, vectorResults], 60)` → top `limit`.
- Empty/blank `query` → no embedding, `mode: "bm25-only"` is **not** used; a query-less recall keeps today's behaviour (all active records, ranked by the existing tie-break `score→feedback→retrievals→updatedAt`). This preserves matrix lines 7–19 unchanged.
- Degradation: embedder throws → log, `mode: "hybrid-degraded"`, BM25-only result (never a silent empty answer); embedder unavailable by config → `mode: "bm25-only"`.
- `retrievals` still increments only on returned hits; the tie-break stays `rrf desc → feedback.useful desc → retrievals desc → updatedAt desc`.

### D7 (E3) — reranker configurable, default OFF (C1)

Resolution: `options.reranker` → env `CORE_BRAIN_RERANKER` (`off` default, `ms-marco`, `fixture`) → off. On: after RRF, take `topK = min(candidates, 50)`, score with the cross-encoder, reorder the head, keep the tail; any failure returns the RRF order unchanged and sets `mode: "hybrid-degraded"` + `reranked: 0`. The result carries `reranked: <count>` so AC3 can assert "changed when on, unchanged when off" from literal values.

### D8 (B3) — prune `onnxruntime-node` to `linux-x64`; `onnxruntime-web` stays UNPROVEN

- **Executed, measured (B3):** keep only `bin/napi-v6/linux/x64/` → `574,221,664 B → 319,431,792 B`, **saved 254,789,872 B** (44.4 % of the package, 25.9 % of the closure). Kept files, measured: `libonnxruntime.so.1`, `onnxruntime_binding.node`, `libonnxruntime_providers_{cuda,tensorrt,shared}.so`.
- **`onnxruntime-web` 145,475,100 B is static-only evidence, not a proven removal.** It appears only inside `@huggingface/transformers` (browser-conditional backend) and `onnxruntime-common`; the closure smoke test on a ~1 GB pruned copy was **NOT run** (outside the Fatia 0 boundary). This plan ships it **as a declared gap**; removing it requires the executed smoke in §12 (AC10 optional line).
- `prune-runtime.sh` performs the prune with the exact B3 commands and prints `du -sb` before/after. It is a runtime-dir operation (D1), never under `~/.npm`.

### D9 (B4) — the fixture, as in D4

Fixture size **measured**: 795,648 B (518 × 384 × 4, exact), binary is 20.35 % of the JSON equivalent (3,909,315 B). Committed under `test/fixtures/`; consumed only by the offline test path.

---

## 7. Files to create/modify, in order, and what changes in each

Order is binding: contract first (TESTER), then the engine (DEVELOPER), then the surface, then docs+licence.

### Phase 0 — TESTER lands the contract delta (no production code)

| # | File | Action | What changes |
|---|---|---|---|
| 0.1 | `test/CONTRACT.md` | edit | D3 delta: async `invoke`; `EngineOptions.embedder/reranker`; `recall.mode`; `RecallHit.rrf`; `STALE_INDEX` error; "all rows await, same observables, still 13/13". |
| 0.2 | `test/matrix.selftest.mjs` | edit | make `row()`/bodies async, `await engine.invoke(...)` everywhere; inject the fixture embedder from `test/fixtures/`; assert the SAME 13 observables. |
| 0.3 | `mcp/test/engine.selftest.mjs` | edit | same async conversion + fixture injection; keep behaviour assertions. |
| 0.4 | `mcp/test/transport.selftest.mjs` | edit | spawn `mcp/server.js` with `CORE_BRAIN_EMBEDDER=fixture` + `CORE_BRAIN_FIXTURE_DIR`; await tool calls (already async). |
| 0.5 | `test/search.selftest.mjs` | **new** | the probe runner for AC1/AC2/AC3/AC5/AC6/AC7/AC8 (names below). |
| 0.6 | `test/fixtures/vectors.bin`, `test/fixtures/manifest.json`, `test/fixtures/embedder.mjs` | **new** | the B4 fixture + the fixture `Embedder`/`Reranker`. |
| 0.7 | `check.sh` | edit | run BOTH `test/matrix.selftest.mjs` (13/13) and `test/search.selftest.mjs` (probe set); still `exit 0` only if all pass; still cleans `CORE_BRAIN_HOME`. |

### Phase 1 — the engine (DEVELOPER)

| # | File | Action | What changes |
|---|---|---|---|
| 1.1 | `engine/fts.ts` | **new** | ported `fts.ts` (D2), Apache-2.0 header + provenance line. |
| 1.2 | `engine/fusion.ts` | **new** | ported `rrfMerge` k=60, Apache-2.0 header. |
| 1.3 | `engine/embedder.ts` | **new** | runtime resolution (D1), `bge-small` adapter (`cls`, fp32, 384), weight cache (D1/E4), `CORE_BRAIN_OFFLINE` → `allowRemoteModels=false`, revision fingerprint (D5), `fallbackEmbed` (hash-ngram stubs). |
| 1.4 | `engine/reranker.ts` | **new** | cross-encoder adapter (ms-marco, q8), `off` default, `applyReranker` semantics, Apache-2.0 header. |
| 1.5 | `engine/search.ts` | **new** | `searchHybrid(corpusRecords, query, limit, {embedder, reranker})` → `{ hits, mode, reranked }`; the ONE ranking implementation (R9). |
| 1.6 | `types.ts` | edit | `Embedder`/`Reranker`; `VectorIndex.revision`; `Engine.invoke(): Promise<…>`; `RecallResult.mode`/`reranked`; `RecallHit.rrf`; `EngineOptions.embedder/reranker`; `StaleIndexError` code. |
| 1.7 | `store.ts` | edit | `EMBEDDER_ID = "Xenova/bge-small-en-v1.5"`, `EMBEDDING_DIM = 384`, keep `FALLBACK_EMBEDDER_ID`; `createEngine` resolves the seams (D4); `storeOp` awaits `embed`; `recallOp` builds the corpus from `authorizeRead` only, runs `searchHybrid`, refuses stale indexes (D5), returns `mode`/`reranked`/`rrf`; `forgetOp` query-match uses the active embedder's cosine; `admin reindex` stamps revision and stays idempotent; `doctor` requires revision; `invoke` async. |
| 1.8 | `index.ts` | edit | `await engine.invoke(...)` (line 482); tool description mentions hybrid + reranker switch. |
| 1.9 | `package.json` | edit | `"license": "(MIT AND Apache-2.0)"`; `dependencies: { "@huggingface/transformers": "4.3.0" }` (declares the runtime; installed in `~/.core-brain/runtime`, D1); `files` gains `engine/`, `LICENSE-APACHE`, `NOTICE`, `INSTALACAO.md`. |
| 1.10 | `tsconfig.json` | edit | `include: ["*.ts", "engine/*.ts"]` (today it is `["*.ts"]` — the new folder would escape `tsc`). |
| 1.11 | `shims.d.ts` | edit | add ambient declarations for `node:module` (`createRequire`) and `node:url` (`pathToFileURL`); a permissive `declare module "@huggingface/transformers"` for the dynamically imported runtime. |

### Phase 2 — the surface (DEVELOPER)

| # | File | Action | What changes |
|---|---|---|---|
| 2.1 | `mcp/jsonrpc.js` | edit | await-capable request handling with an ordered promise chain (D3). |
| 2.2 | `mcp/server.js` | edit | `async callTool`/`async handle`; `await engine.invoke(...)`; tool description. |
| 2.3 | `mcp/check.sh` | edit (if needed) | keep both layers green; the env fixture for the child process. |

### Phase 3 — licence, cost, docs (DEVELOPER + DOCUMENTATION_WRITER)

| # | File | Action | What changes |
|---|---|---|---|
| 3.1 | `LICENSE-APACHE` | **new** | the Apache-2.0 text (E6). |
| 3.2 | `NOTICE` | **new** | origin `plur-ai/plur`, `packages/core`, version `0.21.0`, the 4 ported files, "modified: renamed/adapted for core-brain". |
| 3.3 | `engine/*.ts` | (already in 1.1–1.5) | each ported file carries the header: `// Portions ported from plur-ai/plur packages/core@0.21.0 (Apache-2.0); modified for core-brain. See NOTICE.` |
| 3.4 | `README.md` | edit | replace the "Embedder — `hash-ngram-v1` (declared stub)" section with: model id + dim 384 + fp32 + pooling `cls` + download size 133,093,490 B + cache dir 133,805,935 B; the hybrid/RRF constants; the reranker switch (default off); the **mixed licence** declaration (E6); the **measured cost table** (E8): runtime dir `du -sb`, prune delta, models dir, and "no weights inside the plugin tree". |
| 3.5 | `INSTALACAO.md` | **new/renamed** (C3) | runtime provisioning (`install-runtime.sh`), prune, offline flag, troubleshooting. |
| 3.6 | `install-runtime.sh`, `prune-runtime.sh` | **new** | USER-run provisioning: `npm install --prefix "$CORE_BRAIN_RUNTIME_DIR" --cache /tmp/opencode/npm-cache @huggingface/transformers@4.3.0` (**the temp cache is what keeps `~/.npm` untouched**), then prune (D8), then `du -sb` report. |
| 3.7 | `CHANGELOG.md` (repo root) | edit | permanent behaviour change entry (AGENTS.md rule 3). |
| 3.8 | `TASKS.md` | edit | the Slice 1 item + status. |

---

## 8. Implementation order (each step with its gate)

1. **TESTER** lands Phase 0. Gate: `bash check.sh` and `bash mcp/check.sh` are **RED for the right reason** (async not yet supported) or green against the current sync engine where the row still holds; the RED run is the evidence that the rows discriminate.
2. **DEVELOPER** lands 1.1–1.5 (pure engine modules) + 1.11. Gate: `npx tsc -p .` exit 0.
3. **DEVELOPER** lands 1.6–1.8 (seam + store + plugin). Gate: `bash check.sh` → **13/13, exit 0** with the fixture; then `CORE_BRAIN_EMBEDDER=real bash check.sh` → 13/13 (weights cached).
4. **DEVELOPER** lands Phase 2. Gate: `bash mcp/check.sh` → exit 0.
5. **DEVELOPER** provisions the runtime (USER-authorized script, temp npm cache) and measures E8; lands Phase 3.
6. **Evidence run** (the AC table below), recorded as a digest; then the ARCHITECT attacks the delivery before forwarding it to the ORACLE.

Every step is reversible by `git checkout`-of-the-file mindset only (no commits are made): the new files are additive; the edits are confined to the 12 named files.

---

## 9. Handoff to the TESTER — for each AC, the exact command that proves it

| AC | Command (exact) | Literal observable required |
|---|---|---|
| **AC1** semantic probe | `CORE_BRAIN_EMBEDDER=real node global/opencode/plugins/core-brain/test/search.selftest.mjs --probe semantic` (fallback when the weights are absent: `CORE_BRAIN_EMBEDDER=fixture … --probe semantic`) | the printed **literal** query and record pair, the query↔record cosine (or RRF rank), and that the no-shared-word record ranks above the keyword-sharing decoy |
| **AC2** hybrid + RRF | `node …/test/search.selftest.mjs --probe fusion` | a keyword-only record **and** a vector-only record both in `results`; printed per-leg ranks and `rrf` such that `rrf == Σ 1/(60+rank+1)` and the order equals the RRF order |
| **AC3** reranker on/off | `CORE_BRAIN_RERANKER=off node …/test/search.selftest.mjs --probe rerank` vs `--reranker fixture` vs the real line `CORE_BRAIN_EMBEDDER=real CORE_BRAIN_RERANKER=ms-marco node …/test/search.selftest.mjs --probe rerank-real` | with `off`: order identical to RRF, `reranked == 0`; with the reranker on: the order **changes** and `reranked > 0` (real line: the literal before/after order, **must be run with weights cached**) |
| **AC4** isolation survives | `bash global/opencode/plugins/core-brain/check.sh; echo EXIT=$?` | `13/13 lines PASS` and `EXIT=0`; plus the real-model variant `CORE_BRAIN_EMBEDDER=real bash …/check.sh; echo EXIT=$?` → `13/13`, `EXIT=0` |
| **AC5** no read widening | line 7 / 8 / 19 output inside `check.sh` **plus** `node …/test/search.selftest.mjs --probe isolation-hybrid` | with a live query from `CB_GAMMA`, `results` contains no `CB_BETA` record and `scanned` does not contain `CB_BETA`; the `scanned` array equals the pre-change union (no namespace added by the hybrid path) |
| **AC6** stale index refused | `node …/test/search.selftest.mjs --probe stale-index` | a namespace holding a `hash-ngram-v1` / dim 256 index → `recall` **throws**, `.code === "STALE_INDEX"`, message contains the namespace label **and** `reindex`; nothing is returned |
| **AC7** reindex + idempotence | `node …/test/search.selftest.mjs --probe reindex` | after reindex the AC1 probe passes on that namespace; the 2nd reindex prints `sha256sum` of `index.json` identical to the 1st |
| **AC8** offline | `CORE_BRAIN_EMBEDDER=real CORE_BRAIN_OFFLINE=1 node …/test/search.selftest.mjs --probe offline` | `allowRemoteModels=false`, weights loaded from `~/.core-brain/models`, recall succeeds; the run logs no network fetch |
| **AC9** licence | `ls …/{LICENSE,LICENSE-APACHE,NOTICE}`; `grep -rn "Apache-2.0" …/NOTICE …/engine/*.ts …/README.md`; `grep -n "MIT AND Apache-2.0" …/package.json` | all four present; every ported file carries the header; README declares the mixed licence |
| **AC10** measured cost | `du -sb "$CORE_BRAIN_RUNTIME_DIR/node_modules"`; `du -sb "$CORE_BRAIN_MODELS"`; `find global/opencode/plugins/core-brain ~/.config/opencode/plugins/core-brain -name '*.onnx' \| wc -l` | the README table carries the printed bytes; the `find` prints `0` (no weights inside the plugin tree); second install leaves the models dir byte-identical |
| **E7** both checks | `bash …/check.sh; echo $?; bash …/mcp/check.sh; echo $?` | `0` and `0` |
| **E2 legs (raw)** | `node …/test/search.selftest.mjs --probe fusion --verbose` | the raw BM25 score, the raw cosine and the RRF score per candidate are printed (so the judge can recompute) |

**Fixture/probe set the TESTER must define in `test/search.selftest.mjs`:** `semantic`, `fusion`, `rerank`, `rerank-real`, `isolation-hybrid`, `stale-index`, `reindex`, `offline`, `fusion-verbose`. Each prints `--probe <name>` + literal values; a probe never passes on a bare boolean.

---

## 10. E1–E8 mapping (deliverable → where it lands → proof)

| E | Where | Proof |
|---|---|---|
| E1 | `engine/embedder.ts`, `store.ts:EMBEDDER_ID/EMBEDDING_DIM` | AC1 + the executed `cls`-pooling run (C2) with dim 384 |
| E2 | `engine/fts.ts` + `engine/fusion.ts` + `engine/search.ts` + `store.recallOp` | AC2; the corpus is built from `authorizeRead` only (AC5) |
| E3 | `engine/reranker.ts` + `store` resolution | AC3 (off = unchanged; on = changed) |
| E4 | `engine/embedder.ts` cacheDir + `install-runtime.sh` | AC10's `find`, models dir `du -sb`, second-install invariance |
| E5 | `types.VectorIndex.revision`, `store.readVectors/recallOp/admin reindex/doctor` | AC6, AC7 |
| E6 | `LICENSE-APACHE`, `NOTICE`, `engine/*.ts` headers, `README.md`, `package.json` | AC9 |
| E7 | `check.sh`, `mcp/check.sh`, Phase 0 test edits | AC4 + both `echo $?` = 0 |
| E8 | `README.md` cost table, `install-runtime.sh`/`prune-runtime.sh` output | AC10 (raw `du -sb`, not a copied figure) |

---

## 11. Risks and what this plan does NOT prove (declared, not hidden)

1. **English-only embedder, bilingual product.** `bge-small-en-v1.5`, `all-MiniLM-L6-v2` and `bge-base-en-v1.5` are all English-only (B1). core-brain's users write PT and EN. **Retrieval quality is measured nowhere in this slice**; the model choice rests on availability (cached, offline-proven), width (384) and latency — never on a quality benchmark. A PT probe is a follow-up, and if AC1's probe is written in English only, the PT gap stays open.
2. **Latency is host-local, not an SLO.** p50 4.0 ms / 51 ms for 1,349 chars (ARCHITECT) and p50 4.63 ms (ORACLE), both on Node v24.15.0 with `@huggingface/transformers` 4.3.0, **and with the wrong pooling** for this model (C2). Treat as an order of magnitude.
3. **`onnxruntime-web` (145,475,100 B) removal is UNPROVEN.** Static evidence only; needs the executed smoke (below). It is **not** counted in E8's headline unless the smoke passes.
4. **The E8 closure figure is new.** C4: today's 983,658,321 B is PLUR's closure; core-brain's runtime has not been measured. Any composite delta is unmeasured until E8.
5. **Fixture content generation cost is UNVERIFIED** (B4's open item): the 518 vectors + probe texts need one real embed run whose wall cost is not measured.
6. **`revision` fingerprint cost is UNVERIFIED** (sha256 of a 133,093,490 B file) — memoised, must be timed once.
7. **Query rewriting parity is not shipped** (PLUR's `rewriteLexicalQuery`) — a real ranking gap on some queries; declared, not hidden.
8. **Concurrency unchanged:** no file lock; two writers on one namespace still race (v1 roadmap item).
9. **Count discrepancy 1028 → 518 engrams** (Fatia 0 §6) is untouched here; it blocks M2/M3 parity claims, not this slice.
10. **The reranker model weights are not measured** (size/presence) — AC3's real line requires them cached; if absent it must be recorded as such, not skipped silently.
11. **This plan does not prove any of its own claims by execution**: `check.sh`, the probes and the AC commands are specifications. The executed digests are the DEVELOPER's duty and the judge's bar (rules 17/18).

**Optional unproven-removal smoke (only if the USER wants the 145,475,100 B):** copy the pruned runtime to `/tmp/opencode`, delete `onnxruntime-web`, then run the real embedder + a reranker `scoreBatch` and both `check.sh` runs; only a green executed run counts. Release the copy afterwards.

---

## 12. What the ARCHITECT did NOT verify (honest disclosure)

- **No execution of any kind in this slice.** No `check.sh`, no node run, no npm install, no model download. Every command in §9 is a specification for the DEVELOPER/TESTER, not a result.
- **No measurement was re-run.** All numbers are quoted from `docs/temp/fatiga0-decisoes.md` / `docs/temp/fatiga0-architect-measurements.txt` (both dated 2026-10-03) or read from the shipped code.
- **The `@plur-ai/core` constants are read, not executed** (`grep`/`read` of the installed `0.21.0` dist on this machine, paths cited inline). They are the porting source; the port itself is unproven.
- **The pooling correction (C2)** is a finding about B1's method; it does not invalidate B1's dimension (384, measured twice) or its order-of-magnitude latency.
- **The MCP async change** (`jsonrpc.js` reordering hazard) is a design analysis of the shipped code, not a demonstrated repro — the DEVELOPER must prove it with a test that sends two requests back-to-back and asserts the responses arrive in order.
- No subagent was launched; nothing was written under `~/.config/opencode/`, `~/.plur/` or `~/.npm`; no `git` write; the only artifact created is this plan.
