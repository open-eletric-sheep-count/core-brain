// engine/search.ts — the ONE hybrid ranking implementation (R9).
// core-brain Slice 1, plan §7 file 1.5 (D6/E2, AC1/AC2/AC5).
//
// Not a verbatim port: this is core-brain's composition of the ported parts
// (engine/fts.ts + engine/fusion.ts + engine/reranker.ts). The orchestration is
// modelled on `@plur-ai/core@0.21.0` dist/index.js (src/hybrid-search.ts):
//   - lines 3110-3148 `hybridSearch`/`hybridSearchWithMeta`: two legs, the
//     non-aggregation limits `bm25Limit = limit*3`, `embLimit = limit*2`, RRF
//     fusion and rerank, in that order;
//   - lines 3107-3109 / 3118-3121: PLUR's aggregation-query widening is a
//     DECLARED parity gap (plan §3) and is NOT implemented here.
// core-brain-only: the raw per-leg diagnostic (`ScoreHit.legs`, the ORACLE
// ruling of 2026-10-03 18:20), the `SearchMode` degradation reporting and the
// record/vector input shape (the corpus is exactly what the caller passes).
//
// core-brain-only AC1 refinements the PLUR does NOT have (declared, ORACLE
// ruling of 2026-10-03 19:05): the vector-leg admission floor
// (`MIN_VECTOR_SIMILARITY`) and the deterministic tiebreak (raw cosine desc,
// then `id` asc) applied to the fused order. `rrfMerge` itself is untouched.
//
// CONTRACT: `score` and `rrf` carry the same fused RRF value; `legs` is always
// populated by this module (the caller decides whether to expose it). The
// corpus passed in must be exactly the readable set built by `authorizeRead`
// (AC5): this function NEVER reads outside `records`.

import { recordSearchText, searchRecordScores, type SearchableRecord } from "./fts.ts";
import { rrfMerge, RRF_K_DEFAULT } from "./fusion.ts";
import type { Embedder } from "./embedder.ts";
import { applyReranker, isRerankerOff, RERANKER_TOP_K_DEFAULT, type Reranker } from "./reranker.ts";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** Recall mode (test/CONTRACT.md §8.3); equals the contract's `RecallMode`. */
export type SearchMode = "hybrid" | "hybrid-degraded" | "bm25-only";

/**
 * A rankable record. Structural: `MemoryRecord` satisfies it. `vector` is the
 * record's persisted embedding when the caller has one (the `vectors/<ns>/`
 * index); when absent this module embeds `recordSearchText(record)` itself.
 */
export interface SearchRecord extends SearchableRecord {
  id: string;
  vector?: number[] | undefined;
}

/** The raw score of each leg for one candidate; `null` = absent from that leg. */
export interface SearchLegs {
  bm25: number | null;
  vector: number | null;
}

/** One fused hit. */
export interface SearchHit<T extends SearchRecord> {
  record: T;
  /** The fused RRF score (same value as `rrf`, kept for the existing key). */
  score: number;
  /** The fused RRF score: Σ 1/(k + rank + 1) over the legs that ranked it. */
  rrf: number;
  /** Raw leg scores for external recomputation (ORACLE ruling 18:20). */
  legs: SearchLegs;
}

export interface SearchOptions {
  /** The embedder seam (D4). Absent -> `mode: "bm25-only"`, no embedding. */
  embedder?: Embedder;
  /** The reranker seam (D7). Absent/off -> the RRF order, `reranked: 0`. */
  reranker?: Reranker;
  /** Reranker head size (index.js:3157 default 50). */
  rerankTopK?: number;
}

export interface SearchResult<T extends SearchRecord> {
  hits: SearchHit<T>[];
  mode: SearchMode;
  reranked: number;
}

// ---------------------------------------------------------------------------
// Constants (plan §3 D2 / §6 D6)
// ---------------------------------------------------------------------------

/** Default top-N when the caller passes no positive integer limit. */
export const DEFAULT_SEARCH_LIMIT = 5;
/** Non-aggregation BM25 leg limit (index.js:3120): `limit * 3`. */
export const BM25_LIMIT_FACTOR = 3;
/** Non-aggregation vector leg limit (index.js:3121): `limit * 2`. */
export const VECTOR_LIMIT_FACTOR = 2;
/**
 * Admission floor for the vector leg (core-brain refinement required by AC1):
 * `cos ≈ 0` is orthogonal = no semantic relation; without a floor an irrelevant
 * record buys a rank and wins by appearing in both legs. PLUR has no floor.
 */
export const MIN_VECTOR_SIMILARITY = 0.05;

// ---------------------------------------------------------------------------
// Cosine (same semantics as the v1 store helper: 0 for a degenerate vector)
// ---------------------------------------------------------------------------

/** Cosine similarity; 0 for a missing/degenerate/mismatched pair. */
export function cosine(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  const score = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Number.isFinite(score) ? score : 0;
}

// ---------------------------------------------------------------------------
// searchHybrid
// ---------------------------------------------------------------------------

