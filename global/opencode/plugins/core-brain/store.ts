// store.ts — core-brain data layer: config, authorizer, persistence, vectors.
//
// Spec: docs/specs/core-brain-plugin.md — §4 (storage layout), §5 (vectors),
// §6 (access matrix + error shapes), §7 (API + identity).
// Zero runtime npm dependencies: Node builtins only (spec Q2).

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AdminResult,
  AgentPolicy,
  CoreMemoryRequest,
  CoreMemoryResult,
  DoctorCheck,
  DoctorResult,
  DreamRecord,
  DreamResult,
  Engine,
  EngineOptions,
  Episode,
  EpisodeResult,
  FeedbackResult,
  ForgetResult,
  MemoryRecord,
  ReceiptResult,
  RecallHit,
  RecallMode,
  RecallResult,
  StatusResult,
  StoreResult,
  TimelineResult,
  WhoResult,
} from "./types.ts";

import { createConfiguredEmbedder, type Embedder } from "./engine/embedder.ts";
import { writeJsonFileAtomic } from "./engine/atomic-json.ts";
import {
  archiveRetiredMemories,
  countArchivedMemories,
  decayScores,
  retireExhausted,
  DREAM_MEMORY_STATUS,
  finishDreamRun,
  insertDreamMemory,
  listDreamMemories,
  listDreamRuns,
  readRecordsFromDb,
  namespacesInDb,
  readVectorsFromDb,
  resolveDreamMemoriesBySurvivor,
  resolveDreamMemory,
  sqliteEnabled,
  startDreamRun,
  writeRecordsToDb,
  writeVectorsToDb,
} from "./engine/persistence.ts";
import { createMsMarcoReranker, resolveRerankerName, type Reranker } from "./engine/reranker.ts";
import { searchHybrid, type SearchRecord } from "./engine/search.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Active default model id + width (plan file 1.7, D2/C2): the real
 * `Xenova/bge-small-en-v1.5`, pooling `cls`, fp32, 384 dims. The engine's
 * ACTIVE embedder is resolved per engine (see `createEngine`); these constants
 * name the default and are NOT the v1 stub's id/dim.
 */
export const EMBEDDER_ID = "Xenova/bge-small-en-v1.5";
export const EMBEDDING_DIM = 384;

/** The deterministic v1 double (`hash-ngram-v1`, 256 dims) — never implicit (D1). */
export const FALLBACK_EMBEDDER_ID = "hash-ngram-v1";
export const FALLBACK_EMBEDDING_DIM = 256;

const DEFAULT_RECALL_LIMIT = 5;

/**
 * Default `timeline` result cap when the caller passes no positive integer
 * limit. Not pinned by test/CONTRACT.md §10.2 (implementation choice); 50 keeps
 * a diary read useful without returning an unbounded history.
 */
const DEFAULT_TIMELINE_LIMIT = 50;

/** Cosine at/above which a `forget` query match is retired (spec §6). */
const FORGET_MATCH_THRESHOLD = 0.35;

/**
 * Default policy for an agent absent from `config.json`, and for a configured
 * row that omits `private` / `hasGlobalAccess` / `inject` (spec §2/A2, §3/B1;
 * Fatia 2 CONTRACT §9.1 for `inject`).
 */
const DEFAULT_POLICY = { private: false, hasGlobalAccess: true, inject: false } as const;

/** Directory of this module, used as the last config fallback (dev seed). */
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));

/** Config file name inside the data root. */
const CONFIG_FILE = "config.json";

// ---------------------------------------------------------------------------
// Errors (§6.4)
// ---------------------------------------------------------------------------

/** Thrown at engine init when a config row is invalid (spec Q3 / §6.3). */
export class InvalidConfigurationError extends Error {
  code: "INVALID_CONFIGURATION" = "INVALID_CONFIGURATION";

  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigurationError";
  }
}

/**
 * Thrown by `recall` when a namespace holds records but its index is not the
 * one the active engine would build (D5/AC6, CONTRACT §8.4): the index is
 * absent, or its `embedder`/`dim`/`revision` differ. Answering it silently is
 * the v1 defect this refuses; the message names the namespace and `reindex`.
 */
export class StaleIndexError extends Error {
  code: "STALE_INDEX" = "STALE_INDEX";

  constructor(message: string) {
    super(message);
    this.name = "StaleIndexError";
  }
}

// ---------------------------------------------------------------------------
// Embedder: deterministic, offline, feature-hashed char n-grams (§5, R4)
// ---------------------------------------------------------------------------

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a over UTF-16 code units; returns an unsigned 32-bit value. */
function fnv1a(value: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/**
 * `hash-ngram-v1`: `text -> number[256]`.
 * Character n-grams (n = 2..4, whitespace-collapsed, lowercased, space-padded),
 * double-hashed into a bucket (FNV-1a on `i:<gram>`) with a bit taken from a
 * second independent hash (`s:<gram>`) as the sign; then L2-normalised.
 * Deterministic, offline, dependency-free — a declared v1 stub (§5).
 */
export function embed(text: string): number[] {
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

/** Cosine similarity; 0 for a missing/degenerate vector. */
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
// Limits
// ---------------------------------------------------------------------------

/**
 * The most one memory may carry (USER, 2026-11-22): a rule about SHAPE, not a storage cap — a
 * memory long enough to need a minute of reading is an episode, not a rule. It is a CONFIG value
 * (`memoryMaxChars`, 650 by default) so an install can raise or lower it; the refusal names the
 * number and the key, so the agent summarises and resends.
 */
const DEFAULT_MEMORY_MAX_CHARS = 650;

/**
 * Where a memory's score starts (USER, 2026-11-20): 10. It goes UP one per recall and DOWN one per
 * night, and at zero it is retired — the number is a working-set budget, not a static rank.
 */
const MEMORY_START_SCORE = 10;

/**
 * PLACEHOLDER — the memory-quality gate (USER, 2026-11-19).
 *
 * <p>Today it accepts everything: `true`, always. The question it will answer is «does this
 * memory deserve to exist?» — useful, or redundant, or noise — and that judgement belongs to
 * Laya, decided after the fact from the insertion record (initialization + finalization).
 *
 * <p>Laya plugs in HERE and returns `true` / `false`; a `false` must refuse the store with a
 * reason, never truncate and never store a maybe.
 */
export function memoryIsAcceptable(_text: string): boolean {
  return true;
}

/**
 * Cosine at which two ACTIVE memories are read as saying the same thing (USER, 2026-11-20).
 *
 * <p>Model-dependent on purpose: it is the default of `admin dedupe`, and `minCosine` overrides it
 * per call, so a stricter or a smaller embedder can tighten or loosen the same pass without a code
 * change. Below it two records may still be RELATED — a merge there would destroy a distinction.
 */
const SEMANTIC_DEDUPE_MIN_COSINE = 0.97;

/** The synthesis band (USER, 2026-11-22): only what is nearly the same — 0.90 up to the mechanical
 *  union at 0.97. This is the DEFAULT, the same for every install: the same fact written in
 *  Portuguese and in English lands near 0.90, and a floor of 0.95 leaves those twins apart.
 *  `synthesisMinCosine` in the config moves it per install. */
const SYNTHESIS_MIN_COSINE = 0.9;

/** There is no count per night (USER, 2026-11-22): **one group — the highest cosine** inside the
 *  band. `--limit N` exists for a deliberate pen, never as the night's rule; `SYNTHESIS_PAIRS_MAX`
 *  is only the ceiling such a pen may reach. */
const SYNTHESIS_PAIRS_PER_NIGHT = 1;
const SYNTHESIS_PAIRS_MAX = 50;

/**
 * Every dreamed memory opens with this line (USER, 2026-11-20): the agent reading it must know, in
 * the first words, that the story did not happen — it was a dream. The cap applies to the dream
 * itself; this marker is added on top.
 */
const DREAM_MEMORY_PREFIX = "Esta memória não aconteceu de verdade, foi um sonho: ";

/** The text a duplicate check compares: trimmed, whitespace collapsed, case folded. */
export function normalizeMemoryTextKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Characters of `text` — the same unit `store` counts against `DEFAULT_MEMORY_MAX_CHARS`. */
function charCount(text: string): number {
  return [...text].length;
}

/**
 * The text two memories that say the SAME thing keep once they become one (USER, 2026-11-20: the
 * pair becomes one memory and the scores are added).
 *
 * <p>Joining the sentences would spend the memory budget repeating the same statement in
 * other words, so what survives is the RICHEST text of the group — the longest one, since a longer
 * statement of the same fact carries the most detail (a text that already contains another wins by
 * being longer). Ties keep the first, which is the record that survives. An imported text longer
 * than the ceiling is cut to it: the memory rule holds whatever the background. Pure: same input,
 * same output, no I/O.
 */
export function richestMemoryText(texts: string[]): string {
  const usable = texts.filter((text) => typeof text === "string" && text.trim() !== "");
  if (usable.length === 0) return "";
  let winner = usable[0].trim();
  for (const text of usable.slice(1)) {
    const candidate = text.trim();
    if (charCount(candidate) > charCount(winner)) winner = candidate;
  }
  if (charCount(winner) > DEFAULT_MEMORY_MAX_CHARS) return [...winner].slice(0, DEFAULT_MEMORY_MAX_CHARS).join("");
  return winner;
}

// ---------------------------------------------------------------------------
// Namespaces
// ---------------------------------------------------------------------------

/** A namespace is either the shared global space or one agent's space. */
type Namespace = { kind: "global" } | { kind: "agent"; name: string };

/** The label reported in `scanned` / `store.ns` (§7.2). */
function nsLabel(ns: Namespace): string {
  return ns.kind === "global" ? "global" : `agent:${ns.name}`;
}

/** §4: `global/memories.json` | `agents/<name>/memories.json`. */
function recordsFileFor(root: string, ns: Namespace): string {
  return ns.kind === "global"
    ? join(root, "global", "memories.json")
    : join(root, "agents", ns.name, "memories.json");
}

/**
 * §10.4: `global/episodes.json` | `agents/<name>/episodes.json` — the episodic
 * diary lives beside memories, in the SAME namespace model.
 */
function episodesFileFor(root: string, ns: Namespace): string {
  return ns.kind === "global"
    ? join(root, "global", "episodes.json")
    : join(root, "agents", ns.name, "episodes.json");
}

/** `dreams.json` beside the episodes: `global/dreams.json` | `agents/<name>/dreams.json`. */
function dreamsFileFor(root: string, ns: Namespace): string {
  return ns.kind === "global"
    ? join(root, "global", "dreams.json")
    : join(root, "agents", ns.name, "dreams.json");
}

/** §4: `vectors/global/index.json` | `vectors/<name>/index.json`. */
function vectorsFileFor(root: string, ns: Namespace): string {
  return join(root, "vectors", ns.kind === "global" ? "global" : ns.name, "index.json");
}

// ---------------------------------------------------------------------------
// Filesystem: JSON, atomic writes (tmp + rename — §4)
// ---------------------------------------------------------------------------

function readJsonOrNull(file: string): unknown {
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, "utf8");
  if (raw.trim() === "") return null;
  return JSON.parse(raw);
}

function readRecords(file: string): MemoryRecord[] {
  // SQLite backend (USER, 2026-11-20): the database answers first; JSON stays as the fallback so a
  // half-migrated root still works and a rollback is one word in config.json.
  if (sqliteEnabled()) {
    const rows = readRecordsFromDb(file);
    if (rows !== null) return rows as MemoryRecord[];
  }
  const parsed = readJsonOrNull(file);
  if (!Array.isArray(parsed)) return [];
  // A JSON file written before the rename carries `retrievals`: read it as `score`
  // (the counter's name changed on 2026-11-20; the value means the same thing).
  return (parsed as Array<MemoryRecord & { retrievals?: number }>).map((record) => ({
    ...record,
    score: Number(record.score ?? record.retrievals ?? 0),
  }));
}

/** `episodes.json` (whatever namespace) -> its episode array; `[]` when absent. */
function readEpisodes(file: string): Episode[] {
  const parsed = readJsonOrNull(file);
  return Array.isArray(parsed) ? (parsed as Episode[]) : [];
}


/**
 * Append-only dream log (USER, 2026-11-19): one line per event — START, END or ERROR — so a dream
 * can be followed from outside the store. It lives at the data root, not inside a namespace.
 */
function appendDreamLog(root: string, line: string): void {
  try {
    const file = join(root, "logs", "dream.log");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `[${new Date().toISOString()}] ${line}\n`, { flag: "a" });
  } catch {
    // Logging is advisory: a failed line never breaks a dream.
  }
}

/** The dreams on disk; a missing or unreadable file is an empty list, never a throw. */
function readDreams(file: string): DreamRecord[] {
  if (!existsSync(file)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? (parsed as DreamRecord[]) : [];
  } catch {
    return [];
  }
}

/**
 * A fresh episode id: `EP-<epoch ms>-<4 chars>` (CONTRACT §10.1/§10.2 — the
 * readable, sortable PLUR shape). The 4-char suffix is `[A-Za-z0-9]` (hex taken
 * from the uuid), so the id satisfies `/^EP-\d+-[A-Za-z0-9]{4}$/`.
 */
function newEpisodeId(): string {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 4);
  return `EP-${Date.now()}-${suffix}`;
}

