#!/usr/bin/env node
// test/search.selftest.mjs — the AC probe runner for the core-brain engine
// (plan §9). One probe per invocation; EVERY probe prints literal values, never
// a bare boolean.
//
//   node test/search.selftest.mjs --probe semantic
//   node test/search.selftest.mjs --probe fusion [--verbose]
//   node test/search.selftest.mjs --probe rerank
//   node test/search.selftest.mjs --probe rerank-real
//   node test/search.selftest.mjs --probe isolation-hybrid
//   node test/search.selftest.mjs --probe stale-index
//   node test/search.selftest.mjs --probe reindex
//   node test/search.selftest.mjs --probe offline
//   node test/search.selftest.mjs --probe fusion-verbose
//
// Env knobs mirror D4: CORE_BRAIN_EMBEDDER=real|fixture,
// CORE_BRAIN_RERANKER=off|ms-marco|fixture, CORE_BRAIN_OFFLINE=1,
// CORE_BRAIN_FIXTURE_DIR. `--embedder`/`--reranker` set the same env from argv.
//
// Exit 0 only when the requested probe PASSes. Each probe creates its own
// disposable CORE_BRAIN_HOME and removes it in `finally` (rule 21).

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FIXTURE_DIR,
  PROBE_TEXTS,
  cosine,
  createFixtureEmbedder,
  createFixtureReranker,
} from "./fixtures/embedder.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// argv / env
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const argValue = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
if (argv.includes("--embedder")) process.env.CORE_BRAIN_EMBEDDER = argValue("--embedder");
if (argv.includes("--reranker")) process.env.CORE_BRAIN_RERANKER = argValue("--reranker");

const PROBE = argValue("--probe");
const VERBOSE = argv.includes("--verbose");

// ---------------------------------------------------------------------------
// Engine import (fail loud, same contract as the matrix).
// ---------------------------------------------------------------------------

let createEngine;
try {
  ({ createEngine } = await import("../store.ts"));
} catch (error) {
  console.error("COREBRAIN_SEARCH: cannot import '../store.ts'.");
  console.error(String((error && error.message) || error));
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}
function record(id, agent, scope, text) {
  const now = new Date().toISOString();
  return { id, agent, scope, text, meta: {}, createdAt: now, updatedAt: now, retrievals: 0 };
}
const memoriesPath = (home, name) =>
  name === "global" ? join(home, "global", "memories.json") : join(home, "agents", name, "memories.json");
const vectorsPath = (home, name) => join(home, "vectors", name, "index.json");
const sha256File = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

const log = (key, value) =>
  console.log(`${key}=${typeof value === "string" ? value : JSON.stringify(value)}`);

const AGENTS = [
  { name: "CB_ALPHA", hasGlobalAccess: true, private: false },
  { name: "CB_BETA", hasGlobalAccess: true, private: true },
  { name: "CB_GAMMA", hasGlobalAccess: false, private: true },
];

/**
 * Builds a disposable engine. The embedder seam mirrors the engine's own D4
 * resolution: env `real` -> no seam (the engine loads the model); otherwise the
 * offline fixture is injected here so the probe never needs the weights.
 */
