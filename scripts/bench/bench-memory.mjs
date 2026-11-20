#!/usr/bin/env node
// Benchmark on a COPY of the store (USER, 2026-11-20). The official store is never touched.
//
// It separates the three costs of a query — embed the query, scan the vectors, and the whole
// hybrid recall — and then models the OLD slow path (re-embedding every record per query) to show
// how many queries it takes to reach the 17 s the USER measured.
//
// Run: node --experimental-strip-types bench-memory.mjs <copy-dir> [queries]

import { createEngine } from "/media/gandb/workspace/oesc/core-brain/global/opencode/plugins/core-brain/store.ts";
import { createConfiguredEmbedder } from "/media/gandb/workspace/oesc/core-brain/global/opencode/plugins/core-brain/engine/embedder.ts";
import { readFileSync, existsSync } from "node:fs";

const ROOT = process.argv[2] ?? "/tmp/opencode/corebrain-bench";
const ROUNDS = Number(process.argv[3] ?? 12);
const QUERIES = [
  "código e comentários em inglês",
  "sonhos consolidam memórias",
  "instalação apaga a configuração",
  "modo de voz sem questionários",
  "duplicados com o mesmo significado",
  "velocidade do índice de vectores",
  "índice global vazio",
  "regras do taulukko e do corebrain",
  "limite de seiscentas letras",
  "banco de testes do Laya",
  "ferramentas MCP e browsers",
  "mensagens invertidas no chat",
];

const embedder = createConfiguredEmbedder({ profile: "multilingual-minilm" });
const now = () => Date.now();

// --- 1. embed the query ------------------------------------------------------
const embedTimes = [];
for (let i = 0; i < ROUNDS; i += 1) {
  const started = now();
  await embedder.embed(QUERIES[i % QUERIES.length]);
  embedTimes.push(now() - started);
}

// --- 2. vector scan over the copied index ------------------------------------
const indexFile = `${ROOT}/vectors/global/index.json`;
let vectors = {};
if (existsSync(indexFile)) {
  vectors = JSON.parse(readFileSync(indexFile, "utf8")).vectors ?? {};
}
const entries = Object.entries(vectors);
const queryVec = await embedder.embed(QUERIES[0]);
const scanTimes = [];
for (let i = 0; i < ROUNDS; i += 1) {
  const started = now();
  let best = -Infinity;
  for (const [, vector] of entries) {
    let dot = 0;
    for (let d = 0; d < vector.length; d += 1) dot += queryVec[d] * vector[d];
    if (dot > best) best = dot;
  }
  scanTimes.push(now() - started);
}

// --- 3. full hybrid recall on the copy ---------------------------------------
const engine = createEngine({ home: ROOT });
const recallTimes = [];
for (let i = 0; i < ROUNDS; i += 1) {
  const started = now();
  await engine.invoke("ORACLE", {
    op: "recall",
    limit: 5,
    from: "global",
    countRetrievals: false,
    query: QUERIES[i % QUERIES.length],
  });
  recallTimes.push(now() - started);
}

// --- 4. the old slow path: embed every record of the namespace ---------------
const memories = JSON.parse(readFileSync(`${ROOT}/global/memories.json`, "utf8"));
const records = Array.isArray(memories) ? memories : memories.memories ?? memories.records ?? [];
const sample = records.slice(0, 20);
const started = now();
for (const record of sample) await embedder.embed(String(record.text ?? ""));
const perRecord = (now() - started) / Math.max(1, sample.length);

const stats = (list) => {
  const sorted = [...list].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    avg: Number((sum / sorted.length).toFixed(1)),
    median: sorted[Math.floor(sorted.length / 2)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
};
const e = stats(embedTimes);
const s = stats(scanTimes);
const r = stats(recallTimes);

console.log(`cópia: ${ROOT}`);
console.log(`vectores no índice global: ${entries.length} · memórias no global: ${records.length}`);
console.log(`\n1. embed da pergunta      média ${e.avg} ms · mediana ${e.median} · min ${e.min} · max ${e.max}`);
console.log(`2. varrer ${String(entries.length).padStart(5)} vectores   média ${s.avg} ms · mediana ${s.median} · min ${s.min} · max ${s.max}`);
console.log(`3. recall híbrido global  média ${r.avg} ms · mediana ${r.median} · min ${r.min} · max ${r.max}`);
console.log(`\n4. embed por memória      ${perRecord.toFixed(1)} ms · × ${records.length} memórias = ${(perRecord * records.length).toFixed(0)} ms por consulta`);
console.log(
  `   ⇒ para somar 17 s: ${Math.ceil(17000 / (e.avg + s.avg + r.avg))} consultas do caminho saudável, ` +
    `ou ${Math.max(1, Math.floor(17000 / (perRecord * records.length)))} do caminho que recalcula tudo`,
);
