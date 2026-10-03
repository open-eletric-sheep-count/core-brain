// store.ts — core-brain data layer: config, authorizer, persistence, vectors.
//
// Spec: docs/specs/core-brain-plugin.md — §4 (storage layout), §5 (vectors),
// §6 (access matrix + error shapes), §7 (API + identity).
// Zero runtime npm dependencies: Node builtins only (spec Q2).

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AdminResult,
  AgentPolicy,
  CoreMemoryRequest,
  CoreMemoryResult,
  DoctorCheck,
  DoctorResult,
  Engine,
  EngineOptions,
  Episode,
  EpisodeResult,
  FeedbackResult,
  ForgetResult,
  MemoryRecord,
  PromoteResult,
  ReceiptResult,
  RecallHit,
  RecallMode,
  RecallResult,
  StatusResult,
  StoreResult,
  TimelineResult,
  WhoResult,
} from "./types.ts";

import { createBgeSmallEmbedder, type Embedder } from "./engine/embedder.ts";
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
  const parsed = readJsonOrNull(file);
  return Array.isArray(parsed) ? (parsed as MemoryRecord[]) : [];
}

/** `episodes.json` (whatever namespace) -> its episode array; `[]` when absent. */
function readEpisodes(file: string): Episode[] {
  const parsed = readJsonOrNull(file);
  return Array.isArray(parsed) ? (parsed as Episode[]) : [];
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
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
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
    `run core_admin { action: "reindex", args: { ns: "${label}" } } to rebuild it`
  );
}

// ---------------------------------------------------------------------------
// Configuration (§4/Q3). Precedence: options.configPath > CORE_BRAIN_HOME >
// ~/.core-brain > <dataRoot> > <pluginDir> (last = dev seed).
// ---------------------------------------------------------------------------

function resolveDataRoot(options: EngineOptions): string {
  if (options.home) return options.home;
  const envHome = process.env.CORE_BRAIN_HOME;
  if (envHome) return envHome;
  return join(homedir(), ".core-brain");
}

