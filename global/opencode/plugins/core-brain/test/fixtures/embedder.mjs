// test/fixtures/embedder.mjs — the deterministic offline test double for the
// core-brain engine (plan D4, B4).
//
// WHAT THIS IS (honest scope):
//   * A deterministic Embedder/Reranker seam so the offline matrix and the AC
//     probes run WITHOUT downloading or loading a model.
//   * It is NOT a model. `deterministicVector()` is an algorithmic double:
//     signed char-3gram hashing for arbitrary text, plus a seeded construction
//     for the pinned probe corpus so the AC1 semantic relation is stable.
//   * `vectors.bin` + `manifest.json` (committed) are the B4 form-of-record:
//     N=518, dim=384, N*dim*4 = 795,648 B EXACT. Generate them with
//     `node test/fixtures/generate.mjs`. The embedder works with or without the
//     binary: on a manifest hit it serves the committed bytes; on a miss it
//     falls back to the same deterministic function (never silently wrong —
//     misses are counted and reported by `stats()`).
//
// DECLARED GAP (not hidden): the plan (D4/B4) intends the 518 committed vectors
// to come from ONE real embed run. That run is not executed here; the committed
// binary is the format/size fixture carrying the deterministic double. The real
// embed run remains B4's open item and is the DEVELOPER/USER's step.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE_EMBEDDER_ID = "fixture-bge-small";
export const FIXTURE_DIM = 384;
export const FIXTURE_REVISION = "fixture-v1";
export const FIXTURE_RERANKER_NAME = "fixture-rerank";
export const FIXTURE_VECTOR_COUNT = 518;
export const FIXTURE_BINARY_BYTES = FIXTURE_VECTOR_COUNT * FIXTURE_DIM * 4; // 795648

export const FIXTURE_DIR =
  process.env.CORE_BRAIN_FIXTURE_DIR || dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Pinned probe corpus (shared by the generator and test/search.selftest.mjs).
// The AC1 relation is built by construction, not by a model.
// ---------------------------------------------------------------------------

// --- AC1 pair candidates (TESTER, 2026-10-04) ------------------------------
// Context: with the REAL model (`bge-small-en-v1.5`, pooling `cls`) the previous
// paraphrase ("the agent persists and later retrieves previously stated facts
// about its user") was ABSTRACT while the decoy is CONCRETE (a forecaster, a
// frost), and both models (embedder and reranker) prefer the concrete text, so
// the lexical decoy outranked the paraphrase. The candidates below carry the
// SAME MEANING as `semanticQuery` (where the information previously given to
// the agent is kept) but are themselves CONCRETE and share NO content word with
// it. The decoy is KEPT, one only: it shares five content lexemes with the
// query (assistant, told, earlier, keep, things) and is about a clearly
// different subject (a weather forecast for farmers).
//
// The three paraphrases span the concreteness axis so the ORACLE can measure
// the real cosines and rule which one passes:
//   1 - very concrete (a physical object and a physical storing verb);
//   2 - medium (software vocabulary);
//   3 - minimal lexical sharing (concrete, but maximally distant vocabulary).
// SEMANTIC_ACTIVE_CANDIDATE selects the one wired into `PROBE_TEXTS`; the other
// two stay registered here so the ORACLE can measure them without edits.

/** The kept hard-negative decoy, shared by every candidate pair below. */
export const SEMANTIC_DECOY_KEPT =
  "the assistant forecaster told the farmers earlier to keep the young things warm through the frost";

/** The three numbered AC1 paraphrase candidates (see the block above). */
export const SEMANTIC_PARAPHRASE_CANDIDATES = Object.freeze({
  1: "my pocket robot tucks every message I gave it before into a drawer",
  2: "the program saves whatever remarks its owner passed along previously",
  3: "a notebook holds a copy of each detail you shared",
});

/**
 * Registered extra (NOT one of the three requested): a paraphrase that shares
 * exactly ONE content lexeme with the query ("earlier"). Under the current RRF
 * fusion (reranker off) this is the only shape that can put the paraphrase
 * ABOVE the decoy without touching the fusion: the decoy wins BM25 rank 0 but
 * loses the vector rank to the paraphrase, so both end at rrf = 1/61 + 1/62 and
 * the cosine tiebreak puts the paraphrase first. Registered only for the ORACLE
 * to rule; it is NOT active and NOT counted among the three candidates.
 */