/**
 * Builds an imported episode preserving the source fields VERBATIM (§10.5 rule
 * 4): only the known `Episode` fields are copied, and only when present, so the
 * importer invents nothing — an ownerless entry keeps no `agent` key. `id` is
 * validated by the caller before this is called.
 */
function importedEpisodeFrom(row: Record<string, unknown>): Episode {
  const episode: Partial<Episode> = {};
  if (typeof row.id === "string") episode.id = row.id;
  if (typeof row.at === "string") episode.at = row.at;
  if (typeof row.summary === "string") episode.summary = row.summary;
  if (typeof row.agent === "string" && row.agent !== "") episode.agent = row.agent;
  if (Array.isArray(row.tags)) episode.tags = row.tags as string[];
  if (typeof row.sessionId === "string") episode.sessionId = row.sessionId;
  if (typeof row.channel === "string") episode.channel = row.channel;
  if (Array.isArray(row.engramIds)) episode.engramIds = row.engramIds as string[];
  return episode as Episode;
}

function writeFileAtomic(file: string, data: unknown): void {
  if (sqliteEnabled()) {
    if (Array.isArray(data) && file.endsWith("memories.json")) {
      writeRecordsToDb(file, data);
      return;
    }
    const asIndex = data as { vectors?: unknown } | null;
    if (file.endsWith("index.json") && asIndex && typeof asIndex === "object" && "vectors" in asIndex) {
      writeVectorsToDb(file, (asIndex.vectors ?? {}) as Record<string, number[]>);
      return;
    }
  }
  writeJsonFileAtomic(file, data);
}

/**
 * Resolves `p` to its real filesystem location, following symlinks: `realpath`
 * when it exists, otherwise the realpath of its nearest existing ancestor — so
 * a symlinked ancestor cannot be used to escape the memory root.
 */
