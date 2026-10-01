# core-brain — Active Spec **v2**: the engine must be PLUR's mechanism

- **Status:** DRAFT for USER review. Supersedes the mechanism decisions of v1.
- **Date:** 2026-10-01
- **Author:** ORACLE (flow: `ORACLE does it all`)
- **Repo:** `oesc/core-brain` — file at `docs/specs/core-brain-v2.md`
- **Corrects:** `docs/specs/core-brain-plugin.md` (§5 "Vectors — what is REAL vs STUB"; the D14 zero-dependency decision) and `docs/specs/core-brain-mcp.md` (which treats the embedder as an open follow-up).
- **Everything not named here stands as written in those two documents.**

---

## 0. The USER ruling (authority for this document)

> **2026-10-01:** *"a spec foi feita errada, pois ela foi feita com base neste meu pedido. faça um documento v2 corrigindo isso da spec, explicando que é pra usar o mesmo mecanismo do plur."*
>
> **2026-10-01:** *"pode usar até as mesmas dependências, pode copiar o código plur é open source."*

**R-0 (the governing rule):** core-brain must retrieve memory **by the same mechanism PLUR uses** — the same class of engine, the same dependencies, and PLUR's own code where that is the fastest honest path (PLUR is open source, Apache-2.0). Per-agent isolation is core-brain's **addition on top** of that engine — never a replacement for it, and never a justification for a weaker engine.

---

## 1. What v1 got wrong (named, so it is not repeated)

The job asked for a **substitute** for PLUR (`demand 142`: *"…o qual atuará como substituto do PLUR"*). v1 read the requirement through the spec's **five-item roadmap** — config loader, router, write path, *"read/search path: merge, rank and return top-k"*, docs — and through the 16 acceptance criteria, **all of which were about isolation**. From that, item 4's "rank and top-k" was treated as satisfiable by *any* ranking function, and the engine was declared a **stub** (`hash-ngram-v1`, 256 dims, FNV-1a over character n-grams) with the real embedder moved to "follow-up #1".

That misreading is the defect: **"substitute" was read as "same data model and same ops", when it meant "same capability"**. A substitute that retrieves by *spelling* instead of *meaning* is not a substitute; it is a look-alike. The isolation criterion may have been the hard part, but it was never the whole of the request.

Corrected here: **the engine is not a follow-up; it is a requirement.**

---

## 2. What "the same mechanism" means, precisely

Three layers must be separated — v1 conflated them:

| Layer | PLUR | core-brain v2 | Verdict |
|---|---|---|---|
| **Retrieval engine** — how similarity is computed and results ranked | real embeddings + hybrid keyword/vector + fusion | **must be PLUR's mechanism** | **changes in v2** |
| **Store** — where records live | `~/.plur/` (YAML + PGlite) | `~/.core-brain/` (JSON per namespace) | **stays** (see M2) |
| **Isolation** — who may read/write what | none (store-level trust only) | the §4 matrix, per agent, fail-closed | **stays — this is core-brain's reason to exist** |

So the ruling changes **one** layer. The other two are already correct and are not re-opened.

---

## 3. PLUR's mechanism, measured (2026-10-01, this machine)

- **Library:** `@plur-ai/core@0.20.1` — **Apache-2.0**, repo `github.com/plur-ai/plur`, `packages/core`. Installed tree: 1.6 MB.
- **Declared dependencies:** `@electric-sql/pglite ^0.4.6`, `js-yaml ^4.3.1`, `zod ^3.23.0`.
- **Embedding models present in the bundle:** `Xenova/all-MiniLM-L6-v2`, `Xenova/bge-base-en-v1.5`, `Xenova/bge-small-en-v1.5`.
- **Reranker:** `Xenova/ms-marco-MiniLM-L-6-v2` (cross-encoder).
- **Hybrid retrieval:** keyword (BM25) + vector, fused (RRF) — exposed as `plur_recall_hybrid`, `plur_inject_hybrid`, `plur_similarity_search`.
- **Embedding cache:** `~/.plur/.embeddings-cache.json`, **4.1 MB** on this install.
- **Runtime, measured on disk (the price of the mechanism):**

| Package | Size |
|---|---|
| `onnxruntime-node` | **548 MB** |
| `@huggingface/*` | **145 MB** |
| `onnxruntime-web` | 141 MB |
| `@img/*` (sharp/libvips) | 28 MB |
| `@electric-sql/pglite` | 26 MB |
| `better-sqlite3` | 13 MB |
| `zod` | 5.2 MB |
| **whole `node_modules` of the PLUR plugin** | **≈ 920 MB** |

**The cost is the decision.** 920 MB per independent copy is not a detail; §4 M4 and R7 below are written around it.

---

## 4. Decisions

