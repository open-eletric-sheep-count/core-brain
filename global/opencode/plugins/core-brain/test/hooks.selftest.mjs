#!/usr/bin/env node
// test/hooks.selftest.mjs — executable contract for the core-brain AUTOMATIC
// LAYER (Fatia 2): A1 context injection, A2 prompt learning, A3 compaction
// carry + learn. Authority and the exact ledger: test/CONTRACT.md §9;
// plan docs/specs/fatia2-automatic-layer-plan.md §1–§7.
//
// HOW IT DRIVES THE PLUGIN (no injectable engine exists):
//   1. import the plugin's default export from ../index.ts;
//   2. call setup(ctx) with a CAPTURED fake context — tool.transform,
//      session.hook and session.get are faked, so every registration and the
//      core_memory tool are captured in-process;
//   3. seed / observe THROUGH the plugin's own core_memory tool (store/recall);
//   4. opt-in lives in the agent row (config.json): { ..., "inject": true }.
//
// RED TODAY, FOR THE RIGHT REASON: setup() registers only the inert `prompt`
// hook (index.ts:517-552), so `context`/`compaction` are absent (A1, A3 fail)
// and `prompt` learns nothing (A2 fails). GREEN when the layer lands.
//
// A4 is NOT tested: the closed session-hook list has no session-end member
// (plan D5); an explicit SKIP is printed instead. See CONTRACT.md §9.6.
//
// Declared dependency (CONTRACT.md §9.7): the plugin builds its engine with
// createEngine({ home, configPath }) — no injected embedder — so this suite
// needs the engine embedder available (the provisioned real runtime, or
// CORE_BRAIN_EMBEDDER=fixture honoured by that path). check.sh exports
// CORE_BRAIN_EMBEDDER=fixture. Zero external deps; node:* only.
//
// Run:  node --experimental-strip-types test/hooks.selftest.mjs
// (check.sh runs it with the same feature-detected flag as the other suites.)

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// 1. Import the plugin under test (fail loud and clearly if it is absent).
// ---------------------------------------------------------------------------
let plugin;
try {
  plugin = (await import("../index.ts")).default;
} catch (error) {
  console.error("COREBRAIN_HOOKS: cannot import '../index.ts'.");
  console.error(String((error && error.message) || error));
  process.exit(2);
}
if (!plugin || typeof plugin.setup !== "function") {
  console.error("COREBRAIN_HOOKS: '../index.ts' has no default { setup } export.");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// 2. Disposable data root + the opt-in config (rule 21: removed on exit).
// ---------------------------------------------------------------------------
const ROOT = mkdtempSync(join(tmpdir(), "core-brain-hooks-"));
const CONFIG = join(ROOT, "config.json");
const NONCE = Date.now().toString(36);
const mark = (tag) => `cb-hooks-${NONCE}-${tag}`;

// The opt-in is a SEPARATE key (CONTRACT.md §9.1): CBA_INJ* opt in explicitly,
// CBA_OFF* omit it (default false), and CBA_UNLISTED is absent from the file.
const CONFIG_ROWS = [
  { name: "CBA_INJ1", hasGlobalAccess: true, private: false, inject: true },
  { name: "CBA_INJ2", hasGlobalAccess: true, private: false, inject: true },
  { name: "CBA_INJ3", hasGlobalAccess: true, private: false, inject: true },
  { name: "CBA_INJ4", hasGlobalAccess: true, private: false, inject: true },
  { name: "CBA_REFRESH", hasGlobalAccess: true, private: false, inject: true },
  { name: "CBA_OFF1", hasGlobalAccess: true, private: false },
  { name: "CBA_OFF2", hasGlobalAccess: true, private: false },
];
writeFileSync(
  CONFIG,
  `${JSON.stringify({ agents: CONFIG_ROWS, memoryTestSet: join(ROOT, "model-of-tests") }, null, 2)}\n`,
);
process.env.CORE_BRAIN_DEBUG = "1";

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

// ---------------------------------------------------------------------------
// 3. The captured fake plugin context.
// ---------------------------------------------------------------------------
const hooks = new Map();
const agentBySession = new Map();
let tool = null;
let disposals = 0;

const ctx = {
  options: { home: ROOT, configPath: CONFIG },
  tool: {
    async transform(callback) {
      callback({
        add(added) {
          tool = added;
        },
      });
      return {
        dispose() {
          disposals += 1;
        },
      };
    },
  },
  session: {
    async hook(name, callback) {
      hooks.set(name, callback);
      return {
        dispose() {
          disposals += 1;
        },
      };
    },
    async get(input) {
      const agent = agentBySession.get(input && input.sessionID);
      return agent ? { agent } : null;
    },
  },
};

let dispose;
try {
  dispose = await plugin.setup(ctx);
} catch (error) {
  console.error(
    `COREBRAIN_HOOKS: setup(ctx) threw: ${String((error && error.message) || error)}`,
  );
  process.exit(2);
}
if (!tool || typeof tool.execute !== "function") {
  console.error("COREBRAIN_HOOKS: setup(ctx) did not register the core_memory tool.");
  process.exit(2);
}

let seq = 0;
function session(agent) {
  const id = `ses_hooks_${NONCE}_${++seq}`;
  agentBySession.set(id, agent);
  return id;
}

/** Drives the plugin's own core_memory tool and returns the parsed JSON. */
async function callTool(sessionID, request) {
  const res = await tool.execute(request, { sessionID });
  const content = res && typeof res.content === "string" ? res.content : "";
  if (content.startsWith("ERROR:")) {
    throw new Error(`core_memory ${request.op} (${sessionID}) failed: ${content}`);
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`core_memory ${request.op} returned non-JSON: ${content}`);
  }
}

