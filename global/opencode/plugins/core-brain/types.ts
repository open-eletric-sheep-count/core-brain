// types.ts — shared types for the core-brain plugin (spec §4, §7.2).
//
// Type-only module: it carries no runtime code and store.ts imports it with
// `import type`, so it is fully erased by Node's type-stripping and adds no
// runtime dependency. Keeping it separate keeps the public shapes (the
// `core_memory` request/result JSON) in one place for the tool layer.

/** One row of `config.json` `agents[]` (spec Q3). */
export interface AgentPolicy {
  name: string;
  hasGlobalAccess: boolean;
  private: boolean;
}

/** The whole `config.json` document. */
export interface CoreBrainConfig {
  agents: AgentPolicy[];
}

/** A stored record lives either in an agent space or in the global space. */
export type MemoryScope = "agent" | "global";

/** The write/read target as the caller writes it (spec §7.2). */
export type NamespaceTarget = "self" | "global" | `agent:${string}`;

/** One memory record on disk (spec §4). */
export interface MemoryRecord {
  id: string;
  agent: string;
  scope: MemoryScope;
  text: string;
  meta?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  retrievals: number;
}

/** `vectors/<ns>/index.json` — real vectors, keyed by record id. */
export interface VectorIndex {
  embedder: string;
  dim: number;
  vectors: Record<string, number[]>;
}

/** One `recall` hit as returned to the caller (spec §7.2). */
export interface RecallHit {
  id: string;
  text: string;
  agent: string;
  scope: MemoryScope;
  score: number;
  retrievals: number;
}

/** `core_memory({ op: "who" })` result. */
export interface WhoResult {
  agent: string;
  name: string;
  private: boolean;
  hasGlobalAccess: boolean;
  dataDir: string;
}

/** `core_memory({ op: "store" })` result. */
export interface StoreResult {
  ok: true;
  id: string;
  scope: MemoryScope;
  ns: string;
}

/** `core_memory({ op: "recall" })` result. */
export interface RecallResult {
  results: RecallHit[];
  scanned: string[];
}

export type CoreMemoryResult = WhoResult | StoreResult | RecallResult;

/**
 * The `core_memory` request. `agentName` is NOT part of it on purpose (spec
 * §7.1): identity is trusted infrastructure data injected by the tool layer.
 */
export type CoreMemoryRequest =
  | { op: "who" }
  | { op: "store"; text: string; target?: NamespaceTarget; meta?: Record<string, unknown> }
  | { op: "recall"; query?: string; limit?: number; from?: NamespaceTarget };

/** Options accepted by `createEngine` (spec Q3 precedence). */
export interface EngineOptions {
  /** Data root; defaults to `CORE_BRAIN_HOME ?? ~/.core-brain`. */
  home?: string;
  /** Explicit config file (highest precedence). */
  configPath?: string;
}

/** The engine the tool layer drives (test-facing seam, test/CONTRACT.md §2). */
export interface Engine {
  /** `agentName` is trusted infrastructure identity; `invoke` == `core_memory`. */
  invoke(agentName: string, request: CoreMemoryRequest): CoreMemoryResult;
}
