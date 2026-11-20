#!/usr/bin/env node
// migrate-sqlite.mjs — build a SQLite store from the JSON files (USER, 2026-11-20).
//
// Reads a core-brain data root (memories.json + vectors/*/index.json per namespace) and writes
// memory.db beside it: `memories` + FTS5 over the text + `vectors` as BLOBs. Never touches the
// official store unless given its path; the benchmark runs it against a copy.
//
// Usage: node migrate-sqlite.mjs <data-root>

import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.argv[2];
if (!ROOT) {
  console.error("usage: migrate-sqlite.mjs <data-root>");
  process.exit(2);
}
const DB = join(ROOT, "memory.db");
if (existsSync(DB)) rmSync(DB);

const db = new DatabaseSync(DB);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA synchronous = NORMAL;");
db.exec(`
  CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    namespace TEXT NOT NULL,
    agent TEXT,
    scope TEXT,
    text TEXT NOT NULL,
    meta TEXT,
    created_at TEXT,
    updated_at TEXT,
    retrievals INTEGER DEFAULT 0,
    retired_at TEXT
  );
  CREATE VIRTUAL TABLE memories_fts USING fts5(memory_id UNINDEXED, text, tokenize = 'unicode61 remove_diacritics 2');
  CREATE TABLE vectors (
    memory_id TEXT PRIMARY KEY,
    namespace TEXT NOT NULL,
    dim INTEGER NOT NULL,
    vec BLOB NOT NULL
  );
  CREATE INDEX idx_vectors_ns ON vectors(namespace);
`);
const insertMemory = db.prepare(
  "INSERT OR REPLACE INTO memories(id, namespace, agent, scope, text, meta, created_at, updated_at, retrievals, retired_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
);
const insertFts = db.prepare("INSERT INTO memories_fts(memory_id, text) VALUES (?, ?)");
const insertVector = db.prepare("INSERT OR REPLACE INTO vectors(memory_id, namespace, dim, vec) VALUES (?,?,?,?)");

const namespaces = [];
const globalFile = join(ROOT, "global", "memories.json");
if (existsSync(globalFile)) namespaces.push({ ns: "global", file: globalFile, vector: join(ROOT, "vectors", "global", "index.json") });
const agentsDir = join(ROOT, "agents");
if (existsSync(agentsDir)) {
  for (const name of readdirSync(agentsDir)) {
    const file = join(agentsDir, name, "memories.json");
    if (existsSync(file)) namespaces.push({ ns: `agent:${name}`, file, vector: join(ROOT, "vectors", name, "index.json") });
  }
}

let memories = 0;
let vectors = 0;
for (const entry of namespaces) {
  const parsed = JSON.parse(readFileSync(entry.file, "utf8"));
  const records = Array.isArray(parsed) ? parsed : parsed.memories ?? parsed.records ?? [];
  for (const record of records) {
    insertMemory.run(
      String(record.id),
      entry.ns,
      record.agent ?? null,
      record.scope ?? null,
      String(record.text ?? ""),
      JSON.stringify(record.meta ?? {}),
      record.createdAt ?? null,
      record.updatedAt ?? null,
      Number(record.retrievals ?? 0),
      record.retiredAt ?? null,
    );
    insertFts.run(String(record.id), String(record.text ?? ""));
    memories += 1;
  }

  if (existsSync(entry.vector)) {
    const index = JSON.parse(readFileSync(entry.vector, "utf8"));
    for (const [id, vector] of Object.entries(index.vectors ?? {})) {
      const floats = Float32Array.from(vector);
      insertVector.run(id, entry.ns, floats.length, Buffer.from(floats.buffer));
      vectors += 1;
    }
  }
  console.log(`  ${entry.ns}: ${records.length} memórias`);
}

const count = db.prepare("SELECT COUNT(*) AS n FROM memories").get();
console.log(`\nDB: ${DB}`);
console.log(`memórias gravadas: ${count.n} (contadas ${memories}) · vectores: ${vectors}`);
