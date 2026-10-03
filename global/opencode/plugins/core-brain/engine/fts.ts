// Portions ported from plur-ai/plur packages/core@0.21.0 (Apache-2.0); modified for core-brain. See NOTICE.
//
// Provenance (as cited in docs/specs/fatia1-engine-plan.md §3 D2):
//   source: @plur-ai/core@0.21.0 dist/chunk-TMRCNWX6.js lines 1-179 (`// src/fts.ts`).
//   verbatim: STOP_WORDS, MIN_TOKEN_LENGTH, TOKENIZER_VERSION, SPACELESS_RUN,
//     MAX_SPACELESS_RUN_CHARS, DENSE_SCRIPT, ftsTokenize, termMatches,
//     computeIdf, ftsScore (BM25_K1 = 1.2, BM25_B = 0.75), searchEngrams.
//   adapted for core-brain: `engramSearchText` -> `recordSearchText` (core-brain
//     `MemoryRecord` carries `text` + `meta`, not PLUR's engram fields);
//     `searchEngrams` -> `searchRecords` (same signature/behaviour); params and
//     `engram`/`engrams` renamed to `record`/`records`; `searchRecordScores`
//     added (returns the raw BM25 scores the ORACLE ruling on `RecallHit.legs`
//     requires — see test/CONTRACT.md §8.6).
//   NOT ported (declared parity gaps, plan §3/§124): searchTextFrom,
//     embeddingContentHash, hashEmbeddedText, extendCorpusStats (PLUR's
//     embedding cache and aggregation-widening paths, unused by core-brain).
//
// This module is pure: no imports, no store coupling, no I/O.

/** English function words dropped before scoring (source line 3). */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "from",
  "are",
  "was",
  "were",
  "been",
  "have",
  "has",
  "not",
  "but",
  "its",
  "you",
  "your",
  "can",
  "will",
  "should",
  "would",
  "could",
  "may",
  "might",
]);

export const MIN_TOKEN_LENGTH = 2;

/** Bumped by PLUR whenever the tokenizer output changes (source line 31). */
export const TOKENIZER_VERSION = 4;

/** Runs of CJK/Thai/Khmer/Lao/Myanmar scripts with no spaces (source line 32). */
export const SPACELESS_RUN = /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Thai}\p{Script_Extensions=Khmer}\p{Script_Extensions=Lao}\p{Script_Extensions=Myanmar}]{2,}/gu;

/** Cap on n-gram expansion of a single spaceless run (source line 33). */
export const MAX_SPACELESS_RUN_CHARS = 512;

/** Scripts whose 2-character tokens are meaningful (source line 34). */
export const DENSE_SCRIPT = /[\p{Script_Extensions=Hangul}\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}]/u;

/**
 * Tokenizer v4 (source lines 35-44, verbatim): lowercase, replace spaceless
 * runs, strip non-letter/digit/mark/underscore, drop tokens shorter than
 * MIN_TOKEN_LENGTH (keeping 2-char dense-script tokens), drop stop words, then
 * emit overlapping 2-grams for every spaceless run.
 */
export function ftsTokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const wordSource = lower
    .replace(SPACELESS_RUN, " ")
    .replace(/[^\p{L}\p{N}\p{M}_\s]/gu, " ");
  const tokens = wordSource
    .split(/\s+/)
    .filter((w) => w.length > 2 || (w.length === 2 && DENSE_SCRIPT.test(w)))
    .filter((w) => !STOP_WORDS.has(w));
  for (const run of lower.match(SPACELESS_RUN) ?? []) {
    const span = Math.min(run.length, MAX_SPACELESS_RUN_CHARS);
    for (let i = 0; i < span - 1; i++) tokens.push(run.slice(i, i + 2));
  }
  return tokens;
}

/**
 * The fields of a core-brain `MemoryRecord` this module indexes. Structural on
 * purpose: `MemoryRecord` satisfies it, and tests can pass plain objects.
 */
export interface SearchableRecord {
  text: string;
  meta?: Record<string, unknown> | undefined;
}

/**
 * Build the searchable text of a record (adapted from PLUR's
 * `engramSearchText`, source lines 54-80): core-brain's `MemoryRecord` has
 * `text` plus free-form `meta`, so the record text leads and every string
 * value in `meta` (and every string inside an array value) is appended.
 */
export function recordSearchText(record: SearchableRecord): string {
  const parts = [record.text];
  const meta = record.meta;
  if (meta) {
    for (const value of Object.values(meta)) {
      if (typeof value === "string" && value.length > 0) {
        parts.push(value);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string" && item.length > 0) parts.push(item);
        }
      }
    }
  }
  return parts.join(" ");
}

/** One record with its raw score (core-brain addition for the `legs` diagnostic). */
export interface ScoredRecord<T extends SearchableRecord> {
  record: T;
  score: number;
}