function realTargetPath(p: string): string {
  let current = resolve(p);
  for (;;) {
    if (existsSync(current)) return realpathSync(current);
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

/**
 * §7.2 containment: `export`/`import` may only touch files that live INSIDE the
 * core-brain data root (where the memory is stored). An absolute path elsewhere,
 * a `..` escape, or a symlink pointing out of the root is refused before any
 * filesystem write/read happens.
 */
function assertInsideDataRoot(root: string, candidate: string, action: string): void {
  const rootReal = realTargetPath(root);
  const targetReal = realTargetPath(candidate);
  const rel = relative(rootReal, targetReal);
  const contained = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  if (!contained) {
    throw new Error(
      `core-brain admin ${action}: 'file' must live inside the core-brain memory root ` +
        `(${rootReal}); refusing '${candidate}'`,
    );
  }
}

/**
 * §7.2: an export must never overwrite a LIVE store file — `config.json`, a
 * namespace's `memories.json`/`episodes.json`, or a `vectors/**` index. Doing so
 * would corrupt (or silently wipe) the memory the admin op is meant to dump.
 */
function isLiveStoreFile(root: string, file: string): boolean {
  const rel = relative(realTargetPath(root), realTargetPath(file));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return false;
  const parts = rel.split(sep);
  if (parts[0] === "vectors") return true;
  if (parts.length === 1) return parts[0] === CONFIG_FILE;
  const leaf = parts[parts.length - 1];
  return leaf === "memories.json" || leaf === "episodes.json";
}

/** The index header written by `writeVectors` (D5). */
interface IndexHeader {
  embedder: string;
  dim: number;
  revision: string;
}

/** The minimum the active embedder must expose for index read/write. */
interface IndexEmbedder {
  id: string;
  dim: number;
  revision: string;
}

/** Reads the raw index file: its header (if well-formed) and its vectors. */
function readIndexFile(file: string): { header: IndexHeader | null; vectors: Record<string, number[]> } {
  const parsed = readJsonOrNull(file) as
    | { embedder?: unknown; dim?: unknown; revision?: unknown; vectors?: unknown }
    | null;
  if (!parsed || typeof parsed !== "object") return { header: null, vectors: {} };
  const vectors =
    parsed.vectors && typeof parsed.vectors === "object"
      ? (parsed.vectors as Record<string, number[]>)
      : {};
  const header =
    typeof parsed.embedder === "string" &&
    typeof parsed.dim === "number" &&
    typeof parsed.revision === "string"
      ? { embedder: parsed.embedder, dim: parsed.dim, revision: parsed.revision }
      : null;
  return { header, vectors };
}

/**
 * Reads a namespace's persisted vectors for the ACTIVE embedder: an index built
 * by a different `embedder`/`dim`/`revision` is stale and yields `{}` (recall
 * refuses it with `STALE_INDEX` separately, D5/AC6).
 */
function readVectors(file: string, active: IndexEmbedder): Record<string, number[]> {
  if (sqliteEnabled()) {
    const fromDb = readVectorsFromDb(file);
    if (fromDb !== null) return fromDb;
  }
  const { header, vectors } = readIndexFile(file);
  if (!header) return {};
  if (header.embedder !== active.id || header.dim !== active.dim || header.revision !== active.revision) {
    return {};
  }
  return vectors;
}

/** Writes the D5-stamped index: `{ embedder, dim, revision, vectors }`. */
function writeVectors(file: string, vectors: Record<string, number[]>, active: IndexEmbedder): void {
  writeFileAtomic(file, {
    embedder: active.id,
    dim: active.dim,
    revision: active.revision,
    vectors,
  });
}

/** true when a namespace's index header matches the active engine exactly (D5). */
function indexMatches(header: IndexHeader | null, active: IndexEmbedder): boolean {
  return (
    header !== null &&
    header.embedder === active.id &&
    header.dim === active.dim &&
    header.revision === active.revision
  );
}

/** The `STALE_INDEX` message: names the namespace and the `reindex` fix (AC6). */
function staleIndexMessage(label: string, header: IndexHeader | null, active: IndexEmbedder): string {
  const state = header
    ? `was built by embedder '${header.embedder}' dim ${header.dim} revision '${header.revision}'`
    : `is missing (the namespace has records but no index was written)`;
  return (
    `core_memory recall: namespace '${label}' index ${state}, but the active engine is ` +
    `'${active.id}' dim ${active.dim} revision '${active.revision}' — ` +
    `run the core-brain admin CLI ("reindex --ns ${label}") to rebuild it`
  );
}

// ---------------------------------------------------------------------------
// Configuration (§4/Q3). Precedence: options.configPath > CORE_BRAIN_HOME >
// ~/.config/core-brain > <dataRoot> > <pluginDir> (last = dev seed).
// ---------------------------------------------------------------------------

function resolveDataRoot(options: EngineOptions): string {
  if (options.home) return options.home;
  const envHome = process.env.CORE_BRAIN_HOME;
  if (envHome) return envHome;
  return join(homedir(), ".config", "core-brain");
}

function resolveConfigPath(options: EngineOptions, dataRoot: string): string {
  const candidates: string[] = [];
  const push = (candidate?: string): void => {
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
  };
  push(options.configPath);
  const envHome = process.env.CORE_BRAIN_HOME;
  if (envHome) push(join(envHome, CONFIG_FILE));
  push(join(homedir(), ".config", "core-brain", CONFIG_FILE));
  push(join(dataRoot, CONFIG_FILE));
  push(join(PLUGIN_DIR, CONFIG_FILE));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0] ?? join(dataRoot, CONFIG_FILE);
}

const AGENT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Loads + validates `agents[]` at init, BEFORE any read/write (§6.4):
 * an absent `hasGlobalAccess`/`private`/`inject` key takes the default
 * (`true` / `false` / `false`); a present non-boolean still throws; any resolved
 * `private:false && hasGlobalAccess:false` row aborts the engine.
 */
/**
 * `embedModel` from `config.json` — the model choice as DATA, so the running plugin picks it up on
 * its next start without an environment change. Absent or unreadable = undefined (env/default wins).
 */
/** The config document, or `null` when it is absent or unreadable — ONE home for the read every
 *  `read*` policy below needs, so a broken file is handled the same way everywhere. */
function readConfigDocument(configPath: string | null): Record<string, unknown> | null {
  if (configPath === null || !existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readEmbedModel(configPath: string | null): string | undefined {
  const parsed = readConfigDocument(configPath);
  if (parsed === null) return undefined;
  const value = parsed.embedModel;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/**
 * `dreamEpisodesPerPass` from `config.json` (USER, 2026-11-19): the ceiling on how many episodes a
 * single dream reads. It is a POLICY, not a call argument — the skill respects it. 0 = no ceiling.
 */
function readDreamEpisodesPerPass(configPath: string | null): number {
  const parsed = readConfigDocument(configPath);
  if (parsed === null) return 5;
  const value = parsed.dreamEpisodesPerPass;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 5;
  return Math.floor(value);
}

/**
 * `dreamIdleHours` from `config.json` (USER, 2026-11-19): the rest the scheduler must respect before
 * a dream. Default 4; the skill compares it with the idle time the scheduler passes.
 */
function readDreamIdleHours(configPath: string | null): number {
  const parsed = readConfigDocument(configPath);
  if (parsed === null) return 4;
  const value = parsed.dreamIdleHours;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 4;
  return value;
}

/**
 * `dreamPerDay` from `config.json` (USER, 2026-11-19). Default 1: a store that dreams every hour
 * turns consolidation into a factory. `0` disables dreaming entirely; a manual `force` still works.
 */
function readDreamPerDay(configPath: string | null): number {
  const parsed = readConfigDocument(configPath);
  if (parsed === null) return 1;
  const value = parsed.dreamPerDay;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 1;
  return Math.floor(value);
}

/**
 * The master switch (USER, 2026-11-22): `dreams` in `config.json`. OFF unless it is literally
 * `true` — the dream is experimental and spends tokens (a night can be ten sessions of synthesis),
 * so a store that nobody configured never dreams on its own. `dreamPerDay` still applies on top.
 */
function readDreamsEnabled(configPath: string | null): boolean {
  if (configPath === null || !existsSync(configPath)) return false;
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as { dreams?: unknown };
    return parsed.dreams === true;
  } catch {
    return false;
  }
}

/**
 * The floor of the synthesis band (USER, 2026-11-22): `synthesisMinCosine` in the config, 0.95 by
 * default. Below it two texts may share a style and say different things, and uniting them invents
 * facts; inside a language pair (the same fact written in PT and in EN) similarity lands near 0.90,
 * which is why the value is a dial and not a constant.
 */
function readSynthesisMinCosine(configPath: string | null): number {
  const parsed = readConfigDocument(configPath);
  if (parsed === null) return SYNTHESIS_MIN_COSINE;
  const value = parsed.synthesisMinCosine;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value >= 1) return SYNTHESIS_MIN_COSINE;
  return value;
}

/**
 * How old a memory may be to be elected (USER, 2026-11-22): `synthesisWindowHours` in the config.
 * The window keeps the cost linear as the base grows; only ONE side of the pair has to be inside it,
 * so a new memory still finds an old duplicate. 0 = the whole living base.
 */
function readSynthesisWindowHours(configPath: string | null): number {
  const parsed = readConfigDocument(configPath);
  if (parsed === null) return 48;
  const value = parsed.synthesisWindowHours;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 48;
  return Math.floor(value);
}

/**
 * The ceiling for one memory's text (USER, 2026-11-22): `memoryMaxChars` in the config, 650 by
 * default. One key governs every door that writes a memory — `store`, `dream` and `dream-store` —
 * so the limit cannot differ between them. Values below 50 are treated as a typo.
 */
function readMemoryMaxChars(configPath: string | null): number {
  const parsed = readConfigDocument(configPath);
  if (parsed === null) return DEFAULT_MEMORY_MAX_CHARS;
  const value = parsed.memoryMaxChars;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 50) return DEFAULT_MEMORY_MAX_CHARS;
  return Math.floor(value);
}

/**
 * `memoriesPerContext` from `config.json` (USER, 2026-11-19): how many memories the
 * automatic block carries when the agent does not say otherwise. Default 5 — the
 * number that used to be hard-coded in the hook. `0` = the block carries none.
 */
function readMemoriesPerContext(configPath: string | null): number {
  const parsed = readConfigDocument(configPath);
  if (parsed === null) return 5;
  const value = parsed.memoriesPerContext;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 5;
  return Math.floor(value);
}

/**
 * `memoryTestSet` from `config.json` (USER, 2026-11-19): the folder that collects every memory the
 * agents write, as training cases with an empty vote. Absent = the vault keeps no training set, which
 * is the community default — a personal path must never be baked into the plugin.
 */
function readMemoryTestSet(configPath: string | null): string | null {
  const parsed = readConfigDocument(configPath);
  if (parsed === null) return null;
  const value = parsed.memoryTestSet;
  if (typeof value !== "string" || value.trim() === "") return null;
  return value.trim();
}

function loadPolicies(configPath: string | null): AgentPolicy[] {
  if (!configPath) return [];

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (error) {
    throw new InvalidConfigurationError(
      `cannot read core-brain config '${configPath}': ${String((error as Error).message)}`,
    );
  }
  if (raw.trim() === "") return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new InvalidConfigurationError(
      `core-brain config '${configPath}' is not valid JSON: ${String((error as Error).message)}`,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new InvalidConfigurationError(`core-brain config '${configPath}' must be a JSON object`);
  }

  const agents = (parsed as { agents?: unknown }).agents;
  if (agents === undefined || agents === null) return [];
  if (!Array.isArray(agents)) {
    throw new InvalidConfigurationError(`core-brain config '${configPath}': 'agents' must be an array`);
  }

  const policies: AgentPolicy[] = [];
  const seen = new Set<string>();
  for (const entry of agents) {
    if (!entry || typeof entry !== "object") {
      throw new InvalidConfigurationError(
        `core-brain config '${configPath}': every 'agents' entry must be an object`,
      );
    }
    const row = entry as {
      name?: unknown;
      hasGlobalAccess?: unknown;
      private?: unknown;
      inject?: unknown;
    };
    const name = row.name;
    if (typeof name !== "string" || name.trim() === "") {
      throw new InvalidConfigurationError(
        `core-brain config '${configPath}': every agent needs a non-empty string 'name'`,
      );
    }
    if (!AGENT_NAME_PATTERN.test(name)) {
      throw new InvalidConfigurationError(
        `core-brain config '${configPath}': agent '${name}' has a name that is not filename-safe`,
      );
    }
    const hasGlobalAccess =
      row.hasGlobalAccess === undefined ? DEFAULT_POLICY.hasGlobalAccess : row.hasGlobalAccess;
    if (hasGlobalAccess !== true && hasGlobalAccess !== false) {
      throw new InvalidConfigurationError(
        `core-brain config '${configPath}': agent '${name}' needs a boolean 'hasGlobalAccess'`,
      );
    }
    const isPrivate = row.private === undefined ? DEFAULT_POLICY.private : row.private;
    if (isPrivate !== true && isPrivate !== false) {
      throw new InvalidConfigurationError(
        `core-brain config '${configPath}': agent '${name}' needs a boolean 'private'`,
      );
    }
    // Fatia 2 (CONTRACT §9.1): the automatic-layer opt-in is a separate key.
    const inject = row.inject === undefined ? DEFAULT_POLICY.inject : row.inject;
    if (inject !== true && inject !== false) {
      throw new InvalidConfigurationError(
        `core-brain config '${configPath}': agent '${name}' needs a boolean 'inject'`,
      );
    }
    if (seen.has(name)) {
      throw new InvalidConfigurationError(
        `core-brain config '${configPath}': agent '${name}' is declared more than once`,
      );
    }
    if (isPrivate === false && hasGlobalAccess === false) {
      throw new InvalidConfigurationError(
        `core-brain config '${configPath}': agent '${name}' is a public agent without global access ` +
          `(private:false + hasGlobalAccess:false) — invalid row, refusing to start`,
      );
    }
    seen.add(name);
    policies.push({ name, hasGlobalAccess, private: isPrivate, inject });
  }
  return policies;
}

// ---------------------------------------------------------------------------
// Authorization (§6 — the heart of the slice)
// ---------------------------------------------------------------------------

type StoreRequest = Extract<CoreMemoryRequest, { op: "store" }>;
type RecallRequest = Extract<CoreMemoryRequest, { op: "recall" }>;
type ForgetRequest = Extract<CoreMemoryRequest, { op: "forget" }>;
type FeedbackRequest = Extract<CoreMemoryRequest, { op: "feedback" }>;
type EpisodeRequest = Extract<CoreMemoryRequest, { op: "episode" }>;
type TimelineRequest = Extract<CoreMemoryRequest, { op: "timeline" }>;
type DreamRequest = Extract<CoreMemoryRequest, { op: "dream" }>;

/** One namespace loaded during a recall scan, with its records in memory. */
interface ScannedNamespace {
  ns: Namespace;
  records: MemoryRecord[];
}

/**
 * WRITE authorization (§6.2). Returns the namespace to write; throws a plain
 * `Error` naming the target and the reason on denial (fail-closed).
 */
function authorizeWrite(
  policy: AgentPolicy,
  target: string,
  lookup: (name: string) => AgentPolicy | undefined,
): Namespace {
  if (target === "self") return { kind: "agent", name: policy.name };

  if (target === "global") {
    if (!policy.hasGlobalAccess) {
      throw new Error(`core_memory store: agent '${policy.name}' cannot write to 'global': no global access`);
    }
    return { kind: "global" };
  }

  if (target.startsWith("agent:")) {
    const other = target.slice("agent:".length);
    if (other === policy.name) return { kind: "agent", name: policy.name };
    const otherPolicy = lookup(other);
    if (!otherPolicy) {
      throw new Error(
        `core_memory store: agent '${policy.name}' cannot write to '${target}': ` +
          `cross-agent write not allowed (target agent is not configured)`,
      );
    }
    if (otherPolicy.private) {
      throw new Error(
        `core_memory store: agent '${policy.name}' cannot write to '${target}': ` +
          `target is private — cross-agent write not allowed`,
      );
    }
    throw new Error(
      `core_memory store: agent '${policy.name}' cannot write to '${target}': ` +
        `cross-agent write not allowed (another agent's space is never writable)`,
    );
  }

  throw new Error(`core_memory store: unknown target '${target}'`);
}

/**
 * READ authorization (§6.1). Returns the namespaces actually consulted.
 * A cross-namespace read into a PRIVATE target is omitted, not errored (§7.2).
 */
function authorizeRead(
  policy: AgentPolicy,
  from: string | null,
  policies: AgentPolicy[],
  lookup: (name: string) => AgentPolicy | undefined,
): Namespace[] {
  const namespaces: Namespace[] = [];
  const seen = new Set<string>();
  const add = (ns: Namespace): void => {
    const label = nsLabel(ns);
    if (!seen.has(label)) {
      seen.add(label);
      namespaces.push(ns);
    }
  };

  if (from === null || from === "self") {
    // Default (`from` omitted): the union of all permitted READ namespaces.
    add({ kind: "agent", name: policy.name });
    if (from === "self") return namespaces;
    if (policy.hasGlobalAccess) add({ kind: "global" });
    for (const other of policies) {
      if (other.name !== policy.name && other.private === false) {
        add({ kind: "agent", name: other.name });
      }
    }
    return namespaces;
  }

  if (from === "global") {
    if (policy.hasGlobalAccess) add({ kind: "global" });
    return namespaces;
  }

  if (from.startsWith("agent:")) {
    const other = from.slice("agent:".length);
    if (other === policy.name) {
      add({ kind: "agent", name: policy.name });
      return namespaces;
    }
    const otherPolicy = lookup(other);
    if (otherPolicy && otherPolicy.private === false) add({ kind: "agent", name: other });
    return namespaces;
  }

  return namespaces;
}

// ---------------------------------------------------------------------------
// Engine (§7.2)
// ---------------------------------------------------------------------------

/**
 * Builds the engine. Config is loaded + validated HERE, at init, before any
 * read or write (§6.4) — an invalid row throws `InvalidConfigurationError`.
 */
export function createEngine(options: EngineOptions = {}): Engine {
  const root = resolveDataRoot(options);
  const configPath = resolveConfigPath(options, root);
  const policies = loadPolicies(existsSync(configPath) ? configPath : null);

  const policyByName = new Map<string, AgentPolicy>();
  for (const policy of policies) policyByName.set(policy.name, policy);
  const lookup = (name: string): AgentPolicy | undefined => policyByName.get(name);

  // D4 seams. `options.embedder` wins; otherwise the real bge-small embedder
  // (fail-closed when the runtime is absent — never a silent hash-ngram
  // fallback, D1). The reranker is OFF unless `options.reranker` is injected or
  // `CORE_BRAIN_RERANKER=ms-marco` opts in (C1/D7).
  const active: Embedder =
    options.embedder ??
    createConfiguredEmbedder({ profile: readEmbedModel(existsSync(configPath) ? configPath : null) });
  const reranker: Reranker | undefined =
    options.reranker ?? (resolveRerankerName() === "off" ? undefined : createMsMarcoReranker());

  /**
   * Resolves an agent's policy. A configured agent keeps its policy; an agent
   * absent from `config.json` gets the synthesized default (never throws).
   * Exposed to the plugin as `Engine.resolvePolicy` (Fatia 2, CONTRACT §9.1):
   * the automatic layer reads the `inject` opt-in from here, never from the
   * caller.
   */
  function requirePolicy(agentName: string): AgentPolicy {
    return (
      policyByName.get(agentName) ?? {
        name: agentName,
        private: DEFAULT_POLICY.private,
        hasGlobalAccess: DEFAULT_POLICY.hasGlobalAccess,
        inject: DEFAULT_POLICY.inject,
      }
    );
  }

  function whoOp(policy: AgentPolicy): WhoResult {
    return {
      agent: policy.name,
      name: policy.name,
      private: policy.private,
      hasGlobalAccess: policy.hasGlobalAccess,
      dataDir: root,
    };
  }

  async function storeOp(policy: AgentPolicy, request: StoreRequest): Promise<StoreResult> {
    if (typeof request.text !== "string" || request.text.trim() === "") {
      throw new Error("core_memory store: 'text' must be a non-empty string");
    }
    // A memory is a rule, not a page (USER, 2026-11-19). Refusing is the point: the
    // agent gets the number back, summarises, and sends again — truncating here would
    // keep the first half of a thought and lose the half that mattered.
    const maxChars = readMemoryMaxChars(existsSync(configPath) ? configPath : null);
    const length = [...request.text].length;
    if (length > maxChars) {
      throw new Error(
        `core_memory store: 'text' has ${length} characters, the limit is ${maxChars} ` +
          `('memoryMaxChars' in the config) — summarise it and send again (cut at least ${length - maxChars})`,
      );
    }
    // The quality gate: a stub today (always true), Laya's verdict tomorrow — same door.
    if (!memoryIsAcceptable(request.text)) {
      throw new Error(
        "core_memory store: the memory was refused by the quality evaluator — rewrite it or drop it",
      );
    }
    const target: string = typeof request.target === "string" ? request.target : "self";
    const ns = authorizeWrite(policy, target, lookup);

    const now = new Date().toISOString();
    const record: MemoryRecord = {
      id: randomUUID(),
      agent: ns.kind === "global" ? "global" : policy.name,
      scope: ns.kind === "global" ? "global" : "agent",
      text: request.text,
      meta: request.meta ?? {},
      createdAt: now,
      updatedAt: now,
      score: MEMORY_START_SCORE,
      real: request.meta?.dreamed === true ? false : true,
    };

    // Embed BEFORE writing: a failing embedder must not leave a record without
    // a vector (fail-closed, D1) — the store is atomic on success.
    const vector = await active.embed(record.text);

    const recordsFile = recordsFileFor(root, ns);
    const records = readRecords(recordsFile);
    records.push(record);
    writeFileAtomic(recordsFile, records);

    const vectorsFile = vectorsFileFor(root, ns);
    const vectors = readVectors(vectorsFile, active);
    vectors[record.id] = vector;
    writeVectors(vectorsFile, vectors, active);

    return { ok: true, id: record.id, scope: record.scope, ns: nsLabel(ns) };
  }

  async function recallOp(policy: AgentPolicy, request: RecallRequest): Promise<RecallResult> {
    const requestedLimit = request.limit;
    const limit =
      typeof requestedLimit === "number" && Number.isInteger(requestedLimit) && requestedLimit > 0
        ? requestedLimit
        : DEFAULT_RECALL_LIMIT;

    const from: string | null = typeof request.from === "string" ? request.from : null;
    const requested = authorizeRead(policy, from, policies, lookup);
    const scanned = requested.map(nsLabel);

    const query =
      typeof request.query === "string" && request.query.trim() !== "" ? request.query : null;

    // The corpus of BOTH legs is exactly the readable namespaces' active records
    // (D6/AC5): the hybrid path never widens the read set.
    const buckets = new Map<string, ScannedNamespace>();
    const byId = new Map<string, { label: string; record: MemoryRecord }>();
    const corpus: (MemoryRecord & { vector?: number[] })[] = [];

    for (const ns of requested) {
      const label = nsLabel(ns);
      const records = readRecords(recordsFileFor(root, ns));
      buckets.set(label, { ns, records });

      // SQLite backend (USER, 2026-11-20): the vectors come from the database, cached in memory —
      // no header to compare, because the table has no embedder stamp. The JSON path keeps the D5
      // staleness rule unchanged.
      let vectors: Record<string, number[]>;
      if (sqliteEnabled()) {
        vectors = readVectorsFromDb(vectorsFileFor(root, ns)) ?? {};
      } else {
        const { header, vectors: fromJson } = readIndexFile(vectorsFileFor(root, ns));
        if (records.length > 0 && !indexMatches(header, active)) {
          throw new StaleIndexError(staleIndexMessage(label, header, active));
        }
        vectors = fromJson;
      }

      for (const record of records) {
        if (typeof record.retiredAt === "string") continue;
        const vector = vectors[record.id];
        corpus.push({ ...record, vector: Array.isArray(vector) ? vector : undefined });
        byId.set(String(record.id), { label, record });
      }
    }

    let ranked: {
      id: string;
      score: number;
      rrf: number;
      legs: { bm25: number | null; vector: number | null };
    }[];
    let mode: RecallMode;
    let reranked: number;

    if (query === null) {
      // Query-less recall keeps the v1 behaviour (D6): no legs, ranked by the
      // existing tie-break. CONTRACT §8.3 forbids labelling it `bm25-only`, so
      // it reports `hybrid` with zero legs and `reranked: 0`.
      const candidates = [...byId.values()].map((entry) => {
        const parsedUpdatedAt = Date.parse(String(entry.record.updatedAt));
        return { entry, updatedAt: Number.isFinite(parsedUpdatedAt) ? parsedUpdatedAt : 0 };
      });
      candidates.sort(
        (a, b) =>
          (b.entry.record.feedback?.useful ?? 0) - (a.entry.record.feedback?.useful ?? 0) ||
          (Number(b.entry.record.score) || 0) - (Number(a.entry.record.score) || 0) ||
          b.updatedAt - a.updatedAt,
      );
      ranked = candidates.slice(0, limit).map(({ entry }) => ({
        id: String(entry.record.id),
        score: 0,
        rrf: 0,
        legs: { bm25: null, vector: null },
      }));
      mode = "hybrid";
      reranked = 0;
    } else {
      // AC5 (store-side): `feedback` is a STORE ranking signal — the engine
      // stays pure. Two records with the same text score the same in both legs,
      // yet a leg still gives the first one a better *rank* (position), so the
      // fused `rrf` differs; a post-hoc tie-break alone can never reach them.
      // Feeding the legs a feedback-ordered corpus lets the signal decide that
      // leg-position tie, and the final order below keeps `rrf` first.
      const legCorpus = corpus
        .slice()
        .sort(
          (a, b) =>
            (Number(b.feedback?.useful) || 0) - (Number(a.feedback?.useful) || 0),
        );

      // R9: `searchHybrid` is the ONE ranking implementation (D6/D7).
      const result = await searchHybrid(legCorpus, query, limit, { embedder: active, reranker });

      // With the reranker ON, `searchHybrid` already returns the hits in the
      // reranker's order — that order is the authority and must be preserved
      // exactly (no re-ordering here). The RRF-based final order below applies
      // only when the reranker is OFF (`reranked === 0`, D6/D7).
      // Final order: `rrf` desc; on an `rrf` tie the feedback signal wins, then
      // the raw cosine desc, then `id` asc (the engine's own tie-break).
      const ordered =
        result.reranked > 0
          ? result.hits
          : result.hits.slice().sort((a, b) => {
              if (b.rrf !== a.rrf) return b.rrf - a.rrf;
              const feedbackA = Number(a.record.feedback?.useful) || 0;
              const feedbackB = Number(b.record.feedback?.useful) || 0;
              if (feedbackA !== feedbackB) return feedbackB - feedbackA;
              const cosineA = a.legs.vector === null ? Number.NEGATIVE_INFINITY : a.legs.vector;
              const cosineB = b.legs.vector === null ? Number.NEGATIVE_INFINITY : b.legs.vector;
              if (cosineA !== cosineB) return cosineB - cosineA;
              return a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0;
            });

      ranked = ordered.map((hit) => ({
        id: String(hit.record.id),
        score: hit.score,
        rrf: hit.rrf,
        legs: hit.legs,
      }));
      mode = result.mode;
      reranked = result.reranked;
    }

    // A read that counts as a use. The automatic context injection reads with
    // `countRetrievals: false`: it was inflating the very ranking it is ranked
    // by, so the same five memories won every session forever (2026-11-19).
    const countRetrievals = request.countRetrievals !== false;
    const dirty = new Set<string>();
    const results: RecallHit[] = [];
    for (const hit of ranked) {
      const found = byId.get(hit.id);
      if (!found) continue;
      if (countRetrievals) {
        found.record.score = (Number(found.record.score) || 0) + 1;
        dirty.add(found.label);
      }
      results.push({
        id: found.record.id,
        text: found.record.text,
        agent: typeof found.record.agent === "string" ? found.record.agent : found.label,
        scope: found.record.scope === "global" ? "global" : "agent",
        score: Number(hit.score.toFixed(6)),
        rrf: Number(hit.rrf.toFixed(6)),
        legs: hit.legs,
        score: Number(found.record.score) || 0,
        ...(found.record.meta && Object.keys(found.record.meta).length > 0
          ? { meta: found.record.meta }
          : {}),
      });
    }

    for (const label of dirty) {
      const bucket = buckets.get(label);
      if (bucket) writeFileAtomic(recordsFileFor(root, bucket.ns), bucket.records);
    }

    return { results, scanned, mode, reranked };
  }

  async function forgetOp(policy: AgentPolicy, request: ForgetRequest): Promise<ForgetResult> {
    const target: string = typeof request.target === "string" ? request.target : "self";
    const ns = authorizeWrite(policy, target, lookup);

    const recordsFile = recordsFileFor(root, ns);
    const records = readRecords(recordsFile);

    let matches: MemoryRecord[];
    if (typeof request.id === "string" && request.id.trim() !== "") {
      const found = records.find((record) => record.id === request.id);
      matches = found ? [found] : [];
    } else if (typeof request.query === "string" && request.query.trim() !== "") {
      const vectors = readVectors(vectorsFileFor(root, ns), active);
      const queryVector = await active.embed(request.query);
      matches = records.filter((record) => {
        if (typeof record.retiredAt === "string") return false;
        const vector = vectors[record.id];
        return Array.isArray(vector) ? cosine(queryVector, vector) >= FORGET_MATCH_THRESHOLD : false;
      });
    } else {
      throw new Error("core_memory forget: provide 'id' or 'query'");
    }

    const now = new Date().toISOString();
    const retired: string[] = [];
    for (const record of matches) {
      if (typeof record.retiredAt !== "string") {
        record.retiredAt = now;
        retired.push(record.id);
      }
    }

    if (retired.length > 0) writeFileAtomic(recordsFile, records);

    return { ok: true, retired };
  }

  function feedbackOp(policy: AgentPolicy, request: FeedbackRequest): FeedbackResult {
    const id = request.id;

    // The record must be readable by the caller (§6.1): the full readable union.
    const readable = authorizeRead(policy, null, policies, lookup);

    let foundNamespace: Namespace | null = null;
    let foundRecords: MemoryRecord[] | null = null;
    for (const ns of readable) {
      const records = readRecords(recordsFileFor(root, ns));
      if (records.some((record) => record.id === id)) {
        foundNamespace = ns;
        foundRecords = records;
        break;
      }
    }

    if (!foundNamespace || !foundRecords) {
      throw new Error(
        `core_memory feedback: agent '${policy.name}' cannot give feedback on record '${id}': ` +
          `the record is not readable by '${policy.name}' (private namespace or unknown id)`,
      );
    }

    const record = foundRecords.find((candidate) => candidate.id === id);
    if (!record) {
      throw new Error(
        `core_memory feedback: agent '${policy.name}' cannot give feedback on record '${id}': ` +
          `the record is not readable by '${policy.name}' (private namespace or unknown id)`,
      );
    }

    // Count the signal. `updatedAt` and `score` are left untouched — they
    // are ranking keys, and mutating them would corrupt the tie-break (§5).
    record.feedback = {
      useful: (record.feedback?.useful ?? 0) + (request.useful ? 1 : 0),
      useless: (record.feedback?.useless ?? 0) + (request.useful ? 0 : 1),
    };

    writeFileAtomic(recordsFileFor(root, foundNamespace), foundRecords);

    return {
      ok: true,
      id,
      usefulness: { useful: record.feedback.useful, useless: record.feedback.useless },
    };
  }

  /**
   * `episode` (§10.2/§10.3, T2): append one episodic record to the caller's own
   * space (default) or to `global` when it has global access. The owner
   * (`agent`) is ALWAYS the caller's SESSION identity — a request field named
   * `agent` is not an input and is ignored (the forged owner never changes the
   * diary). `agent:<X>` is not a valid episode target (§10.2).
   */
  async function episodeOp(policy: AgentPolicy, request: EpisodeRequest): Promise<EpisodeResult> {
    if (typeof request.summary !== "string" || request.summary.trim() === "") {
      throw new Error("core_memory episode: 'summary' must be a non-empty string");
    }
    const target: string = typeof request.target === "string" ? request.target : "self";
    if (target !== "self" && target !== "global") {
      throw new Error(
        `core_memory episode: 'target' must be 'self' or 'global' (got '${target}')`,
      );
    }
    const ns = authorizeWrite(policy, target, lookup);

    const episode: Episode = {
      id: newEpisodeId(),
      at: new Date().toISOString(),
      agent: policy.name,
      summary: request.summary,
    };
    if (Array.isArray(request.tags)) episode.tags = request.tags.slice();
    if (typeof request.sessionId === "string" && request.sessionId !== "") {
      episode.sessionId = request.sessionId;
    }

    const episodesFile = episodesFileFor(root, ns);
    const episodes = readEpisodes(episodesFile);
    episodes.push(episode);
    writeFileAtomic(episodesFile, episodes);

    return { ok: true, id: episode.id, ns: nsLabel(ns) };
  }

  /**
   * `timeline` (§10.2/§10.6, T5): read episodes over the SAME readable union as
   * a query-less `recall` — the identical `authorizeRead`, no exception. A blank
   * query returns the diary most-recent-first (`at` desc); a query ranks by the
   * Fatia 1 hybrid engine (search by meaning, AC-TL4) over exactly the readable
   * episodes.
   */
  async function timelineOp(policy: AgentPolicy, request: TimelineRequest): Promise<TimelineResult> {
    const from: string | null = typeof request.from === "string" ? request.from : null;
    const requested = authorizeRead(policy, from, policies, lookup);
    const scanned = requested.map(nsLabel);

    const limit =
      typeof request.limit === "number" && Number.isInteger(request.limit) && request.limit > 0
        ? request.limit
        : DEFAULT_TIMELINE_LIMIT;

    const sinceMs =
      typeof request.since === "string" && request.since.trim() !== ""
        ? Date.parse(request.since)
        : null;
    const untilMs =
      typeof request.until === "string" && request.until.trim() !== ""
        ? Date.parse(request.until)
        : null;
    const tagFilter = Array.isArray(request.tags)
      ? request.tags.filter((tag): tag is string => typeof tag === "string" && tag !== "")
      : null;

    // The corpus is exactly the readable namespaces' episodes (AC5 §10.6): the
    // read path never widens the read set — same rule as recall.
    const episodes: Episode[] = [];
    for (const ns of requested) {
      for (const episode of readEpisodes(episodesFileFor(root, ns))) {
        if (!episode || typeof episode !== "object") continue;
        if (sinceMs !== null) {
          const at = Date.parse(String(episode.at));
          if (!Number.isFinite(at) || at < sinceMs) continue;
        }
        if (untilMs !== null) {
          const at = Date.parse(String(episode.at));
          if (!Number.isFinite(at) || at > untilMs) continue;
        }
        if (tagFilter !== null && tagFilter.length > 0) {
          const tags = Array.isArray(episode.tags) ? episode.tags : [];
          if (!tagFilter.some((tag) => tags.includes(tag))) continue;
        }
        episodes.push(episode);
      }
    }

    const query =
      typeof request.query === "string" && request.query.trim() !== "" ? request.query : null;

    if (query === null) {
      // Query-less timeline is most-recent-first (`at` desc), per §10.2.
      const sorted = episodes
        .slice()
        .sort((a, b) => (String(a.at) < String(b.at) ? 1 : String(a.at) > String(b.at) ? -1 : 0));
      return { results: sorted.slice(0, limit), scanned };
    }

    // §10.2/§10.7 (AC-TL4): search by meaning with the ONE ranking engine (R9),
    // exactly as `recall` does. Episodes carry no vector index, so the engine
    // embeds `recordSearchText` from `summary` (+ `tags` meta) for each one.
    const corpus: (SearchRecord & { episode: Episode })[] = episodes.map((episode) => ({
      id: episode.id,
      text: episode.summary,
      meta: episode.tags ? { tags: episode.tags } : undefined,
      episode,
    }));
    const result = await searchHybrid(corpus, query, limit, { embedder: active, reranker });
    return { results: result.hits.map((hit) => hit.record.episode), scanned };
  }

  /**
   * The text a duplicate check compares: trimmed, whitespace collapsed, case folded. Two promotions
   * of the same conclusion differ in spacing or case, never in meaning, so the key ignores both.
   * One home for the policy: `normalizeMemoryTextKey`.
   */
  const normalizeMemoryText = normalizeMemoryTextKey;

  /** `DR-<epoch ms>-<4 chars>` — the same readable shape the episodes use. */
  function dreamId(): string {
    return `DR-${Date.now()}-${randomUUID().slice(0, 4)}`;
  }

  /**
   * `dream` (USER, 2026-11-19): episodes in, memories out.
   *
   * <p>With no payload it LISTS the episodes still waiting — those without `dreamedAt`, oldest
   * first. With `episodeIds` and `memories` it performs the pass: every memory is stored with
   * `meta.derivedFrom` (the first episode) and `meta.dreams` (this dream, with its DATE), each
   * episode is marked `dreamedAt` and gains the new ids in `engramIds`, and one dream record links
   * both sides. Nothing is written unless the whole pass is valid: an unknown episode, an already
   * dreamed episode or a duplicate memory refuses the call BEFORE the first write.
   */
  async function dreamOp(policy: AgentPolicy, request: DreamRequest): Promise<DreamResult> {
    const own = authorizeWrite(policy, "self", lookup);
    const episodesFile = episodesFileFor(root, own);
    const episodes = readEpisodes(episodesFile);

    const ids = Array.isArray(request.episodeIds) ? request.episodeIds.filter((id) => typeof id === "string") : [];
    const wanted = Array.isArray(request.memories) ? request.memories : [];

    // Listing mode: nothing to write, just what is waiting.
    if (ids.length === 0 && wanted.length === 0) {
      const waiting = episodes
        .filter((episode) => typeof episode.dreamedAt !== "string")
        .sort((a, b) => String(a.at).localeCompare(String(b.at)));
      return {
        ok: true,
        episodes: waiting,
        dreamsEnabled: readDreamsEnabled(existsSync(configPath) ? configPath : null),
        idleHoursRequired: readDreamIdleHours(existsSync(configPath) ? configPath : null),
        episodesPerPass: readDreamEpisodesPerPass(existsSync(configPath) ? configPath : null),
      };
    }

    // The switch, before anything is written (USER, 2026-11-22): with `dreams` off the pass is
    // refused whole — the episodes stay waiting and nothing is marked, no matter who calls.
    if (ids.length === 0 || wanted.length === 0) {
      const message = "core_memory dream: pass 'episodeIds' AND 'memories', or neither (listing)";
      appendDreamLog(root, `ERROR ${message}`);
      throw new Error(message);
    }
    if (!readDreamsEnabled(existsSync(configPath) ? configPath : null)) {
      const message =
        "core_memory dream: dreaming is disabled — set \"dreams\": true in the config to enable it " +
        "(the feature is experimental and spends tokens)";
      appendDreamLog(root, `ERROR ${message}`);
      throw new Error(message);
    }
    for (const memory of wanted) {
      if (typeof memory?.text !== "string" || memory.text.trim() === "") {
        throw new Error("core_memory dream: every memory needs a non-empty 'text'");
      }
    }

    const selected: Episode[] = [];
    for (const id of ids) {
      const episode = episodes.find((candidate) => String(candidate.id) === id);
      if (!episode) {
        const message = `core_memory dream: unknown episode '${id}' in '${nsLabel(own)}'`;
        appendDreamLog(root, `ERROR ${message}`);
        throw new Error(message);
      }
      if (typeof episode.dreamedAt === "string") {
        const message =
          `core_memory dream: episode '${id}' was already dreamed at ${episode.dreamedAt} — ` +
          "a dreamed episode is never proposed again";
        appendDreamLog(root, `ERROR ${message}`);
        throw new Error(message);
      }
      selected.push(episode);
    }

    // A duplicate is not an error and not a second record: it REINFORCES the memory that already
    // says it (USER, 2026-11-19) — the dream is added to its list, its counters go up, and the
    // episode is still marked as dreamed. Only a retired memory is out of the way.
    const perPass = readDreamEpisodesPerPass(existsSync(configPath) ? configPath : null);
    if (perPass > 0 && ids.length > perPass) {
      const message =
        `core_memory dream: ${ids.length} episodes in one pass — the config allows ${perPass} ` +
        "('dreamEpisodesPerPass'); split it";
      appendDreamLog(root, `ERROR ${message}`);
      throw new Error(message);
    }

    const allRecords = readRecords(recordsFileFor(root, own));
    const activeRecords = allRecords.filter((record) => typeof record.retiredAt !== "string");

    // Daily ceiling (USER, 2026-11-19): consolidation is not a treadmill.
    const perDay = readDreamPerDay(existsSync(configPath) ? configPath : null);
    const today = new Date().toISOString().slice(0, 10);
    const dreamsSoFar = readDreams(dreamsFileFor(root, own)).filter((d) => String(d.at).slice(0, 10) === today);
    if (request.force !== true && (perDay === 0 || dreamsSoFar.length >= perDay)) {
      const message =
        `core_memory dream: daily limit reached (${dreamsSoFar.length}/${perDay} today) — ` +
        "pass force:true only for a deliberate manual run";
      appendDreamLog(root, `ERROR ${message}`);
      throw new Error(message);
    }

    const dream = dreamId();
    const at = new Date().toISOString();
    appendDreamLog(root, `START ${dream} episodes=${selected.length} memories=${wanted.length}`);
    startDreamRun(root, { id: dream, namespace: nsLabel(own), startedAt: at });
    const created: string[] = [];
    const reinforced: string[] = [];
    let joined = 0;
    const pending: Array<(typeof wanted)[number]> = [];

    // Pass 1 — the EXACT twin. A duplicate is not an error and not a second record: it REINFORCES
    // the memory that already says it (USER, 2026-11-19) — the dream is added to its list, its
    // counters go up, and the episode is still marked as dreamed. Only a retired memory is out of
    // the way. This runs BEFORE the stores below on purpose: writing `allRecords` afterwards would
    // clobber every record those stores had just appended.
    for (const memory of wanted) {
      const key = normalizeMemoryText(memory.text);
      const clash = activeRecords.find((record) => normalizeMemoryText(record.text) === key);
      if (!clash) {
        pending.push(memory);
        continue;
      }
      clash.score = (clash.score ?? 0) + 1;
      const feedback = clash.feedback ?? { useful: 0, useless: 0 };
      clash.feedback = { useful: (feedback.useful ?? 0) + 1, useless: feedback.useless ?? 0 };
      const dreams = Array.isArray(clash.meta?.dreams) ? (clash.meta?.dreams as unknown[]) : [];
      clash.meta = { ...(clash.meta ?? {}), dreams: [...dreams, { id: dream, at }] };
      clash.updatedAt = at;
      reinforced.push(clash.id);
    }
    if (reinforced.length > 0) writeFileAtomic(recordsFileFor(root, own), allRecords);

    // Pass 2 — store what has no twin at all.
    for (const memory of pending) {
      const meta: Record<string, unknown> = {
        ...(memory.meta ?? {}),
        derivedFrom: selected[0].id,
        dreams: [{ id: dream, at }],
      };
      const stored = await storeOp(policy, { op: "store", text: memory.text, target: "self", meta });
      created.push(stored.id);
    }

    // Pass 3 — the MEANING sweep (USER, 2026-11-20). Everything that says the same thing in other
    // words is ONE memory — whether it was written a second ago in this pass or a month ago. The
    // sweep IS the maintenance pass (`admin dedupe`, semantic mode) so the rule keeps one home;
    // every pair it joins is queued in `dream_memories`, carrying this dream's id, for the review
    // that closes the dream.
    const sweep = await adminOp(policy, {
      op: "admin",
      action: "dedupe",
      args: { apply: true, mode: "semantic", ns: nsLabel(own), dreamId: dream },
    });
    for (const group of sweep.groups ?? []) {
      joined += 1;
      if (!reinforced.includes(group.kept)) reinforced.push(group.kept);
      for (const retiredId of group.retired) {
        const index = created.indexOf(retiredId);
        if (index >= 0) created.splice(index, 1);
      }
    }

    for (const episode of selected) {
      episode.dreamedAt = at;
      const engramIds = Array.isArray(episode.engramIds) ? episode.engramIds : [];
      episode.engramIds = [
        ...engramIds,
        ...[...created, ...reinforced].filter((id) => !engramIds.includes(id)),
      ];
    }
    writeFileAtomic(episodesFile, episodes);

    const dreamsFile = dreamsFileFor(root, own);
    const dreams = readDreams(dreamsFile);
    const record: DreamRecord = {
      id: dream,
      at,
      episodes: selected.map((e) => e.id),
      memories: created,
      ...(reinforced.length > 0 ? { reinforced } : {}),
    };
    dreams.push(record);
    writeFileAtomic(dreamsFile, dreams);

    // The night's accounting, at the END (USER, 2026-11-20): one point from every memory, then
    // everything at zero is retired, then the retired rows leave the live table for the history.
    // A night that failed changed nothing before this point, and this point still runs.
    const decayed = decayScores(root);
    const exhausted = retireExhausted(root);
    const archived = archiveRetiredMemories(root);
    appendDreamLog(
      root,
      `END ${dream} memories=${created.join(",") || "-"} reinforced=${reinforced.join(",") || "-"} ` +
        `decayed=${decayed} retired_at_zero=${exhausted} archived=${archived}`,
    );
    // The similar memories the night worked on, as the USER asked (2026-11-20): a memory may have
    // more than one neighbour, so this is a list, never a pair.
    const similar = [...new Set((sweep.groups ?? []).flatMap((group) => [group.kept, ...group.retired]))];
    finishDreamRun(root, dream, {
      status: "done",
      finishedAt: new Date().toISOString(),
      episodes: selected.length,
      created: created.length,
      reinforced: reinforced.length,
      merged: joined,
      pending: joined,
      similar,
    });
    return {
      ok: true,
      dreamId: dream,
      memories: created,
      ...(reinforced.length > 0 ? { reinforced } : {}),
      ...(archived > 0 ? { archived } : {}),
    };
  }

  /**
   * Namespaces present on disk: always the shared global space, plus one agent
   * space per directory under `<root>/agents` whose name is filename-safe (§4).
   * A missing or unreadable agents directory yields only the global space — it
   * never throws.
   */
  function activeNamespaces(): Namespace[] {
    const namespaces: Namespace[] = [{ kind: "global" }];
    const seen = new Set<string>();
    const add = (name: string): void => {
      if (!AGENT_NAME_PATTERN.test(name) || seen.has(name)) return;
      seen.add(name);
      namespaces.push({ kind: "agent", name });
    };

    // The SQLite backend keeps the memories, not the directories (2026-11-20): a space exists when a
    // record does. The JSON files stay authoritative for the JSON backend.
    for (const label of namespacesInDb(root)) {
      if (label.startsWith("agent:")) add(label.slice("agent:".length));
    }
    try {
      for (const entry of readdirSync(join(root, "agents"), { withFileTypes: true })) {
        if (entry.isDirectory()) add(entry.name);
      }
    } catch {
      // Missing or unreadable agents directory: the database already answered.
    }
    return namespaces;
  }

  /**
   * `status` (§7.2): per-namespace record/retired/retrieval counts. Counts only
   * — memory text is never returned. An optional `ns` filters to the single
   * namespace whose `nsLabel` equals it; an unknown label yields an empty
   * `namespaces` array (never throws).
   */
  function statusOp(request: Extract<CoreMemoryRequest, { op: "status" }>): StatusResult {
    const requested = typeof request.ns === "string" && request.ns !== "" ? request.ns : null;

    const namespaces: StatusResult["namespaces"] = [];
    let totalRecords = 0;
    let totalRetired = 0;
    let totalRetrievals = 0;

    for (const ns of activeNamespaces()) {
      const label = nsLabel(ns);
      if (requested !== null && label !== requested) continue;

      const records = readRecords(recordsFileFor(root, ns));
      let retired = 0;
      let score = 0;
      for (const record of records) {
        if (typeof record.retiredAt === "string") retired += 1;
        score += Number(record.score) || 0;
      }

      namespaces.push({ ns: label, records: records.length, retired, score });
      totalRecords += records.length;
      totalRetired += retired;
      totalRetrievals += score;
    }

    return {
      storageRoot: root,
      configPath,
      embedder: active.id,
      dim: active.dim,
      namespaces,
      totals: { records: totalRecords, retired: totalRetired, score: totalRetrievals },
    };
  }

  /**
   * `receipt` (§3 row 9): per-namespace throughput — stored, retrieved and hit
   * counts. Read-only, counts only; memory text is never returned. An optional
   * `ns` filters to the exact `nsLabel` (an unknown label yields an empty
   * `byNamespace`, never throws); an optional positive integer `days` counts
   * only records created within the last N days (unparseable dates excluded).
   */
  function receiptOp(request: Extract<CoreMemoryRequest, { op: "receipt" }>): ReceiptResult {
    const requestedNs = typeof request.ns === "string" && request.ns !== "" ? request.ns : null;
    const requestedDays =
      typeof request.days === "number" && Number.isInteger(request.days) && request.days > 0
        ? request.days
        : null;
    const cutoffMs = requestedDays === null ? null : Date.now() - requestedDays * 86_400_000;

    const byNamespace: ReceiptResult["byNamespace"] = [];
    let totalStored = 0;
    let totalRetrieved = 0;
    let totalHits = 0;

    for (const ns of activeNamespaces()) {
      const label = nsLabel(ns);
      if (requestedNs !== null && label !== requestedNs) continue;

      const records = readRecords(recordsFileFor(root, ns));
      let stored = 0;
      let retrieved = 0;
      let hits = 0;
      for (const record of records) {
        // `days`: keep only records created within the last N days; unparseable
        // dates (createdAt, falling back to updatedAt) are excluded.
        if (cutoffMs !== null) {
          const created = Date.parse(record.createdAt);
          const dateMs = Number.isFinite(created) ? created : Date.parse(record.updatedAt);
          if (!Number.isFinite(dateMs) || dateMs < cutoffMs) continue;
        }
        stored += 1;
        const score = Number(record.score) || 0;
        retrieved += score;
        if (score > 0) hits += 1;
      }

      byNamespace.push({ ns: label, stored, retrieved, hits });
      totalStored += stored;
      totalRetrieved += retrieved;
      totalHits += hits;
    }

    return { stored: totalStored, retrieved: totalRetrieved, hits: totalHits, byNamespace };
  }

  /**
   * The raw `vectors` map of a namespace's index file, read WITHOUT the
   * embedder/dim filter that `readVectors` applies (so the pairing and
   * dimension checks still see ids that `readVectors` would hide). A missing,
   * empty, or unparsable index file yields an empty map.
   */
  function readRawVectors(ns: Namespace): Record<string, number[]> {
    const file = vectorsFileFor(root, ns);
    if (!existsSync(file)) return {};
    let parsed: unknown;
    try {
      parsed = readJsonOrNull(file);
    } catch {
      return {};
    }
    if (parsed === null || typeof parsed !== "object") return {};
    const rawVectors = (parsed as { vectors?: unknown }).vectors;
    return rawVectors && typeof rawVectors === "object"
      ? (rawVectors as Record<string, number[]>)
      : {};
  }

  /** `doctor` check 1 — no public agent row that lacks global access. */
  function configRowsCheck(): DoctorCheck {
    const id = "config-rows";
    if (!existsSync(configPath)) {
      return { id, ok: true, detail: "no config file — default policy applies" };
    }
    let parsed: unknown;
    try {
      parsed = readJsonOrNull(configPath);
    } catch (error) {
      return {
        id,
        ok: false,
        detail: `config file is not valid JSON: ${String((error as Error).message)}`,
      };
    }
    if (parsed === null || typeof parsed !== "object") {
      return { id, ok: true, detail: "no agents configured" };
    }
    const agents = (parsed as { agents?: unknown }).agents;
    if (!Array.isArray(agents)) {
      return { id, ok: true, detail: "no agents configured" };
    }
    const badRows: string[] = [];
    for (const entry of agents) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as { name?: unknown; private?: unknown; hasGlobalAccess?: unknown };
      if (row.private === false && row.hasGlobalAccess === false) {
        badRows.push(`agent '${String(row.name)}' (private:false + hasGlobalAccess:false)`);
      }
    }
    if (badRows.length > 0) {
      return { id, ok: false, detail: `invalid config row(s): ${badRows.join("; ")}` };
    }
    return { id, ok: true, detail: `${agents.length} agent row(s) valid` };
  }

  /** `doctor` check 2 — every present index declares the active embedder + dim + revision. */
  function embedderDimCheck(): DoctorCheck {
    const id = "embedder-dim";
    const problems: string[] = [];
    for (const ns of activeNamespaces()) {
      const label = nsLabel(ns);
      const file = vectorsFileFor(root, ns);
      if (!existsSync(file)) continue; // no index file -> skip the namespace
      let parsed: unknown;
      try {
        parsed = readJsonOrNull(file);
      } catch (error) {
        problems.push(`${label}: index unparsable (${String((error as Error).message)})`);
        continue;
      }
      if (parsed === null || typeof parsed !== "object") continue; // empty index -> skip
      const index = parsed as { embedder?: unknown; dim?: unknown; revision?: unknown };
      if (
        index.embedder !== active.id ||
        index.dim !== active.dim ||
        index.revision !== active.revision
      ) {
        problems.push(
          `${label}: embedder='${String(index.embedder)}' (expected '${active.id}')` +
            `, dim='${String(index.dim)}' (expected ${active.dim})` +
            `, revision='${String(index.revision)}' (expected '${active.revision}')`,
        );
      }
    }
    if (problems.length > 0) return { id, ok: false, detail: problems.join("; ") };
    return { id, ok: true, detail: "all index files match the active embedder, dim and revision" };
  }

  /** `doctor` check 3 — the data root accepts a write; the probe is always removed. */
  function storeWritableCheck(): DoctorCheck {
    const id = "store-writable";
    const probePath = join(root, ".write-test");
    try {
      writeFileSync(probePath, "probe", "utf8");
      return { id, ok: true, detail: `data root '${root}' is writable` };
    } catch (error) {
      return { id, ok: false, detail: String((error as Error).message) };
    } finally {
      // Always clean the probe up, even when the write or the unlink itself fails.
      try {
        if (existsSync(probePath)) unlinkSync(probePath);
      } catch {
        // Best-effort: a leftover probe must not mask the check result.
      }
    }
  }

  /** `doctor` check 4 — every record has a vector and every vector has a record. */
  function vectorRecordPairingCheck(): DoctorCheck {
    const id = "vector-record-pairing";
    let totalOrphans = 0;
    let totalMissing = 0;
    const orphanSamples: string[] = [];
    const missingSamples: string[] = [];

    for (const ns of activeNamespaces()) {
      const label = nsLabel(ns);
      const records = readRecords(recordsFileFor(root, ns));
      const recordIds = new Set(records.map((record) => String(record.id)));
      const vectorIds = new Set(Object.keys(readRawVectors(ns)));

      const orphans = [...vectorIds].filter((vectorId) => !recordIds.has(vectorId));
      const missing = [...recordIds].filter((recordId) => !vectorIds.has(recordId));

      totalOrphans += orphans.length;
      totalMissing += missing.length;
      for (const orphan of orphans) {
        if (orphanSamples.length < 5) orphanSamples.push(`${label}:${orphan}`);
      }
      for (const missingId of missing) {
        if (missingSamples.length < 5) missingSamples.push(`${label}:${missingId}`);
      }
    }

    if (totalOrphans === 0 && totalMissing === 0) {
      return { id, ok: true, detail: "every record has a vector and every vector has a record" };
    }
    const detail =
      `${totalOrphans} orphan vector(s)` +
      `${orphanSamples.length > 0 ? ` e.g. ${orphanSamples.join(", ")}` : ""}; ` +
      `${totalMissing} record(s) without a vector` +
      `${missingSamples.length > 0 ? ` e.g. ${missingSamples.join(", ")}` : ""}`;
    return { id, ok: false, detail };
  }

  /** `doctor` check 5 — every raw vector has exactly the active embedder's dim. */
  function vectorDimensionCheck(): DoctorCheck {
    const id = "vector-dimension";
    let total = 0;
    const bad: string[] = [];
    for (const ns of activeNamespaces()) {
      const label = nsLabel(ns);
      const vectors = readRawVectors(ns);
      for (const [vectorId, vector] of Object.entries(vectors)) {
        if (Array.isArray(vector) && vector.length !== active.dim) {
          total += 1;
          if (bad.length < 5) bad.push(`${label}:${vectorId} (length ${vector.length})`);
        }
      }
    }
    if (total === 0) {
      return { id, ok: true, detail: `all vectors are ${active.dim}-dimensional` };
    }
    return {
      id,
      ok: false,
      detail: `${total} vector(s) with the wrong dimension e.g. ${bad.join(", ")}`,
    };
  }

  /**
   * `doctor` (AC6): five read-only health checks in a fixed order
   * (config-rows, embedder-dim, store-writable, vector-record-pairing,
   * vector-dimension). Top-level `ok` is true only when every check is ok.
   */
  function doctorOp(request: Extract<CoreMemoryRequest, { op: "doctor" }>): DoctorResult {
    void request; // engine-only op; the request carries no payload
    const checks: DoctorCheck[] = [
      configRowsCheck(),
      embedderDimCheck(),
      storeWritableCheck(),
      vectorRecordPairingCheck(),
      vectorDimensionCheck(),
    ];
    return { ok: checks.every((check) => check.ok), checks };
  }

  // ---------------------------------------------------------------------------
  // Dream bookkeeping surfaced by `admin` (USER, 2026-11-20): the analysis tables.
  // ---------------------------------------------------------------------------

  /** The numbers the admin surface accepts, in one place. */
  const DREAM_LIST_DEFAULT = 20;
  const DREAM_MEMORY_LIST_MAX = 100;
  const DREAM_RUN_LIST_MAX = 200;

  /** A caller's limit: a positive integer, never above `max`; otherwise the default. */
  function readLimit(raw: unknown, fallback: number, max: number): number {
    return typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? Math.min(raw, max) : fallback;
  }

  /** `dream-memories`: the pairs waiting for a verdict (or every row of one status). */
  function dreamMemoriesReport(args: Record<string, unknown> | undefined): AdminResult {
    const requested = args?.status;
    const status =
      requested === "all"
        ? null
        : requested === DREAM_MEMORY_STATUS.processed || requested === DREAM_MEMORY_STATUS.skipped
          ? requested
          : DREAM_MEMORY_STATUS.pending;
    const rows = listDreamMemories(
      root,
      status,
      readLimit(args?.limit, DREAM_LIST_DEFAULT, DREAM_MEMORY_LIST_MAX),
    );
    return {
      ok: true,
      action: "dream-memories",
      detail: `${rows.length} row(s) ${status ?? "any status"}`,
      dreamMemories: rows,
    };
  }

  /** `dream-memory`: the agent's verdict — on ONE pair (`id`) or on a whole group (`survivorId`). */
  function dreamMemoryVerdict(args: Record<string, unknown> | undefined): AdminResult {
    const id = typeof args?.id === "string" ? args.id : "";
    const survivorId = typeof args?.survivorId === "string" ? args.survivorId : "";
    if (id === "" && survivorId === "") {
      throw new Error("core-brain admin dream-memory: 'id' (a pair) or 'survivorId' (a group) is required");
    }
    const skipped = args?.skipped === true;
    const mergedText = typeof args?.mergedText === "string" ? args.mergedText.trim() : "";
    if (!skipped && mergedText === "") {
      throw new Error(
        "core-brain admin dream-memory: send 'mergedText' (the single memory) or { skipped: true }",
      );
    }
    const maxChars = readMemoryMaxChars(existsSync(configPath) ? configPath : null);
    if (charCount(mergedText) > maxChars) {
      throw new Error(
        `core-brain admin dream-memory: 'mergedText' has ${charCount(mergedText)} characters, ` +
          `the limit is ${maxChars} ('memoryMaxChars' in the config)`,
      );
    }
    const verdict = {
      status: skipped ? DREAM_MEMORY_STATUS.skipped : DREAM_MEMORY_STATUS.processed,
      mergedText: skipped ? null : mergedText,
      mergedMemoryId:
        typeof args?.mergedMemoryId === "string" && args.mergedMemoryId !== "" ? args.mergedMemoryId : null,
      processedAt: new Date().toISOString(),
    };

    // A group is ONE decision: every pair that points at the same survivor settles together.
    if (survivorId !== "") {
      const settled = resolveDreamMemoriesBySurvivor(root, survivorId, verdict);
      if (settled === 0) {
        throw new Error(`core-brain admin dream-memory: no pending row points at '${survivorId}'`);
      }
      return {
        ok: true,
        action: "dream-memory",
        detail: `${settled} row(s) ${skipped ? "skipped" : "processed"}`,
      };
    }

    const known = resolveDreamMemory(root, id, verdict);
    if (!known) throw new Error(`core-brain admin dream-memory: unknown row '${id}'`);
    return {
      ok: true,
      action: "dream-memory",
      detail: `${id} ${skipped ? "skipped" : "processed"}`,
    };
  }

  /** `dreams`: the passes, newest first — the table the USER analyses. */
  function dreamsReport(args: Record<string, unknown> | undefined): AdminResult {
    const runs = listDreamRuns(root, readLimit(args?.limit, DREAM_LIST_DEFAULT, DREAM_RUN_LIST_MAX));
    return { ok: true, action: "dreams", detail: `${runs.length} dream(s)`, dreams: runs };
  }

  /**
   * `admin` (§7.2): maintenance ops that bypass per-agent authorization.
   * ONE validation path, ONE error shape — any invalid input (unknown action,
   * bad/missing arg) throws a plain `Error` prefixed `core-brain admin` and
   * naming the problem. Only the data root is written, except the `export`
   * file the caller names.
   */
  async function adminOp(
    policy: AgentPolicy,
    request: Extract<CoreMemoryRequest, { op: "admin" }>,
  ): Promise<AdminResult> {
    void policy; // admin ops are maintenance — the caller's policy is not consulted
    const args: Record<string, unknown> | undefined = request.args;
    const nsFilter = typeof args?.ns === "string" && args.ns !== "" ? args.ns : null;
    const action: string = String(request.action);

    // --- purge: hard-delete ONE namespace's records + vectors (force for private)
    if (action === "purge") {
      const nsArg = args?.ns;
      if (typeof nsArg !== "string" || nsArg.trim() === "") {
        throw new Error("core-brain admin purge: 'ns' is required (a namespace label)");
      }
      const target = activeNamespaces().find((ns) => nsLabel(ns) === nsArg);
      if (!target) {
        throw new Error(`core-brain admin purge: unknown namespace '${nsArg}'`);
      }
      if (target.kind === "agent") {
        const targetPolicy = lookup(target.name);
        if (targetPolicy?.private === true && args?.force !== true) {
          throw new Error(
            `core-brain admin purge: namespace 'agent:${target.name}' is private — ` +
              `pass { ns, force: true } to purge it`,
          );
        }
      }
      const recordsFile = recordsFileFor(root, target);
      if (existsSync(recordsFile)) unlinkSync(recordsFile);
      const vectorsFile = vectorsFileFor(root, target);
      if (existsSync(vectorsFile)) unlinkSync(vectorsFile);
      return { ok: true, action: "purge", detail: `removed namespace '${nsLabel(target)}'` };
    }

    // --- reindex: rebuild every namespace's vector index from its records
    if (action === "reindex") {
      let processed = 0;
      let written = 0;
      for (const ns of activeNamespaces()) {
        const label = nsLabel(ns);
        if (nsFilter !== null && label !== nsFilter) continue;
        const records = readRecords(recordsFileFor(root, ns));
        const vectors: Record<string, number[]> = {};
        for (const record of records) vectors[String(record.id)] = await active.embed(record.text);
        writeVectors(vectorsFileFor(root, ns), vectors, active);
        processed += 1;
        written += records.length;
      }
      return {
        ok: true,
        action: "reindex",
        detail: `${processed} namespace(s) processed, ${written} vector(s) written`,
      };
    }

    // --- export: dump { version, exportedAt, namespaces[] } to a caller-named file
    if (action === "export") {
      const file = args?.file;
      if (typeof file !== "string" || file.trim() === "") {
        throw new Error("core-brain admin export: 'file' is required (a non-empty path)");
      }
      assertInsideDataRoot(root, file, "export");
      if (isLiveStoreFile(root, file)) {
        throw new Error(
          `core-brain admin export: 'file' must not overwrite a live store file: ${file}`,
        );
      }
      const namespaces: {
        ns: string;
        records: MemoryRecord[];
        vectors: Record<string, number[]>;
      }[] = [];
      let totalRecords = 0;
      for (const ns of activeNamespaces()) {
        const label = nsLabel(ns);
        if (nsFilter !== null && label !== nsFilter) continue;
        const records = readRecords(recordsFileFor(root, ns));
        const vectors = readVectors(vectorsFileFor(root, ns), active);
        namespaces.push({ ns: label, records, vectors });
        totalRecords += records.length;
      }
      const document = { version: 1, exportedAt: new Date().toISOString(), namespaces };
      writeFileAtomic(file, document);
      return {
        ok: true,
        action: "export",
        detail: `wrote ${file} (${namespaces.length} namespace(s), ${totalRecords} record(s))`,
      };
    }

    // --- import: append records (never overwrite an id) + merge vectors, per namespace
    if (action === "import") {
      const file = args?.file;
      if (typeof file !== "string" || file.trim() === "") {
        throw new Error("core-brain admin import: 'file' is required (a non-empty path)");
      }
      assertInsideDataRoot(root, file, "import");
      if (!existsSync(file)) {
        throw new Error(`core-brain admin import: file not found: ${file}`);
      }
      let parsed: unknown;
      try {
        parsed = readJsonOrNull(file);
      } catch (error) {
        throw new Error(
          `core-brain admin import: cannot parse '${file}': ${String((error as Error).message)}`,
        );
      }
      if (!parsed || typeof parsed !== "object") {
        throw new Error(`core-brain admin import: '${file}' is not a JSON object`);
      }
      const docNamespaces = (parsed as { namespaces?: unknown }).namespaces;
      if (!Array.isArray(docNamespaces)) {
        throw new Error(
          `core-brain admin import: '${file}' is not a core-brain export document ` +
            `(missing 'namespaces' array)`,
        );
      }
      let imported = 0;
      let skipped = 0;
      for (const entry of docNamespaces) {
        if (!entry || typeof entry !== "object") continue;
        const row = entry as { ns?: unknown; records?: unknown; vectors?: unknown };
        const label = typeof row.ns === "string" ? row.ns : "";
        if (label === "") continue;
        let target: Namespace | null = null;
        if (label === "global") {
          target = { kind: "global" };
        } else if (label.startsWith("agent:")) {
          const name = label.slice("agent:".length);
          if (name !== "" && AGENT_NAME_PATTERN.test(name)) target = { kind: "agent", name };
        }
        if (!target) {
          throw new Error(
            `core-brain admin import: '${file}' carries an invalid namespace label '${label}'`,
          );
        }
        const incomingRecords = Array.isArray(row.records)
          ? (row.records as MemoryRecord[])
          : [];
        const incomingVectors =
          row.vectors && typeof row.vectors === "object"
            ? (row.vectors as Record<string, number[]>)
            : {};

        const recordsFile = recordsFileFor(root, target);
        const currentRecords = readRecords(recordsFile);
        const currentIds = new Set(currentRecords.map((record) => String(record.id)));
        const vectorsFile = vectorsFileFor(root, target);
        const currentVectors = readVectors(vectorsFile, active);

        let namespaceImported = 0;
        for (const record of incomingRecords) {
          if (!record || typeof record !== "object") continue;
          const id = String(record.id);
          if (id === "") continue; // malformed record, no id
          if (currentIds.has(id)) {
            skipped += 1;
            continue; // never overwrite an existing id
          }
          currentRecords.push(record);
          currentIds.add(id);
          namespaceImported += 1;
          imported += 1;
          const vector = incomingVectors[id];
          if (Array.isArray(vector)) currentVectors[id] = vector;
        }
        if (namespaceImported > 0) {
          writeFileAtomic(recordsFile, currentRecords);
          writeVectors(vectorsFile, currentVectors, active);
        }
      }

      // --- episodes section (§10.5, T4): a FLAT Episode[] whose `ns` is derived
      // from `agent` (present, non-empty -> `agent:<agent>` verbatim; absent ->
      // global), deduped by `id` within its target namespace. A second run of
      // the same document leaves every file byte-identical.
      const docEpisodes = (parsed as { episodes?: unknown }).episodes;
      let importedEpisodes = 0;
      let skippedEpisodes = 0;
      if (docEpisodes !== undefined) {
        if (!Array.isArray(docEpisodes)) {
          throw new Error(
            `core-brain admin import: '${file}' has an 'episodes' key that is not an array`,
          );
        }
        for (const entry of docEpisodes) {
          if (!entry || typeof entry !== "object") continue;
          const row = entry as Record<string, unknown>;
          const id = row.id;
          if (typeof id !== "string" || id === "") continue; // no dedupe key
          const owner = row.agent;
          let target: Namespace;
          if (typeof owner === "string" && owner !== "") {
            if (!AGENT_NAME_PATTERN.test(owner)) {
              throw new Error(
                `core-brain admin import: '${file}' carries an episode with an invalid owner '${owner}'`,
              );
            }
            target = { kind: "agent", name: owner };
          } else {
            target = { kind: "global" };
          }
          const episodeFile = episodesFileFor(root, target);
          const currentEpisodes = readEpisodes(episodeFile);
          if (currentEpisodes.some((episode) => String(episode.id) === id)) {
            skippedEpisodes += 1;
            continue; // never overwrite an existing id (§10.5 rule 5)
          }
          currentEpisodes.push(importedEpisodeFrom(row));
          writeFileAtomic(episodeFile, currentEpisodes);
          importedEpisodes += 1;
        }
      }

      return {
        ok: true,
        action: "import",
        detail:
          `imported ${imported} record(s), skipped ${skipped} existing; ` +
          `imported ${importedEpisodes} episode(s), skipped ${skippedEpisodes} existing`,
      };
    }

    // --- compact: drop vectors whose record is retired or missing, per namespace
    if (action === "compact") {
      let dropped = 0;
      for (const ns of activeNamespaces()) {
        const label = nsLabel(ns);
        if (nsFilter !== null && label !== nsFilter) continue;
        const records = readRecords(recordsFileFor(root, ns));
        const liveIds = new Set(
          records
            .filter((record) => typeof record.retiredAt !== "string")
            .map((record) => String(record.id)),
        );
        const vectorsFile = vectorsFileFor(root, ns);
        const currentVectors = readVectors(vectorsFile, active);
        const nextVectors: Record<string, number[]> = {};
        let namespaceDropped = 0;
        for (const [id, vector] of Object.entries(currentVectors)) {
          if (liveIds.has(id)) {
            nextVectors[id] = vector;
          } else {
            namespaceDropped += 1;
          }
        }
        if (namespaceDropped > 0) {
          writeVectors(vectorsFile, nextVectors, active);
          dropped += namespaceDropped;
        }
      }
      return { ok: true, action: "compact", detail: `${dropped} vector(s) dropped` };
    }

    // --- dedupe: collapse records that say the same thing (USER, 2026-11-18) -----------
    // Dry-run by default (`apply: true` writes). Two passes share the same bookkeeping:
    //   * TEXT — records whose NORMALISED text is equal form one group;
    //   * SEMANTIC (USER, 2026-11-20) — records whose vectors sit at/above `minCosine` form one
    //     group: the same meaning said in different words.
    // In both, the most-retrieved (then the newest) survives and absorbs the others' counters; the
    // rest are RETIRED with `meta.absorbedInto` — the text stays on disk, so nothing is lost. In the
    // SEMANTIC pass the survivor's text becomes the union of the group within `DEFAULT_MEMORY_MAX_CHARS`
    // (`richestMemoryText`), so a fact only the absorbed copy carried stays recallable. The vector is
    // kept: the group is one meaning by construction, so the old vector still points at the new text.
    // Idempotent by construction: a retired record is not a candidate.
    if (action === "dedupe") {
      const apply = args?.apply === true;
      const requestedMode = args?.mode;
      const mode: "text" | "semantic" | "both" =
        requestedMode === "text" || requestedMode === "semantic" ? requestedMode : "both";
      const requestedMin = args?.minCosine;
      const minCosine =
        typeof requestedMin === "number" &&
        Number.isFinite(requestedMin) &&
        requestedMin >= 0 &&
        requestedMin <= 1
          ? requestedMin
          : SEMANTIC_DEDUPE_MIN_COSINE;
      const groups: Array<{
        ns: string;
        kept: string;
        retired: string[];
        kind: "text" | "semantic";
        cosine?: number;
        merged?: number;
        skipped?: number;
      }> = [];
      let retiredTotal = 0;
      // A record already collapsed by the text pass is not offered to the semantic pass again:
      // one record, one collapse, and a dry run reports each group once.
      const claimed = new Set<string>();

      /** The survivor: most score, then the OLDEST (it carries the history), then the lowest id. */
      const survivorFirst = (a: MemoryRecord, b: MemoryRecord): number => {
        const byRetrievals = (b.score ?? 0) - (a.score ?? 0);
        if (byRetrievals !== 0) return byRetrievals;
        const byDate = String(a.updatedAt).localeCompare(String(b.updatedAt));
        if (byDate !== 0) return byDate;
        return String(a.id).localeCompare(String(b.id));
      };

      /** Sums the group's counters into `survivor`, retires the rest, returns how many retired. */
      const absorb = (survivor: MemoryRecord, bucket: MemoryRecord[], now: string): number => {
        survivor.score = bucket.reduce((sum, record) => sum + (record.score ?? 0), 0);
        const useful = bucket.reduce((sum, record) => sum + (record.feedback?.useful ?? 0), 0);
        const useless = bucket.reduce((sum, record) => sum + (record.feedback?.useless ?? 0), 0);
        if (useful > 0 || useless > 0) survivor.feedback = { useful, useless };
        survivor.updatedAt = now;
        let retired = 0;
        for (const record of bucket) {
          if (record === survivor) continue;
          record.retiredAt = now;
          record.meta = { ...(record.meta ?? {}), absorbedInto: survivor.id };
          retired += 1;
        }
        return retired;
      };

      if (mode !== "semantic") {
        for (const ns of activeNamespaces()) {
          const label = nsLabel(ns);
          if (nsFilter !== null && label !== nsFilter) continue;

          const records = readRecords(recordsFileFor(root, ns));
          const bucketsByText = new Map<string, MemoryRecord[]>();
          for (const record of records) {
            if (typeof record.retiredAt === "string") continue;
            const key = normalizeMemoryText(record.text);
            const bucket = bucketsByText.get(key);
            if (bucket) bucket.push(record);
            else bucketsByText.set(key, [record]);
          }

          let namespaceChanged = false;
          for (const bucket of bucketsByText.values()) {
            if (bucket.length < 2) continue;
            const ordered = [...bucket].sort(survivorFirst);
            const [survivor, ...absorbed] = ordered;
            groups.push({
              ns: label,
              kept: survivor.id,
              retired: absorbed.map((record) => record.id),
              kind: "text",
            });
            for (const record of ordered) claimed.add(String(record.id));
            if (!apply) continue;
            retiredTotal += absorb(survivor, ordered, new Date().toISOString());
            namespaceChanged = true;
          }
          if (namespaceChanged) writeFileAtomic(recordsFileFor(root, ns), records);
        }
      }

      if (mode !== "text") {
        for (const ns of activeNamespaces()) {
          const label = nsLabel(ns);
          if (nsFilter !== null && label !== nsFilter) continue;

          // Re-read: the text pass may have retired records a moment ago in this same call.
          const records = readRecords(recordsFileFor(root, ns));
          const vectors = readVectors(vectorsFileFor(root, ns), active);
          const candidates = records.filter(
            (record) =>
              typeof record.retiredAt !== "string" &&
              !claimed.has(String(record.id)) &&
              record.real !== false && // a dream is not a source for another dream (2026-11-20)
              Array.isArray(vectors[String(record.id)]),
          );
          if (candidates.length < 2) continue;

          const ordered = [...candidates].sort(survivorFirst);
          const assigned = new Set<string>();
          let namespaceChanged = false;
          for (const seed of ordered) {
            const seedId = String(seed.id);
            if (assigned.has(seedId)) continue;
            const bucket = [seed];
            let weakest = 1;
            for (const other of ordered) {
              const otherId = String(other.id);
              if (otherId === seedId || assigned.has(otherId)) continue;
              const similarity = cosine(vectors[seedId], vectors[otherId]);
              if (similarity < minCosine) continue;
              bucket.push(other);
              if (similarity < weakest) weakest = similarity;
            }
            if (bucket.length < 2) continue;
            for (const member of bucket) assigned.add(String(member.id));
            const [survivor, ...absorbed] = bucket;
            const richest = richestMemoryText(bucket.map((record) => record.text));
            groups.push({
              ns: label,
              kept: String(survivor.id),
              retired: absorbed.map((record) => String(record.id)),
              kind: "semantic",
              cosine: Number(weakest.toFixed(4)),
            });
            if (!apply) continue;
            // Each pair goes to the queue (USER, 2026-11-20): the two texts as they were, the
            // cosine that allowed the join, and an agent's verdict — the machine never rewrites a
            // memory on its own judgement alone.
            const queuedAt = new Date().toISOString();
            for (const record of absorbed) {
              insertDreamMemory(root, {
                id: randomUUID(),
                namespace: label,
                dreamId: typeof args?.dreamId === "string" ? args.dreamId : null,
                survivorId: String(survivor.id),
                absorbedId: String(record.id),
                survivorText: survivor.text,
                absorbedText: record.text,
                cosine: Number(weakest.toFixed(4)),
                status: DREAM_MEMORY_STATUS.pending,
                createdAt: queuedAt,
                processedAt: null,
                mergedText: null,
                mergedMemoryId: null,
              });
            }
            survivor.text = richest;
            retiredTotal += absorb(survivor, bucket, queuedAt);
            namespaceChanged = true;
          }
          if (namespaceChanged) writeFileAtomic(recordsFileFor(root, ns), records);
        }
      }

      const byMeaning = groups.filter((group) => group.kind === "semantic").length;
      const detail = apply
        ? `${groups.length} group(s) collapsed (${byMeaning} by meaning), ${retiredTotal} record(s) retired`
        : `${groups.length} group(s) found (${byMeaning} by meaning), nothing written (pass { apply: true } to collapse)`;
      return { ok: true, action: "dedupe", detail, groups };
    }

    // --- synthesis-pairs: the band between the two regimes (USER, 2026-11-20) ------------------
    // Above 0.97 the store unites two memories by itself. Between 0.50 and 0.97 they say the same
    // thing in other words and only a writer can put them together: this action NAMES the pairs to
    // dream about, it writes nothing. Selection follows the USER's rule (2026-11-21): every memory
    // proposes its nearest neighbour inside the band, and the night takes the pairs with the
    // HIGHEST cosine — the ten closest to the 0.97 ceiling, whatever their score. Ties are settled
    // at random.
    if (action === "synthesis-pairs") {
      // One group per night (USER, 2026-11-22): the highest cosine inside the band. `limit` is only
      // for a deliberate pen (`--limit N` in the worker), never the rule of the night.
      const limit = readLimit(args?.limit, SYNTHESIS_PAIRS_PER_NIGHT, SYNTHESIS_PAIRS_MAX);
      // A window on AGE (USER, 2026-11-22): `sinceHours` restricts the election to the memories
      // created in the last N hours, so a fresh duplicate is united tonight and the old base is not
      // re-read every night. Absent = the whole living base, as before.
      const configuredWindow = readSynthesisWindowHours(existsSync(configPath) ? configPath : null);
      const sinceHours =
        typeof args?.sinceHours === "number" && Number.isFinite(args.sinceHours) && args.sinceHours >= 0
          ? args.sinceHours
          : configuredWindow;
      const sinceMs = sinceHours === 0 ? null : Date.now() - sinceHours * 3_600_000;
      const floor =
        typeof args?.minCosine === "number" && Number.isFinite(args.minCosine) && args.minCosine > 0 && args.minCosine < 1
          ? args.minCosine
          : readSynthesisMinCosine(existsSync(configPath) ? configPath : null);
      const ceiling = SEMANTIC_DEDUPE_MIN_COSINE;
      const candidates: Array<{
        ns: string;
        a: { id: string; text: string; score: number };
        b: { id: string; text: string; score: number };
        cosine: number;
      }> = [];
      const seen = new Set<string>();

      for (const ns of activeNamespaces()) {
        const label = nsLabel(ns);
        if (nsFilter !== null && label !== nsFilter) continue;
        // The pool is the whole living space; the WINDOW decides which pairs may be elected
        // (USER, 2026-11-22): at least one side must be younger than `sinceHours`, so a new memory
        // finds an old duplicate — the case the two-sided window lost.
        const records = readRecords(recordsFileFor(root, ns)).filter(
          (record) => typeof record.retiredAt !== "string" && record.real !== false,
        );
        const isRecent = (record: { createdAt?: unknown }): boolean =>
          sinceMs === null || Date.parse(String(record.createdAt ?? "")) >= sinceMs;
        const createdAtById = new Map(records.map((record) => [String(record.id), record.createdAt]));
        const vectors = readVectors(vectorsFileFor(root, ns), active);
        if (records.length < 2) continue;

        const scored = records
          .filter((record) => Array.isArray(vectors[String(record.id)]))
          .map((record) => ({ record, score: Number(record.score ?? 0) }));
        if (scored.length < 2) continue;

        // Each memory proposes its nearest neighbour inside the band — the pair it would be worth
        // dreaming about. The night is decided later, by cosine, across every namespace.
        for (const entry of scored) {
          const idA = String(entry.record.id);
          let best: { id: string; text: string; score: number; cosine: number } | null = null;
          for (const other of scored) {
            const idB = String(other.record.id);
            if (idB === idA) continue;
            const similarity = cosine(vectors[idA], vectors[idB]);
            if (similarity < floor || similarity >= ceiling) continue;
            if (!best || similarity > best.cosine) {
              best = { id: idB, text: other.record.text, score: other.score, cosine: similarity };
            }
          }
          if (!best) continue;
          // At least one side inside the window, otherwise the pair is not tonight's business.
          // The date is looked up in a Map built once — a scan here made the election O(n^3).
          if (sinceMs !== null && !isRecent(entry.record) && !(createdAtById.get(best.id) !== undefined && isRecent({ createdAt: createdAtById.get(best.id) }))) {
            continue;
          }
          const key = [idA, best.id].sort().join("|");
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push({
            ns: label,
            a: { id: idA, text: entry.record.text, score: entry.score },
            b: { id: best.id, text: best.text, score: best.score },
            cosine: best.cosine,
          });
        }
      }

      // Highest cosine first; equal cosines are equally good tonight, so a random key breaks the tie.
      const chosen = candidates
        .map((pair) => ({ pair, tie: Math.random() }))
        .sort((x, y) => y.pair.cosine - x.pair.cosine || x.tie - y.tie)
        .slice(0, limit)
        .map((entry) => entry.pair);

      // Pairs that share a memory become ONE dream (USER, 2026-11-21): the first dream would absorb
      // that memory and the second would dream about something already gone. A group keeps every
      // memory once, in the order the strongest link brought it in, and reports the strongest link.
      type Member = { id: string; text: string; score: number };
      const groups: Array<{ ns: string; members: Member[]; cosine: number }> = [];
      for (const pair of chosen) {
        const touched = groups.filter((group) =>
          group.members.some((member) => member.id === pair.a.id || member.id === pair.b.id),
        );
        let target: { ns: string; members: Member[]; cosine: number };
        if (touched.length === 0) {
          target = { ns: pair.ns, members: [], cosine: 0 };
          groups.push(target);
        } else {
          target = touched[0];
          for (const other of touched.slice(1)) {
            for (const member of other.members) {
              if (!target.members.some((existing) => existing.id === member.id)) target.members.push(member);
            }
            target.cosine = Math.max(target.cosine, other.cosine);
            groups.splice(groups.indexOf(other), 1);
          }
        }
        for (const member of [pair.a, pair.b]) {
          if (!target.members.some((existing) => existing.id === member.id)) target.members.push(member);
        }
        target.cosine = Math.max(target.cosine, pair.cosine);
      }

      return {
        ok: true,
        action: "synthesis-pairs",
        detail: `${groups.length} dream(s) from ${chosen.length} pair(s) (band ${floor}-${ceiling}${sinceHours ? `, last ${sinceHours}h` : ""})`,
        synthesisPairs: groups.map((group) => ({
          ns: group.ns,
          members: group.members,
          cosine: Number(group.cosine.toFixed(4)),
          // The first two members keep the old keys, so an older worker still dreams something.
          a: group.members[0],
          b: group.members[1],
        })),
      } as AdminResult;
    }

    // --- dream-store: the landing of a synthesised dream (USER, 2026-11-20) --------------------
    // The dream is a SYSTEM operation: it writes into the namespace the pair belongs to (which no
    // agent may write into on its behalf), marks the memory `real = false` with its provenance, and
    // retires the sources in the same call — one dream, one write, no half state.
    if (action === "dream-store") {
      const wanted = typeof args?.ns === "string" ? args.ns : "";
      const target = activeNamespaces().find((ns) => nsLabel(ns) === wanted);
      if (!target) throw new Error(`core-brain admin dream-store: unknown namespace '${wanted}'`);
      const text = typeof args?.text === "string" ? args.text.trim() : "";
      if (text === "") throw new Error("core-brain admin dream-store: 'text' is required");
      const maxChars = readMemoryMaxChars(existsSync(configPath) ? configPath : null);
      if (charCount(text) > maxChars) {
        throw new Error(
          `core-brain admin dream-store: the dream has ${charCount(text)} characters, the limit is ` +
            `${maxChars} ('memoryMaxChars' in the config)`,
        );
      }
      const sourceIds = Array.isArray(args?.sourceIds) ? args.sourceIds.map((id) => String(id)) : [];
      const now = new Date().toISOString();
      const records = readRecords(recordsFileFor(root, target));
      // The union INHERITS the strength of what it replaces (USER, 2026-11-22): its score is the SUM
      // of the sources' scores — uniting two strong memories must not produce a newborn of 10. A
      // dream that names no source (or none found) still starts like any other memory.
      const inherited = records
        .filter((source) => sourceIds.includes(String(source.id)))
        .reduce((total, source) => total + Number(source.score ?? 0), 0);
      const record: MemoryRecord = {
        id: randomUUID(),
        agent: target.kind === "global" ? "global" : target.name,
        scope: target.kind === "global" ? "global" : "agent",
        text: `${DREAM_MEMORY_PREFIX}${text}`,
        meta: { dreamed: true, dreamedFrom: sourceIds, type: "dream" },
        createdAt: now,
        updatedAt: now,
        score: inherited > 0 ? inherited : MEMORY_START_SCORE,
        real: false,
      };
      const vector = await active.embed(record.text);
      records.push(record);
      for (const source of records) {
        if (!sourceIds.includes(String(source.id))) continue;
        if (typeof source.retiredAt === "string") continue;
        source.retiredAt = now;
        source.meta = { ...(source.meta ?? {}), absorbedInto: record.id };
      }
      writeFileAtomic(recordsFileFor(root, target), records);
      const vectors = readVectors(vectorsFileFor(root, target), active);
      vectors[record.id] = vector;
      writeVectors(vectorsFileFor(root, target), vectors, active);
      return { ok: true, action: "dream-store", detail: `dream ${record.id} (${sourceIds.length} source(s) retired)` };
    }

    // --- dream-memories: the pairs the dream judged, and the verdict an agent writes (2026-11-20) --
    // The dream never rewrites a memory on its own judgement alone: every pair it joined is a row
    // here, and an agent that wakes after the pass either writes the single memory or skips it.
    if (action === "dream-memories") return dreamMemoriesReport(args);
    if (action === "dream-memory") return dreamMemoryVerdict(args);
    if (action === "dreams") return dreamsReport(args);
    if (action === "archive") {
      const moved = archiveRetiredMemories(root);
      return { ok: true, action: "archive", detail: `${moved} record(s) moved to memories_history` };
    }
    if (action === "history") {
      return { ok: true, action: "history", detail: `${countArchivedMemories(root)} record(s) in memories_history` };
    }

    throw new Error(
      `core-brain admin: unknown action '${action}' ` +
        `(expected purge|reindex|export|import|compact|dedupe|dreams|dream-memories|dream-memory|archive|history)`,
    );
  }

  async function invoke(agentName: string, request: CoreMemoryRequest): Promise<CoreMemoryResult> {
    const policy = requirePolicy(agentName);
    if (!request || typeof request !== "object") {
      throw new Error("core_memory: request must be an object");
    }
    if (request.op === "who") return whoOp(policy);
    if (request.op === "store") return storeOp(policy, request);
    if (request.op === "recall") return recallOp(policy, request);
    if (request.op === "forget") return forgetOp(policy, request);
    if (request.op === "feedback") return feedbackOp(policy, request);
    if (request.op === "episode") return episodeOp(policy, request);
    if (request.op === "timeline") return timelineOp(policy, request);
    if (request.op === "dream") return dreamOp(policy, request);
    if (request.op === "status") return statusOp(request);
    if (request.op === "receipt") return receiptOp(request);
    if (request.op === "doctor") return doctorOp(request);
    if (request.op === "admin") return adminOp(policy, request);
    const unknownOp: string = String((request as { op?: unknown }).op);
    throw new Error(`core_memory: unknown op '${unknownOp}'`);
  }

  return {
    invoke,
    resolvePolicy: requirePolicy,
    memoriesPerContext: () => readMemoriesPerContext(existsSync(configPath) ? configPath : null),
    memoryTestSet: () => readMemoryTestSet(existsSync(configPath) ? configPath : null),
  };
}
