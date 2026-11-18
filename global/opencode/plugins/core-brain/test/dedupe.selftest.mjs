// test/dedupe.selftest.mjs — the maintenance pass that collapses duplicated memories.
//
// USER decision (2026-11-18): scan the memory, and when two records say the same thing, REMOVE one
// and REINFORCE the other. "Remove" here means RETIRE (soft): the duplicate leaves `recall` and
// keeps `retiredAt` — the text stays on disk, auditable.
//
// What is pinned:
//   1. dry-run reports the groups and writes NOTHING;
//   2. apply keeps ONE record per normalised text, retires the rest with `meta.absorbedInto`;
//   3. the survivor is REINFORCED: retrievals and feedback counters are summed;
//   4. a second run is a no-op (idempotent) and the active count only shrinks (convergence);
//   5. `--ns` restricts the scan to one namespace.
//
// Fixture embedder: deterministic, no model download. Disposable home only (guarded).

import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFixtureEmbedder, FIXTURE_DIR } from "./fixtures/embedder.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "corebrain-dedupe-"));
process.env.CORE_BRAIN_HOME = ROOT;
writeFileSync(
  join(ROOT, "config.json"),
  JSON.stringify({ agents: [{ name: "CB_ALPHA", hasGlobalAccess: true, private: false }] }),
);

const { createEngine } = await import("../store.ts");
const engine = createEngine({ embedder: createFixtureEmbedder({ dir: FIXTURE_DIR }) });

const policy = await engine.invoke("CB_ALPHA", { op: "who" });
if (policy.dataDir !== ROOT) {
  console.error(`COREBRAIN_DEDUPE: refusing to run against ${policy.dataDir} (expected ${ROOT})`);
  process.exit(2);
}

const MEMORIES = join(ROOT, "agents", "CB_ALPHA", "memories.json");
const records = () => JSON.parse(readFileSync(MEMORIES, "utf8"));
const active = () => records().filter((record) => typeof record.retiredAt !== "string");

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

// ---------------------------------------------------------------------------
// Arrange: three records that say the same thing (spacing/case differ) + one distinct
// ---------------------------------------------------------------------------
const SAME = "The Jarvis key lives in ~/.config/jarvis-client/config.json.";
const first = await engine.invoke("CB_ALPHA", { op: "store", text: SAME });
const second = await engine.invoke("CB_ALPHA", { op: "store", text: `  ${SAME.toUpperCase()}  ` });
const third = await engine.invoke("CB_ALPHA", { op: "store", text: SAME.replace(" ", "  ") });
await engine.invoke("CB_ALPHA", { op: "store", text: "The Ravenloft glossary has 17 terms." });

// Give the copies different weights, so "reinforce" has something measurable to do.
await engine.invoke("CB_ALPHA", { op: "feedback", id: first.id, useful: true });
await engine.invoke("CB_ALPHA", { op: "feedback", id: second.id, useful: true });
await engine.invoke("CB_ALPHA", { op: "feedback", id: third.id, useful: false });

check("4 active records before the scan", active().length === 4, `active=${active().length}`);

// ---------------------------------------------------------------------------
// 1. Dry-run: reports the group, writes nothing
// ---------------------------------------------------------------------------
const dry = await engine.invoke("CB_ALPHA", { op: "admin", action: "dedupe", args: {} });
check("dry-run finds 1 group", Array.isArray(dry.groups) && dry.groups.length === 1, JSON.stringify(dry.groups));
check("dry-run points at 2 retirements", dry.groups?.[0]?.retired?.length === 2, JSON.stringify(dry.groups?.[0]));
check("dry-run writes nothing", active().length === 4, `active=${active().length}`);

// ---------------------------------------------------------------------------
// 2. Apply: one survivor, two retired, counters summed
// ---------------------------------------------------------------------------
const applied = await engine.invoke("CB_ALPHA", { op: "admin", action: "dedupe", args: { apply: true } });
check("apply returns ok", applied.ok === true, JSON.stringify(applied));
check("1 active record of the repeated text remains", active().length === 2, `active=${active().length}`);

const survivor = active().find((record) => record.text.trim().toUpperCase().includes("JARVIS KEY"));
check("the survivor has the summed feedback",
  survivor?.feedback?.useful === 2 && survivor?.feedback?.useless === 1,
  JSON.stringify(survivor?.feedback));

const retired = records().filter((record) => typeof record.retiredAt === "string");
check("2 retired records", retired.length === 2, `retired=${retired.length}`);
check("the retired ones point at the survivor",
  retired.every((record) => record.meta?.absorbedInto === survivor?.id),
  JSON.stringify(retired.map((record) => record.meta)));

// ---------------------------------------------------------------------------
// 3. Idempotent: a second run changes nothing
// ---------------------------------------------------------------------------
const snapshot = JSON.stringify(records());
const again = await engine.invoke("CB_ALPHA", { op: "admin", action: "dedupe", args: { apply: true } });
check("the second pass finds no groups", Array.isArray(again.groups) && again.groups.length === 0,
  JSON.stringify(again.groups));
check("the second pass does not change the file", JSON.stringify(records()) === snapshot, "file changed");

// ---------------------------------------------------------------------------
// 4. --ns filter: another namespace is left alone
// ---------------------------------------------------------------------------
await engine.invoke("CB_BETA", { op: "store", text: "Duplicate in Beta." });
await engine.invoke("CB_BETA", { op: "store", text: "Duplicate in Beta." });
const betaBefore = readFileSync(join(ROOT, "agents", "CB_BETA", "memories.json"), "utf8");
await engine.invoke("CB_ALPHA", {
  op: "admin",
  action: "dedupe",
  args: { apply: true, ns: "agent:CB_ALPHA" },
});
check("the --ns filter leaves another space untouched",
  readFileSync(join(ROOT, "agents", "CB_BETA", "memories.json"), "utf8") === betaBefore,
  "the CB_BETA space changed");

console.log(failures === 0 ? "DEDUPE OK" : `DEDUPE FAILED (${failures})`);
process.exitCode = failures === 0 ? 0 : 1;
