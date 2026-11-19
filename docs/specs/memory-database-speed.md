# Memory database speed — the query path (spec)

Status: DRAFT · 2026-11-19 · owner: ORACLE, for the USER
Related: `plugins/core-brain/store.ts`, `engine/search.ts`, `engine/embedder.ts`, `engine/reranker.ts`

## 1. The symptom

With the automatic block ACTIVE (two recalls per context event, one per half), every context event
cost ~17.5 s and the machine felt blocked — browser agents were slow while nothing was consuming CPU.

Measured on the live store (`~/.config/core-brain`), 12 runs of the pair:

| path | average | median |
|---|---|---|
| block with the new code commented (one query-less recall) | **61 ms** | 60 ms |
| block with the new code active (two recalls, with a query) | **17 658 ms** | 17 494 ms |

## 2. Where the time goes (one run, phase by phase)

| phase | time | note |
|---|---|---|
| read + parse `global/memories.json` | 4 ms | 0.9 MB, 635 records |
| read + parse `vectors/global/index.json` | 0 ms | **0.0 MB — 2 vectors** |
| read + parse `vectors/ORACLE/index.json` | 32 ms | 11.6 MB, 1 079 vectors |
| embed the query once (first call, model load) | 1 059 ms | multilingual miniLM |
| recall **global**, reranker OFF | 22 235 ms | |
| recall **global**, reranker ON | 19 022 ms | the reranker is not the cost |
| recall **agent's own space**, reranker ON | 269 ms | same code path, healthy index |

## 3. Cause

The **global namespace has 635 memories and a vector index with 2 vectors**. The query path finds an
index that cannot answer, and pays for it by recomputing vectors for the whole namespace on every
call. The agent's own space, whose index is complete (1 079 vectors), answers the same query in
**269 ms**.

So there are two distinct defects, and they are worth keeping apart:

1. **A missing/incomplete index is not detected before the work starts.** The namespace reports a
   usable-looking index and the search proceeds instead of failing with `STALE_INDEX` (the store has
   that path for a *different* header; an index with fewer vectors than records slips past it).
2. **There is no cache.** Every recall re-reads and re-parses the JSON index (11.6 MB for ORACLE,
   32 ms) and, when the index is short, re-embeds the missing records on every call.

## 4. What a fix must do

- **F1 — detect a short index.** If `vectors` holds fewer entries than the live records of the
  namespace, treat it exactly like a stale index: refuse the vector leg (or the whole recall) with a
  message that names `reindex --ns <label>`. Never silently recompute a whole namespace per call.
- **F2 — cache the index in memory.** One parse per namespace per process, invalidated by the file's
  mtime and size; a recall must not parse 11.6 MB again if the file did not change.
- **F3 — rebuild the global index.** One-off `reindex --ns global`, so the live store stops paying
  for the 2-vector index.
- **F4 — bound the work.** If F1 fires, the automatic layer must still produce a block within a
  budget (e.g. 500 ms): fall back to the agent's own half and the strength order rather than waiting
  for a recomputation.

## 5. Acceptance

- A query recall on a namespace with a complete index stays **under 500 ms** (currently 269 ms in the
  agent's space).
- A query recall on a namespace with a short index **refuses in under 50 ms** with the named fix, and
  never spends more than 50 ms before refusing.
- The automatic block (two halves) stays **under 1 s** end to end in the live store.
- Evidence: the same phase-by-phase harness used to produce §2, run before and after.

## 6. Out of scope

- Changing the embedder or the reranker.
- Moving the store to a real database: the files work; they are simply read and recomputed without
  care. If the cache proves insufficient, that discussion comes later, with numbers.
