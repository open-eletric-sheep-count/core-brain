// store.ts — core-brain data layer: config, authorizer, persistence, vectors.
//
// Spec: docs/specs/core-brain-plugin.md — §4 (storage layout), §5 (vectors),
// §6 (access matrix + error shapes), §7 (API + identity).
// Zero runtime npm dependencies: Node builtins only (spec Q2).

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AgentPolicy,
  CoreMemoryRequest,
  CoreMemoryResult,
  Engine,
  EngineOptions,
  MemoryRecord,
  RecallHit,
  RecallResult,
  StoreResult,
  WhoResult,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const EMBEDDER_ID = "hash-ngram-v1";
export const EMBEDDING_DIM = 256;
const DEFAULT_RECALL_LIMIT = 5;

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
  const vector: number[] = new Array(EMBEDDING_DIM).fill(0);
  const collapsed = String(text).toLowerCase().replace(/\s+/g, " ").trim();
  const padded = ` ${collapsed} `;

  for (let n = 2; n <= 4; n += 1) {
    for (let i = 0; i + n <= padded.length; i += 1) {
      const gram = padded.slice(i, i + n);
      const bucket = fnv1a(`i:${gram}`) % EMBEDDING_DIM;
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

function writeFileAtomic(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
}

/** Reads `{ id: number[] }`; drops the index when the embedder version changed. */
function readVectors(file: string): Record<string, number[]> {
  const parsed = readJsonOrNull(file) as { embedder?: unknown; vectors?: unknown } | null;
  if (!parsed || typeof parsed !== "object") return {};
  if (parsed.embedder !== EMBEDDER_ID) return {};
  const vectors = parsed.vectors;
  return vectors && typeof vectors === "object" ? (vectors as Record<string, number[]>) : {};
}

function writeVectors(file: string, vectors: Record<string, number[]>): void {
  writeFileAtomic(file, { embedder: EMBEDDER_ID, dim: EMBEDDING_DIM, vectors });
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
 * any `private:false && hasGlobalAccess:false` row aborts the engine.
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
    const row = entry as { name?: unknown; hasGlobalAccess?: unknown; private?: unknown };
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
    if (row.hasGlobalAccess !== true && row.hasGlobalAccess !== false) {
      throw new InvalidConfigurationError(
        `core-brain config '${configPath}': agent '${name}' needs a boolean 'hasGlobalAccess'`,
      );
    }
    if (row.private !== true && row.private !== false) {
      throw new InvalidConfigurationError(
        `core-brain config '${configPath}': agent '${name}' needs a boolean 'private'`,
      );
    }
    if (seen.has(name)) {
      throw new InvalidConfigurationError(
        `core-brain config '${configPath}': agent '${name}' is declared more than once`,
      );
    }
    if (row.private === false && row.hasGlobalAccess === false) {
      throw new InvalidConfigurationError(
        `core-brain config '${configPath}': agent '${name}' is a public agent without global access ` +
          `(private:false + hasGlobalAccess:false) — invalid row, refusing to start`,
      );
    }
    seen.add(name);
    policies.push({ name, hasGlobalAccess: row.hasGlobalAccess, private: row.private });
  }
  return policies;
}

// ---------------------------------------------------------------------------
// Authorization (§6 — the heart of the slice)
// ---------------------------------------------------------------------------

type StoreRequest = Extract<CoreMemoryRequest, { op: "store" }>;
type RecallRequest = Extract<CoreMemoryRequest, { op: "recall" }>;

/** One namespace loaded during a recall scan, with its records in memory. */
interface ScannedNamespace {
  ns: Namespace;
  records: MemoryRecord[];
}

/** One recall candidate before ranking. */
interface RecallCandidate {
  label: string;
  record: MemoryRecord;
  score: number;
  updatedAt: number;
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

  /** Fail-closed for an unlisted agent (§7.1): no default allow, no fallback. */
  function requirePolicy(agentName: string): AgentPolicy {
    const policy = policyByName.get(agentName);
    if (!policy) {
      throw new Error(`agent '${agentName}' is not configured in core-brain config.json`);
    }
    return policy;
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

  function storeOp(policy: AgentPolicy, request: StoreRequest): StoreResult {
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

    const recordsFile = recordsFileFor(root, ns);
    const records = readRecords(recordsFile);
    records.push(record);
    writeFileAtomic(recordsFile, records);

    const vectorsFile = vectorsFileFor(root, ns);
    const vectors = readVectors(vectorsFile);
    vectors[record.id] = embed(record.text);
    writeVectors(vectorsFile, vectors);

    return { ok: true, id: record.id, scope: record.scope, ns: nsLabel(ns) };
  }

  function recallOp(policy: AgentPolicy, request: RecallRequest): RecallResult {
    const requestedLimit = request.limit;
    const limit =
      typeof requestedLimit === "number" && Number.isInteger(requestedLimit) && requestedLimit > 0
        ? requestedLimit
        : DEFAULT_RECALL_LIMIT;

    const from: string | null = typeof request.from === "string" ? request.from : null;
    const requested = authorizeRead(policy, from, policies, lookup);
    const scanned = requested.map(nsLabel);

    const query = typeof request.query === "string" && request.query.trim() !== "" ? request.query : null;
    const queryVector = query === null ? null : embed(query);

    const buckets = new Map<string, ScannedNamespace>();
    const candidates: RecallCandidate[] = [];

    for (const ns of requested) {
      const label = nsLabel(ns);
      const records = readRecords(recordsFileFor(root, ns));
      const vectors = readVectors(vectorsFileFor(root, ns));
      buckets.set(label, { ns, records });
      for (const record of records) {
        const vector = vectors[record.id];
        const score = queryVector !== null && Array.isArray(vector) ? cosine(queryVector, vector) : 0;
        const parsedUpdatedAt = Date.parse(String(record.updatedAt));
        candidates.push({
          label,
          record,
          score,
          updatedAt: Number.isFinite(parsedUpdatedAt) ? parsedUpdatedAt : 0,
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt);
    const top = candidates.slice(0, limit);

    const dirty = new Set<string>();
    const results: RecallHit[] = [];
    for (const hit of top) {
      hit.record.retrievals = (Number(hit.record.retrievals) || 0) + 1;
      dirty.add(hit.label);
      results.push({
        id: hit.record.id,
        text: hit.record.text,
        agent: typeof hit.record.agent === "string" ? hit.record.agent : hit.label,
        scope: hit.record.scope === "global" ? "global" : "agent",
        score: Number(hit.score.toFixed(6)),
        retrievals: hit.record.retrievals,
      });
    }

    for (const label of dirty) {
      const bucket = buckets.get(label);
      if (bucket) writeFileAtomic(recordsFileFor(root, bucket.ns), bucket.records);
    }

    return { results, scanned };
  }

  function invoke(agentName: string, request: CoreMemoryRequest): CoreMemoryResult {
    const policy = requirePolicy(agentName);
    if (!request || typeof request !== "object") {
      throw new Error("core_memory: request must be an object");
    }
    if (request.op === "who") return whoOp(policy);
    if (request.op === "store") return storeOp(policy, request);
    if (request.op === "recall") return recallOp(policy, request);
    const unknownOp: string = String((request as { op?: unknown }).op);
    throw new Error(`core_memory: unknown op '${unknownOp}'`);
  }

  return { invoke };
}
