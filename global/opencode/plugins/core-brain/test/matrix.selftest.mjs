// test/matrix.selftest.mjs — executable isolation matrix for the `core-brain` plugin.
//
// LAYER A (spec docs/specs/core-brain-plugin.md §9.2): proves access rules
// 7, 8, 9, 10, 11, 12, 13, 14 IN-PROCESS against the REAL store + authorizer,
// on a disposable CORE_BRAIN_HOME. This is the proof of the access rules — not
// an implementation unit test.
//
// STATUS (updated 2026-10-01): the implementation EXISTS (../store.ts) and this
// matrix HAS been executed end-to-end by the ORACLE: 8/8 lines PASS, exit 0,
// Node v24.15.0. This file remains the CONTRACT the implementation satisfies; the
// dynamic import below now resolves the real store + authorizer.
//
// ---------------------------------------------------------------------------
// TEST-FACING CONTRACT (declared by TESTER; see test/CONTRACT.md)
// ---------------------------------------------------------------------------
// The spec pins the `core_memory` TOOL JSON (§7) but not the TypeScript export
// names. §9.2 says this layer "instantiates the real store + authorizer", so
// the seam is pinned to the internal module §2 names (`store.ts`) and the
// DEVELOPER implements exactly this:
//
//   import { createEngine, InvalidConfigurationError } from "../store.ts";
//
//   const engine = createEngine({ home, configPath });
//     // home       = CORE_BRAIN_HOME data root (default ~/.core-brain)
//     // configPath = explicit config file (spec Q3 precedence: options.configPath
//     //              > ~/.core-brain/config.json > <pluginDir>/config.json)
//
//   engine.invoke(agentName, request) -> §7.2 result object (throws on denial)
//     request = { op: "who" }
//             | { op: "store", text, target?, meta? }   target: self|global|agent:<n>
//             | { op: "recall", query?, limit?, from? }  from:   self|global|agent:<n>
//
//   InvalidConfigurationError extends Error, .code === "INVALID_CONFIGURATION".
//
// `agentName` is TRUSTED infrastructure identity (the running session's agent),
// injected by the tool layer from the hook — it is NOT a `core_memory` input
// field and cannot be impersonated by the caller (§7.1). `invoke(a, req)` is
// therefore exactly `core_memory(req)` with that trusted identity supplied.
//
// WHY THIS PATH (and not the registered tool): `setup(ctx)` needs the live V2
// plugin context, which cannot be instantiated offline; the spec §9.2 explicitly
// says this layer drives the real store + authorizer. Driving `store.ts` directly
// exercises the SAME authorizer the tool calls, with zero SDK dependency (Q2).

import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Import the implementation under test (fail loud and clearly if it is absent).
// ---------------------------------------------------------------------------