| # | Decision | Rationale |
|---|---|---|
| **M1** | **The retrieval engine is PLUR's**, reused rather than reinvented: same model family, same hybrid keyword+vector, same fusion, same reranker. Implemented by depending on `@plur-ai/core` (pinned) and/or by vendoring the parts of its source that are needed. | the USER ruling; and it is the only way "substitute" is true. |
| **M2** | **The store stays core-brain's** (per-namespace JSON under `~/.core-brain/`, atomic writes). PLUR's PGlite store is **not** adopted in this pass. | the isolation proof (`check.sh`, 8/8) is built on the namespace layout; swapping the store would re-open the matrix work for no gain in retrieval. Recorded alternative: adopting PGlite wholesale is allowed by R-0 and can be a later slice if durability/concurrency demands it. |
| **M3** | **The isolation layer is untouched**: matrix §4, namespaces, fail-closed, `InvalidConfigurationError`, the tool `core_memory`, the MCP surface of `core-brain-mcp.md` §3. | orthogonal to retrieval; it is the part already proven. |
| **M4** | **D14 ("zero runtime dependencies") is SUPERSEDED.** New rule: dependencies are allowed and expected; each one is declared in `package.json`; **sharing a package with PLUR is allowed** — only *identifiers* must not collide (plugin id, tool names, store path, env vars, MCP server name). | USER: *"pode usar até as mesmas dependências"*. |
| **M5** | **Model weights are fetched once and cached outside the plugin tree** (shared cache dir, e.g. `~/.core-brain/models`; env-overridable), so the weights are never duplicated per plugin copy. | the runtime binaries are copied; the weights do not have to be. |
| **M6** | **The index records what produced it**: `embedder` (model id) + `dim` + model revision. A mismatch is refused at load (already true) and there is an explicit **reindex** path. `EMBEDDING_DIM` stops being a hardcoded constant. | the current 256-dim index is the artifact that must be replaced, not silently mixed. |
| **M7** | **The reranker is PLUR's, and it is configurable** — on by default where PLUR has it on, with a documented switch to turn it off for latency. | parity first, tunable after. |
| **M8** | **Licence compliance is a deliverable, not a formality**: Apache-2.0 obligations are met (see R8). | copying open-source code carries duties. |

---

## 5. Requirements

- **R1 — Semantic retrieval.** A recall returns results ranked by **meaning**, not by character overlap. The acceptance proof is behavioural: a query that shares no words with a record but means the same thing must find it, and a query that shares words but means something else must not outrank it.
- **R2 — The same model family.** The default embedder is PLUR's own (measured: `Xenova/all-MiniLM-L6-v2` / `bge-small-en-v1.5` / `bge-base-en-v1.5`); the choice, its dimension and its download size are declared in `README.md`.
- **R3 — Hybrid, fused.** Keyword (BM25) + vector, fused (RRF), over **the namespaces §4 permits** — and only those. Hybrid must never widen the read set.
- **R4 — Rerank, configurable.** PLUR's cross-encoder, with a documented off switch.
- **R5 — Local and offline at query time.** Models load from the local cache; no network call during a recall. The first fetch is documented, with its size.
- **R6 — The isolation proof survives the engine change.** `bash global/opencode/plugins/core-brain/check.sh` stays **8/8, exit 0**, with the real embedder in place — same command, same bar.
- **R7 — Dependency cost is declared and bounded.** `README.md` states the installed size of the runtime closure (measured today: ≈ 920 MB for a full copy) and how the repo avoids duplicating model weights (M5). Trimming the closure — e.g. dropping the browser build (`onnxruntime-web`) or the unrelated `@img/sharp` tree if nothing needs them — is **required before shipping**, with the measured result recorded.
- **R8 — Apache-2.0 duties.** For every copied/vendored PLUR file: keep the Apache-2.0 `LICENSE`, carry a `NOTICE` (or an equivalent provenance section) naming the origin (`plur-ai/plur`, `packages/core`, version), and state in `README.md` that the repo is **mixed-licence**: core-brain's own code MIT, vendored engine Apache-2.0. Modified files carry a header saying they were changed.
- **R9 — Nothing duplicated silently.** One engine implementation, consumed by both the plugin path (`core_memory`) and the MCP path — no second copy of the ranking logic.

---

## 6. Migration — the 256-dim index

The text is the source of truth; vectors are derived. Therefore:

1. the existing `vectors/*/index.json` (`hash-ngram-v1`, dim 256) is **not** translated — it is **rebuilt**;
2. `core_admin { action: "reindex" }` (already specified in `core-brain-mcp.md` §3) walks every record of a namespace, re-embeds it with the real model, and writes a new index stamped with the model id + dim;
3. until a namespace is reindexed, recall on it is **refused** with a clear message naming the namespace and the reason — never silently answered by a stale index;
4. no record text is touched; a reindex is repeatable and idempotent.

