#!/usr/bin/env node
// Layer-A engine self-test for the core-brain plugin (spec §10, plan D8).
//
// Drives createEngine() DIRECTLY (no MCP transport) on disposable, SEEDED
// roots: each scenario writes its own fixtures in the store's on-disk layout,
// calls the engine, and asserts exact values — so a green run means the
// DETECTION works, not only the happy path.
//
// Zero dependencies (node:* only). Run through mcp/check.sh or directly:
//   node mcp/test/engine.selftest.mjs
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createEngine, EMBEDDER_ID, EMBEDDING_DIM } from "../../store.ts";

// The seed config (spec §2/A2, §3/B1): CB_ALPHA public+global, CB_BETA
// private+global, CB_GAMMA private+no-global.
const CONFIG = {
  agents: [
    { name: "CB_ALPHA", hasGlobalAccess: true, private: false },
    { name: "CB_BETA", hasGlobalAccess: true, private: true },
    { name: "CB_GAMMA", hasGlobalAccess: false, private: true },
  ],
};

// The shell may export CORE_BRAIN_HOME: remember it so every scenario can set
// its own root and hand the process back exactly as it found it.
const previousHome = process.env.CORE_BRAIN_HOME;

let pass = 0;
let fail = 0;
function line(ok, text) {
  const n = pass + fail + 1;
  if (ok) {
    pass += 1;
    console.log(`PASS ${n} ${text}`);
  } else {
    fail += 1;
    console.log(`FAIL ${n} ${text}`);
  }
}

/** Runs one scenario, turning an unexpected throw into a counted FAIL. */
function scenario(name, fn) {
  try {
    fn();
  } catch (error) {
    line(false, `${name} crashed: ${error && error.message ? error.message : error}`);
  }
}

// ---------------------------------------------------------------------------
// Fixture helpers — the store's own layout (store.ts §4).
// ---------------------------------------------------------------------------

