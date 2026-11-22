// engine/persistence.ts — the store's disk layer, with a SQLite backend.
//
// WHY IT EXISTS (USER, 2026-11-20). The JSON store re-read and re-parsed its files on every call and
// kept no vectors in memory; a namespace whose index was short made each query pay for a whole
// recomputation (18 180 ms measured). This module keeps the SAME shapes the rest of the store already
// uses — a records array, an index object — and moves them into one SQLite file: `memories` + FTS5 for
// the lexical leg, `vectors` as BLOBs, and an in-memory vector cache that is only rebuilt when the
// database file changes.
//
// Selection: `store: "sqlite"` in config.json, or `CORE_BRAIN_STORE=sqlite`. Default stays `json`
// until the USER flips it, so a regression is one word away from a rollback.

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { writeJsonFileAtomic } from "./atomic-json.ts";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY, namespace TEXT NOT NULL, agent TEXT, scope TEXT, text TEXT NOT NULL,
    meta TEXT, created_at TEXT, updated_at TEXT, score INTEGER DEFAULT 10, retired_at TEXT,
    real INTEGER DEFAULT 1
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    memory_id UNINDEXED, text, tokenize = 'unicode61 remove_diacritics 2'
  );
  CREATE TABLE IF NOT EXISTS vectors (
    memory_id TEXT PRIMARY KEY, namespace TEXT NOT NULL, dim INTEGER NOT NULL, vec BLOB NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_vectors_ns ON vectors(namespace);
  CREATE TABLE IF NOT EXISTS dream_memories (
    id TEXT PRIMARY KEY, namespace TEXT NOT NULL, dream_id TEXT,
    survivor_id TEXT NOT NULL, absorbed_id TEXT NOT NULL,
    survivor_text TEXT NOT NULL, absorbed_text TEXT NOT NULL,
    cosine REAL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL,
    processed_at TEXT, merged_text TEXT, merged_memory_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_dream_memories_status ON dream_memories(status);
  CREATE TABLE IF NOT EXISTS dreams (
    id TEXT PRIMARY KEY, namespace TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'running', episodes INTEGER DEFAULT 0, created INTEGER DEFAULT 0,
    reinforced INTEGER DEFAULT 0, merged INTEGER DEFAULT 0, pending INTEGER DEFAULT 0,
    similar TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_dreams_started ON dreams(started_at);
  CREATE TABLE IF NOT EXISTS memories_history (
    id TEXT PRIMARY KEY, namespace TEXT NOT NULL, agent TEXT, scope TEXT, text TEXT NOT NULL,
    meta TEXT, created_at TEXT, updated_at TEXT, score INTEGER DEFAULT 0, retired_at TEXT,
    real INTEGER DEFAULT 1, archived_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_memories_history_ns ON memories_history(namespace);
`;

type Db = DatabaseSync;
const open = new Map<string, Db>();
/** Guards the first-open seed against re-entering itself through seedFromJson. */
const seeding = new Set<string>();
/** Vector cache per namespace, invalidated by the database file's mtime+size. */
const cache = new Map<string, { stamp: string; vectors: Record<string, number[]> }>();

/**
 * SQLite is the store now (USER, 2026-11-20: he approved the move). `CORE_BRAIN_STORE=json` is the
 * escape hatch while the JSON files still exist beside the database; nothing else chooses the engine.
 */
export function sqliteEnabled(): boolean {
  return process.env.CORE_BRAIN_STORE !== "json";
}

/**
 * The counter is `score` since 2026-11-20 (it was `retrievals`). A database created before the
 * rename is migrated the first time this build opens it — code and data travel together, so an
 * install never leaves the plugin reading a column that no longer exists.
 */
function ensureScoreColumn(db: Db): void {
  for (const table of ["memories", "memories_history"]) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((column) => String(column.name));
    if (columns.includes("retrievals") && !columns.includes("score")) {
      db.exec(`ALTER TABLE ${table} RENAME COLUMN retrievals TO score`);
    }
    // `real` (USER, 2026-11-20): a memory born from a dream is NOT reality; default is real.
    if (!columns.includes("real")) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN real INTEGER DEFAULT 1`);
    }
  }

  // `dreams.similar` (USER, 2026-11-20): the memories the night worked on, as a JSON array of ids.
  const dreamColumns = db.prepare("PRAGMA table_info(dreams)").all().map((column) => String(column.name));
  if (!dreamColumns.includes("similar")) {
    db.exec("ALTER TABLE dreams ADD COLUMN similar TEXT");
  }
}