/** Corpus-wide BM25 statistics (the `stats` fast path of source lines 90-99). */
export interface CorpusStats {
  N: number;
  df: Map<string, number>;
  avgDocLength: number;
}

/** Bidirectional prefix/substring term match (source lines 87-89, verbatim). */
export function termMatches(t: string, qt: string): boolean {
  return t.includes(qt) || qt.startsWith(t);
}

/**
 * Inverse document frequency per query token (source lines 90-114, verbatim
 * apart from the `engram` -> `record` rename). With `stats`, the precomputed
 * `df` is used; otherwise document frequency is computed from the corpus.
 */
export function computeIdf(
  records: SearchableRecord[],
  queryTokens: string[],
  stats?: CorpusStats,
): Map<string, number> {
  if (stats) {
    if (stats.N === 0) return new Map();
    const idf2 = new Map<string, number>();
    for (const qt of queryTokens) {
      const df = stats.df.get(qt) ?? 0;
      idf2.set(qt, Math.max(0, Math.log(stats.N / (1 + df))));
    }
    return idf2;
  }
  const N = records.length;
  if (N === 0) return new Map();
  const recordTermSets = records.map((r) => new Set(ftsTokenize(recordSearchText(r))));
  const idf = new Map<string, number>();
  for (const qt of queryTokens) {
    let df = 0;
    for (const termSet of recordTermSets) {
      if (termSet.has(qt) || Array.from(termSet).some((t) => termMatches(t, qt))) {
        df++;
      }
    }
    idf.set(qt, Math.max(0, Math.log(N / (1 + df))));
  }
  return idf;
}

/** Okapi BM25 constants — MUST stay equal to PLUR (source lines 139-140). */
export const BM25_K1 = 1.2;
export const BM25_B = 0.75;

/**
 * Okapi BM25 score of one record (source lines 141-168, verbatim apart from
 * the renames). `idfWeights` absent -> idf 1; all-zero idf -> idf 1 so a query
 * whose tokens appear in every document still scores.
 */
export function ftsScore(
  record: SearchableRecord,
  queryTokens: string[],
  idfWeights?: Map<string, number>,
  avgDocLength?: number,
): number {
  const allTerms = ftsTokenize(recordSearchText(record));
  if (queryTokens.length === 0) return 0;
  const docLen = allTerms.length;
  const avgdl = avgDocLength && avgDocLength > 0 ? avgDocLength : docLen;
  const hasNonZeroIdf = idfWeights && Array.from(idfWeights.values()).some((v) => v > 0);
  let score = 0;
  for (const qt of queryTokens) {
    let effectiveIdf: number;
    if (!idfWeights) {
      effectiveIdf = 1;
    } else if (hasNonZeroIdf) {
      effectiveIdf = idfWeights.get(qt) ?? 0;
      if (effectiveIdf === 0) continue;
    } else {
      effectiveIdf = 1;
    }
    let tf = 0;
    for (const t of allTerms) {
      if (termMatches(t, qt)) tf++;
    }
    if (tf === 0) continue;
    const numerator = tf * (BM25_K1 + 1);
    const denominator = tf + BM25_K1 * (1 - BM25_B + (BM25_B * docLen) / avgdl);
    score += effectiveIdf * (numerator / denominator);
  }
  return score;
}

/**
 * BM25 search returning the raw scores (core-brain addition). This is the ONE
 * BM25 ranking used by the hybrid path; `searchRecords` below is the
 * PLUR-shaped wrapper that drops the scores.
 */
export function searchRecordScores<T extends SearchableRecord>(
  records: T[],
  query: string,
  limit = 20,
  stats?: CorpusStats,
): ScoredRecord<T>[] {
  const queryTokens = ftsTokenize(query);
  if (queryTokens.length === 0) return [];
  const idfWeights = computeIdf(records, queryTokens, stats);
  const avgDocLength = stats
    ? stats.avgDocLength
    : records.length > 0
      ? records.reduce((sum, r) => sum + ftsTokenize(recordSearchText(r)).length, 0) / records.length
      : 0;
  let scored: ScoredRecord<T>[] = records
    .map((record) => ({ record, score: ftsScore(record, queryTokens, idfWeights, avgDocLength) }))
    .filter((r) => r.score > 0);
  // All-zero-IDF fallback (source lines 175-177): rescore with idf 1.
  if (scored.length === 0) {
    scored = records
      .map((record) => ({ record, score: ftsScore(record, queryTokens, undefined, avgDocLength) }))
      .filter((r) => r.score > 0);
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Ported `searchEngrams` (source lines 169-179) under the core-brain name:
 * returns the top-`limit` records by BM25 score, `[]` for a query with no
 * tokens. Same ordering and same all-zero-IDF fallback as PLUR.
 */
export function searchRecords<T extends SearchableRecord>(
  records: T[],
  query: string,
  limit = 20,
  stats?: CorpusStats,
): T[] {
  return searchRecordScores(records, query, limit, stats).map((r) => r.record);
}
