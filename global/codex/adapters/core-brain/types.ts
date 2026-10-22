// types.ts — shared types for the core-brain plugin (spec §4, §7.2) .
//
// Type-only module: it carries no runtime code and store.ts imports it with
// `import type`, so it is fully erased by Node's type-stripping and adds no
// runtime dependency. Keeping it separate keeps the public shapes (the
// `core_memory` request/result JSON) in one place for the tool layer.
//
// The D4 injection seams (`Embedder`/`Reranker`) are OWNED by the engine
// modules and merely RE-EXPORTED here (test/CONTRACT.md §8.2): never redefine
// them in this file. The re-export is `import type` + `export type`, so it stays
// fully erased.

import type { Embedder } from "./engine/embedder.ts";
import type { Reranker } from "./engine/reranker.ts";

export type { Embedder, Reranker };

/** One row of `config.json` `agents[]` (spec Q3). */
export interface AgentPolicy {
  name: string;
  hasGlobalAccess: boolean;
  private: boolean;
  /**
   * Automatic-layer opt-in (Fatia 2, test/CONTRACT.md §9.1): a NEW, separate
   * boolean key, `false` by default. `true` is the ONLY way an agent receives
   * the automatic block; `name`/`private`/`hasGlobalAccess` do NOT enable it.
   * A present non-boolean is refused at init like the other booleans.
   */
  inject: boolean;
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
  /** Soft retire (M8): set when the record is forgotten; empty = active. */
  retiredAt?: string;
  /** `core_feedback` signal; absent = neutral (useful = useless = 0). */
  feedback?: { useful: number; useless: number };
}

/**
 * One episodic memory record on disk (Fatia 3, test/CONTRACT.md §10.1): *what
 * happened*, with a date — distinct from the undated engrams (`MemoryRecord`).
 * `agent` is required on every episode created by the `episode` op (always the
 * caller's SESSION identity, never a tool argument, §10.3) and is copied
 * **verbatim** on imported episodes; the importer invents nothing, so an
 * ownerless import keeps no `agent` key (§10.5).
 */
export interface Episode {
  /** `EP-<epoch ms>-<4 chars>` — readable, sortable, the PLUR shape. */
  id: string;
  /** ISO 8601 timestamp of the event. */
  at: string;
  /** Who wrote it — the caller's session identity, never a tool argument. */
  agent: string;
  /** The narrative: what happened. */
  summary: string;
  sessionId?: string;
  channel?: string;
  tags?: string[];
  /** Set by `promote` — the memories that came out of this episode. */
  engramIds?: string[];
}

/** `core_memory({ op: "episode" })` result (CONTRACT §10.2). */
export interface EpisodeResult {
  ok: true;
  id: string;
  /** The label format of `store`/`scanned`: `agent:<A>` or `"global"`. */
  ns: string;
}

/** `core_memory({ op: "timeline" })` result (CONTRACT §10.2). */
export interface TimelineResult {
  results: Episode[];
  /** Exactly the namespaces consulted, in the `scanned` label format. */
  scanned: string[];
}

/** `core_memory({ op: "promote" })` result (CONTRACT §10.2). */
export interface PromoteResult {
  ok: true;
  episodeId: string;
  memoryId: string;
}

/** `vectors/<ns>/index.json` — real vectors, keyed by record id. */
export interface VectorIndex {
  embedder: string;
  dim: number;
  /** Model-artifact fingerprint (D5); a mismatch makes the index stale. */
  revision: string;
  vectors: Record<string, number[]>;
}

/**
 * `.code` of the error `recall` throws when a namespace has records and an
 * index whose `embedder`/`dim`/`revision` differ from the active engine — or
 * records and no index at all (CONTRACT §8.4, D5/AC6). The runtime error class
 * lives where it is thrown (`store.ts`), keeping this module type-only.
 */
export type StaleIndexErrorCode = "STALE_INDEX";

/** One `recall` hit as returned to the caller (spec §7.2, CONTRACT §8.3). */
export interface RecallHit {
  id: string;
  text: string;
  agent: string;
  scope: MemoryScope;
  /** The fused RRF score; same value as `rrf` (existing key, CONTRACT §8.3). */
  score: number;
  /** The RRF fused score: Σ 1/(60 + rank + 1) over the legs (CONTRACT §8.3). */
  rrf: number;
  /**
   * Raw per-leg scores for external RRF recomputation (ORACLE ruling of
   * 2026-10-03 18:20, CONTRACT §8.6); `null` = absent from that leg. Optional,
   * so the default shape is unchanged.
   */
  legs?: { bm25: number | null; vector: number | null };
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

/** How the last `recall` ranked (CONTRACT §8.3). */
export type RecallMode = "hybrid" | "hybrid-degraded" | "bm25-only";

/** `core_memory({ op: "recall" })` result. */
export interface RecallResult {
  results: RecallHit[];
  scanned: string[];
  /** Ranking mode actually used (CONTRACT §8.3). */
  mode: RecallMode;
  /** Candidates the reranker actually reordered; 0 when off (CONTRACT §8.3). */
  reranked: number;
}

/** `core_memory({ op: "forget" })` result. */
export interface ForgetResult {
  ok: true;
  retired: string[];
}

/** `core_memory({ op: "feedback" })` result. */
export interface FeedbackResult {
  ok: true;
  id: string;
  usefulness: { useful: number; useless: number };
}

/** Per-namespace counts as reported by `status` (spec §3 row 7). */
export interface StatusNamespaceCount {
  ns: string;
  records: number;
  retired: number;
  retrievals: number;
}

/** `core_memory({ op: "status" })` result — counts only, no memory text. */
export interface StatusResult {
  storageRoot: string;
  configPath: string;
  embedder: string;
  dim: number;
  namespaces: StatusNamespaceCount[];
  totals: { records: number; retired: number; retrievals: number };
}

/** One `doctor` check (AC6 shape). */
export interface DoctorCheck {
  id: string;
  ok: boolean;
  detail: string;
}

/** `core_memory({ op: "doctor" })` result. */
export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
}

