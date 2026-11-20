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
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY, namespace TEXT NOT NULL, agent TEXT, scope TEXT, text TEXT NOT NULL,
    meta TEXT, created_at TEXT, updated_at TEXT, retrievals INTEGER DEFAULT 0, retired_at TEXT
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    memory_id UNINDEXED, text, tokenize = 'unicode61 remove_diacritics 2'
  );
  CREATE TABLE IF NOT EXISTS vectors (
    memory_id TEXT PRIMARY KEY, namespace TEXT NOT NULL, dim INTEGER NOT NULL, vec BLOB NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_vectors_ns ON vectors(namespace);
`;

type Db = DatabaseSync;
const open = new Map<string, Db>();
/** Guards the first-open seed against re-entering itself through seedFromJson. */
const seeding = new Set<string>();
/** Vector cache per namespace, invalidated by the database file's mtime+size. */
const cache = new Map<string, { stamp: string; vectors: Record<string, number[]> }>();

/**
 * SQLite is the store now (USER, 2026-11-20: «pode fazer a mudança»). `CORE_BRAIN_STORE=json` is the
 * escape hatch while the JSON files still exist beside the database; nothing else chooses the engine.
 */
export function sqliteEnabled(): boolean {
  return process.env.CORE_BRAIN_STORE !== "json";
}

export function databaseFor(root: string): Db {
  const file = join(root, "memory.db");
  const found = open.get(file);
  if (found) return found;
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec(SCHEMA);
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
    retrievals: Number(row.retrievals ?? 0),
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
      "INSERT OR REPLACE INTO memories(id, namespace, agent, scope, text, meta, created_at, updated_at, retrievals, retired_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
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
        Number(record.retrievals ?? 0),
        (record.retiredAt as string) ?? null,
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
    "INSERT OR REPLACE INTO memories(id, namespace, agent, scope, text, meta, created_at, updated_at, retrievals, retired_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
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
        Number(record.retrievals ?? 0),
        (record.retiredAt as string) ?? null,
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