/**
 * After the first seeding the JSON files stop being read (USER, 2026-11-22: they go to `legacy/`).
 * Only what the DATABASE replaced is moved: `memories.json` per space and the `vectors/` tree.
 * `episodes.json` and `dreams.json` stay where they are — they are still the live store for those.
 * A rename keeps the bytes, so a rollback is a move back.
 */
function moveJsonStoreToLegacy(root: string): number {
  const legacy = join(root, "legacy");
  let moved = 0;
  const moveFile = (from: string, to: string): void => {
    if (!existsSync(from)) return;
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
    moved += 1;
  };
  const agentsDir = join(root, "agents");
  if (existsSync(agentsDir)) {
    for (const name of readdirSync(agentsDir)) {
      moveFile(join(agentsDir, name, "memories.json"), join(legacy, "agents", name, "memories.json"));
    }
  }
  moveFile(join(root, "global", "memories.json"), join(legacy, "global", "memories.json"));
  const vectorsDir = join(root, "vectors");
  if (existsSync(vectorsDir) && !existsSync(join(legacy, "vectors"))) {
    mkdirSync(legacy, { recursive: true });
    renameSync(vectorsDir, join(legacy, "vectors"));
    moved += 1;
  }
  return moved;
}

export function databaseFor(root: string): Db {
  const file = join(root, "memory.db");
  const found = open.get(file);
  if (found) return found;
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec(SCHEMA);
  ensureScoreColumn(db);
  open.set(file, db);
  // First open: the database is EMPTY and the JSON files are still there -> fill it once.
  if (seeding.has(file)) return db;
  seeding.add(file);
  try {
    const count = db.prepare("SELECT COUNT(*) AS n FROM memories").get();
    if (Number(count?.n ?? 0) === 0) {
      const seeded = seedFromJson(root);
      if (seeded.memories > 0) {
        console.log(`[core-brain][store] seeded ${seeded.memories} memories and ${seeded.vectors} vectors from JSON`);
        const moved = moveJsonStoreToLegacy(root);
        if (moved > 0) console.log(`[core-brain][store] moved ${moved} JSON file(s) to legacy/`);
      }
    }
  } catch {
    /* a seeding failure must not take the store down: the callers fall back to the JSON files */
  } finally {
    seeding.delete(file);
  }
  return db;
}

/** `agents/ORACLE/memories.json` -> `agent:ORACLE`; `global/memories.json` -> `global`. */
export function namespaceOf(file: string): string {
  const parts = file.split("/");
  const parent = parts[parts.length - 2];
  return parent === "global" ? "global" : `agent:${parent}`;
}

/** `vectors/ORACLE/index.json` -> `agent:ORACLE`; `vectors/global/index.json` -> `global`. */
export function vectorNamespaceOf(file: string): string {
  const parts = file.split("/");
  const parent = parts[parts.length - 2];
  return parent === "global" ? "global" : `agent:${parent}`;
}


/** The data root that owns a file: `<root>/global/x.json`, `<root>/agents/<ns>/x.json`, `<root>/vectors/<ns>/x.json`. */
export function rootOf(file: string): string {
  const parts = file.split("/");
  const namespaceDir = parts[parts.length - 2];
  const parent = parts[parts.length - 3];
  if (parent === "agents" || parent === "vectors") return parts.slice(0, parts.length - 3).join("/");
  if (namespaceDir === "global") return parts.slice(0, parts.length - 2).join("/");
  return parts.slice(0, parts.length - 1).join("/");
}

