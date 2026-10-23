// engine/embedder.ts — real (bge-small) + deterministic (hash-ngram) embedders.
// core-brain Slice 1, plan §7 file 1.3 (D1/D2/C2/D4/D5, E1/E4).
//
// Portions ported from plur-ai/plur packages/core@0.21.0 (Apache-2.0); modified
// for core-brain. See NOTICE.
//
// Provenance (plan §3 D2; read on this machine from the installed 0.21.0):
//   source: @plur-ai/core@0.21.0 dist/chunk-VNFYIPQL.js
//     - lines 5-50   : `loadPipeline` (lazy `import("@huggingface/transformers")`,
//                      `process.env.HF_HUB_DISABLE_XET ??= "1"`, `env.cacheDir`,
//                      pipeline cache) and `makeTransformersAdapter`/`embedOne`
//                      (the dim assertion `returned N-dim vector, expected D`).
//     - lines 66-76  : `makeBgeSmallAdapter` — `modelId:"Xenova/bge-small-en-v1.5"`,
//                      `dim:384`, `pooling:"cls"`, `normalize:true`, `dtype:"fp32"`.
//     - lines 292-346: the embedder registry and `DEFAULT_EMBEDDER = "bge-small"`
//                      (line 300).
//   NOT ported (declared parity gaps, plan §3 / §124): the minilm / bge-base /
//     embedding-gemma / openai adapters, `getEmbedder`, `resolveEmbedderName`
//     (PLUR_EMBEDDER), `_resetEmbedderCache`, embedBatch.
//   core-brain-only (not from PLUR): the runtime resolver (D1), the named
//     fail-closed `EngineUnavailableError`, the weights cache dir (D1/E4), the
//     `CORE_BRAIN_OFFLINE` switch (AC8) and the model-artifact fingerprint (D5).
//   `fallbackEmbed` is core-brain's own v1 algorithm (`hash-ngram-v1`, plugin
//     spec §5) — NOT PLUR code; it is kept so a v1 index stays reproducible and
//     so the fixture's manifest miss has a named, deterministic double.
//
// D1 fail-closed: `createBgeSmallEmbedder()` never silently downgrades to
// `hash-ngram-v1`. If the runtime cannot be resolved the error is NAMED
// (`EngineUnavailableError`) and its message names the fix. Choosing the
// deterministic double is always an explicit, observable decision (its `id` is
// `"hash-ngram-v1"`, never `"Xenova/bge-small-en-v1.5"`).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Public seam (test/CONTRACT.md §8.2 — types.ts re-exports this at step 1.6)
// ---------------------------------------------------------------------------

/** The embedder seam (D4). `revision` is the D5 model-artifact fingerprint. */
export interface Embedder {
  /** "Xenova/bge-small-en-v1.5" | "fixture-bge-small" | "hash-ngram-v1". */
  id: string;
  /** 384 (bge-small + fixture); 256 for the v1 deterministic stub. */
  dim: number;
  /** Model-artifact fingerprint (D5); the stub uses "hash-ngram-v1". */
  revision: string;
  embed(text: string): number[] | Promise<number[]>;
}

// ---------------------------------------------------------------------------
// Constants — MUST stay equal to PLUR (plan §3 D2 / C2)
// ---------------------------------------------------------------------------

/** `Xenova/bge-small-en-v1.5` (chunk-VNFYIPQL.js:66). */
export const BGE_SMALL_MODEL_ID = "Xenova/bge-small-en-v1.5";
/** `dim: 384` (chunk-VNFYIPQL.js:70). */
export const BGE_SMALL_DIM = 384;
/** `pooling: "cls"` (chunk-VNFYIPQL.js:72) — NOT `mean` (the C2 correction). */
export const BGE_SMALL_POOLING = "cls";
/** `normalize: true` (chunk-VNFYIPQL.js:73). */
export const BGE_SMALL_NORMALIZE = true;
/** `dtype: "fp32"` (chunk-VNFYIPQL.js:74). */
export const BGE_SMALL_DTYPE = "fp32";

