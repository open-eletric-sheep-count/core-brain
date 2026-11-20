// test/dedupe-namespaces.selftest.mjs — a merge NEVER crosses a namespace (USER, 2026-11-20).
//
// The rule, in the USER's words: two memories of ONE agent become one memory of THAT agent; two
// globals become one global; and a global beside an agent memory is NOT duplication — the two live in
// different spaces and both stay. The rule is structural (every pass walks one namespace at a time);
// this suite pins it so a future refactor cannot quietly break it.
//
// What is pinned:
//   1. two memories of one agent -> ONE memory, still the agent's;
//   2. two global memories       -> ONE global memory;
//   3. a global + an agent copy  -> NOT a duplicate: no group, both ACTIVE (identical text included);
//   4. the dream obeys the same rule: it looks only inside its own namespace, and never touches global.

import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFixtureEmbedder, FIXTURE_DIR } from "./fixtures/embedder.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "corebrain-dedupe-ns-"));
process.env.CORE_BRAIN_HOME = ROOT;
writeFileSync(
  join(ROOT, "config.json"),
  JSON.stringify({
    dreamPerDay: 5,
    agents: [{ name: "CB_ALPHA", hasGlobalAccess: true, private: false }],
  }),
);

const { createEngine } = await import("../store.ts");
const engine = createEngine({ embedder: createFixtureEmbedder({ dir: FIXTURE_DIR }) });

const policy = await engine.invoke("CB_ALPHA", { op: "who" });
if (policy.dataDir !== ROOT) {
  console.error(`COREBRAIN_DEDUPE_NS: refusing to run against ${policy.dataDir} (expected ${ROOT})`);
  process.exit(2);
}

const readSpace = (relative) => {
  const file = join(ROOT, relative, "memories.json");
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const list = Array.isArray(parsed) ? parsed : parsed.records ?? [];
    return list.filter((record) => typeof record.retiredAt !== "string");
  } catch {
    return [];
  }
};
const agentActive = () => readSpace(join("agents", "CB_ALPHA"));
const globalActive = () => readSpace("global");

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

const dedupe = (args) => engine.invoke("CB_ALPHA", { op: "admin", action: "dedupe", args });

// ---------------------------------------------------------------------------
// 1. Two memories of ONE agent become one memory OF THAT AGENT
// ---------------------------------------------------------------------------
const AGENT_A = "The deploy script rebuilds the client bundle, so the release page stays current.";
const AGENT_B = "The deploy script rebuilds the client bundle; the release page stays current.";
await engine.invoke("CB_ALPHA", { op: "store", text: AGENT_A });
await engine.invoke("CB_ALPHA", { op: "store", text: AGENT_B });

const agentRun = await dedupe({ apply: true, ns: "agent:CB_ALPHA" });
check("1 group inside the agent space", agentRun.groups?.length === 1, JSON.stringify(agentRun.groups));
check("the group belongs to the agent space", agentRun.groups?.[0]?.ns === "agent:CB_ALPHA",
  JSON.stringify(agentRun.groups?.[0]));
check("the agent keeps ONE memory", agentActive().length === 1, `active=${agentActive().length}`);
check("the global space was not touched", globalActive().length === 0, `global=${globalActive().length}`);
check("the surviving memory is the agent's", agentActive()[0]?.scope === "agent",
  String(agentActive()[0]?.scope));

// ---------------------------------------------------------------------------
// 2. Two GLOBAL memories become one GLOBAL memory
// ---------------------------------------------------------------------------
const GLOBAL_A = "The vault export writes Obsidian callouts, so the notes keep their shape.";
const GLOBAL_B = "The vault export writes Obsidian callouts; the notes keep their shape.";
await engine.invoke("CB_ALPHA", { op: "store", target: "global", text: GLOBAL_A });
await engine.invoke("CB_ALPHA", { op: "store", target: "global", text: GLOBAL_B });

const globalRun = await dedupe({ apply: true, ns: "global" });
check("1 group inside the global space", globalRun.groups?.length === 1, JSON.stringify(globalRun.groups));
check("the group belongs to the global space", globalRun.groups?.[0]?.ns === "global",
  JSON.stringify(globalRun.groups?.[0]));
check("global keeps ONE memory", globalActive().length === 1, `global=${globalActive().length}`);
check("the surviving memory is global", globalActive()[0]?.scope === "global",
  String(globalActive()[0]?.scope));
check("the agent space still has its ONE memory", agentActive().length === 1, `active=${agentActive().length}`);

// ---------------------------------------------------------------------------
// 3. A global + an agent memory is NOT duplication — identical text included
// ---------------------------------------------------------------------------
const SHARED = "The nightly backup runs at 03:00 and writes to the external drive.";
await engine.invoke("CB_ALPHA", { op: "store", text: SHARED });
await engine.invoke("CB_ALPHA", { op: "store", target: "global", text: SHARED });

const dryBoth = await dedupe({});
check("no group appears for the shared text", (dryBoth.groups ?? []).length === 0,
  JSON.stringify(dryBoth.groups));

const applyBoth = await dedupe({ apply: true });
check("apply collapses nothing", (applyBoth.groups ?? []).length === 0, JSON.stringify(applyBoth.groups));
check("the agent copy stays ACTIVE", agentActive().some((record) => record.text === SHARED), "missing");
check("the global copy stays ACTIVE", globalActive().some((record) => record.text === SHARED), "missing");
check("2 active records in each space", agentActive().length === 2 && globalActive().length === 2,
  `agent=${agentActive().length} global=${globalActive().length}`);

// ---------------------------------------------------------------------------
// 4. The dream obeys the same rule
// ---------------------------------------------------------------------------
const DREAM_TWIN = "The nightly backup runs at 03:00, writing to the external drive.";
const episode = await engine.invoke("CB_ALPHA", { op: "episode", summary: "Checked the backup schedule." });
const dreamed = await engine.invoke("CB_ALPHA", {
  op: "dream",
  episodeIds: [episode.id],
  memories: [{ text: DREAM_TWIN }],
});

check("the dream wrote to its own space, not to global",
  agentActive().some((record) => record.text === DREAM_TWIN), "not found in the agent space");
check("the global copy was left alone",
  globalActive().filter((record) => record.text === SHARED).length === 1, "global changed");
check("the dream did not report a join across spaces", (dreamed.reinforced ?? []).length === 0,
  JSON.stringify(dreamed.reinforced));
check("the queue row (if any) belongs to the agent space",
  (await engine.invoke("CB_ALPHA", { op: "admin", action: "dream-memories", args: { status: "all" } }))
    .dreamMemories?.every((row) => row.namespace === "agent:CB_ALPHA") !== false,
  "a queue row carries another namespace");

console.log(failures === 0 ? "DEDUPE NAMESPACES OK" : `DEDUPE NAMESPACES FAILED (${failures})`);
process.exitCode = failures === 0 ? 0 : 1;
