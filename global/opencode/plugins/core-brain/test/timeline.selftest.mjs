#!/usr/bin/env node
// test/timeline.selftest.mjs — executable contract for the core-brain EPISODIC
// TIMELINE (Fatia 3, T1–T5): ops `episode` / `timeline` / `promote` on the one
// `core_memory` tool, the per-namespace diary storage, the import document's
// episodes section, and the isolation matrix applied to the diary.
//
// Authority and the exact ledgers: test/CONTRACT.md §10;
// plan docs/specs/fatia3-timeline-plan.md §1–§7;
// source spec docs/specs/core-brain-v2.md §12 (lines 166–224).
//
// HOW IT DRIVES THE PLUGIN: through the engine seam (`createEngine`) exactly
// like test/search.selftest.mjs — `engine.invoke(agent, request)` IS
// `core_memory(request)` with the trusted session identity supplied. The
// "identity is the session, never a tool argument" rule is proven by forging an
// `agent` field in the request (TL1.b) and asserting it is ignored.
//
// RED TODAY, FOR THE RIGHT REASON: store.ts has no `episode`/`timeline`/
// `promote` op yet, so `invoke` throws `core_memory: unknown op '…'`; the
// importer ignores the `episodes` key. Every ledger except TL3 fails on that
// throw; TL3 fails on the ignored key. They go GREEN when the ops land.
//
// TL6 is NOT executed here: the 13/13 matrix is check.sh Suite A's job and the
// backup mirror is UNKNOWN (lives in another repo, plan §7.2). Explicit SKIP.
//
// Declared dependency (same as the matrix): the plugin path does not honour
// CORE_BRAIN_EMBEDDER, so this suite injects the offline fixture via
// `options.embedder` unless CORE_BRAIN_EMBEDDER=real. Zero external deps; node:*
// only. Creates and removes its own temp root (rule 21).
//
// Run:  node --experimental-strip-types test/timeline.selftest.mjs
// (check.sh runs it with the same feature-detected flag as the other suites.)

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FIXTURE_DIR, PROBE_TEXTS, createFixtureEmbedder } from "./fixtures/embedder.mjs";

// ---------------------------------------------------------------------------
// 1. Import the engine under test (fail loud and clearly if it is absent).
// ---------------------------------------------------------------------------
let createEngine;
try {
  ({ createEngine } = await import("../store.ts"));
} catch (error) {
  console.error("COREBRAIN_TIMELINE: cannot import '../store.ts'.");
  console.error(String((error && error.message) || error));
  process.exit(2);
}

// ---------------------------------------------------------------------------
// 2. Disposable data root + config (rule 21: removed on exit).
// ---------------------------------------------------------------------------
const ROOT = mkdtempSync(join(tmpdir(), "core-brain-timeline-"));
const CONFIG = join(ROOT, "config.json");
const NONCE = Date.now().toString(36);
const mark = (tag) => `tl-${NONCE}-${tag}`;

// CB_ALPHA public+global · CB_BETA private+global · CB_GAMMA private, no global.
const AGENTS = [
  { name: "CB_ALPHA", hasGlobalAccess: true, private: false },
  { name: "CB_BETA", hasGlobalAccess: true, private: true },
  { name: "CB_GAMMA", hasGlobalAccess: false, private: true },
];
writeFileSync(CONFIG, `${JSON.stringify({ agents: AGENTS }, null, 2)}\n`);

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try {
    rmSync(ROOT, { recursive: true, force: true });
  } catch {
    // advisory — cleanup must never change the verdict
  }
}
process.on("exit", cleanup);

const USE_FIXTURE = (process.env.CORE_BRAIN_EMBEDDER || "fixture") !== "real";
const options = { home: ROOT, configPath: CONFIG };
let fixture = null;
if (USE_FIXTURE) {
  fixture = createFixtureEmbedder({ dir: FIXTURE_DIR });
  options.embedder = fixture;
}