function resolveConfigPath(options: EngineOptions, dataRoot: string): string {
  const candidates: string[] = [];
  const push = (candidate?: string): void => {
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
  };
  push(options.configPath);
  const envHome = process.env.CORE_BRAIN_HOME;
  if (envHome) push(join(envHome, CONFIG_FILE));
  push(join(homedir(), ".core-brain", CONFIG_FILE));
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
type PromoteRequest = Extract<CoreMemoryRequest, { op: "promote" }>;

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
  const active: Embedder = options.embedder ?? createBgeSmallEmbedder();
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
      retrievals: 0,
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
      const { header, vectors } = readIndexFile(vectorsFileFor(root, ns));
      buckets.set(label, { ns, records });

      // D5/AC6: records + an index that is not the active engine's = stale.
      if (records.length > 0 && !indexMatches(header, active)) {
        throw new StaleIndexError(staleIndexMessage(label, header, active));
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
          (Number(b.entry.record.retrievals) || 0) - (Number(a.entry.record.retrievals) || 0) ||
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

    const dirty = new Set<string>();
    const results: RecallHit[] = [];
    for (const hit of ranked) {
      const found = byId.get(hit.id);
      if (!found) continue;
      found.record.retrievals = (Number(found.record.retrievals) || 0) + 1;
      dirty.add(found.label);
      results.push({
        id: found.record.id,
        text: found.record.text,
        agent: typeof found.record.agent === "string" ? found.record.agent : found.label,
        scope: found.record.scope === "global" ? "global" : "agent",
        score: Number(hit.score.toFixed(6)),
        rrf: Number(hit.rrf.toFixed(6)),
        legs: hit.legs,
        retrievals: found.record.retrievals,
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

    // Count the signal. `updatedAt` and `retrievals` are left untouched — they
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
   * `promote` (§10.2/§10.3/§10.5, T2): write a NEW memory in the caller's own
   * namespace carrying `meta.derivedFrom = <episodeId>`, then append that
   * memory's id to the episode's `engramIds`. Nothing is copied from the
   * episode — the caller supplies `text`. The episode must be readable by the
   * caller (the same read matrix as `feedback`).
   */
  async function promoteOp(policy: AgentPolicy, request: PromoteRequest): Promise<PromoteResult> {
    const episodeId = request.episodeId;
    if (typeof episodeId !== "string" || episodeId.trim() === "") {
      throw new Error("core_memory promote: 'episodeId' must be a non-empty string");
    }
    if (typeof request.text !== "string" || request.text.trim() === "") {
      throw new Error("core_memory promote: 'text' must be a non-empty string");
    }

    // The episode must be READABLE by the caller (§10.6): search the readable
    // union; a private namespace outside it hides the episode.
    const readable = authorizeRead(policy, null, policies, lookup);
    let foundNs: Namespace | null = null;
    let foundEpisodes: Episode[] | null = null;
    for (const ns of readable) {
      const episodes = readEpisodes(episodesFileFor(root, ns));
      if (episodes.some((episode) => String(episode.id) === episodeId)) {
        foundNs = ns;
        foundEpisodes = episodes;
        break;
      }
    }
    if (!foundNs || !foundEpisodes) {
      throw new Error(
        `core_memory promote: agent '${policy.name}' cannot promote episode '${episodeId}': ` +
          `the episode is not readable by '${policy.name}' (private namespace or unknown id)`,
      );
    }

    // The memory follows the write matrix (own space) and carries derivedFrom;
    // `store` embeds before writing, so a failing embedder leaves no orphan.
    const meta: Record<string, unknown> = { derivedFrom: episodeId };
    if (Array.isArray(request.tags) && request.tags.length > 0) meta.tags = request.tags.slice();
    const stored = await storeOp(policy, { op: "store", text: request.text, target: "self", meta });

    // Append the memory id to the episode's engramIds; every other field stays
    // exactly as stored (the episode is the record of truth, §10.4).
    const episode = foundEpisodes.find((candidate) => String(candidate.id) === episodeId);
    if (!episode) {
      throw new Error(`core_memory promote: episode '${episodeId}' vanished mid-promote`);
    }
    const engramIds = Array.isArray(episode.engramIds) ? episode.engramIds : [];
    episode.engramIds = engramIds.includes(stored.id) ? engramIds : [...engramIds, stored.id];
    writeFileAtomic(episodesFileFor(root, foundNs), foundEpisodes);

    return { ok: true, episodeId, memoryId: stored.id };
  }

  /**
   * Namespaces present on disk: always the shared global space, plus one agent
   * space per directory under `<root>/agents` whose name is filename-safe (§4).
   * A missing or unreadable agents directory yields only the global space — it
   * never throws.
   */
  function activeNamespaces(): Namespace[] {
    const namespaces: Namespace[] = [{ kind: "global" }];
    const agentsDir = join(root, "agents");
    try {
      for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
        if (entry.isDirectory() && AGENT_NAME_PATTERN.test(entry.name)) {
          namespaces.push({ kind: "agent", name: entry.name });
        }
      }
    } catch {
      // Missing or unreadable agents directory: only the global space is active.
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
      let retrievals = 0;
      for (const record of records) {
        if (typeof record.retiredAt === "string") retired += 1;
        retrievals += Number(record.retrievals) || 0;
      }

      namespaces.push({ ns: label, records: records.length, retired, retrievals });
      totalRecords += records.length;
      totalRetired += retired;
      totalRetrievals += retrievals;
    }

    return {
      storageRoot: root,
      configPath,
      embedder: active.id,
      dim: active.dim,
      namespaces,
      totals: { records: totalRecords, retired: totalRetired, retrievals: totalRetrievals },
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
        const retrievals = Number(record.retrievals) || 0;
        retrieved += retrievals;
        if (retrievals > 0) hits += 1;
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

    throw new Error(
      `core-brain admin: unknown action '${action}' ` +
        `(expected purge|reindex|export|import|compact)`,
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
    if (request.op === "promote") return promoteOp(policy, request);
    if (request.op === "status") return statusOp(request);
    if (request.op === "receipt") return receiptOp(request);
    if (request.op === "doctor") return doctorOp(request);
    if (request.op === "admin") return adminOp(policy, request);
    const unknownOp: string = String((request as { op?: unknown }).op);
    throw new Error(`core_memory: unknown op '${unknownOp}'`);
  }

  return { invoke, resolvePolicy: requirePolicy };
}