function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function readJsonFile(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** A fresh disposable data root (removed by `withRoot`). */
function makeRoot() {
  return mkdtempSync(join(tmpdir(), "core-brain-engine-selftest."));
}

/** Runs `fn(root)` with CORE_BRAIN_HOME pointed at a fresh root, then cleans up. */
function withRoot(fn) {
  const root = makeRoot();
  process.env.CORE_BRAIN_HOME = root;
  try {
    return fn(root);
  } finally {
    if (previousHome === undefined) delete process.env.CORE_BRAIN_HOME;
    else process.env.CORE_BRAIN_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
}

function seedConfig(root, agents = CONFIG.agents) {
  writeJson(join(root, "config.json"), { agents });
}

function memoriesFile(root, name) {
  return name === "global"
    ? join(root, "global", "memories.json")
    : join(root, "agents", name, "memories.json");
}

function vectorsFile(root, name) {
  return join(root, "vectors", name, "index.json");
}

/** One MemoryRecord as persisted (types.ts §4). */
function record(id, agent, scope, text, extra = {}) {
  const now = new Date().toISOString();
  return { id, agent, scope, text, meta: {}, createdAt: now, updatedAt: now, retrievals: 0, ...extra };
}

/** The requested doctor check, by id, from a full `doctor` run. */
function checkOf(engine, id) {
  return engine.invoke("CB_ALPHA", { op: "doctor" }).checks.find((check) => check.id === id);
}

// ---------------------------------------------------------------------------
// AC4 — forget is a soft retire, through CB_BETA's own namespace.
// ---------------------------------------------------------------------------

scenario("AC4", () =>
  withRoot((root) => {
    seedConfig(root);
    const engine = createEngine();

    const stored = engine.invoke("CB_BETA", { op: "store", text: "beta forget me now", target: "self" });

    const forgotten = engine.invoke("CB_BETA", { op: "forget", id: stored.id });
    line(
      Array.isArray(forgotten.retired) && forgotten.retired.includes(stored.id),
      "AC4 forget by id reports the id as retired",
    );

    const afterForget = engine.invoke("CB_BETA", { op: "recall", query: "beta forget me now", from: "self" });
    line(
      !afterForget.results.some((hit) => hit.id === stored.id),
      "AC4 a retired record is absent from recall",
    );

    const status = engine.invoke("CB_BETA", { op: "status", ns: "agent:CB_BETA" });
    const beta = status.namespaces.find((entry) => entry.ns === "agent:CB_BETA");
    line(Boolean(beta) && beta.retired >= 1, "AC4 status reports retired >= 1 for the namespace");

    const persisted = readJsonFile(memoriesFile(root, "CB_BETA")).find((row) => row.id === stored.id);
    line(
      Boolean(persisted) && persisted.text === "beta forget me now",
      "AC4 retire keeps the record text on disk (never deletes)",
    );
  }),
);

// ---------------------------------------------------------------------------
// AC5 — feedback moves the ranking; unreadable feedback is refused.
// ---------------------------------------------------------------------------

scenario("AC5", () =>
  withRoot((root) => {
    seedConfig(root);
    const engine = createEngine();

    const first = engine.invoke("CB_ALPHA", { op: "store", text: "identical ranking text", target: "self" });
    const second = engine.invoke("CB_ALPHA", { op: "store", text: "identical ranking text", target: "self" });

    const feedback = engine.invoke("CB_ALPHA", { op: "feedback", id: second.id, useful: true });
    line(
      feedback.ok === true && feedback.usefulness.useful === 1 && feedback.usefulness.useless === 0,
      "AC5 feedback records useful=1 on the target record",
    );

    // The FIRST recall is the decisive one (recall mutates `retrievals`).
    const ranked = engine.invoke("CB_ALPHA", { op: "recall", query: "identical ranking text", from: "self" });
    line(
      ranked.results.length >= 2 &&
        ranked.results[0].id === second.id &&
        ranked.results.some((hit) => hit.id === first.id),
      "AC5 the feedbacked record ranks first among identical texts",
    );

    // CB_BETA is private: a CB_GAMMA id in that namespace is not readable.
    const betaRecord = engine.invoke("CB_BETA", { op: "store", text: "closed beta memory", target: "self" });
    let refusal = "";
    try {
      engine.invoke("CB_GAMMA", { op: "feedback", id: betaRecord.id, useful: true });
    } catch (error) {
      refusal = String(error.message);
    }
    line(refusal.includes("not readable"), "AC5 feedback outside the readable union is refused as 'not readable'");
  }),
);

// ---------------------------------------------------------------------------
// AC6 — every core_doctor check DETECTS its defect (one per fresh root).
// ---------------------------------------------------------------------------

// Clean root: doctor is ok and all five checks pass.
scenario("AC6-clean", () =>
  withRoot((root) => {
    seedConfig(root);
    const engine = createEngine();
    const doctor = engine.invoke("CB_ALPHA", { op: "doctor" });
    line(doctor.ok === true, "AC6 clean root: doctor ok is true");
    line(doctor.checks.length === 5 && doctor.checks.every((check) => check.ok), "AC6 clean root: 5/5 checks ok");
  }),
);

// 1. config-rows — rewrite the config AFTER init; doctor re-reads the file.
scenario("AC6-config-rows", () =>
  withRoot((root) => {
    seedConfig(root);
    const engine = createEngine();
    seedConfig(root, [...CONFIG.agents, { name: "BAD_ROW", private: false, hasGlobalAccess: false }]);
    const check = checkOf(engine, "config-rows");
    line(check.ok === false && check.detail.includes("BAD_ROW"), "AC6 config-rows detects a public row without global access");
  }),
);

// 1b. the engine-level invariant: that row from the start aborts init.
scenario("AC6-config-rows-init", () =>
  withRoot((root) => {
    seedConfig(root, [{ name: "BAD_ROW", private: false, hasGlobalAccess: false }]);
    let threw = false;
    let errorName = "";
    try {
      createEngine();
    } catch (error) {
      threw = true;
      errorName = error?.name ?? "";
    }
    line(
      threw && errorName === "InvalidConfigurationError",
      "AC6 config-rows invariant: createEngine throws on an invalid row at init",
    );
  }),
);

// 2. embedder-dim — a present index with a stale dim.
scenario("AC6-embedder-dim", () =>
  withRoot((root) => {
    seedConfig(root);
    writeJson(memoriesFile(root, "CB_ALPHA"), []);
    writeJson(vectorsFile(root, "CB_ALPHA"), { embedder: EMBEDDER_ID, dim: 128, vectors: {} });
    const engine = createEngine();
    const check = checkOf(engine, "embedder-dim");
    line(check.ok === false && check.detail.includes("agent:CB_ALPHA"), "AC6 embedder-dim detects a stale index and names the namespace");
  }),
);

// 3. store-writable — an unwritable root, restored in finally.
scenario("AC6-store-writable", () =>
  withRoot((root) => {
    seedConfig(root);
    const engine = createEngine();
    let check;
    chmodSync(root, 0o500);
    try {
      check = checkOf(engine, "store-writable");
    } finally {
      chmodSync(root, 0o755);
    }
    line(
      check.ok === false && /permission|EACCES/i.test(check.detail),
      "AC6 store-writable detects an unwritable root and reports the OS error",
    );
  }),
);

// 4. vector-record-pairing — an orphan vector AND a record with no vector.
scenario("AC6-vector-record-pairing", () =>
  withRoot((root) => {
    seedConfig(root);
    writeJson(memoriesFile(root, "CB_BETA"), [record("rec-no-vector", "CB_BETA", "agent", "a record with no vector")]);
    writeJson(vectorsFile(root, "CB_BETA"), {
      embedder: EMBEDDER_ID,
      dim: EMBEDDING_DIM,
      vectors: { "vec-no-record": new Array(EMBEDDING_DIM).fill(0) },
    });
    const engine = createEngine();
    const check = checkOf(engine, "vector-record-pairing");
    line(
      check.ok === false && check.detail.includes("rec-no-vector") && check.detail.includes("vec-no-record"),
      "AC6 vector-record-pairing detects both broken directions and names the ids",
    );
  }),
);

// 5. vector-dimension — a vector whose length is not EMBEDDING_DIM.
scenario("AC6-vector-dimension", () =>
  withRoot((root) => {
    seedConfig(root);
    writeJson(memoriesFile(root, "CB_BETA"), [record("bad-dim", "CB_BETA", "agent", "a record with a short vector")]);
    writeJson(vectorsFile(root, "CB_BETA"), {
      embedder: EMBEDDER_ID,
      dim: EMBEDDING_DIM,
      vectors: { "bad-dim": [1, 2, 3] },
    });
    const engine = createEngine();
    const check = checkOf(engine, "vector-dimension");
    line(check.ok === false && check.detail.includes("bad-dim"), "AC6 vector-dimension detects a short vector and names it");
  }),
);

// ---------------------------------------------------------------------------
// S7 / core_admin — the full matrix, all through engine.invoke(..., admin).
// ---------------------------------------------------------------------------

scenario("S7-purge", () =>
  withRoot((root) => {
    seedConfig(root);
    writeJson(memoriesFile(root, "CB_BETA"), [record("beta-1", "CB_BETA", "agent", "private beta memory")]);
    const engine = createEngine();

    let refusal = "";
    try {
      engine.invoke("CB_ALPHA", { op: "admin", action: "purge", args: { ns: "agent:CB_BETA" } });
    } catch (error) {
      refusal = String(error.message);
    }
    line(
      refusal.includes("agent:CB_BETA") && /private/i.test(refusal),
      "S7 purge refuses a private namespace without force",
    );

    const purged = engine.invoke("CB_ALPHA", { op: "admin", action: "purge", args: { ns: "agent:CB_BETA", force: true } });
    line(
      purged.ok === true && !existsSync(memoriesFile(root, "CB_BETA")),
      "S7 purge with force removes the private namespace records",
    );

    let unknownMessage = "";
    try {
      engine.invoke("CB_ALPHA", { op: "admin", action: "bogus" });
    } catch (error) {
      unknownMessage = String(error.message);
    }
    line(unknownMessage.startsWith("core-brain admin:"), "S7 an unknown admin action is refused with the 'core-brain admin:' prefix");
  }),
);

scenario("S7-reindex", () =>
  withRoot((root) => {
    seedConfig(root);
    writeJson(memoriesFile(root, "CB_ALPHA"), [record("alpha-1", "CB_ALPHA", "agent", "reindex me")]);
    const engine = createEngine();

    const first = engine.invoke("CB_ALPHA", { op: "admin", action: "reindex" });
    const afterFirst = readFileSync(vectorsFile(root, "CB_ALPHA"), "utf8");
    const second = engine.invoke("CB_ALPHA", { op: "admin", action: "reindex" });
    const afterSecond = readFileSync(vectorsFile(root, "CB_ALPHA"), "utf8");

    line(first.ok === true && second.ok === true && existsSync(vectorsFile(root, "CB_ALPHA")), "S7 reindex rebuilds the namespace vector index");
    line(afterFirst === afterSecond, "S7 reindex run twice is idempotent");
  }),
);

scenario("S7-export-import", () =>
  withRoot((root) => {
    seedConfig(root);
    writeJson(memoriesFile(root, "CB_ALPHA"), [record("alpha-keep", "CB_ALPHA", "agent", "original text")]);
    const engine = createEngine();
    engine.invoke("CB_ALPHA", { op: "admin", action: "reindex" });

    const exportFile = join(root, "backup.json");
    const exported = engine.invoke("CB_ALPHA", { op: "admin", action: "export", args: { file: exportFile } });
    const document = readJsonFile(exportFile);
    line(
      exported.ok === true && existsSync(exportFile) && Array.isArray(document.namespaces),
      "S7 export writes a parseable caller-named file",
    );

    // Locally edit the existing record, then import the same file: the import
    // must NOT overwrite the id (a fresh re-import of the very same doc).
    const before = readJsonFile(memoriesFile(root, "CB_ALPHA"));
    before.find((row) => row.id === "alpha-keep").text = "locally edited text";
    writeJson(memoriesFile(root, "CB_ALPHA"), before);

    const imported = engine.invoke("CB_ALPHA", { op: "admin", action: "import", args: { file: exportFile } });
    const after = readJsonFile(memoriesFile(root, "CB_ALPHA"));
    line(imported.ok === true, "S7 import of a valid export document succeeds");
    line(
      after.length === 1 && after[0].text === "locally edited text",
      "S7 import never overwrites an existing id",
    );
  }),
);

scenario("S7-compact", () =>
  withRoot((root) => {
    seedConfig(root);
    const engine = createEngine();

    const live = engine.invoke("CB_ALPHA", { op: "store", text: "live memory", target: "self" });
    const doomed = engine.invoke("CB_ALPHA", { op: "store", text: "doomed memory", target: "self" });
    engine.invoke("CB_ALPHA", { op: "forget", id: doomed.id });

    const before = readJsonFile(vectorsFile(root, "CB_ALPHA")).vectors;
    const compacted = engine.invoke("CB_ALPHA", { op: "admin", action: "compact" });
    const after = readJsonFile(vectorsFile(root, "CB_ALPHA")).vectors;

    line(
      compacted.ok === true && Object.keys(after).length === Object.keys(before).length - 1,
      "S7 compact drops the retired record's vector",
    );
    line(
      !Object.prototype.hasOwnProperty.call(after, doomed.id) &&
        Object.prototype.hasOwnProperty.call(after, live.id),
      "S7 compact keeps the live vector and removes the retired id",
    );
  }),
);

// ---------------------------------------------------------------------------
// Criterion 17 — an agent absent from the config gets the default policy and
// can write both in its own space and in global.
// ---------------------------------------------------------------------------

scenario("criterion-17", () =>
  withRoot((root) => {
    seedConfig(root);
    const engine = createEngine();

    const who = engine.invoke("CB_UNKNOWN", { op: "who" });
    line(
      who.private === false && who.hasGlobalAccess === true,
      "criterion 17 an unconfigured agent gets {private:false, hasGlobalAccess:true}",
    );

    const selfStore = engine.invoke("CB_UNKNOWN", { op: "store", text: "unknown self", target: "self" });
    const globalStore = engine.invoke("CB_UNKNOWN", { op: "store", text: "unknown global", target: "global" });
    line(
      selfStore.ok === true && selfStore.scope === "agent" && globalStore.ok === true && globalStore.scope === "global",
      "criterion 17 an unconfigured agent can store in self and global",
    );
  }),
);

// ---------------------------------------------------------------------------

console.log("");
console.log(`${pass}/${pass + fail} lines PASS`);
process.exit(fail === 0 ? 0 : 1);