---

## 7. Acceptance criteria

- **AC1** — a semantic probe passes: query and record with **no shared words** but the same meaning → hit; the same query with a keyword-only record → no hit. (Executed, with the literal query/record pair recorded.)
- **AC2** — hybrid is real: a keyword-only match and a vector-only match both surface, and their fused order matches RRF.
- **AC3** — the reranker changes the order when enabled and does not when disabled.
- **AC4** — `check.sh` → **8/8, exit 0**, with the real embedder (the isolation matrix is unchanged by the engine).
- **AC5** — recall from an agent that may read only its own namespace returns **only** its namespace, with the hybrid engine active — the isolation is not weakened by the new search path.
- **AC6** — a recall against a namespace still holding a 256-dim index is **refused** with the reindex message (never answered with a stale index).
- **AC7** — `reindex` on a namespace makes AC1 pass on that namespace, and running it twice changes nothing.
- **AC8** — offline: with the network disabled, a recall after the first fetch still works.
- **AC9** — licence: `LICENSE`/`NOTICE`/provenance present, `README.md` declares the mixed licence, `grep` shows every vendored file's header.
- **AC10** — the declared size of the runtime closure is measured and written down; no model weights are duplicated inside the plugin tree.

---

## 8. Order of work (corrected)

1. **The engine** (this document): real embeddings + hybrid + rerank, with the isolation matrix intact. This is now **first**, not "follow-up #1".
2. **The automatic layer (G2)** — `context` injection into `system[]`, learning from the user's text, the `compaction` hook, and the session-closing ritual. It stops being "another slice" and becomes the step that makes the memory visible to agents.
3. **The episodic timeline (§12)** — first-class episodes, searchable by meaning. The USER's decision of 2026-10-01 puts it in scope; it depends on step 1 for search, and it blocks nothing (G2 does not wait for it, and it does not wait for G2).
4. **Fine tuning** — model choice, thresholds, reranker on/off, tuned against real use.

The MCP surface (`core-brain-mcp.md`) is unaffected in shape and rides on the same engine (R9).

---

## 9. Impact map — what this document changes

| Document | What changes |
|---|---|
| `docs/specs/core-brain-plugin.md` | §5 "Vectors — REAL vs STUB" is **superseded** (the stub is no longer acceptable as the engine); the D14 zero-dependency decision is **superseded** by M4. §4 storage, §6 matrix, §7 API, §8 hooks, §9 tests, §10 non-regression **stand**. |
| `docs/specs/core-brain-mcp.md` | §0/§13's classification of the embedder as "follow-up #1" is **amended**: it is a prerequisite of the swap, not a follow-up. The tool surface, M3 (two hosts), AC1–AC10 and the spikes **stand**. |
| `docs/adr/0001-core-brain-memory-isolation.md` | D8 (embedder as a declared stub) and D14 (zero runtime deps) are **amended by this document**; D1–D7, D9–D13 **stand**. |
| `docs/core_brain_specification.md` (USER) | **not touched.** Its roadmap stays as the USER wrote it; this document is the honest reading of what "substitute" requires. |

---

## 10. Open items (to be measured before/while implementing)

1. **Which model by default** — parity with PLUR suggests `all-MiniLM-L6-v2`; the trade is size vs quality vs dimension. Measure download size and latency for the two candidates.
2. **Dependency vs vendor** — depending on the published `@plur-ai/core@0.20.1` (updates, less control) vs vendoring the needed source (control, must track upstream by hand). The repo already vendors `plur-memory`, so vendoring is consistent; decide with the measured closure in hand (R7).
3. **How much of the 920 MB is actually reachable** — the runtime ships browser and multi-platform binaries; measure the trimmed closure after removing what is never loaded on this machine.
4. **CI determinism** — the isolation tests must stay runnable offline: pin a small model **or** commit a recorded vector fixture for the test path only, and say which.
5. **Collision audit** — confirm no shared dependency introduces an identifier collision with PLUR (M4).

---

## 11. Not touched by this document

The isolation matrix, the store format, the record shape, the plugin tool `core_memory`, the MCP tool surface and its two-host decision, the two-layer test plan, and the rule that an unlisted agent gets nothing. The isolation is the one thing that was already right. **§12 adds a new object (episodes) beside them — it changes none of them.**

---

## 12. The episodic timeline — first-class, in scope (USER decision, 2026-10-01)

