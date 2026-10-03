// engine/reranker.ts — configurable cross-encoder reranker, OFF by default.
// core-brain Slice 1, plan §7 file 1.4 (D7, C1/E3).
//
// Portions ported from plur-ai/plur packages/core@0.21.0 (Apache-2.0); modified
// for core-brain. See NOTICE.
//
// Provenance (plan §3 D2; read on this machine from the installed 0.21.0):
//   source: @plur-ai/core@0.21.0 dist/index.js
//     - lines 2919-2978: `loadPipeline` (`AutoTokenizer` +
//       `AutoModelForSequenceClassification.from_pretrained(modelId, { dtype })`),
//       `makeTransformersCrossEncoder` (`scoreBatch` reads `logits[i*numLabels]`),
//       `MS_MARCO_MINILM_L6_MODEL_ID = "Xenova/ms-marco-MiniLM-L-6-v2"` (2921),
//       dtype default `"q8"` (2945).
//     - lines 2980-2982: `RERANKER_NAMES = ["bge-reranker-v2-m3",
//       "ms-marco-minilm-l6", "off"]` and `DEFAULT_RERANKER = "off"` (2982) —
//       the C1 finding: parity means OFF by default.
//     - lines 3024-3036: `OFF_ADAPTER` / `isRerankerOff`.
//     - lines 3150-3175: `applyReranker` (topK default 50, head/tail split,
//       descending reorder, failure -> the RRF order unchanged, count 0).
//   NOT ported (declared parity gaps, plan §3 / §124): the bge-reranker-v2-m3
//     adapter, PLUR's runtime status counters/logging, `rerankerStatus`.
//   core-brain-only: the dependency on the D1 runtime resolver (reusing
//     `importTransformers` from ./embedder.ts) and the returned `degraded`
//     flag, so a reranker failure is an OBSERVABLE mode instead of a log line.
//
// DECISION D7 (C1): the reranker is OFF by default; the documented switch is to
// turn it ON via `CORE_BRAIN_RERANKER=ms-marco` (or by injecting a `Reranker`
// seam). Nothing here changes the RRF order unless the switch is on.

import { importTransformers, resolveRuntimeDir } from "./embedder.ts";

// ---------------------------------------------------------------------------
// Public seam (test/CONTRACT.md §8.2 — types.ts re-exports this at step 1.6)
// ---------------------------------------------------------------------------

/** The reranker seam (D4). `scoreBatch` is await-tolerant like the embedder. */
export interface Reranker {
  /** "off" | "ms-marco-minilm-l6" | "fixture-rerank". */
  name: string;
  scoreBatch(query: string, docs: string[]): number[] | Promise<number[]>;
}

// ---------------------------------------------------------------------------
// Constants — MUST stay equal to PLUR (plan §3 D2 / C1)
// ---------------------------------------------------------------------------

/** `DEFAULT_RERANKER = "off"` (index.js:2982) — the C1 parity decision. */
export const DEFAULT_RERANKER = "off";
/** The off adapter's name (index.js:2983). */
export const OFF_RERANKER_NAME = "off";
/** PLUR's name for the ms-marco cross-encoder (index.js:2981). */
export const MS_MARCO_MINILM_L6_NAME = "ms-marco-minilm-l6";
/** `Xenova/ms-marco-MiniLM-L-6-v2` (index.js:2921). */
export const MS_MARCO_MINILM_L6_MODEL_ID = "Xenova/ms-marco-MiniLM-L-6-v2";
/** dtype default `"q8"` (index.js:2945). */
export const RERANKER_DTYPE_DEFAULT = "q8";
/** `rerank.topK ?? 50` (index.js:3157). */
export const RERANKER_TOP_K_DEFAULT = 50;
/** Env knob (D7). `off` default | `ms-marco`; the `fixture` route is injected. */
export const RERANKER_MODE_ENV = "CORE_BRAIN_RERANKER";

// ---------------------------------------------------------------------------
// Off adapter (index.js:3024-3036)
// ---------------------------------------------------------------------------

/** The off adapter: scores everything 0 and never reorders (PLUR shape). */
export function createOffReranker(): Reranker {
  return {
    name: OFF_RERANKER_NAME,
    scoreBatch(_query: string, docs: string[]): number[] {
      return docs.map(() => 0);
    },
  };
}

/** `isRerankerOff` (index.js:3034): absent or named "off". */
export function isRerankerOff(reranker?: Reranker): boolean {
  return !reranker || reranker.name === OFF_RERANKER_NAME;
}

/** Resolves `CORE_BRAIN_RERANKER` (D7): `ms-marco` opts in, everything else is off. */
export function resolveRerankerName(
  env: Record<string, string | undefined> = process.env,
): "off" | "ms-marco-minilm-l6" {
  return env[RERANKER_MODE_ENV] === "ms-marco" ? MS_MARCO_MINILM_L6_NAME : DEFAULT_RERANKER;
}