/** Per-namespace throughput for `receipt`. */
export interface ReceiptNamespaceCount {
  ns: string;
  stored: number;
  retrieved: number;
  hits: number;
}

/** `core_memory({ op: "receipt" })` result (spec §3 row 9 shape). */
export interface ReceiptResult {
  stored: number;
  retrieved: number;
  hits: number;
  byNamespace: ReceiptNamespaceCount[];
}

/** `core_memory({ op: "admin" })` result — the single dispatcher error shape. */
export interface AdminResult {
  ok: true;
  action: string;
  detail?: string;
}

export type CoreMemoryResult =
  | WhoResult
  | StoreResult
  | RecallResult
  | ForgetResult
  | FeedbackResult
  | EpisodeResult
  | TimelineResult
  | PromoteResult
  | StatusResult
  | DoctorResult
  | ReceiptResult
  | AdminResult;

/**
 * The `core_memory` request. `agentName` is NOT part of it on purpose (spec
 * §7.1): identity is trusted infrastructure data injected by the tool layer.
 *
 * Tool-facing ops (`core_memory`): `who`, `store`, `recall`, `forget`, `feedback`,
 * `episode`, `timeline`, `promote` (Fatia 3, CONTRACT §10.2).
 * Engine-only ops (reached by the MCP through the same `engine.invoke` seam
 * with the admin identity — spec §6/M9): `status`, `doctor`, `receipt`, `admin`.
 */
export type CoreMemoryRequest =
  | { op: "who" }
  | { op: "store"; text: string; target?: NamespaceTarget; meta?: Record<string, unknown> }
  | { op: "recall"; query?: string; limit?: number; from?: NamespaceTarget }
  | { op: "forget"; id?: string; query?: string; target?: "self" | "global" }
  | { op: "feedback"; id: string; useful: boolean }
  | {
      op: "episode";
      summary: string;
      tags?: string[];
      sessionId?: string;
      /** Own space by default; `"global"` only with `hasGlobalAccess` (§10.2). */
      target?: "self" | "global";
    }
  | {
      op: "timeline";
      query?: string;
      since?: string;
      until?: string;
      tags?: string[];
      limit?: number;
      /** Identical to `recall`: `"self"` | `"global"` | `"agent:<X>"`; omitted = readable union. */
      from?: NamespaceTarget;
    }
  | { op: "promote"; episodeId: string; text: string; tags?: string[] }
  | { op: "status"; ns?: string }
  | { op: "doctor" }
  | { op: "receipt"; ns?: string; days?: number }
  | {
      op: "admin";
      action: "purge" | "reindex" | "export" | "import" | "compact";
      args?: Record<string, unknown>;
    };

/** Options accepted by `createEngine` (spec Q3 precedence). */
export interface EngineOptions {
  /** Data root; defaults to `CORE_BRAIN_HOME ?? ~/.config/core-brain`. */
  home?: string;
  /** Explicit config file (highest precedence). */
  configPath?: string;
  /** D4 injection seam; never a `core_memory` input (test/CONTRACT.md §8.2). */
  embedder?: Embedder;
  /** D4 injection seam; never a `core_memory` input (test/CONTRACT.md §8.2). */
  reranker?: Reranker;
}

/** The engine the tool layer drives (test-facing seam, test/CONTRACT.md §2). */
export interface Engine {
  /**
   * `agentName` is trusted infrastructure identity; `invoke` == `core_memory`.
   * D3: `invoke` is ASYNC — every caller must `await` it (CONTRACT §2/§8.1).
   */
  invoke(agentName: string, request: CoreMemoryRequest): Promise<CoreMemoryResult>;
  /**
   * Reads the running agent's RESOLVED policy — the automatic layer's `inject`
   * opt-in is resolved by the ENGINE (Fatia 2, CONTRACT §9.1), never from the
   * caller. An agent absent from `config.json` resolves to the default policy
   * (never throws), exactly like `who`.
   */
  resolvePolicy(agentName: string): AgentPolicy;
}