> The USER asked what would happen to the 34 episodes and chose: **"Timeline a sério no core-brain"** — episodes as first-class objects, not a tag and not left behind. Episodic memory: *what happened*, with a date. It is not short-term memory (that is the conversation window and G2's injected block) and it is not the engrams (that is *what is known*, undated).

### 12.1 The object (additive — M7 still holds)

```ts
interface Episode {
  id: string;            // EP-<epoch ms>-<4 chars> — readable, sortable, the PLUR shape
  at: string;            // ISO timestamp of the event
  agent: string;         // who wrote it — the caller's SESSION identity, never a tool argument
  summary: string;       // the narrative: what happened
  sessionId?: string;
  channel?: string;
  tags?: string[];
  engramIds?: string[];  // set by `core_promote` — the memories that came out of this episode
}
```

**Storage:** the **same namespace model as memories** — `~/.core-brain/agents/<A>/episodes.json` and `~/.core-brain/global/episodes.json`, atomic writes, same file policy as `memories.json`.
**Why not PLUR's single global `episodes.yaml`:** PLUR's episodes are store-global — measured: of the 34, only **2** carry an `agent` and most carry no owner at all, so a private agent's diary would be readable by everyone. In core-brain the diary obeys **the §6 matrix, the same one as everything else** — one isolation model, one authorizer, no exception. That is the improvement this slice buys.

### 12.2 Operations (same "one surface, two hosts" rule)

| op | host | input | output | isolation |
|---|---|---|---|---|
| `core_episode` | **P** | `{ summary, tags?, sessionId? }` | `{ ok, id, ns }` | write matrix §6.2 — own namespace always; `global` iff `hasGlobalAccess` |
| `core_timeline` | **P** (own view) · **M** (global view, admin) | `{ query?, since?, until?, tags?, limit? }` | `{ results: Episode[], scanned[] }` | read matrix §6.1 — identical to recall; the MCP view reads `global` only |
| `core_promote` | **P** | `{ episodeId, text, tags? }` | `{ ok, episodeId, memoryId }` | the episode must be readable by the caller; the memory follows §6.2; the episode gains the id in `engramIds` |

`core_promote` is PLUR's `plur_episode_to_engram` — it closes the *"aconteceu → virou memória"* path the timeline exists for. Nothing is copied: it writes a normal memory record carrying `meta.derivedFrom = <episode id>`.

**Naming on the plugin host:** these three are **ops of the existing tool `core_memory`** (`op: "episode" | "timeline" | "promote"`), so the plugin keeps registering exactly **one** tool — no second tool, no second identity path. The MCP host exposes `core_timeline` as its own tool (§`core-brain-mcp.md` §3), because there the caller has no session identity and the op is a global read.

### 12.3 Retrieval — searchable by meaning, not by spelling

`core_timeline { query }` ranks with **the v2 engine** (§2–§5): the same embeddings + hybrid. *"o que fizemos sobre SGLang"* must find the episode that says *"server 'mystery shutdowns' caused by `timeout 9999`"* — no shared word. Without the engine this op would only match spelling, which is why §8 puts the engine first.

### 12.4 Migration of the existing 34 — nothing lost, nothing invented

- **source:** `~/.plur/episodes.yaml` (fields measured: `timestamp`, `summary`, optional `channel`, `session_id`, `tags`, `agent`);
- **namespace:** an `agent` present → that agent's namespace; **no owner → `global`** (the honest reading of records that were written store-global);
- `id` preserved, `at` from `timestamp`, `summary`/`tags`/`sessionId`/`channel` verbatim — **no summarising, no rewriting**;
- **idempotent:** a second run dedupes on `id` and changes nothing;
- **mechanism:** `core_admin { action: "import" }` (`core-brain-mcp.md` §3) gains an episodes section — no second importer, no second format.

### 12.5 Acceptance criteria (timeline)

- **AC-TL1** — append + read round-trip; the episode's `agent` comes from the session, never from the tool input.
- **AC-TL2** — isolation: `A` (private) writes an episode and `B` **does not** see it in `core_timeline`; `A`'s public episodes are visible per §6.1. Same matrix, no exception.
- **AC-TL3** — the 34 import with dates, tags and owners intact, and re-running the import changes nothing.
- **AC-TL4** — a query with **no shared words** finds the right episode (the *SGLang / `timeout 9999`* pair is the probe).
- **AC-TL5** — `core_promote` produces a memory carrying `derivedFrom`, the episode lists it in `engramIds`, and the episode is otherwise unchanged.
- **AC-TL6** — `check.sh` stays **8/8**, and the backup mirrors the episodes (`bkps/.core-brain/`).

### 12.6 Honest bounds

- **Not promised:** PLUR's `plur_report_failure` (procedure evolution), meta-engrams and the cognitive `profile` — they remain outside (§10).
- **Who writes automatically:** PLUR's `plur_session_end` ritual (*review the conversation, extract learnings*) belongs to **G2**. This slice ships the explicit `core_episode` op **and** the import, so nothing here waits on G2.