/** core-brain's v1 deterministic stub — a distinct, observable id. */
export const FALLBACK_EMBEDDER_ID = "hash-ngram-v1";
/** `text -> number[256]` (v1 store.ts §5). */
export const FALLBACK_EMBEDDING_DIM = 256;
/** The stub has no artifact bytes, so its fingerprint is its own name. */
export const FALLBACK_REVISION = FALLBACK_EMBEDDER_ID;

/** Env knobs (D1/E4/AC8). `CORE_BRAIN_MODELS` is the plan's name for the same
 *  dir; both are accepted so the two documents agree at runtime. */
export const RUNTIME_DIR_ENV = "CORE_BRAIN_RUNTIME_DIR";
export const MODELS_DIR_ENV = "CORE_BRAIN_MODELS_DIR";
export const MODELS_DIR_ENV_LEGACY = "CORE_BRAIN_MODELS";
export const OFFLINE_ENV = "CORE_BRAIN_OFFLINE";
export const EMBEDDER_MODE_ENV = "CORE_BRAIN_EMBEDDER";

/** Memoised D5 fingerprint file inside the weights dir. */
export const MODEL_REVISION_MEMO_FILE = ".core-brain-model.json";

// ---------------------------------------------------------------------------
// Named fail-closed error (D1)
// ---------------------------------------------------------------------------

/** The runtime is absent/unresolvable — never a silent fallback. */
export class EngineUnavailableError extends Error {
  code: "ENGINE_UNAVAILABLE" = "ENGINE_UNAVAILABLE";

  constructor(message: string) {
    super(message);
    this.name = "EngineUnavailableError";
  }
}

// ---------------------------------------------------------------------------
// Environment resolution (D1/E4/AC8)
// ---------------------------------------------------------------------------

/** `CORE_BRAIN_RUNTIME_DIR` -> `~/.config/core-brain/runtime` (D1). */
export function resolveRuntimeDir(): string {
  const env = process.env[RUNTIME_DIR_ENV];
  return env && env.trim() !== "" ? env : join(homedir(), ".config", "core-brain", "runtime");
}

/** `CORE_BRAIN_MODELS_DIR` (brief) | `CORE_BRAIN_MODELS` (plan) -> `~/.config/core-brain/models`. */
export function resolveModelsDir(): string {
  const env =
    process.env[MODELS_DIR_ENV] ?? process.env[MODELS_DIR_ENV_LEGACY];
  return env && env.trim() !== "" ? env : join(homedir(), ".config", "core-brain", "models");
}

/** `CORE_BRAIN_OFFLINE=1|true` -> `transformers.env.allowRemoteModels = false` (AC8). */
export function isOffline(): boolean {
  const raw = process.env[OFFLINE_ENV];
  return raw === "1" || raw === "true";
}

/** D4 mode resolved from `CORE_BRAIN_EMBEDDER` (`real` default | `fixture`). */
export type EmbedderMode = "real" | "fixture";

/** Reads the env mode; anything unrecognised resolves to `real` (D4 default). */
export function resolveEmbedderMode(env: Record<string, string | undefined> = process.env): EmbedderMode {
  return env[EMBEDDER_MODE_ENV] === "fixture" ? "fixture" : "real";
}

// ---------------------------------------------------------------------------
// Runtime resolution (D1): createRequire().resolve() + import(pathToFileURL)
// ---------------------------------------------------------------------------

/** Imports the runtime resolved from the ABSOLUTE runtime dir (D1). */
export async function importTransformers(runtimeDir: string = resolveRuntimeDir()): Promise<any> {
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  let entry: string;
  try {
    const requireFromRuntime = createRequire(join(runtimeDir, "package.json"));
    entry = requireFromRuntime.resolve("@huggingface/transformers");
  } catch (error) {
    throw new EngineUnavailableError(runtimeUnavailableMessage(runtimeDir, error));
  }
  try {
    return await import(pathToFileURL(entry).href);
  } catch (error) {
    throw new EngineUnavailableError(runtimeUnavailableMessage(runtimeDir, error));
  }
}

function runtimeUnavailableMessage(runtimeDir: string, cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return (
    `core-brain engine runtime is not available: could not load ` +
    `"@huggingface/transformers" from '${runtimeDir}' (${detail}). ` +
    `Run global/opencode/plugins/core-brain/install-runtime.sh to provision it ` +
    `(the dir is CORE_BRAIN_RUNTIME_DIR, default ~/.config/core-brain/runtime).`
  );
}