// ---------------------------------------------------------------------------
// Real cross-encoder (ported shape, index.js:2919-2971)
// ---------------------------------------------------------------------------

const crossEncoderCache = new Map<string, Promise<any>>();

async function loadCrossEncoder(modelId: string, dtype: string, runtimeDir: string): Promise<any> {
  const key = `${modelId}::${dtype}`;
  let pending = crossEncoderCache.get(key);
  if (!pending) {
    pending = (async () => {
      process.env.HF_HUB_DISABLE_XET ??= "1";
      const transformers = await importTransformers(runtimeDir);
      const [tokenizer, model] = await Promise.all([
        transformers.AutoTokenizer.from_pretrained(modelId),
        transformers.AutoModelForSequenceClassification.from_pretrained(modelId, { dtype }),
      ]);
      return { tokenizer, model };
    })();
    crossEncoderCache.set(key, pending);
    pending.catch(() => crossEncoderCache.delete(key));
  }
  return pending;
}

export interface MsMarcoRerankerOptions {
  modelId?: string;
  dtype?: string;
  runtimeDir?: string;
}

/**
 * `ms-marco-minilm-l6` cross-encoder (D7, opt-in). Lazily loads the tokenizer +
 * sequence-classification model from the D1 runtime; `importTransformers`
 * throws the NAMED `EngineUnavailableError` when the runtime is absent.
 */
export function createMsMarcoReranker(options: MsMarcoRerankerOptions = {}): Reranker {
  const modelId = options.modelId ?? MS_MARCO_MINILM_L6_MODEL_ID;
  const dtype = options.dtype ?? RERANKER_DTYPE_DEFAULT;
  const runtimeDir = options.runtimeDir ?? resolveRuntimeDir();

  return {
    name: MS_MARCO_MINILM_L6_NAME,
    async scoreBatch(query: string, documents: string[]): Promise<number[]> {
      if (documents.length === 0) return [];
      const pipe = await loadCrossEncoder(modelId, dtype, runtimeDir);
      const inputs = await pipe.tokenizer(
        documents.map(() => query),
        { text_pair: documents, padding: true, truncation: true, return_tensor: true },
      );
      const output = await pipe.model(inputs);
      const logits = output.logits;
      const raw = logits.data instanceof Float32Array ? logits.data : Float32Array.from(logits.data);
      const numLabels = logits.dims[logits.dims.length - 1] ?? 1;
      const scores = new Array<number>(documents.length);
      for (let i = 0; i < documents.length; i += 1) scores[i] = raw[i * numLabels];
      return scores;
    },
  };
}

// ---------------------------------------------------------------------------
// applyReranker (index.js:3150-3175)
// ---------------------------------------------------------------------------

/** The outcome of a rerank pass. `degraded` is the observable failure signal. */
export interface RerankOutcome<T> {
  /** The (possibly reordered) candidates; the RRF order on any failure. */
  items: T[];
  /** Head length actually reordered; 0 when off, empty, or failed. */
  count: number;
  /** true only when the reranker was ON and failed (D7: mode -> hybrid-degraded). */
  degraded: boolean;
  /** The failure detail when `degraded` is true. */
  error?: string;
}

/**
 * Ported `applyReranker` (index.js:3150-3175), generic over the candidate and
 * with `docs` parallel to `candidates` (core-brain keeps the record outside the
 * hit). topK = `min(candidates, 50)`; the head is reordered by the cross-encoder
 * descending and the tail is kept; any failure returns the input unchanged with
 * `count: 0` and `degraded: true`.
 */
export async function applyReranker<T>(
  candidates: T[],
  docs: string[],
  query: string,
  reranker?: Reranker,
  topK: number = RERANKER_TOP_K_DEFAULT,
): Promise<RerankOutcome<T>> {
  if (isRerankerOff(reranker) || candidates.length === 0) {
    return { items: candidates, count: 0, degraded: false };
  }
  const headSize = Math.max(1, Math.min(candidates.length, topK));
  const head = candidates.slice(0, headSize);
  const tail = candidates.slice(headSize);
  try {
    const scores = await reranker!.scoreBatch(query, docs.slice(0, headSize));
    if (!Array.isArray(scores) || scores.length !== head.length) {
      const got = Array.isArray(scores) ? scores.length : 0;
      return {
        items: candidates,
        count: 0,
        degraded: true,
        error: `returned ${got} scores for ${head.length} candidates`,
      };
    }
    const reordered = head
      .map((item, index) => ({ item, score: scores[index] }))
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item);
    return { items: [...reordered, ...tail], count: head.length, degraded: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { items: candidates, count: 0, degraded: true, error: message };
  }
}