export const SEMANTIC_PARAPHRASE_MIN_SHARING =
  "a notebook preserves what you said earlier";

/** Which candidate above is the ACTIVE paraphrase in `PROBE_TEXTS`. */
export const SEMANTIC_ACTIVE_CANDIDATE = 1;

export const PROBE_TEXTS = Object.freeze({
  semanticQuery: "where does the assistant keep the things it was told earlier",
  semanticParaphrase: SEMANTIC_PARAPHRASE_CANDIDATES[SEMANTIC_ACTIVE_CANDIDATE],
  semanticDecoy: SEMANTIC_DECOY_KEPT,
  fusionQuery: "ledger reconciliation nightly batch job",
  fusionKeywordOnly: "ledger reconciliation nightly batch job review",
  fusionVectorOnly: "posting entries that square the accounts away each evening",
  rerankAnchor: "which memory retrieval layer ranks paraphrases above keyword matches",
});

const CORPUS_ORDER = [
  "semanticQuery",
  "semanticParaphrase",
  "semanticDecoy",
  "fusionQuery",
  "fusionKeywordOnly",
  "fusionVectorOnly",
  "rerankAnchor",
];

const KIND_BY_TEXT = new Map(CORPUS_ORDER.map((key) => [normalizeText(PROBE_TEXTS[key]), key]));

// Seeds are arbitrary; only the construction matters. semanticQuery/Paraphrase
// both sit ~0.99 of the same base direction (so cos(query,paraphrase) is high)
// while semanticDecoy is an independent direction (so its cosine is ~0).
//
// The decoy is a HARD NEGATIVE (AC1, plan R1): it shares five content lexemes
// with the query (assistant, told, earlier, keep, things) but is about a
// different subject (a weather forecast for farmers), so a real embedder must
// read it as semantically unrelated. The fixture encodes that "unrelated" as an
// independent seeded direction (cos(query,decoy) ≈ 0, i.e. ≤ MIN_VECTOR_SIMILARITY
// = 0.05) which keeps the decoy out of the vector leg, in BM25 only.
//
// NOTE (2026-10-04): `semanticParaphrase` is now the ACTIVE concrete candidate
// (SEMANTIC_ACTIVE_CANDIDATE = 1). Only its TEXT changed; the seeded
// construction (the `semanticParaphrase` case below) is untouched, and
// `KIND_BY_TEXT` re-keys the new text automatically. The committed
// vectors.bin/manifest.json still carry the OLD key, so regenerate them
// (`node test/fixtures/generate.mjs`) — until then the fixture serves the same
// vector via the deterministic fallback and reports the miss in `stats()`.
const SEED = { base: 0xbace, perturbA: 0x51a1, perturbB: 0x7c3d, decoy: 0xdec0, other: 0xf00d };

// ---------------------------------------------------------------------------
// Deterministic primitives.
// ---------------------------------------------------------------------------

export function normalizeText(text) {
  return String(text).trim().toLowerCase().replace(/\s+/g, " ");
}

function xorshift32(state) {
  state ^= state << 13;
  state >>>= 0;
  state ^= state >>> 17;
  state ^= state << 5;
  state >>>= 0;
  return state;
}

function unitFromSeed(seed, dim) {
  const v = new Array(dim);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < dim; i += 1) {
    s = xorshift32(s);
    v[i] = (s / 4294967296) * 2 - 1;
  }
  return l2normalize(v);
}

function l2normalize(v) {
  let sum = 0;
  for (let i = 0; i < v.length; i += 1) sum += v[i] * v[i];
  const norm = Math.sqrt(sum);
  if (!(norm > 0)) return v.slice();
  const out = new Array(v.length);
  for (let i = 0; i < v.length; i += 1) out[i] = v[i] / norm;
  return out;
}