const stampOf = (file: string): string => {
  try {
    const info = statSync(file);
    return `${info.mtimeMs}:${info.size}`;
  } catch {
    return "0";
  }
};

/** Every namespace the DATABASE holds — the SQLite backend has no directories to walk. */
export function namespacesInDb(root: string): string[] {
  if (!sqliteEnabled() || !existsSync(join(root, "memory.db"))) return [];
  const rows = databaseFor(root).prepare("SELECT DISTINCT namespace FROM memories").all();
  return rows.map((row) => String(row.namespace));
}

export function readRecordsFromDb(file: string): unknown[] | null {
  const root = rootOf(file);
  const db = databaseFor(root);
  const ns = namespaceOf(file);
  const rows = db.prepare("SELECT * FROM memories WHERE namespace = ? ORDER BY rowid").all(ns);
  if (rows.length === 0 && !existsSync(join(root, "memory.db"))) return null;
  return rows.map((row) => ({
    id: row.id,
    agent: row.agent ?? undefined,
    scope: row.scope ?? undefined,
    text: row.text,
    meta: row.meta ? JSON.parse(row.meta) : {},
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
    score: Number(row.score ?? 0),
    real: Number(row.real ?? 1) !== 0,
    ...(row.retired_at ? { retiredAt: row.retired_at } : {}),
  }));
}