let engine;
try {
  engine = createEngine(options);
} catch (error) {
  console.error(`COREBRAIN_TIMELINE: createEngine threw: ${String((error && error.message) || error)}`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// 3. Helpers.
// ---------------------------------------------------------------------------
const call = (agent, request) => engine.invoke(agent, request);
const log = (key, value) =>
  console.log(`${key}=${typeof value === "string" ? value : JSON.stringify(value)}`);

const episodesFile = (ns) =>
  ns === "global"
    ? join(ROOT, "global", "episodes.json")
    : join(ROOT, "agents", ns, "episodes.json");
const readEpisodes = (ns) => {
  const file = episodesFile(ns);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
};
const sha256File = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const byId = (episodes, id) => (Array.isArray(episodes) ? episodes.find((e) => e && e.id === id) : undefined);
const summaries = (episodes) => (episodes || []).map((e) => e && e.summary);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ---------------------------------------------------------------------------
// 4. Scenario runner.
// ---------------------------------------------------------------------------
const ledger = [];
let pass = 0;
let fail = 0;
let skip = 0;

async function scenario(id, label, fn) {
  try {
    await fn();
    pass += 1;
    ledger.push({ id, status: "PASS", label, detail: "" });
  } catch (error) {
    fail += 1;
    ledger.push({
      id,
      status: "FAIL",
      label,
      detail: String((error && error.message) || error),
    });
  }
}

// ===========================================================================
// TL1 — append + read round-trip; identity is the session (§10.3, AC-TL1)
// ===========================================================================

const S1 = mark("alpha-episode");

await scenario("TL1.a", "episode append + timeline read round-trip; agent from the session", async () => {
  const r = await call("CB_ALPHA", {
    op: "episode",
    summary: S1,
    tags: ["tl1", "alpha"],
    sessionId: "ses_tl1_alpha",
  });
  log("tl1.append", r);
  assert(r && r.ok === true, `episode must return {ok:true}; got ${JSON.stringify(r)}`);
  assert(typeof r.id === "string" && r.id.length > 0, `episode must return an id; got ${JSON.stringify(r.id)}`);
  assert(r.ns === "agent:CB_ALPHA", `ns must be "agent:CB_ALPHA"; got ${JSON.stringify(r.ns)}`);
  assert(/^EP-\d+-[A-Za-z0-9]{4}$/.test(r.id), `id must match EP-<epoch>-<4 chars>; got ${JSON.stringify(r.id)}`);

  const t = await call("CB_ALPHA", { op: "timeline", limit: 50 });
  log("tl1.timeline.count", Array.isArray(t.results) ? t.results.length : t.results);
  log("tl1.timeline.scanned", t.scanned);
  const ep = byId(t.results, r.id);
  assert(ep, `the appended episode ${r.id} must be returned by timeline`);
  assert(ep.summary === S1, `summary round-trip: got ${JSON.stringify(ep.summary)}`);
  assert(ep.agent === "CB_ALPHA", `agent must be the session identity "CB_ALPHA"; got ${JSON.stringify(ep.agent)}`);
  assert(JSON.stringify(ep.tags) === JSON.stringify(["tl1", "alpha"]), `tags round-trip: got ${JSON.stringify(ep.tags)}`);
  assert(ep.sessionId === "ses_tl1_alpha", `sessionId round-trip: got ${JSON.stringify(ep.sessionId)}`);
  assert(typeof ep.at === "string" && !Number.isNaN(Date.parse(ep.at)), `at must be an ISO timestamp; got ${JSON.stringify(ep.at)}`);
  log("tl1.episode", ep);
  const sorted = t.results.every((e, i) => i === 0 || String(t.results[i - 1].at) >= String(e.at));
  assert(sorted, `a query-less timeline is most-recent-first (at desc); got ${JSON.stringify(t.results.map((e) => e.at))}`);
});

const S1B = mark("alpha-forged");

await scenario("TL1.b", "identity is the session: a forged `agent` argument does not change the owner", async () => {
  const r = await call("CB_ALPHA", { op: "episode", summary: S1B, agent: "FORGED_AGENT" });
  log("tl1b.append", r);
  assert(r && r.ok === true, `episode must return {ok:true}; got ${JSON.stringify(r)}`);
  const t = await call("CB_ALPHA", { op: "timeline", limit: 50 });
  const ep = byId(t.results, r.id);
  assert(ep, `the appended episode ${r.id} must be returned by timeline`);
  log("tl1b.stored.agent", ep.agent);
  assert(ep.agent === "CB_ALPHA", `the forged agent must be ignored; stored agent=${JSON.stringify(ep.agent)}`);
  const forged = t.results.filter((e) => e.agent === "FORGED_AGENT");
  log("tl1b.forged.count", forged.length);
  assert(forged.length === 0, "no episode may carry the forged owner");
});

// ===========================================================================
// TL2 — the diary obeys the same isolation matrix as memories (§10.6, AC-TL2)
// ===========================================================================

const G = mark("gamma-private");

await scenario("TL2.a", "isolation: a private diary is invisible to another agent", async () => {
  const w = await call("CB_GAMMA", { op: "episode", summary: G });
  log("tl2a.gamma.append", w);
  assert(w && w.ok === true, `episode must return {ok:true}; got ${JSON.stringify(w)}`);
  assert(w.ns === "agent:CB_GAMMA", `ns must be "agent:CB_GAMMA"; got ${JSON.stringify(w.ns)}`);
  const t = await call("CB_ALPHA", { op: "timeline", limit: 50 });
  log("tl2a.alpha.scanned", t.scanned);
  const leaked = t.results.filter((e) => e.summary === G);
  log("tl2a.leaked.count", leaked.length);
  assert(leaked.length === 0, "CB_ALPHA must not see CB_GAMMA's private episode");
  assert(
    !(t.scanned || []).some((ns) => String(ns).includes("CB_GAMMA")),
    `scanned must exclude CB_GAMMA: ${JSON.stringify(t.scanned)}`,
  );
});

const P = mark("alpha-public");

await scenario("TL2.b", "isolation: a public diary is visible per the read matrix", async () => {
  const w = await call("CB_ALPHA", { op: "episode", summary: P });
  log("tl2b.alpha.append", w);
  assert(w && w.ok === true, `episode must return {ok:true}; got ${JSON.stringify(w)}`);
  const t = await call("CB_GAMMA", { op: "timeline", limit: 50 });
  log("tl2b.gamma.scanned", t.scanned);
  const seen = t.results.filter((e) => e.summary === P);
  log("tl2b.seen.count", seen.length);
  assert(seen.length === 1, `CB_GAMMA must see CB_ALPHA's public episode (count=${seen.length})`);
  assert(
    (t.scanned || []).some((ns) => String(ns).includes("CB_ALPHA")),
    `scanned must include CB_ALPHA: ${JSON.stringify(t.scanned)}`,
  );
});

await scenario("TL2.c", "isolation: a direct read into a private space is empty and unscanned", async () => {
  const t = await call("CB_ALPHA", { op: "timeline", from: "agent:CB_GAMMA", limit: 50 });
  log("tl2c.results.count", t.results.length);
  log("tl2c.scanned", t.scanned);
  assert(t.results.length === 0, "a direct read into private CB_GAMMA must be empty");
  assert(
    !(t.scanned || []).some((ns) => String(ns).includes("CB_GAMMA")),
    `scanned must exclude CB_GAMMA: ${JSON.stringify(t.scanned)}`,
  );
});

// ===========================================================================
// TL5 — promote: memory with derivedFrom, episode gains engramIds (§10.2, AC-TL5)
// ===========================================================================

const EP5 = mark("promoted-episode");
const M5 = mark("promoted-memory");

await scenario("TL5", "promote writes a memory with derivedFrom and the episode gains engramIds", async () => {
  const w = await call("CB_ALPHA", { op: "episode", summary: EP5 });
  log("tl5.episode.append", w);
  assert(w && w.ok === true, `episode must return {ok:true}; got ${JSON.stringify(w)}`);

  const before = byId((await call("CB_ALPHA", { op: "timeline", limit: 50 })).results, w.id);
  assert(before, "the episode must be readable after append");
  const snapshot = JSON.parse(JSON.stringify(before));
  log("tl5.episode.before", snapshot);

  const p = await call("CB_ALPHA", { op: "promote", episodeId: w.id, text: M5, tags: ["tl5"] });
  log("tl5.promote.result", p);
  assert(p && p.ok === true, `promote must return {ok:true}; got ${JSON.stringify(p)}`);
  assert(p.episodeId === w.id, `promote must echo the episodeId; got ${JSON.stringify(p.episodeId)}`);
  assert(typeof p.memoryId === "string" && p.memoryId.length > 0, `promote must return a memoryId; got ${JSON.stringify(p.memoryId)}`);

  const memoriesFile = join(ROOT, "agents", "CB_ALPHA", "memories.json");
  assert(existsSync(memoriesFile), `the promoted memory file must exist: ${memoriesFile}`);
  const mem = JSON.parse(readFileSync(memoriesFile, "utf8")).find((m) => m && m.id === p.memoryId);
  log("tl5.memory.record", mem);
  assert(mem, `the promoted memory ${p.memoryId} must be stored`);
  assert(mem.text === M5, `the memory must carry the promoted text ${JSON.stringify(M5)}; got ${JSON.stringify(mem.text)}`);
  assert(
    mem.meta && mem.meta.derivedFrom === w.id,
    `the memory must carry meta.derivedFrom=${JSON.stringify(w.id)}; got ${JSON.stringify(mem.meta)}`,
  );

  const stored = readEpisodes("CB_ALPHA");
  const ep = byId(stored, w.id);
  log("tl5.episode.after", ep);
  assert(ep, `the episode ${w.id} must still be stored`);
  assert(
    Array.isArray(ep.engramIds) && ep.engramIds.includes(p.memoryId),
    `the episode must list ${p.memoryId} in engramIds; got ${JSON.stringify(ep.engramIds)}`,
  );

  const after = JSON.parse(JSON.stringify(ep));
  delete after.engramIds;
  delete snapshot.engramIds;
  assert(
    JSON.stringify(after) === JSON.stringify(snapshot),
    `promote must not change any other episode field; before=${JSON.stringify(snapshot)} after=${JSON.stringify(after)}`,
  );
});

// ===========================================================================
// TL4 — searchable by meaning, not by spelling (§10.7, AC-TL4)
// ===========================================================================

await scenario("TL4", "timeline searches by meaning (fixture construction)", async () => {
  const query = PROBE_TEXTS.semanticQuery;
  const paraphrase = PROBE_TEXTS.semanticParaphrase;
  const decoy = PROBE_TEXTS.semanticDecoy;
  log("tl4.query", query);
  log("tl4.paraphrase", paraphrase);
  log("tl4.decoy", decoy);

  const wp = await call("CB_ALPHA", { op: "episode", summary: paraphrase });
  const wd = await call("CB_ALPHA", { op: "episode", summary: decoy });
  assert(wp.ok === true && wd.ok === true, "both episodes must be appended");

  const t = await call("CB_ALPHA", { op: "timeline", query, limit: 50 });
  log("tl4.order", summaries(t.results));
  const rp = t.results.findIndex((e) => e.id === wp.id);
  const rd = t.results.findIndex((e) => e.id === wd.id);
  log("tl4.rank.paraphrase", rp);
  log("tl4.rank.decoy", rd);
  assert(rp >= 0 && rd >= 0, `both episodes must be returned (paraphrase=${rp}, decoy=${rd})`);
  assert(rp < rd, `the no-shared-word paraphrase (${rp}) must rank above the keyword decoy (${rd})`);

  // The literal spec §12.3 pair is the REAL-model probe; its bound is declared
  // in CONTRACT §10.8 and is NOT asserted on the fixture path.
  log("tl4.real_probe", {
    query: "SGLang",
    episode: "server 'mystery shutdowns' caused by `timeout 9999`",
    note: "real-model authoritative probe; AC1 bound declared (CONTRACT §10.8), not asserted offline",
  });
});

// ===========================================================================
// TL3 — import: dates/tags/owners intact, idempotent (§10.5, AC-TL3)
// ===========================================================================

await scenario("TL3", "import lands episodes with fields intact and a second run changes nothing", async () => {
  const doc = join(ROOT, "fixture-episodes.json");
  const idA = "EP-1700000000001-aaa1";
  const idB = "EP-1700000000002-bbb2";
  const idC = "EP-1700000000003-ccc3";
  const fixture = {
    namespaces: [],
    episodes: [
      {
        id: idA,
        at: "2026-01-01T00:00:00.000Z",
        summary: "ownerless episode one",
        tags: ["alpha", "tl3"],
        sessionId: "ses_tl3_a",
        channel: "test",
      },
      { id: idB, at: "2026-01-02T00:00:00.000Z", summary: "ownerless episode two" },
      { id: idC, at: "2026-01-03T00:00:00.000Z", agent: "CB_BETA", summary: "episode owned by CB_BETA", tags: ["beta"] },
    ],
  };
  writeFileSync(doc, `${JSON.stringify(fixture, null, 2)}\n`);

  const first = await call("CB_ALPHA", { op: "admin", action: "import", args: { file: doc } });
  log("tl3.import.first", first);
  assert(first && first.ok === true, `import must return {ok:true}; got ${JSON.stringify(first)}`);

  const globalEps = readEpisodes("global");
  const betaEps = readEpisodes("CB_BETA");
  log("tl3.global.ids", globalEps ? globalEps.map((e) => e.id) : globalEps);
  log("tl3.beta.ids", betaEps ? betaEps.map((e) => e.id) : betaEps);
  assert(byId(globalEps, idA), `the ownerless ${idA} must land in global/episodes.json`);
  assert(byId(globalEps, idB), `the ownerless ${idB} must land in global/episodes.json`);
  assert(byId(betaEps, idC), `the owned ${idC} must land in agents/CB_BETA/episodes.json`);
  assert(!byId(betaEps, idA), "an ownerless episode must not land in a private agent's file");

  const epA = byId(globalEps, idA);
  log("tl3.episode.A", epA);
  assert(epA.at === "2026-01-01T00:00:00.000Z", `at preserved verbatim: ${JSON.stringify(epA.at)}`);
  assert(JSON.stringify(epA.tags) === JSON.stringify(["alpha", "tl3"]), `tags preserved: ${JSON.stringify(epA.tags)}`);
  assert(epA.sessionId === "ses_tl3_a", `sessionId preserved: ${JSON.stringify(epA.sessionId)}`);
  assert(epA.channel === "test", `channel preserved: ${JSON.stringify(epA.channel)}`);
  const epC = byId(betaEps, idC);
  log("tl3.episode.C.agent", epC.agent);
  assert(epC.agent === "CB_BETA", `owner preserved verbatim: ${JSON.stringify(epC.agent)}`);

  const shaGlobal1 = sha256File(episodesFile("global"));
  const shaBeta1 = sha256File(episodesFile("CB_BETA"));
  const second = await call("CB_ALPHA", { op: "admin", action: "import", args: { file: doc } });
  log("tl3.import.second", second);
  const shaGlobal2 = sha256File(episodesFile("global"));
  const shaBeta2 = sha256File(episodesFile("CB_BETA"));
  log("tl3.sha.global", { first: shaGlobal1, second: shaGlobal2 });
  log("tl3.sha.beta", { first: shaBeta1, second: shaBeta2 });
  assert(shaGlobal1 === shaGlobal2, "a second import must not change global/episodes.json");
  assert(shaBeta1 === shaBeta2, "a second import must not change agents/CB_BETA/episodes.json");
});

// ===========================================================================
// TL6 — check.sh 13/13 + backup mirror: SKIP (declared UNKNOWN, §10.8)
// ===========================================================================
skip += 1;
ledger.push({
  id: "TL6",
  status: "SKIP",
  label: "check.sh stays 13/13; backup mirror",
  detail:
    "the 13/13 matrix is enforced by check.sh Suite A (matrix.selftest.mjs, unchanged); " +
    "the backup mirror (bkps/.core-brain/) lives in another repo (plan §7.2) and is UNKNOWN — not tested.",
});

// ---------------------------------------------------------------------------
// 5. Report + exit code.
// ---------------------------------------------------------------------------
console.log("");
console.log(`core-brain episodic timeline (Fatia 3, CONTRACT.md §10) — ROOT=${ROOT}`);
console.log(`engine seam: ${USE_FIXTURE ? "fixture (offline)" : "real (CORE_BRAIN_EMBEDDER=real)"}`);
for (const row of ledger) {
  const detail = row.detail ? `  -> ${row.detail}` : "";
  console.log(`${row.id.padEnd(6)} ${row.status}  ${row.label}${detail}`);
}
if (fixture) {
  const s = fixture.stats();
  console.log(`fixture: loaded=${s.loaded} hits=${s.hits} misses=${s.misses} dim=${s.dim} revision=${s.revision}`);
}
console.log("");
console.log(`${pass}/${pass + fail} ledgers PASS, ${skip} SKIP (TL6 UNKNOWN), exit ${fail === 0 ? 0 : 1}`);

cleanup();
process.exitCode = fail === 0 ? 0 : 1;