let createEngine;
let InvalidConfigurationError;
try {
  ({ createEngine, InvalidConfigurationError } = await import("../store.ts"));
} catch (error) {
  console.error("COREBRAIN_SELFTEST: cannot import '../store.ts'.");
  console.error(
    "The core-brain implementation is missing or does not export the test-facing " +
      "contract (createEngine, InvalidConfigurationError). See test/CONTRACT.md.",
  );
  console.error(String((error && error.message) || error));
  process.exitCode = 2;
  // Nothing to run; end here.
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

const HOME = process.env.CORE_BRAIN_HOME;
if (!HOME) {
  console.error("COREBRAIN_SELFTEST: CORE_BRAIN_HOME is not set (check.sh sets it).");
  process.exit(2);
}

// check.sh writes $CORE_BRAIN_HOME/config.json with the 4 agents (§9.1), incl.
// the invalid CB_DELTA row used by line 12. For the valid lines we write a
// second fixture that drops CB_DELTA (otherwise the whole config fails closed).
const INVALID_CONFIG = join(HOME, "config.json");
const VALID_CONFIG = join(HOME, "config.valid.json");
writeFileSync(
  VALID_CONFIG,
  `${JSON.stringify(
    {
      agents: [
        { name: "CB_ALPHA", hasGlobalAccess: true, private: false },
        { name: "CB_BETA", hasGlobalAccess: true, private: true },
        { name: "CB_GAMMA", hasGlobalAccess: false, private: true },
      ],
    },
    null,
    2,
  )}\n`,
);

const NONCE = Date.now().toString(36);
const marker = (tag) => `cb-selftest-${NONCE}-${tag}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertThrows(fn, predicate, label) {
  let caught = null;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  if (caught === null) {
    throw new Error(`${label}: expected a thrown error, none was thrown`);
  }
  if (!predicate(caught)) {
    const msg = caught && caught.message;
    const code = caught && caught.code;
    throw new Error(
      `${label}: thrown error did not match (message=${JSON.stringify(msg)}, code=${JSON.stringify(code)})`,
    );
  }
}

/** True when any scanned namespace label mentions `needle` (e.g. "CB_BETA"). */
function scannedMentions(scanned, needle) {
  return Array.isArray(scanned) && scanned.some((ns) => String(ns).includes(needle));
}

const engine = createEngine({ home: HOME, configPath: VALID_CONFIG });

// ---------------------------------------------------------------------------
// Matrix rows (spec §9.2). Each body asserts the OBSERVABLE literal, not a bool.
// ---------------------------------------------------------------------------

const rows = [];
function row(line, label, body) {
  try {
    body();
    rows.push({ line, label, ok: true, detail: "" });
  } catch (error) {
    rows.push({ line, label, ok: false, detail: String((error && error.message) || error) });
  }
}

// Precondition (not a numbered row): the trusted identity maps to config policy.
try {
  const who = engine.invoke("CB_BETA", { op: "who" });
  const name = who && (who.agent || who.name);
  assert(
    name === "CB_BETA" && who.private === true && who.hasGlobalAccess === true,
    `who() mismatch: ${JSON.stringify(who)}`,
  );
} catch (error) {
  console.error(`SETUP FAIL (identity/policy): ${(error && error.message) || error}`);
  process.exit(2);
}

// 7 — private CB_BETA is unreadable by private CB_GAMMA.
row(7, "CB_GAMMA recall from agent:CB_BETA -> empty, scanned excludes CB_BETA", () => {
  const m = marker("l7-beta-self");
  engine.invoke("CB_BETA", { op: "store", text: m, target: "self" });
  const r = engine.invoke("CB_GAMMA", { op: "recall", from: "agent:CB_BETA" });
  assert(Array.isArray(r.results), "results must be an array");
  assert(r.results.length === 0, `results must be empty, got ${r.results.length}`);
  assert(Array.isArray(r.scanned), "scanned must be an array");
  assert(!scannedMentions(r.scanned, "CB_BETA"), `scanned must NOT include CB_BETA: ${JSON.stringify(r.scanned)}`);
});

// 8 — private CB_BETA is unreadable by public CB_ALPHA.
row(8, "CB_ALPHA recall from agent:CB_BETA -> empty, scanned excludes CB_BETA", () => {
  const r = engine.invoke("CB_ALPHA", { op: "recall", from: "agent:CB_BETA" });
  assert(Array.isArray(r.results) && r.results.length === 0, "results must be empty");
  assert(Array.isArray(r.scanned), "scanned must be an array");
  assert(!scannedMentions(r.scanned, "CB_BETA"), `scanned must NOT include CB_BETA: ${JSON.stringify(r.scanned)}`);
});

// 9 — private agent WITHOUT global access cannot write global.
row(9, "CB_GAMMA store target:global -> throws, names CB_GAMMA + 'no global access'", () => {
  assertThrows(
    () => engine.invoke("CB_GAMMA", { op: "store", text: marker("l9-gamma-global"), target: "global" }),
    (e) => e instanceof Error && /CB_GAMMA/.test(e.message) && /no global access/i.test(e.message),
    "CB_GAMMA global write",
  );
});

// 10 — private agent WITH global access writes global; any global agent reads it.
row(10, "CB_BETA store target:global -> CB_ALPHA recall from:global echoes text", () => {
  const m = marker("l10-beta-global");
  engine.invoke("CB_BETA", { op: "store", text: m, target: "global" });
  const r = engine.invoke("CB_ALPHA", { op: "recall", from: "global" });
  assert(Array.isArray(r.results), "results must be an array");
  assert(
    r.results.some((rec) => rec && rec.text === m),
    `CB_ALPHA must recall the record text ${JSON.stringify(m)}; got ${JSON.stringify(r.results.map((x) => x && x.text))}`,
  );
});

// 11 — an agent retrieves its own private memory.
row(11, "CB_GAMMA store self -> CB_GAMMA recall from:self returns its own record", () => {
  const m = marker("l11-gamma-self");
  engine.invoke("CB_GAMMA", { op: "store", text: m, target: "self" });
  const r = engine.invoke("CB_GAMMA", { op: "recall", from: "self" });
  assert(
    Array.isArray(r.results) && r.results.some((rec) => rec && rec.text === m),
    `CB_GAMMA must recall its own record ${JSON.stringify(m)}`,
  );
});

// 12 — invalid row (private:false + hasGlobalAccess:false) fails init.
row(12, "createEngine(config with CB_DELTA) -> InvalidConfigurationError INVALID_CONFIGURATION", () => {
  assert(
    existsSync(INVALID_CONFIG),
    `missing ${INVALID_CONFIG} (check.sh must write the 4-agent config.json first)`,
  );
  assertThrows(
    () => createEngine({ home: HOME, configPath: INVALID_CONFIG }),
    (e) =>
      e instanceof InvalidConfigurationError &&
      e.code === "INVALID_CONFIGURATION" &&
      /CB_DELTA/.test(e.message) &&
      /public agent without global access/i.test(e.message),
    "CB_DELTA invalid config init",
  );
});

// 13 — public agent WITH global access writes and reads global.
row(13, "CB_ALPHA store target:global -> CB_ALPHA recall from:global returns it", () => {
  const m = marker("l13-alpha-global");
  engine.invoke("CB_ALPHA", { op: "store", text: m, target: "global" });
  const r = engine.invoke("CB_ALPHA", { op: "recall", from: "global" });
  assert(
    Array.isArray(r.results) && r.results.some((rec) => rec && rec.text === m),
    `CB_ALPHA must recall its global record ${JSON.stringify(m)}`,
  );
});

// 14 — a public agent cannot write directly into another agent's private space.
row(14, "CB_ALPHA store target:agent:CB_BETA -> blocked, names CB_BETA + 'private'", () => {
  assertThrows(
    () => engine.invoke("CB_ALPHA", { op: "store", text: marker("l14-cross"), target: "agent:CB_BETA" }),
    (e) => e instanceof Error && /CB_BETA/.test(e.message) && /private/i.test(e.message),
    "CB_ALPHA -> agent:CB_BETA write",
  );
});

// ---------------------------------------------------------------------------
// Report + exit code
// ---------------------------------------------------------------------------

console.log("");
console.log(`core-brain isolation matrix (spec §9.2) — CORE_BRAIN_HOME=${HOME}`);
for (const r of rows) {
  const status = r.ok ? "PASS" : "FAIL";
  const detail = r.ok ? "" : `  -> ${r.detail}`;
  console.log(`${String(r.line).padEnd(3)} ${status}  ${r.label}${detail}`);
}
console.log("");

const failed = rows.filter((r) => !r.ok);
console.log(`${rows.length - failed.length}/${rows.length} lines PASS`);
process.exitCode = failed.length === 0 ? 0 : 1;