export function writeRecordsToDb(file: string, records: unknown[]): void {
  const root = rootOf(file);
  const db = databaseFor(root);
  const ns = namespaceOf(file);
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM memories WHERE namespace = ?").run(ns);
    db.prepare("DELETE FROM memories_fts WHERE memory_id NOT IN (SELECT id FROM memories)").run();
    const insert = db.prepare(
      "INSERT OR REPLACE INTO memories(id, namespace, agent, scope, text, meta, created_at, updated_at, score, retired_at, real) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    );
    const fts = db.prepare("INSERT INTO memories_fts(memory_id, text) VALUES (?, ?)");
    for (const raw of records) {
      const record = raw as Record<string, unknown>;
      const id = String(record.id);
      insert.run(
        id,
        ns,
        (record.agent as string) ?? null,
        (record.scope as string) ?? null,
        String(record.text ?? ""),
        JSON.stringify(record.meta ?? {}),
        (record.createdAt as string) ?? null,
        (record.updatedAt as string) ?? null,
        Number((record as { score?: number }).score ?? 0),
        (record.retiredAt as string) ?? null,
        (record.real as boolean) === false ? 0 : 1,
      );
      fts.run(id, String(record.text ?? ""));
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** The whole namespace's vectors, cached until the database file changes on disk. */
export function readVectorsFromDb(file: string): Record<string, number[]> | null {
  const root = rootOf(file);
  const dbFile = join(root, "memory.db");
  if (!existsSync(dbFile)) return null;
  const ns = vectorNamespaceOf(file);
  const stamp = `${stampOf(dbFile)}:${ns}`;
  const cached = cache.get(ns);
  if (cached && cached.stamp === stamp) return cached.vectors;
  const db = databaseFor(root);
  const vectors: Record<string, number[]> = {};
  for (const row of db.prepare("SELECT memory_id, dim, vec FROM vectors WHERE namespace = ?").all(ns)) {
    const floats = new Float32Array(row.vec.buffer, row.vec.byteOffset, Number(row.dim));
    vectors[row.memory_id] = Array.from(floats);
  }
  cache.set(ns, { stamp, vectors });
  return vectors;
}

export function writeVectorsToDb(file: string, vectors: Record<string, number[]>): void {
  const root = rootOf(file);
  const db = databaseFor(root);
  const ns = vectorNamespaceOf(file);
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM vectors WHERE namespace = ?").run(ns);
    const insert = db.prepare("INSERT OR REPLACE INTO vectors(memory_id, namespace, dim, vec) VALUES (?,?,?,?)");
    for (const [id, vector] of Object.entries(vectors)) {
      const floats = Float32Array.from(vector);
      insert.run(id, ns, floats.length, Buffer.from(floats.buffer));
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  cache.delete(ns);
}

/** One-off: fill an empty database from the JSON files that sit beside it. */
export function seedFromJson(root: string): { memories: number; vectors: number } {
  const db = databaseFor(root);
  const insert = db.prepare(
    "INSERT OR REPLACE INTO memories(id, namespace, agent, scope, text, meta, created_at, updated_at, score, retired_at, real) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  );
  const fts = db.prepare("INSERT INTO memories_fts(memory_id, text) VALUES (?, ?)");
  const insertVector = db.prepare("INSERT OR REPLACE INTO vectors(memory_id, namespace, dim, vec) VALUES (?,?,?,?)");
  let memories = 0;
  let vectors = 0;

  const files: { ns: string; records: string; index: string }[] = [];
  const globalRecords = join(root, "global", "memories.json");
  if (existsSync(globalRecords)) {
    files.push({ ns: "global", records: globalRecords, index: join(root, "vectors", "global", "index.json") });
  }
  if (existsSync(join(root, "agents"))) {
    for (const name of readdirSync(join(root, "agents"))) {
      const records = join(root, "agents", name, "memories.json");
      if (existsSync(records)) files.push({ ns: `agent:${name}`, records, index: join(root, "vectors", name, "index.json") });
    }
  }

  for (const entry of files) {
    const parsed = JSON.parse(readFileSync(entry.records, "utf8"));
    const records = Array.isArray(parsed) ? parsed : parsed.memories ?? parsed.records ?? [];
    for (const raw of records) {
      const record = raw as Record<string, unknown>;
      insert.run(
        String(record.id),
        entry.ns,
        (record.agent as string) ?? null,
        (record.scope as string) ?? null,
        String(record.text ?? ""),
        JSON.stringify(record.meta ?? {}),
        (record.createdAt as string) ?? null,
        (record.updatedAt as string) ?? null,
        Number((record as { score?: number }).score ?? 0),
        (record.retiredAt as string) ?? null,
        (record.real as boolean) === false ? 0 : 1,
      );
      fts.run(String(record.id), String(record.text ?? ""));
      memories += 1;
    }
    if (existsSync(entry.index)) {
      const index = JSON.parse(readFileSync(entry.index, "utf8"));
      for (const [id, vector] of Object.entries(index.vectors ?? {})) {
        const floats = Float32Array.from(vector as number[]);
        insertVector.run(id, entry.ns, floats.length, Buffer.from(floats.buffer));
        vectors += 1;
      }
    }
  }
  return { memories, vectors };
}

/** The lexical leg straight from FTS5 — BM25 with no corpus in memory. */
export function lexicalSearchFromDb(file: string, query: string, limit: number): string[] {
  const root = rootOf(file);
  if (!existsSync(join(root, "memory.db"))) return [];
  const db = databaseFor(root);
  const ns = namespaceOf(file);
  const clean = query.replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
  if (clean === "") return [];
  try {
    const rows = db
      .prepare(
        "SELECT f.memory_id AS id FROM memories_fts f JOIN memories m ON m.id = f.memory_id " +
          "WHERE memories_fts MATCH ? AND m.namespace = ? ORDER BY bm25(memories_fts) LIMIT ?",
      )
      .all(clean, ns, limit);
    return rows.map((row) => String(row.id));
  } catch {
    return [];
  }
}

export function databasePathFor(file: string): string {
  return join(dirname(dirname(dirname(file))), "memory.db");
}

export function databaseName(file: string): string {
  return basename(databasePathFor(file));
}

// ---------------------------------------------------------------------------
// Dream bookkeeping (USER, 2026-11-20)
// ---------------------------------------------------------------------------
//
// Two tables for analysis:
//   * `dreams`          — one row per pass: when it started, how it ended, and the counts;
//   * `dream_memories`  — one row per pair the pass had to judge: the two texts, the cosine, and
//                         the verdict an agent writes after waking.
//
// The dream itself is still `dreams.json` (the domain record the skill relies on); the tables are the
// queryable copy. `dream_memories` has a JSON fallback (`dream-memories.json`) so the JSON backend —
// the one the suite runs on — keeps the same queue.

/** The queue's lifecycle: a row is born `pending`; an agent settles it. */
export const DREAM_MEMORY_STATUS = {
  pending: "pending",
  processed: "processed",
  skipped: "skipped",
} as const;
export type DreamMemoryStatus = (typeof DREAM_MEMORY_STATUS)[keyof typeof DREAM_MEMORY_STATUS];

/** A pass is `running` until it closes — a row left `running` IS the crash report. */
export const DREAM_RUN_STATUS = {
  running: "running",
  done: "done",
  failed: "failed",
} as const;
export type DreamRunStatus = (typeof DREAM_RUN_STATUS)[keyof typeof DREAM_RUN_STATUS];

/** One dream pass. */
export interface DreamRunRow {
  id: string;
  namespace: string;
  startedAt: string;
  finishedAt: string | null;
  status: DreamRunStatus;
  episodes: number;
  created: number;
  reinforced: number;
  merged: number;
  pending: number;
  /** The ids of the memories the night worked on (the similar pairs). */
  similar?: string[];
}

/** One pair the dream judged: the survivor, the memory it absorbed, and the verdict. */
export interface DreamMemoryRow {
  id: string;
  namespace: string;
  dreamId: string | null;
  survivorId: string;
  absorbedId: string;
  survivorText: string;
  absorbedText: string;
  cosine: number | null;
  status: DreamMemoryStatus;
  createdAt: string;
  processedAt: string | null;
  mergedText: string | null;
  mergedMemoryId: string | null;
}

/** What a verdict may change: the status and its evidence, never the pair itself. */
export interface DreamMemoryVerdict {
  status: DreamMemoryStatus;
  mergedText: string | null;
  mergedMemoryId: string | null;
  processedAt: string;
}

const DREAM_MEMORIES_FILE = "dream-memories.json";

function readDreamMemoriesFile(root: string): DreamMemoryRow[] {
  const file = join(root, DREAM_MEMORIES_FILE);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? (parsed as DreamMemoryRow[]) : [];
  } catch {
    return [];
  }
}

function writeDreamMemoriesFile(root: string, rows: DreamMemoryRow[]): void {
  writeJsonFileAtomic(join(root, DREAM_MEMORIES_FILE), rows);
}

/** Snake-case row as the rest of the module speaks: camelCase, typed, no `any`. */
function toDreamMemoryRow(raw: Record<string, unknown>): DreamMemoryRow {
  return {
    id: String(raw.id),
    namespace: String(raw.namespace),
    dreamId: asText(raw.dream_id),
    survivorId: String(raw.survivor_id),
    absorbedId: String(raw.absorbed_id),
    survivorText: String(raw.survivor_text),
    absorbedText: String(raw.absorbed_text),
    cosine: raw.cosine === null || raw.cosine === undefined ? null : Number(raw.cosine),
    status: String(raw.status) as DreamMemoryStatus,
    createdAt: String(raw.created_at),
    processedAt: asText(raw.processed_at),
    mergedText: asText(raw.merged_text),
    mergedMemoryId: asText(raw.merged_memory_id),
  };
}

/** A JSON array of ids stored in a text column; empty when absent or unreadable. */
function parseIds(value: unknown): string[] {
  if (typeof value !== "string" || value === "") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((id) => String(id)) : [];
  } catch {
    return [];
  }
}

/** A nullable column: absent and null both mean "no value". */
function asText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** Opens the queue for one pair. Idempotent by `id`: the same row is never written twice. */
export function insertDreamMemory(root: string, row: DreamMemoryRow): void {
  if (sqliteEnabled()) {
    const db = databaseFor(root);
    db.prepare(
      "INSERT OR IGNORE INTO dream_memories (id, namespace, dream_id, survivor_id, absorbed_id, " +
        "survivor_text, absorbed_text, cosine, status, created_at, processed_at, merged_text, " +
        "merged_memory_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)",
    ).run(
      row.id,
      row.namespace,
      row.dreamId,
      row.survivorId,
      row.absorbedId,
      row.survivorText,
      row.absorbedText,
      row.cosine,
      row.status,
      row.createdAt,
    );
    return;
  }
  const rows = readDreamMemoriesFile(root);
  if (rows.some((candidate) => candidate.id === row.id)) return;
  rows.push(row);
  writeDreamMemoriesFile(root, rows);
}

/** The rows an agent must still look at (`pending`), or every row of a status when asked. */
export function listDreamMemories(
  root: string,
  status: DreamMemoryStatus | null,
  limit: number,
): DreamMemoryRow[] {
  if (sqliteEnabled()) {
    const db = databaseFor(root);
    const rows = status
      ? db
          .prepare("SELECT * FROM dream_memories WHERE status = ? ORDER BY created_at LIMIT ?")
          .all(status, limit)
      : db.prepare("SELECT * FROM dream_memories ORDER BY created_at DESC LIMIT ?").all(limit);
    return rows.map((raw: Record<string, unknown>) => toDreamMemoryRow(raw));
  }
  const rows = readDreamMemoriesFile(root)
    .filter((row) => (status ? row.status === status : true))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return rows.slice(0, limit);
}

/**
 * Writes the verdict on one pair. `false` when the id is unknown — a mistyped id must not look done.
 * A row already settled keeps its first verdict: the queue is worked once.
 */
export function resolveDreamMemory(root: string, id: string, verdict: DreamMemoryVerdict): boolean {
  if (sqliteEnabled()) {
    const db = databaseFor(root);
    const found = db.prepare("SELECT status FROM dream_memories WHERE id = ?").get(id);
    if (!found) return false;
    if (String(found.status) !== DREAM_MEMORY_STATUS.pending) return true;
    db.prepare(
      "UPDATE dream_memories SET status = ?, processed_at = ?, merged_text = ?, merged_memory_id = ? " +
        "WHERE id = ?",
    ).run(verdict.status, verdict.processedAt, verdict.mergedText, verdict.mergedMemoryId, id);
    return true;
  }
  const rows = readDreamMemoriesFile(root);
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) return false;
  if (row.status === DREAM_MEMORY_STATUS.pending) {
    Object.assign(row, verdict);
    writeDreamMemoriesFile(root, rows);
  }
  return true;
}

/**
 * Settles EVERY pending row that points at one survivor — the verdict of a group, not of a pair
 * (USER, 2026-11-20). A cluster of near-identical memories is ONE decision: asking the reviewer to
 * repeat it per pair would make the queue unworkable. Returns how many rows were settled.
 */
export function resolveDreamMemoriesBySurvivor(
  root: string,
  survivorId: string,
  verdict: DreamMemoryVerdict,
): number {
  if (sqliteEnabled()) {
    const db = databaseFor(root);
    const found = db
      .prepare("SELECT COUNT(*) AS n FROM dream_memories WHERE survivor_id = ? AND status = ?")
      .get(survivorId, DREAM_MEMORY_STATUS.pending);
    const pending = Number(found?.n ?? 0);
    if (pending === 0) return 0;
    db.prepare(
      "UPDATE dream_memories SET status = ?, processed_at = ?, merged_text = ?, merged_memory_id = ? " +
        "WHERE survivor_id = ? AND status = ?",
    ).run(
      verdict.status,
      verdict.processedAt,
      verdict.mergedText,
      verdict.mergedMemoryId,
      survivorId,
      DREAM_MEMORY_STATUS.pending,
    );
    return pending;
  }
  const rows = readDreamMemoriesFile(root);
  let settled = 0;
  for (const row of rows) {
    if (row.survivorId !== survivorId || row.status !== DREAM_MEMORY_STATUS.pending) continue;
    Object.assign(row, verdict);
    settled += 1;
  }
  if (settled > 0) writeDreamMemoriesFile(root, rows);
  return settled;
}

/** Opens a pass. Called once, before anything is written to the memories. */
export function startDreamRun(root: string, pass: { id: string; namespace: string; startedAt: string }): void {
  if (!sqliteEnabled()) return; // the JSON backend keeps the pass in dreams.json alone
  const db = databaseFor(root);
  db.prepare(
    "INSERT OR IGNORE INTO dreams (id, namespace, started_at, finished_at, status, episodes, created, " +
      "reinforced, merged, pending) VALUES (?, ?, ?, NULL, ?, 0, 0, 0, 0, 0)",
  ).run(pass.id, pass.namespace, pass.startedAt, DREAM_RUN_STATUS.running);
}

/** What a closed pass reports. `status: failed` uses the same door as `done`. */
export interface DreamRunSummary {
  status: DreamRunStatus;
  finishedAt: string;
  episodes: number;
  created: number;
  reinforced: number;
  merged: number;
  pending: number;
  /** The ids of the memories the night worked on (the similar pairs). */
  similar?: string[];
}

export function finishDreamRun(root: string, id: string, summary: DreamRunSummary): void {
  if (!sqliteEnabled()) return;
  const db = databaseFor(root);
  db.prepare(
    "UPDATE dreams SET status = ?, finished_at = ?, episodes = ?, created = ?, reinforced = ?, " +
      "merged = ?, pending = ?, similar = ? WHERE id = ?",
  ).run(
    summary.status,
    summary.finishedAt,
    summary.episodes,
    summary.created,
    summary.reinforced,
    summary.merged,
    summary.pending,
    JSON.stringify(summary.similar ?? []),
    id,
  );
}

/** `global` + one entry per agent directory — the spaces a dream record may live in. */
function dreamSpaces(root: string): Array<{ dir: string; namespace: string }> {
  const spaces: Array<{ dir: string; namespace: string }> = [
    { dir: join(root, "global"), namespace: "global" },
  ];
  const agentsDir = join(root, "agents");
  if (!existsSync(agentsDir)) return spaces;
  for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
    if (entry.isDirectory()) spaces.push({ dir: join(agentsDir, entry.name), namespace: `agent:${entry.name}` });
  }
  return spaces;
}

/** A `dreams.json` array, or nothing when the file is missing or unreadable. */
function readDreamsFile(file: string): Array<Record<string, unknown>> {
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

/** The JSON backend has no table: a pass exists only once dreams.json carries it, so it is `done`. */
function dreamRunsFromJson(root: string): DreamRunRow[] {
  const rows: DreamRunRow[] = [];
  for (const space of dreamSpaces(root)) {
    for (const raw of readDreamsFile(join(space.dir, "dreams.json"))) {
      rows.push({
        id: String(raw.id),
        namespace: space.namespace,
        startedAt: String(raw.at),
        finishedAt: String(raw.at),
        status: DREAM_RUN_STATUS.done,
        episodes: Array.isArray(raw.episodes) ? raw.episodes.length : 0,
        created: Array.isArray(raw.memories) ? raw.memories.length : 0,
        reinforced: Array.isArray(raw.reinforced) ? raw.reinforced.length : 0,
        merged: 0,
        pending: 0,
      });
    }
  }
  return rows;
}

/** The passes, newest first — what the USER reads to analyse the dreams. */export function listDreamRuns(root: string, limit: number): DreamRunRow[] {
  const rows = sqliteEnabled()
    ? databaseFor(root)
        .prepare("SELECT * FROM dreams ORDER BY started_at DESC LIMIT ?")
        .all(limit)
        .map((raw: Record<string, unknown>) => ({
          id: String(raw.id),
          namespace: String(raw.namespace),
          startedAt: String(raw.started_at),
          finishedAt: asText(raw.finished_at),
          status: String(raw.status) as DreamRunStatus,
          episodes: Number(raw.episodes ?? 0),
          created: Number(raw.created ?? 0),
          reinforced: Number(raw.reinforced ?? 0),
          merged: Number(raw.merged ?? 0),
          pending: Number(raw.pending ?? 0),
          similar: parseIds(raw.similar),
        }))
    : dreamRunsFromJson(root);
  rows.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  return rows.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Memories history (USER, 2026-11-20)
// ---------------------------------------------------------------------------
//
// The live table is what an agent reads on every call; a RETIRED record is audit material and must
// not keep inflating it. At the end of each dream the retired rows move to `memories_history` — same
// columns plus `archived_at` — with their FTS entry and vector dropped, because a retired memory is
// never recalled again. The history is the USER's: he may delete it whenever he likes.

/**
 * Moves every RETIRED memory of the database into `memories_history` and returns how many moved.
 * Idempotent: a row already moved is no longer in `memories`. JSON backend: no-op (nothing to move —
 * the JSON files are the history).
 */
export function archiveRetiredMemories(root: string): number {
  if (!sqliteEnabled()) return 0;
  const db = databaseFor(root);
  const pending = Number(db.prepare("SELECT COUNT(*) AS n FROM memories WHERE retired_at IS NOT NULL").get()?.n ?? 0);
  if (pending === 0) return 0;

  const now = new Date().toISOString();
  const retiredCondition = "retired_at IS NOT NULL";
  db.exec("BEGIN");
  try {
    // REPLACE, not IGNORE (USER, 2026-11-21): a memory retired, restored and retired again found
    // its old row still in the history, the INSERT was ignored, and the row was then deleted from
    // `memories` — the newer retirement vanished. The history keeps one row per memory, always its
    // latest state, and no column is ever lost on the way in.
    db.prepare(
      "INSERT OR REPLACE INTO memories_history (id, namespace, agent, scope, text, meta, created_at, " +
        "updated_at, score, retired_at, real, archived_at) SELECT id, namespace, agent, scope, text, " +
        `meta, created_at, updated_at, score, retired_at, real, ? FROM memories WHERE ${retiredCondition}`,
    ).run(now);
    db.prepare(`DELETE FROM memories_fts WHERE memory_id IN (SELECT id FROM memories WHERE ${retiredCondition})`).run();
    db.prepare(`DELETE FROM vectors WHERE memory_id IN (SELECT id FROM memories WHERE ${retiredCondition})`).run();
    db.prepare(`DELETE FROM memories WHERE ${retiredCondition}`).run();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return pending;
}

/** How many memories the history holds — the number the USER reads before deciding to prune it. */
export function countArchivedMemories(root: string): number {
  if (!sqliteEnabled()) return 0;
  return Number(databaseFor(root).prepare("SELECT COUNT(*) AS n FROM memories_history").get()?.n ?? 0);
}

// ---------------------------------------------------------------------------
// The nightly score (USER, 2026-11-20)
// ---------------------------------------------------------------------------
//
// Applied at the END of a dream, never at its start: a night that fails changes nothing. Order:
// forget one point from every memory, then stamp `retired_at` on everything at or below zero, then
// archive. The archive sweep is what makes room; these two only decide who leaves.

/** Every memory loses one point. Returns how many rows changed. */
export function decayScores(root: string, amount = 1): number {
  if (!sqliteEnabled()) return 0;
  const db = databaseFor(root);
  const changed = db.prepare("UPDATE memories SET score = score - ? WHERE retired_at IS NULL").run(amount);
  return Number(changed.changes ?? 0);
}

/** Everything at or below zero is retired (a negative left by a bug retires too). Returns the count. */
export function retireExhausted(root: string): number {
  if (!sqliteEnabled()) return 0;
  const db = databaseFor(root);
  const now = new Date().toISOString();
  const changed = db
    .prepare("UPDATE memories SET retired_at = ? WHERE retired_at IS NULL AND score <= 0")
    .run(now);
  return Number(changed.changes ?? 0);
}