function mix(a, wA, b, wB) {
  const out = new Array(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = a[i] * wA + b[i] * wB;
  return l2normalize(out);
}

function signedHash(token) {
  return createHash("sha256").update(token).digest().readUInt32LE(0);
}

/** Signed char-3gram hashing — the generic offline fallback vector. */
function hashNgramVector(normalizedText, dim) {
  const v = new Array(dim).fill(0);
  const padded = `  ${normalizedText}  `;
  for (let i = 0; i + 3 <= padded.length; i += 1) {
    const gram = padded.slice(i, i + 3);
    const h = signedHash(gram);
    const bucket = h % dim;
    v[bucket] += (h & 0x80000000) === 0 ? 1 : -1;
  }
  return l2normalize(v);
}

/**
 * The deterministic vector for `text`: seeded construction for the pinned probe
 * corpus, char-3gram hashing otherwise. Pure and stable across runs/platforms.
 */
export function deterministicVector(text, dim = FIXTURE_DIM) {
  const norm = normalizeText(text);
  const kind = KIND_BY_TEXT.get(norm);
  if (!kind) return hashNgramVector(norm, dim);

  const base = unitFromSeed(SEED.base, dim);
  switch (kind) {
    case "semanticQuery":
      return mix(base, 0.95, unitFromSeed(SEED.perturbA, dim), 0.05);
    case "semanticParaphrase":
      // Active concrete AC1 candidate (SEMANTIC_PARAPHRASE_CANDIDATES[
      // SEMANTIC_ACTIVE_CANDIDATE]); only the text changed, the seeded
      // construction is unchanged.
      return mix(base, 0.95, unitFromSeed(SEED.perturbB, dim), 0.05);
    case "fusionVectorOnly":
      return mix(base, 0.97, unitFromSeed(SEED.perturbA, dim), 0.03);
    case "rerankAnchor":
      return mix(base, 0.9, unitFromSeed(SEED.perturbB, dim), 0.1);
    case "semanticDecoy":
      return unitFromSeed(SEED.decoy, dim);
    case "fusionQuery":
      return mix(unitFromSeed(SEED.base, dim), 0.8, unitFromSeed(SEED.other, dim), 0.2);
    case "fusionKeywordOnly":
      return unitFromSeed(SEED.other, dim);
    default:
      return hashNgramVector(norm, dim);
  }
}

export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return Number.NaN;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d > 0 ? dot / d : Number.NaN;
}

export function vectorKey(text) {
  return createHash("sha256").update(normalizeText(text)).digest("hex");
}

// ---------------------------------------------------------------------------
// The committed binary fixture (optional at runtime).
// ---------------------------------------------------------------------------

function loadFixture(dir, dim) {
  const binPath = join(dir, "vectors.bin");
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(binPath) || !existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.dim !== dim) return null;
  const bytes = readFileSync(binPath);
  const byKey = new Map();
  for (const entry of manifest.entries || []) {
    byKey.set(entry.sha256, { offset: entry.offset, length: entry.length });
  }
  return { manifest, bytes, byKey };
}

// ---------------------------------------------------------------------------
// Public seams.
// ---------------------------------------------------------------------------

export function createFixtureEmbedder(options = {}) {
  const dir = options.dir || FIXTURE_DIR;
  const dim = options.dim || FIXTURE_DIM;
  const loaded = loadFixture(dir, dim);
  let hits = 0;
  let misses = 0;
  const warned = { miss: false, missing: false };

  const embed = (text) => {
    const key = vectorKey(text);
    if (loaded) {
      const entry = loaded.byKey.get(key);
      if (entry) {
        hits += 1;
        const out = new Array(dim);
        for (let i = 0; i < dim; i += 1) out[i] = loaded.bytes.readFloatLE(entry.offset + i * 4);
        return out;
      }
    } else if (!warned.missing) {
      warned.missing = true;
      process.stderr.write(
        `[fixture] vectors.bin/manifest.json not found in ${dir} — using the deterministic fallback (run generate.mjs).\n`,
      );
    }
    misses += 1;
    if (!warned.miss) {
      warned.miss = true;
      process.stderr.write(
        "[fixture] manifest miss — deterministic fallback vector used (reported in stats()).\n",
      );
    }
    return deterministicVector(text, dim);
  };

  return {
    id: FIXTURE_EMBEDDER_ID,
    dim,
    revision: FIXTURE_REVISION,
    embed,
    stats: () => ({ loaded: Boolean(loaded), hits, misses, dim, revision: FIXTURE_REVISION }),
  };
}

/**
 * The fixture reranker: scores the candidates by their position in the received
 * (RRF-ordered) head — increasing, so a descending sort REVERSES the head. It
 * exists to prove the reorder path (AC3: on = order changes), not to model
 * relevance. Documented as a deterministic reverse double.
 */
export function createFixtureReranker() {
  return {
    name: FIXTURE_RERANKER_NAME,
    scoreBatch(_query, docs) {
      return docs.map((_, index) => index);
    },
  };
}
