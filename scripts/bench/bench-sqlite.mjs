#!/usr/bin/env node
// bench-sqlite.mjs — the same queries as bench-memory.mjs, answered by the SQLite store.
// Lexical leg = FTS5/bm25, vector leg = cosine over the BLOBs, fusion = RRF. Nothing else.
//
// Usage: node bench-sqlite.mjs <data-root> [rounds] [query]

import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { createConfiguredEmbedder } from "/media/gandb/workspace/oesc/core-brain/global/opencode/plugins/core-brain/engine/embedder.ts";

const ROOT = process.argv[2] ?? "/tmp/opencode/corebrain-bench";
const ROUNDS = Number(process.argv[3] ?? 10);
const db = new DatabaseSync(join(ROOT, "memory.db"));

const QUERIES = [
  "código e comentários em inglês",
  "sonhos consolidam memórias",
  "instalação apaga a configuração",
  "modo de voz sem questionários",
  "duplicados com o mesmo significado",
  "velocidade do índice de vectores",
  "índice global vazio",
  "regras do taulukoo e do corebrain",
  "limite de seiscentas letras",
  "banco de testes do Laya",
];

const embedder = createConfiguredEmbedder({ profile: "multilingual-minilm" });
const lexical = db.prepare(
  "SELECT memory_id, bm25(memories_fts) AS score FROM memories_fts WHERE memories_fts MATCH ? ORDER BY score LIMIT 20",
);
const vectorRows = db.prepare("SELECT memory_id, dim, vec FROM vectors WHERE namespace = ?").all("global");

// Load the vectors once: the in-memory cache the JSON store never had.
const cached = vectorRows.map((row) => ({
  id: row.memory_id,
  vec: new Float32Array(row.vec.buffer, row.vec.byteOffset, row.dim),
}));

const cosine = (a, b) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
};

const rrf = (lists, k = 60) => {
  const scores = new Map();
  lists.forEach((list) => {
    list.forEach((id, index) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1)));
  });
  return [...scores].sort((a, b) => b[1] - a[1]).slice(0, 5);
};

async function answer(query) {
  const lexicalHits = lexical.all(query.replace(/[^\p{L}\p{N}\s]/gu, " ").trim()).map((row) => row.memory_id);
  const queryVec = await embedder.embed(query);
  const vectorHits = cached
    .map((entry) => ({ id: entry.id, score: cosine(queryVec, entry.vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((entry) => entry.id);
  return rrf([lexicalHits, vectorHits]);
}

const times = [];
let first = null;
for (let round = 1; round <= ROUNDS; round += 1) {
  const query = QUERIES[(round - 1) % QUERIES.length];
  const started = Date.now();
  const hits = await answer(query);
  const ms = Date.now() - started;
  times.push(ms);
  if (!first) first = { query, hits: hits.map(([id, score]) => `${id.slice(0, 8)} ${score.toFixed(4)}`) };
  console.log(`round ${String(round).padStart(2)}: ${String(ms).padStart(4)} ms · top ${hits.length}`);
}

const sorted = [...times].sort((a, b) => a - b);
const avg = times.reduce((sum, value) => sum + value, 0) / times.length;
console.log(`\nSQLite: média ${avg.toFixed(1)} ms · mediana ${sorted[Math.floor(sorted.length / 2)]} ms · min ${sorted[0]} · max ${sorted[sorted.length - 1]}`);
console.log(`vectores em cache: ${cached.length} · exemplo «${first.query}» → ${first.hits.join(" | ")}`);