function makeHarness({ reranker, seed } = {}) {
  const home = mkdtempSync(join(tmpdir(), "core-brain-probe."));
  writeJson(join(home, "config.json"), { agents: AGENTS });
  if (seed) seed(home); // seed the store layout BEFORE createEngine reads it
  const embedderMode = process.env.CORE_BRAIN_EMBEDDER || "fixture";
  const options = { home, configPath: join(home, "config.json") };
  let fixture = null;
  if (embedderMode !== "real") {
    fixture = createFixtureEmbedder({ dir: FIXTURE_DIR });
    options.embedder = fixture;
  }
  if (reranker) options.reranker = reranker;
  const engine = createEngine(options);
  return { home, engine, fixture, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

function ok(detail = "") {
  return { ok: true, detail };
}
function bad(detail) {
  return { ok: false, detail };
}
const rankOf = (results, text) => results.findIndex((hit) => hit.text === text);
const textsOf = (results) => results.map((hit) => hit.text);

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

// AC1 — semantic: a no-shared-word paraphrase outranks a keyword-sharing decoy.
async function semantic() {
  const h = makeHarness();
  try {
    log("probe", "semantic");
    log("embedder_mode", process.env.CORE_BRAIN_EMBEDDER || "fixture");
    const query = PROBE_TEXTS.semanticQuery;
    const paraphrase = PROBE_TEXTS.semanticParaphrase;
    const decoy = PROBE_TEXTS.semanticDecoy;
    log("query", query);
    log("paraphrase", paraphrase);
    log("decoy", decoy);
    await h.engine.invoke("CB_ALPHA", { op: "store", text: paraphrase, target: "self" });
    await h.engine.invoke("CB_ALPHA", { op: "store", text: decoy, target: "self" });
    const r = await h.engine.invoke("CB_ALPHA", { op: "recall", query, from: "self", limit: 5 });
    log("mode", r.mode);
    log("order", textsOf(r.results));
    log("rrf", r.results.map((hit) => hit.rrf));
    if (h.fixture) {
      const qv = h.fixture.embed(query);
      log("cos_query_paraphrase", cosine(qv, h.fixture.embed(paraphrase)).toFixed(6));
      log("cos_query_decoy", cosine(qv, h.fixture.embed(decoy)).toFixed(6));
    }
    const rp = rankOf(r.results, paraphrase);
    const rd = rankOf(r.results, decoy);
    if (rp < 0 || rd < 0) return bad(`both records must be returned (paraphrase=${rp}, decoy=${rd})`);
    if (!(rp < rd)) return bad(`paraphrase rank ${rp} must be above decoy rank ${rd}`);
    return ok(`paraphrase rank ${rp} < decoy rank ${rd}`);
  } finally {
    h.cleanup();
  }
}

// AC2 + E2 — hybrid: one keyword-only and one vector-only record both fused.
async function fusion({ verbose = VERBOSE } = {}) {
  const h = makeHarness();
  try {
    log("probe", verbose ? "fusion-verbose" : "fusion");
    const query = PROBE_TEXTS.fusionQuery;
    const keywordOnly = PROBE_TEXTS.fusionKeywordOnly;
    const vectorOnly = PROBE_TEXTS.fusionVectorOnly;
    log("query", query);
    log("keyword_only", keywordOnly);
    log("vector_only", vectorOnly);
    await h.engine.invoke("CB_ALPHA", { op: "store", text: keywordOnly, target: "self" });
    await h.engine.invoke("CB_ALPHA", { op: "store", text: vectorOnly, target: "self" });
    const r = await h.engine.invoke("CB_ALPHA", { op: "recall", query, from: "self", limit: 5 });
    log("mode", r.mode);
    log("order", textsOf(r.results));
    for (const hit of r.results) {
      log(
        `hit:${hit.text.slice(0, 24)}`,
        { rrf: hit.rrf, score: hit.score, retrievals: hit.retrievals, legs: hit.legs ?? "absent" },
      );
    }
    if (r.results.some((hit) => !Number.isFinite(hit.rrf))) {
      return bad("every hit must carry a numeric `rrf` (the fused RRF score)");
    }
    const rrfDescending = r.results.every(
      (hit, i) => i === 0 || r.results[i - 1].rrf >= hit.rrf,
    );
    if (!rrfDescending) return bad(`results are not in descending rrf order: ${JSON.stringify(r.results.map((x) => x.rrf))}`);
    const hasKeyword = rankOf(r.results, keywordOnly) >= 0;
    const hasVector = rankOf(r.results, vectorOnly) >= 0;
    if (!hasKeyword || !hasVector) return bad(`both legs must be present (keyword=${hasKeyword}, vector=${hasVector})`);
    if (r.mode !== "hybrid") return bad(`mode must be "hybrid", got ${JSON.stringify(r.mode)}`);
    if (verbose && r.results.every((hit) => !Array.isArray(hit.legs))) {
      console.log("legs_note=raw leg fields are not part of the pinned shape (CONTRACT.md §8.6)");
    }
    return ok("keyword-only and vector-only both fused; rrf descending; mode=hybrid");
  } finally {
    h.cleanup();
  }
}

// AC3 — off keeps the RRF order and reranked=0; on changes it and reranked>0.
async function rerankCommon({ real }) {
  const query = PROBE_TEXTS.fusionQuery;
  const docs = [PROBE_TEXTS.fusionKeywordOnly, PROBE_TEXTS.fusionVectorOnly, PROBE_TEXTS.rerankAnchor];
  const savedReranker = process.env.CORE_BRAIN_RERANKER;
  process.env.CORE_BRAIN_RERANKER = "off"; // the off run must be off, whatever the caller exported
  const off = makeHarness();
  try {
    for (const text of docs) await off.engine.invoke("CB_ALPHA", { op: "store", text, target: "self" });
    const rOff = await off.engine.invoke("CB_ALPHA", { op: "recall", query, from: "self", limit: 5 });
    process.env.CORE_BRAIN_RERANKER = real ? "ms-marco" : "fixture";
    const on = makeHarness(real ? {} : { reranker: createFixtureReranker() });
    try {
      for (const text of docs) await on.engine.invoke("CB_ALPHA", { op: "store", text, target: "self" });
      const rOn = await on.engine.invoke("CB_ALPHA", { op: "recall", query, from: "self", limit: 5 });
      log("probe", real ? "rerank-real" : "rerank");
      log("reranker", real ? "ms-marco (real)" : "fixture");
      log("off.order", textsOf(rOff.results));
      log("off.reranked", rOff.reranked);
      log("off.mode", rOff.mode);
      log("on.order", textsOf(rOn.results));
      log("on.reranked", rOn.reranked);
      log("on.mode", rOn.mode);
      if (rOff.reranked !== 0) return bad(`reranker off must report reranked=0, got ${rOff.reranked}`);
      if (!(rOn.reranked > 0)) return bad(`reranker on must report reranked>0, got ${rOn.reranked}`);
      const changed = JSON.stringify(textsOf(rOn.results)) !== JSON.stringify(textsOf(rOff.results));
      if (!changed) return bad("reranker on must change the order relative to RRF");

      return ok("off=RRF order reranked=0; on=changed reranked>0");
    } finally {
      on.cleanup();
    }
  } finally {
    off.cleanup();
    if (savedReranker === undefined) delete process.env.CORE_BRAIN_RERANKER;
    else process.env.CORE_BRAIN_RERANKER = savedReranker;
  }
}
const rerank = () => rerankCommon({ real: false });
const rerankReal = async () => {
  if ((process.env.CORE_BRAIN_EMBEDDER || "") !== "real") {
    log("embedder_mode", process.env.CORE_BRAIN_EMBEDDER || "(unset)");
    return bad("rerank-real requires CORE_BRAIN_EMBEDDER=real (weights cached)");
  }
  return rerankCommon({ real: true });
};

// AC5 — a live query from CB_GAMMA never widens the readable set.
async function isolationHybrid() {
  const h = makeHarness();
  try {
    log("probe", "isolation-hybrid");
    const query = PROBE_TEXTS.fusionQuery;
    log("query", query);
    await h.engine.invoke("CB_BETA", { op: "store", text: PROBE_TEXTS.fusionKeywordOnly, target: "self" });
    await h.engine.invoke("CB_GAMMA", { op: "store", text: PROBE_TEXTS.fusionVectorOnly, target: "self" });
    const withQuery = await h.engine.invoke("CB_GAMMA", { op: "recall", query, from: "self" });
    const withoutQuery = await h.engine.invoke("CB_GAMMA", { op: "recall", from: "self" });
    log("queryless.scanned", withoutQuery.scanned);
    log("hybrid.scanned", withQuery.scanned);
    log("hybrid.result_agents", withQuery.results.map((hit) => hit.agent));
    log("hybrid.result_texts", textsOf(withQuery.results));
    log("hybrid.mode", withQuery.mode);
    if (withQuery.results.some((hit) => String(hit.agent).includes("CB_BETA"))) {
      return bad("a private CB_BETA record leaked into the hybrid results");
    }
    if (withQuery.scanned.some((ns) => String(ns).includes("CB_BETA"))) {
      return bad(`hybrid scanned widened to CB_BETA: ${JSON.stringify(withQuery.scanned)}`);
    }
    if (JSON.stringify(withQuery.scanned) !== JSON.stringify(withoutQuery.scanned)) {
      return bad(`hybrid scanned differs from the query-less union: ${JSON.stringify(withQuery.scanned)} vs ${JSON.stringify(withoutQuery.scanned)}`);
    }
    return ok("no CB_BETA record and scanned equals the pre-change union");
  } finally {
    h.cleanup();
  }
}

// AC6 — a stale index makes recall throw STALE_INDEX naming ns + reindex.
async function staleIndex() {
  const staleText = PROBE_TEXTS.fusionKeywordOnly;
  const h = makeHarness({
    seed(home) {
      // A persisted index built by a DIFFERENT embedder/dim: a stale state.
      writeJson(memoriesPath(home, "CB_ALPHA"), [record("alpha-stale", "CB_ALPHA", "agent", staleText)]);
      writeJson(vectorsPath(home, "CB_ALPHA"), {
        embedder: "hash-ngram-v1",
        dim: 256,
        vectors: { "alpha-stale": new Array(256).fill(0) },
      });
    },
  });
  try {
    log("probe", "stale-index");
    let caught = null;
    try {
      const r = await h.engine.invoke("CB_ALPHA", { op: "recall", query: staleText, from: "self" });
      log("returned", true);
      log("results", textsOf(r.results));
    } catch (error) {
      caught = error;
    }
    if (!caught) return bad("recall returned instead of throwing on a stale index");
    log("error.code", caught.code ?? "(no code)");
    log("error.message", String(caught.message));
    if (caught.code !== "STALE_INDEX") return bad(`code must be "STALE_INDEX", got ${JSON.stringify(caught.code)}`);
    if (!String(caught.message).includes("CB_ALPHA") || !/reindex/i.test(String(caught.message))) {
      return bad("message must name the namespace and reindex");
    }
    return ok("recall threw STALE_INDEX naming the namespace and reindex");
  } finally {
    h.cleanup();
  }
}

// AC7 — reindex rebuilds, is idempotent, and the AC1 relation then holds.
async function reindex() {
  const h = makeHarness();
  try {
    log("probe", "reindex");
    const query = PROBE_TEXTS.semanticQuery;
    const paraphrase = PROBE_TEXTS.semanticParaphrase;
    const decoy = PROBE_TEXTS.semanticDecoy;
    for (const text of [paraphrase, decoy]) {
      await h.engine.invoke("CB_ALPHA", { op: "store", text, target: "self" });
    }
    const first = await h.engine.invoke("CB_ALPHA", { op: "admin", action: "reindex" });
    const shaFirst = sha256File(vectorsPath(h.home, "CB_ALPHA"));
    const second = await h.engine.invoke("CB_ALPHA", { op: "admin", action: "reindex" });
    const shaSecond = sha256File(vectorsPath(h.home, "CB_ALPHA"));
    log("reindex.first.ok", first.ok === true);
    log("reindex.second.ok", second.ok === true);
    log("sha256.first", shaFirst);
    log("sha256.second", shaSecond);
    if (shaFirst !== shaSecond) return bad("two consecutive reindex runs are not byte-identical");
    const r = await h.engine.invoke("CB_ALPHA", { op: "recall", query, from: "self", limit: 5 });
    log("post_reindex.order", textsOf(r.results));
    const rp = rankOf(r.results, paraphrase);
    const rd = rankOf(r.results, decoy);
    if (!(rp >= 0 && rd >= 0 && rp < rd)) return bad(`after reindex paraphrase (${rp}) must outrank decoy (${rd})`);
    return ok("reindex idempotent (identical sha256) and the semantic relation holds");
  } finally {
    h.cleanup();
  }
}

// AC8 — offline: real engine, weights from the cache, no network fetch.
async function offline() {
  if ((process.env.CORE_BRAIN_EMBEDDER || "") !== "real") {
    log("embedder_mode", process.env.CORE_BRAIN_EMBEDDER || "(unset)");
    return bad("offline requires CORE_BRAIN_EMBEDDER=real");
  }
  if (!process.env.CORE_BRAIN_OFFLINE) {
    log("CORE_BRAIN_OFFLINE", process.env.CORE_BRAIN_OFFLINE ?? "(unset)");
    return bad("offline requires CORE_BRAIN_OFFLINE=1");
  }
  const h = makeHarness();
  try {
    log("probe", "offline");
    log("CORE_BRAIN_OFFLINE", process.env.CORE_BRAIN_OFFLINE);
    await h.engine.invoke("CB_ALPHA", { op: "store", text: PROBE_TEXTS.fusionKeywordOnly, target: "self" });
    const r = await h.engine.invoke("CB_ALPHA", { op: "recall", query: PROBE_TEXTS.fusionQuery, from: "self" });
    const status = await h.engine.invoke("CB_ALPHA", { op: "status" });
    log("status.embedder", status.embedder);
    log("status.dim", status.dim);
    log("recall.count", r.results.length);
    if (status.embedder !== "Xenova/bge-small-en-v1.5") {
      return bad(`the real embedder must be active, got ${JSON.stringify(status.embedder)}`);
    }
    if (r.results.length < 1) return bad("offline recall returned nothing");
    return ok("offline recall succeeded with the real embedder and no fetch");
  } finally {
    h.cleanup();
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const PROBES = {
  semantic,
  fusion: () => fusion({ verbose: false }),
  "fusion-verbose": () => fusion({ verbose: true }),
  rerank,
  "rerank-real": rerankReal,
  "isolation-hybrid": isolationHybrid,
  "stale-index": staleIndex,
  reindex,
  offline,
};

console.log(`core-brain search probes — home=<temp> fixture_dir=${FIXTURE_DIR}`);

if (!PROBE || !PROBES[PROBE]) {
  console.log(`usage: node test/search.selftest.mjs --probe <${Object.keys(PROBES).join("|")}> [--verbose]`);
  console.log(`unknown_or_missing_probe=${JSON.stringify(PROBE ?? null)}`);
  process.exit(2);
}

let result;
try {
  result = await PROBES[PROBE]();
} catch (error) {
  result = bad(`probe crashed: ${(error && error.message) || error}`);
}

console.log(`${PROBE} ${result.ok ? "PASS" : "FAIL"}  ${result.detail}`);
process.exit(result.ok ? 0 : 1);