/**
 * Hybrid BM25 + vector search fused by RRF (k = 60), optionally reranked.
 *
 * - BM25 leg: `searchRecordScores` (raw scores) -> top `min(n, limit*3)`.
 * - Vector leg: cosine of the embedded query against each record vector ->
 *   top `min(n, limit*2)`, similarities above `MIN_VECTOR_SIMILARITY` only.
 * - Fusion: `rrfMerge([bm25, vector], 60)` untouched; the fused order is then
 *   tie-broken (raw cosine desc, then `id` asc) -> top `limit`.
 *
 * `mode`: `"hybrid"` when both legs contributed; `"hybrid-degraded"` when an
 * injected embedder threw (BM25-only result, never a silent empty answer);
 * `"bm25-only"` when no embedder was injected. A reranker failure on a hybrid
 * result also degrades to `"hybrid-degraded"` and reports `reranked: 0`.
 *
 * A blank query is a query-less recall, which is NOT this function's job (D6:
 * it keeps the v1 behaviour and must be handled by the caller); here it
 * returns an empty `bm25-only` result.
 */
export async function searchHybrid<T extends SearchRecord>(
  records: T[],
  query: string,
  limit: number = DEFAULT_SEARCH_LIMIT,
  options: SearchOptions = {},
): Promise<SearchResult<T>> {
  const top = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_SEARCH_LIMIT;
  const trimmed = typeof query === "string" ? query.trim() : "";
  if (records.length === 0 || trimmed === "") {
    return { hits: [], mode: "bm25-only", reranked: 0 };
  }

  // --- BM25 leg -----------------------------------------------------------
  const bm25Limit = Math.max(1, Math.min(records.length, top * BM25_LIMIT_FACTOR));
  const bm25Scored = searchRecordScores(records, trimmed, bm25Limit);
  const bm25ScoreById = new Map<string, number>();
  for (const entry of bm25Scored) bm25ScoreById.set(entry.record.id, entry.score);

  // --- Vector leg ---------------------------------------------------------
  let mode: SearchMode = "bm25-only";
  let vectorScored: { record: T; cosine: number }[] = [];
  const { embedder } = options;
  if (embedder) {
    try {
      const queryVector = await embedder.embed(trimmed);
      const scored: { record: T; cosine: number }[] = [];
      for (const record of records) {
        const vector =
          Array.isArray(record.vector) && record.vector.length > 0
            ? record.vector
            : await embedder.embed(recordSearchText(record));
        if (!Array.isArray(vector) || vector.length === 0) continue;
        const similarity = cosine(queryVector, vector);
        if (similarity > MIN_VECTOR_SIMILARITY) scored.push({ record, cosine: similarity });
      }
      scored.sort((a, b) => b.cosine - a.cosine);
      vectorScored = scored.slice(0, Math.max(1, Math.min(records.length, top * VECTOR_LIMIT_FACTOR)));
      mode = "hybrid";
    } catch {
      // D6: never a silent empty answer — degrade to BM25 and say so.
      vectorScored = [];
      mode = "hybrid-degraded";
    }
  }
  const vectorScoreById = new Map<string, number>();
  for (const entry of vectorScored) vectorScoreById.set(entry.record.id, entry.cosine);

  // --- Fusion (RRF k = 60) ------------------------------------------------
  const fused = rrfMerge<T>(
    [bm25Scored.map((entry) => entry.record), vectorScored.map((entry) => entry.record)],
    RRF_K_DEFAULT,
  );

  // --- Deterministic tiebreak (core-brain refinement, AC1) ----------------
  // RRF gives a BM25 rank 0 and a vector rank 0 the same credit, so a record
  // present in BOTH legs outranks one present in a single leg. Equal `rrf` is
  // broken by the raw cosine (desc; absent from the vector leg = worst) and
  // then by `id` asc, so the order never depends on Map insertion order.
  const fusedOrdered = fused.slice().sort((a, b) => {
    if (b.rrf !== a.rrf) return b.rrf - a.rrf;
    const cosineA = vectorScoreById.get(a.record.id);
    const cosineB = vectorScoreById.get(b.record.id);
    const rawA = cosineA === undefined ? Number.NEGATIVE_INFINITY : cosineA;
    const rawB = cosineB === undefined ? Number.NEGATIVE_INFINITY : cosineB;
    if (rawA !== rawB) return rawB - rawA;
    return a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0;
  });

  let hits: SearchHit<T>[] = fusedOrdered.slice(0, top).map((entry) => {
    const id = entry.record.id;
    return {
      record: entry.record,
      score: entry.rrf,
      rrf: entry.rrf,
      legs: {
        bm25: bm25ScoreById.has(id) ? (bm25ScoreById.get(id) as number) : null,
        vector: vectorScoreById.has(id) ? (vectorScoreById.get(id) as number) : null,
      },
    };
  });

  // --- Optional rerank (off by default) -----------------------------------
  let reranked = 0;
  if (!isRerankerOff(options.reranker)) {
    const outcome = await applyReranker(
      hits,
      hits.map((hit) => recordSearchText(hit.record)),
      trimmed,
      options.reranker,
      options.rerankTopK ?? RERANKER_TOP_K_DEFAULT,
    );
    hits = outcome.items;
    reranked = outcome.count;
    if (outcome.degraded && mode === "hybrid") mode = "hybrid-degraded";
  }

  return { hits, mode, reranked };
}
