#!/usr/bin/env node
// reindex-sqlite.mjs — fill the vectors table for records that have none (USER, 2026-11-20).
//
// The JSON store shipped a global index with 2 vectors for 635 records; that is what made every
// query re-embed the namespace. This script embeds only what is missing, in batches, and writes the
// BLOBs — a one-off cost, never a per-query one.
//
// Usage: node reindex-sqlite.mjs <data-root> [batch]

import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { createConfiguredEmbedder } from "/media/gandb/workspace/oesc/core-brain/global/opencode/plugins/core-brain/engine/embedder.ts";

const ROOT = process.argv[2];
const BATCH = Number(process.argv[3] ?? 25);
if (!ROOT) {
  console.error("usage: reindex-sqlite.mjs <data-root> [batch]");
  process.exit(2);
}

const db = new DatabaseSync(join(ROOT, "memory.db"));
const embedder = createConfiguredEmbedder({ profile: "multilingual-minilm" });

const namespaces = db.prepare("SELECT DISTINCT namespace AS ns FROM memories").all().map((row) => String(row.ns));
let total = 0;

for (const ns of namespaces) {
  const missing = db
    .prepare(
      "SELECT m.id, m.text FROM memories m LEFT JOIN vectors v ON v.memory_id = m.id " +
        "WHERE m.namespace = ? AND v.memory_id IS NULL AND m.retired_at IS NULL",
    )
    .all(ns);
  if (missing.length === 0) {
    console.log(`${ns}: completo`);
    continue;
  }
  const insert = db.prepare("INSERT OR REPLACE INTO vectors(memory_id, namespace, dim, vec) VALUES (?,?,?,?)");
  const started = Date.now();
  for (let index = 0; index < missing.length; index += BATCH) {
    const slice = missing.slice(index, index + BATCH);
    for (const row of slice) {
      const vector = await embedder.embed(String(row.text ?? ""));
      const floats = Float32Array.from(vector);
      insert.run(String(row.id), ns, floats.length, Buffer.from(floats.buffer));
      total += 1;
    }
    const done = Math.min(missing.length, index + BATCH);
    process.stdout.write(`\r${ns}: ${done}/${missing.length}`);
  }
  console.log(` ${ns}: +${missing.length} vectores em ${Date.now() - started} ms`);
}

const counts = db.prepare("SELECT namespace AS ns, COUNT(*) AS n FROM vectors GROUP BY namespace").all();
console.log(`\nvectores reindexados: ${total}`);
for (const row of counts) console.log(`  ${row.ns}: ${row.n}`);
