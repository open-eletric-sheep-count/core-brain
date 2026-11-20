# Memory database — options survey

Status: DRAFT · 2026-11-20 · for item 6.1.2 (memory database speed)
Companion: `memory-database-speed.md` (the measured problem)

## 1. What the store has to do

| need | today | weight |
|---|---|---|
| keep records with text + metadata + counters | `memories.json` per namespace | mandatory |
| keep one 384-float vector per record | `vectors/<ns>/index.json` | mandatory |
| **lexical search with BM25** | hand-rolled in `engine/fts.ts` | mandatory |
| **vector search (cosine)** | brute force in JS | mandatory |
| fuse the two rankings (RRF) | `engine/fusion.ts` | mandatory |
| run **inside the plugin process** (no service to babysit) | yes | strong |
| work **offline**, single file, backupable | yes | strong |
| survive several writer processes | partial (atomic rename) | medium |
| corpus size today | 635 global + 1 079 ORACLE vectors | — |

Scale matters for the choice: **at a few thousand records, vector search is a linear scan of a few
million floats — milliseconds**. The 17 s measured on 2026-11-19 came from re-embedding records, not
from scanning them.

## 2. Candidates

| option | embedded? | BM25 | vector | runtime fit | verdict |
|---|---|---|---|---|---|
| **SQLite (`node:sqlite`) + FTS5** | yes, single file | **yes, native `bm25()`** | BLOB + brute force (or `sqlite-vec`) | **already in the runtime** (used by jarvis-voz) | **recommended** |
| SQLite + `sqlite-vec` extension | yes | yes | KNN index (vec0) | `loadExtension` exists; extra binary per platform | upgrade path, not needed yet |
| LanceDB | yes (Rust) | yes (Tantivy) | native ANN | Node binding, big native dep | good if the corpus grows to 10⁵+ |
| DuckDB (+ FTS, VSS) | yes | yes (fts extension) | array distance | good for batch, awkward for small frequent writes | no |
| Orama | yes (pure JS) | yes | yes | easy | slower than SQLite, another dependency |
| Qdrant | **no, server** | yes | yes | a service to run and keep alive | no |
| Meilisearch / Typesense | **no, server** | excellent | partial/recent | another service | no |
| Postgres + pgvector | **no, server** | yes | yes | he already runs postgres | only if other apps share it |
| Chroma | server or embedded Python | no native BM25 | yes | Python-first | no |
| Redis Stack | **no, server** | yes | yes | another service | no |

## 3. What was verified on this machine (2026-11-20)

Run against `node:sqlite` in the same runtime the plugins use:

- **`CREATE VIRTUAL TABLE … USING fts5(text)` works**, and `bm25()` returns a rank — the lexical leg
  becomes a query instead of hand-rolled code.
- **BLOB columns work** — a 384-float vector is 1 536 bytes, trivially stored per row.
- **`db.loadExtension` exists** — `sqlite-vec` can be added later without changing the storage shape.

No new dependency: `node:sqlite` ships with the runtime and is already used by the `jarvis-voz`
plugin for its arming database.

## 4. Recommendation

**One SQLite file per store root, `node:sqlite`, with:**

1. a `memories` table (id, agent, scope, text, meta JSON, counters, dates);
2. `FTS5` on the text — the lexical leg stops being our code;
3. the vector in a BLOB column — the vector leg stays a linear scan in JS (fast at this scale), or
   `sqlite-vec` later;
4. RRF unchanged, above both legs;
5. **no per-call file parsing and no re-embedding**: a record without a vector is a store-time
   problem, never a query-time cost.

Why not a "vector database": it would add a service or a large native dependency to answer a
question that, at 2 000 records, is answered in milliseconds by a scan — and the real defect
(§ `memory-database-speed.md` F1/F2) is the recomputation and the missing cache, not the scan.

## 5. Migration

- Read `memories.json` + `vectors/*/index.json`, write the SQLite file, verify counts and that a
  fixed set of queries returns the same top-k (order may differ only where the fused score ties).
- Keep the JSON files readable for one release as a rollback, then retire them.
- The MCP server (`plugins/core-brain/mcp/server.js`) reads the same store through the same engine —
  it must switch at the same time.

## 6. Open questions for the USER

1. One SQLite file per agent, or one file for the whole store with `agent` as a column? (One file is
   simpler to back up; one file makes cross-agent reads and reindexing cheaper.)
2. Do we want `sqlite-vec` from day one (native binary per platform), or start with the JS scan?
3. Should the store keep answering reads while a write is in flight (WAL), or is a short lock fine?