function requireHook(name) {
  const callback = hooks.get(name);
  if (typeof callback !== "function") {
    throw new Error(`the "${name}" hook is not registered by setup(ctx)`);
  }
  return callback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Runs the context hook on a fresh event and returns it. */
async function runContext(sessionID, extra = {}) {
  const event = { sessionID, system: [], ...extra };
  await requireHook("context")(event);
  return event;
}

const learnedCount = (results, token) =>
  results.filter((hit) => typeof hit.text === "string" && hit.text.includes(token)).length;
const textsOf = (results) => JSON.stringify(results.map((hit) => hit.text));

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
// A1 — context: automatic injection (opt-in, OFF by default; §9.3)
// ===========================================================================

await scenario(
  "A1.a",
  "opt-in ON: context pushes exactly one block carrying the recalled record",
  async () => {
    const s = session("CBA_INJ1");
    const M = mark("a1-on");
    await callTool(s, { op: "store", text: M });
    const event = await runContext(s, { messages: [{ role: "user", content: M }] });
    assert(
      event.system.length === 1,
      `expected exactly 1 pushed system part, got ${event.system.length}`,
    );
    const part = event.system[0];
    assert(
      part && part.type === "text" && typeof part.text === "string" && part.text.length > 0,
      `pushed part must be {type:"text", text:<non-empty>}; got ${JSON.stringify(part)}`,
    );
    assert(
      part.text.includes(M),
      `block must carry the recalled record ${M}; block=${JSON.stringify(part.text)}`,
    );
  },
);

await scenario(
  "A1.b",
  "opt-in OFF: zero pushes AND recall is never called",
  async () => {
    const s = session("CBA_OFF1");
    const M = mark("a1-off");
    await callTool(s, { op: "store", text: M });
    const event = await runContext(s);
    assert(
      event.system.length === 0,
      `opt-in OFF must push nothing, got ${event.system.length}`,
    );
    const recalled = await callTool(s, { op: "recall", from: "self" });
    assert(
      recalled.results.length === 1,
      `expected the single seeded record, got ${recalled.results.length}`,
    );
    const score = recalled.results[0].score;
    assert(
      score === 11, // born at 10 (2026-11-20) + one recall
      `opt-in OFF must not call recall; one observation recall must yield 11 (10 + 1), got ${score}`,
    );
  },
);

await scenario(
  "A1.c",
  "opt-in ON: event.system absent does not throw",
  async () => {
    const s = session("CBA_INJ1");
    await requireHook("context")({ sessionID: s });
  },
);

await scenario(
  "A1.d",
  "opt-in ON: event.system non-array does not throw",
  async () => {
    const s = session("CBA_INJ1");
    await requireHook("context")({ sessionID: s, system: { not: "an array" } });
  },
);

await scenario(
  "A1.e",
  "an unlisted agent receives nothing by default",
  async () => {
    const s = session("CBA_UNLISTED");
    const M = mark("a1-unlisted");
    await callTool(s, { op: "store", text: M });
    const event = await runContext(s);
    assert(
      event.system.length === 0,
      `unlisted agent must receive nothing, got ${event.system.length} pushes`,
    );
  },
);

// ===========================================================================
// A2 — prompt: learning, read-only (§9.4)
// ===========================================================================

const DURABLE_A2 = "convention: always use pnpm";

await scenario(
  "A2.a",
  "prompt learns once from the USER text and never edits prompt.text",
  async () => {
    const s = session("CBA_INJ2");
    const event = { sessionID: s, prompt: { text: DURABLE_A2 } };
    await requireHook("prompt")(event);
    assert(
      event.prompt.text === DURABLE_A2,
      `prompt.text must be byte-identical; got ${JSON.stringify(event.prompt.text)}`,
    );
    assert(
      JSON.stringify(event.prompt) === JSON.stringify({ text: DURABLE_A2 }),
      `prompt object must be untouched; got ${JSON.stringify(event.prompt)}`,
    );
    const recalled = await callTool(s, { op: "recall", from: "self" });
    const count = learnedCount(recalled.results, "pnpm");
    assert(
      count === 1,
      `expected exactly 1 learned record containing "pnpm", got ${count}: ${textsOf(recalled.results)}`,
    );
  },
);

await scenario(
  "A2.b",
  "prompt dedupes the identical statement (still one record)",
  async () => {
    const s = session("CBA_INJ2");
    await requireHook("prompt")({ sessionID: s, prompt: { text: DURABLE_A2 } });
    const recalled = await callTool(s, { op: "recall", from: "self" });
    const count = learnedCount(recalled.results, "pnpm");
    assert(
      count === 1,
      `dedupe must keep exactly 1 record, got ${count}: ${textsOf(recalled.results)}`,
    );
  },
);

await scenario(
  "A2.c",
  "a non-opted-in agent learns nothing",
  async () => {
    const s = session("CBA_OFF2");
    await requireHook("prompt")({ sessionID: s, prompt: { text: "convention: always use bun" } });
    const recalled = await callTool(s, { op: "recall", from: "self" });
    const count = learnedCount(recalled.results, "bun");
    assert(
      count === 0,
      `non-opted-in agent must learn nothing, got ${count}: ${textsOf(recalled.results)}`,
    );
  },
);

// A Portuguese rule is a rule too (USER, 2026-11-19): the cue list used to be
// English-only, so every rule the USER states in Portuguese was silently
// dropped by the gate. The English cues must keep working (A2.a/A2.b above).
const DURABLE_PT_A2 = "Nunca usar tabs neste repositório — regra do Gand";

await scenario(
  "A2.d",
  "prompt learns a durable statement written in Portuguese",
  async () => {
    const s = session("CBA_INJ2");
    await requireHook("prompt")({ sessionID: s, prompt: { text: DURABLE_PT_A2 } });
    const recalled = await callTool(s, { op: "recall", from: "self" });
    const count = learnedCount(recalled.results, "tabs neste repositório");
    assert(
      count === 1,
      `expected exactly 1 learned Portuguese record, got ${count}: ${textsOf(recalled.results)}`,
    );
  },
);

await scenario(
  "A2.e",
  "a Portuguese sentence without a durable cue is not learned",
  async () => {
    const s = session("CBA_INJ3");
    await requireHook("prompt")({
      sessionID: s,
      prompt: { text: "Hoje o café estava bom e vi o jogo à noite" },
    });
    const recalled = await callTool(s, { op: "recall", from: "self" });
    const count = learnedCount(recalled.results, "café estava bom");
    assert(
      count === 0,
      `ordinary Portuguese chatter must learn nothing, got ${count}: ${textsOf(recalled.results)}`,
    );
  },
);

// ===========================================================================
// A3 — compaction: carry + learn from the discarded (§9.5)
// ===========================================================================

const DURABLE_A3 = "convention: always use yarn";

await scenario(
  "A3.a",
  "compaction carries the block, learns from messages, never writes event.result",
  async () => {
    const s = session("CBA_INJ3");
    const M = mark("a3-seed");
    await callTool(s, { op: "store", text: M });
    const messageText = `${DURABLE_A3} ${M}`;
    const message = {
      role: "user",
      content: messageText,
      parts: [{ type: "text", text: messageText }],
    };
    const event = {
      sessionID: s,
      system: [],
      messages: [message],
      result: undefined,
    };
    await requireHook("compaction")(event);
    assert(
      event.result === undefined,
      `compaction must not set event.result; got ${JSON.stringify(event.result)}`,
    );
    assert(
      event.system.length === 1,
      `expected exactly 1 carried system part, got ${event.system.length}`,
    );
    const part = event.system[0];
    assert(
      part && part.type === "text" && typeof part.text === "string" && part.text.length > 0,
      `carried part must be {type:"text", text:<non-empty>}; got ${JSON.stringify(part)}`,
    );
    assert(
      part.text.includes(M),
      `carried block must carry the recalled record ${M}; block=${JSON.stringify(part.text)}`,
    );
    const recalled = await callTool(s, { op: "recall", from: "self" });
    const count = learnedCount(recalled.results, "yarn");
    assert(
      count === 1,
      `expected exactly 1 record learned from the discarded messages, got ${count}: ${textsOf(recalled.results)}`,
    );
  },
);

await scenario(
  "A3.b",
  "a non-opted-in agent: compaction carries nothing and learns nothing",
  async () => {
    const s = session("CBA_OFF1");
    const messageText = "convention: always use cargo";
    const event = {
      sessionID: s,
      system: [],
      messages: [{ role: "user", content: messageText, parts: [{ type: "text", text: messageText }] }],
      result: undefined,
    };
    await requireHook("compaction")(event);
    assert(
      event.system.length === 0,
      `non-opted-in compaction must carry nothing, got ${event.system.length}`,
    );
    assert(
      event.result === undefined,
      `event.result must stay untouched; got ${JSON.stringify(event.result)}`,
    );
    const recalled = await callTool(s, { op: "recall", from: "self" });
    const count = learnedCount(recalled.results, "cargo");
    assert(
      count === 0,
      `non-opted-in compaction must learn nothing, got ${count}: ${textsOf(recalled.results)}`,
    );
  },
);

// ===========================================================================
// A1.f — the injection must not count as a retrieval (placed last: it seeds
// one extra record, and the contexts above rank a fixed number of them).
// The read happens on the model's behalf, not for the model; counting it made
// the same five memories win every session forever (measured 2026-11-19: the
// injected records gained +5 score across a handful of reads).
// ===========================================================================

await scenario(
  "A1.f",
  "the injection reads without counting a retrieval",
  async () => {
    const s = session("CBA_INJ1");
    const M = mark("a1-nocount");
    const stored = await callTool(s, { op: "store", text: M });
    // Two usefulness marks take it above every seeded record, so it is inside
    // the injected five whatever order the others are in.
    await callTool(s, { op: "feedback", id: stored.id, useful: true });
    await callTool(s, { op: "feedback", id: stored.id, useful: true });
    const event = await runContext(s);
    assert(
      event.system.length === 1,
      `expected exactly 1 pushed part, got ${event.system.length}`,
    );
    assert(
      typeof event.system[0]?.text === "string" && event.system[0].text.includes(M),
      `the block must carry the seeded record; block=${JSON.stringify(event.system[0]?.text)}`,
    );
    const recalled = await callTool(s, { op: "recall", from: "self" });
    const hit = recalled.results.find((result) => result.text === M);
    assert(hit !== undefined, "the seeded record must still be returned");
    assert(
      hit.score === 11, // born at 10 + one recall
      `the hook read must not count: one observation recall must yield 11, got ${hit.score}`,
    );
  },
);

// ===========================================================================
// A1.g — the block size is ONE global setting (USER, 2026-11-19): the engine
// reads `memoriesPerContext` from config.json and defaults to 5.
// ===========================================================================

await scenario(
  "A1.g",
  "the block size comes from the global memoriesPerContext",
  async () => {
    const { createEngine } = await import("../store.ts");
    const custom = join(ROOT, "config-limit.json");
    writeFileSync(
      custom,
      `${JSON.stringify({ memoriesPerContext: 2, agents: CONFIG_ROWS }, null, 2)}\n`,
    );
    const sized = createEngine({ home: ROOT, configPath: custom });
    assert(
      sized.memoriesPerContext() === 2,
      `expected the configured 2, got ${sized.memoriesPerContext()}`,
    );
    const plain = createEngine({ home: ROOT, configPath: CONFIG });
    assert(
      plain.memoriesPerContext() === 5,
      `an absent setting must default to 5, got ${plain.memoriesPerContext()}`,
    );
  },
);

// ===========================================================================
// A1.h — the block is TWO halves (USER, 2026-11-19): up to `memoriesPerContext`
// global records + the same number from the agent's own space. Placed last:
// it seeds the global space, which no context above expects.
// ===========================================================================

await scenario(
  "A1.h",
  "the block carries the global half and the agent's own half",
  async () => {
    const s = session("CBA_INJ4");
    const own = mark("block-own");
    const shared = mark("block-global");
    await callTool(s, { op: "store", text: own });
    await callTool(s, { op: "store", target: "global", text: shared });
    const event = await runContext(s);
    assert(
      event.system.length === 1,
      `expected exactly 1 pushed part, got ${event.system.length}`,
    );
    const block = String(event.system[0]?.text ?? "");
    const bullets = block.split("\n").filter((line) => line.startsWith("- ")).length;
    assert(bullets === 2, `expected 2 memories (1 global + 1 own), got ${bullets}: ${block}`);
    assert(block.includes(shared), `the global half is missing: ${block}`);
    assert(block.includes(own), `the agent's own half is missing: ${block}`);
  },
);

// ===========================================================================
// A1.i — the block FOLLOWS the conversation (USER, 2026-11-19). At start there is
// no prompt, so it is chosen by strength; once a prompt exists the block is
// searched by it and REPLACED in place (before, the marker meant «skip»).
// ===========================================================================

await scenario(
  "A1.i",
  "a new prompt replaces the block instead of being skipped",
  async () => {
    const s = session("CBA_REFRESH");
    const topics = ["sglang", "voice", "dreams", "contas", "orchestrator", "foundry"];
    for (const topic of topics) {
      await callTool(s, { op: "store", text: `regra fixa sobre ${topic}` });
    }
    const event = await runContext(s);
    assert(event.system.length === 1, `expected the block, got ${event.system.length}`);
    const first = String(event.system[0]?.text ?? "");
    assert(first.includes("automatic memory context"), `not the memory block: ${first}`);

    await requireHook("prompt")({ sessionID: s, prompt: { text: "como está a regra do sglang?" } });
    await requireHook("context")(event);
    assert(
      event.system.length === 1,
      `the block must be replaced in place, not duplicated (got ${event.system.length} parts)`,
    );
    const second = String(event.system[0]?.text ?? "");
    assert(
      second !== first,
      `the block must change with the subject; it stayed the same: ${second}`,
    );
  },
);

// ===========================================================================
// S1 — a memory has a shape: 600 characters, and going over is REFUSED with the
// number, never truncated (USER, 2026-11-19). Driven here because this suite
// already calls the plugin's own tool. The quality gate behind it is a stub that
// accepts everything (`store.memoryIsAcceptable`) — Laya's verdict plugs there.
// ===========================================================================

await scenario(
  "S1",
  "store refuses a memory longer than 600 characters and names the cut",
  async () => {
    const s = session("CBA_INJ1");
    const long = `x`.repeat(700);
    let refusal = "";
    try {
      await callTool(s, { op: "store", text: long });
    } catch (error) {
      refusal = String(error?.message ?? error);
    }
    assert(refusal !== "", "a 700-character memory must be refused");
    assert(
      refusal.includes("limit is 600"),
      `the refusal must name the limit: ${refusal}`,
    );
    assert(
      refusal.includes("cut at least 100"),
      `the refusal must say how much to cut: ${refusal}`,
    );
    const short = await callTool(s, { op: "store", text: `x`.repeat(600) });
    assert(
      typeof short.id === "string" && short.id.length > 0,
      "600 characters exactly must be accepted",
    );
  },
);


// ===========================================================================
// S2 — every memory written is a training case, with an EMPTY vote (USER, 2026-11-19).
// ===========================================================================

await scenario(
  "S2",
  "a stored memory lands in the training set with vote null",
  async () => {
    const s = session("CBA_INJ1");
    const text = mark("training-case");
    await callTool(s, { op: "store", text });
    const file = join(ROOT, "model-of-tests", "cases.jsonl");
    const rows = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const last = rows[rows.length - 1];
    assert(last.memory === text, `the last case must be the memory just written; got ${last.memory}`);
    assert(last.vote === null, `the vote must be empty for the USER to fill; got ${JSON.stringify(last.vote)}`);
    assert(last.agent === "CBA_INJ1", `the agent must be recorded; got ${last.agent}`);
    assert(typeof last.id === "string" && last.id.length > 0, "the memory id must be recorded");
  },
);

// ===========================================================================
// A4 — closing ritual: UNKNOWN, not tested (§9.6). Explicit skip, no FAIL.
// ===========================================================================
skip += 1;
ledger.push({
  id: "A4",
  status: "SKIP",
  label: "closing ritual (session end)",
  detail:
    "UNKNOWN (plan D5): the closed session-hook list has no session-end member; " +
    "no hook is registered and nothing is tested here.",
});

// ===========================================================================
// Registration envelope — the three hooks exist and every registration is
// disposed by the returned disposer (plan D1/rule 1.2.6). Run LAST.
// ===========================================================================
await scenario(
  "REG",
  "setup registers context/prompt/compaction and disposes every registration",
  async () => {
    for (const name of ["context", "prompt", "compaction"]) {
      assert(typeof hooks.get(name) === "function", `hook "${name}" is not registered`);
    }
    if (typeof dispose === "function") await dispose();
    assert(
      disposals >= 4,
      `the returned disposer must dispose every registration (tool + 3 hooks); got ${disposals}`,
    );
  },
);

// ---------------------------------------------------------------------------
// 5. Report + exit code.
// ---------------------------------------------------------------------------
console.log("");
console.log(`core-brain automatic layer (Fatia 2, CONTRACT.md §9) — ROOT=${ROOT}`);
console.log(`opt-in config: ${JSON.stringify(CONFIG_ROWS)}`);
for (const row of ledger) {
  const detail = row.detail ? `  -> ${row.detail}` : "";
  console.log(`${row.id.padEnd(5)} ${row.status}  ${row.label}${detail}`);
}
console.log("");
console.log(
  `${pass}/${pass + fail} ledgers PASS, ${skip} SKIP (A4 UNKNOWN), exit ${fail === 0 ? 0 : 1}`,
);

cleanup();
process.exitCode = fail === 0 ? 0 : 1;