// ---------------------------------------------------------------------------
// D5 — model-artifact fingerprint
// ---------------------------------------------------------------------------

function readRevisionMemo(modelsDir: string): Record<string, string> {
  const file = join(modelsDir, MODEL_REVISION_MEMO_FILE);
  try {
    if (!existsSync(file)) return {};
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeRevisionMemo(modelsDir: string, memo: Record<string, string>): void {
  try {
    mkdirSync(modelsDir, { recursive: true });
    writeFileSync(join(modelsDir, MODEL_REVISION_MEMO_FILE), `${JSON.stringify(memo, null, 2)}\n`, "utf8");
  } catch {
    // Memoisation is an optimisation; a read-only/absent cache must not fail.
  }
}

/** HF cache dir name for a model id (PLUR index.js:3021 shape). */
export function hfCacheDirName(modelId: string): string {
  return `models--${modelId.replace(/\//g, "--")}`;
}

/** Locates `onnx/model.onnx` under the HF cache dir, or `null`. */
export function findOnnxFile(modelsDir: string, modelId: string): string | null {
  const snapshots = join(modelsDir, hfCacheDirName(modelId), "snapshots");
  if (!existsSync(snapshots)) return null;
  let revisions: string[];
  try {
    revisions = readdirSync(snapshots).slice().sort();
  } catch {
    return null;
  }
  for (const revision of revisions) {
    const candidate = join(snapshots, revision, "onnx", "model.onnx");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** sha256 of a file as hex (`readFileSync` returns bytes; `Buffer` is a Uint8Array). */
function sha256FileHex(file: string): string {
  return String(createHash("sha256").update(readFileSync(file)).digest("hex"));
}

/**
 * D5 revision: `<modelId>@<dtype>@<first 16 hex of sha256(onnx/model.onnx)>`,
 * computed once and memoised to `<modelsDir>/.core-brain-model.json`. When the
 * artifact is not cached yet the revision is the NAMED sentinel
 * `<modelId>@<dtype>@unavailable` (never a silent guess) and no memo is written
 * for it, so the fingerprint is computed for real once the weights land.
 */
export function modelArtifactRevision(
  modelId: string = BGE_SMALL_MODEL_ID,
  dtype: string = BGE_SMALL_DTYPE,
  modelsDir: string = resolveModelsDir(),
): string {
  const key = `${modelId}@${dtype}`;
  const memo = readRevisionMemo(modelsDir);
  const memoised = memo[key];
  if (typeof memoised === "string" && memoised !== "") return memoised;
  const onnx = findOnnxFile(modelsDir, modelId);
  if (!onnx) return `${key}@unavailable`;
  const revision = `${key}@${sha256FileHex(onnx).slice(0, 16)}`;
  memo[key] = revision;
  writeRevisionMemo(modelsDir, memo);
  return revision;
}

// ---------------------------------------------------------------------------
// Real adapter — bge-small (ported shape, chunk-VNFYIPQL.js:5-50, 66-76)
// ---------------------------------------------------------------------------

const pipelineCache = new Map<string, Promise<any>>();

/** Lazily loads (and caches) the feature-extraction pipeline (source 7-24). */
async function loadPipeline(options: {
  runtimeDir: string;
  modelsDir: string;
  modelId: string;
  dtype: string;
}): Promise<any> {
  const key = `${options.modelId}::${options.dtype}`;
  let pending = pipelineCache.get(key);
  if (!pending) {
    pending = (async () => {
      // Keep parallelism off for the downloader (source 12).
      process.env.HF_HUB_DISABLE_XET ??= "1";
      const transformers = await importTransformers(options.runtimeDir);
      transformers.env.cacheDir = options.modelsDir;
      if (isOffline()) transformers.env.allowRemoteModels = false;
      return transformers.pipeline("feature-extraction", options.modelId, { dtype: options.dtype });
    })();
    pipelineCache.set(key, pending);
    // Never cache a rejected load: a transient failure must stay retryable.
    pending.catch(() => pipelineCache.delete(key));
  }
  return pending;
}

/** Options for {@link createBgeSmallEmbedder} (all default to the PLUR config). */
export interface BgeSmallEmbedderOptions {
  modelId?: string;
  dtype?: string;
  pooling?: string;
  dim?: number;
  runtimeDir?: string;
  modelsDir?: string;
}

/**
 * The real embedder (D2/C2): `Xenova/bge-small-en-v1.5`, `pooling:"cls"`,
 * `normalize:true`, `dtype:"fp32"`, dim 384. The pipeline is loaded on first
 * `embed()`; `importTransformers` throws the NAMED fail-closed error if the
 * runtime is absent. `revision` computes the D5 fingerprint lazily (once).
 */
export function createBgeSmallEmbedder(options: BgeSmallEmbedderOptions = {}): Embedder {
  const modelId = options.modelId ?? BGE_SMALL_MODEL_ID;
  const dtype = options.dtype ?? BGE_SMALL_DTYPE;
  const pooling = options.pooling ?? BGE_SMALL_POOLING;
  const dim = options.dim ?? BGE_SMALL_DIM;
  const modelsDir = options.modelsDir ?? resolveModelsDir();
  const runtimeDir = options.runtimeDir ?? resolveRuntimeDir();

  let revisionCache: string | null = null;

  return {
    id: modelId,
    dim,
    get revision(): string {
      if (revisionCache === null) revisionCache = modelArtifactRevision(modelId, dtype, modelsDir);
      return revisionCache;
    },
    async embed(text: string): Promise<number[]> {
      const pipe = await loadPipeline({ runtimeDir, modelsDir, modelId, dtype });
      const result = await pipe(text, { pooling, normalize: BGE_SMALL_NORMALIZE });
      const raw = result && result.data !== undefined ? result.data : result;
      const vector = raw instanceof Float32Array ? raw : Float32Array.from(raw as ArrayLike<number>);
      if (vector.length !== dim) {
        throw new Error(
          `Embedder "${modelId}" returned ${vector.length}-dim vector, expected ${dim}`,
        );
      }
      return Array.from(vector);
    },
  };
}

// ---------------------------------------------------------------------------
// Deterministic double — core-brain `hash-ngram-v1` (v1 store.ts §5, NOT PLUR)
// ---------------------------------------------------------------------------

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a over UTF-16 code units; unsigned 32-bit. */
function fnv1a(value: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/**
 * `hash-ngram-v1`: `text -> number[256]`, character n-grams (n = 2..4,
 * whitespace-collapsed, lowercased, space-padded) double-hashed into a bucket
 * with a sign bit, then L2-normalised. Deterministic, offline, dependency-free.
 * Identical to the v1 `store.ts` implementation so a v1 index stays valid.
 */
export function fallbackEmbed(text: string): number[] {
  const vector: number[] = new Array(FALLBACK_EMBEDDING_DIM).fill(0);
  const collapsed = String(text).toLowerCase().replace(/\s+/g, " ").trim();
  const padded = ` ${collapsed} `;

  for (let n = 2; n <= 4; n += 1) {
    for (let i = 0; i + n <= padded.length; i += 1) {
      const gram = padded.slice(i, i + n);
      const bucket = fnv1a(`i:${gram}`) % FALLBACK_EMBEDDING_DIM;
      const sign = (fnv1a(`s:${gram}`) & 1) === 0 ? 1 : -1;
      vector[bucket] += sign;
    }
  }

  let sumOfSquares = 0;
  for (const value of vector) sumOfSquares += value * value;
  if (sumOfSquares === 0) return vector;

  const norm = Math.sqrt(sumOfSquares);
  for (let i = 0; i < vector.length; i += 1) vector[i] = vector[i] / norm;
  return vector;
}

/**
 * The NAMED deterministic embedder. Selecting it is observable via `id ===
 * "hash-ngram-v1"`; it is never chosen implicitly by the real path (D1).
 */
export function createFallbackEmbedder(): Embedder {
  return {
    id: FALLBACK_EMBEDDER_ID,
    dim: FALLBACK_EMBEDDING_DIM,
    revision: FALLBACK_REVISION,
    embed: fallbackEmbed,
  };
}
