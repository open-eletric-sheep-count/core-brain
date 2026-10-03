// Portions ported from plur-ai/plur packages/core@0.21.0 (Apache-2.0); modified for core-brain. See NOTICE.
//
// Provenance (as cited in docs/specs/fatia1-engine-plan.md §3 D2):
//   source: @plur-ai/core@0.21.0 dist/index.js lines 3077-3096
//     (`// src/hybrid-search.ts`, `function rrfMerge(resultSets, k = 60)`).
//   verbatim: the RRF formula `1 / (k + rank + 1)` summed per id across every
//     result set, sorted by the summed score descending; default k = 60.
//   adapted for core-brain: the ranked item is a generic `{ id: string }`
//     (core-brain `MemoryRecord`) not a PLUR `Engram`; the score field is named
//     `rrf` (the name used by `RecallHit.rrf` in test/CONTRACT.md §8.3);
//     `rrfMergeRecords` added as the record-returning wrapper mirroring PLUR's
//     `rrfMergeEngrams`.
//
// This module is pure: no imports, no store coupling, no I/O.

/** RRF rank constant. MUST stay equal to PLUR (source line 3078: `k = 60`). */
export const RRF_K_DEFAULT = 60;

/** One fused candidate: the record and its summed reciprocal-rank score. */
export interface RrfRanked<T> {
  record: T;
  rrf: number;
}

/**
 * Reciprocal Rank Fusion (source lines 3078-3093, verbatim formula). Each
 * result set is a list already ordered best-first; a record at `rank` (0-based)
 * in a set contributes `1 / (k + rank + 1)`, contributions are summed per id,
 * and the fused list is sorted by that sum descending.
 */
export function rrfMerge<T extends { id: string }>(
  resultSets: T[][],
  k: number = RRF_K_DEFAULT,
): RrfRanked<T>[] {
  const scores = new Map<string, RrfRanked<T>>();
  for (const results of resultSets) {
    for (let rank = 0; rank < results.length; rank++) {
      const record = results[rank];
      const existing = scores.get(record.id);
      const rrfScore = 1 / (k + rank + 1);
      if (existing) {
        existing.rrf += rrfScore;
      } else {
        scores.set(record.id, { record, rrf: rrfScore });
      }
    }
  }
  return Array.from(scores.values()).sort((a, b) => b.rrf - a.rrf);
}

/** Record-returning wrapper (core-brain name for PLUR's `rrfMergeEngrams`). */
export function rrfMergeRecords<T extends { id: string }>(
  resultSets: T[][],
  k: number = RRF_K_DEFAULT,
): T[] {
  return rrfMerge(resultSets, k).map((entry) => entry.record);
}
