// test/dream-score.selftest.mjs — a union inherits the strength it replaces (USER, 2026-11-22):
// its score is the SUM of its sources', never a newborn 10.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { createFixtureEmbedder, FIXTURE_DIR } from "./fixtures/embedder.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "corebrain-dream-score-"));
process.env.CORE_BRAIN_HOME = ROOT;
writeFileSync(
  join(ROOT, "config.json"),
  JSON.stringify({ dreams: true, agents: [{ name: "CB_ALPHA", hasGlobalAccess: true, private: false }] }),
);

const { createEngine } = await import("../store.ts");
const engine = createEngine({ embedder: createFixtureEmbedder({ dir: FIXTURE_DIR }) });

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

const one = await engine.invoke("CB_ALPHA", { op: "store", text: "The parser reads the tokens in order." });
const two = await engine.invoke("CB_ALPHA", { op: "store", text: "The parser walks the tokens left to right." });
const idOne = one.id ?? one.data?.id;
const idTwo = two.id ?? two.data?.id;

// Push the two sources apart so the sum is not just "two tens".
await engine.invoke("CB_ALPHA", { op: "feedback", id: idTwo, useful: true });
await engine.invoke("CB_ALPHA", { op: "feedback", id: idTwo, useful: true });

const dbFile = join(ROOT, "memory.db");
const db = new DatabaseSync(dbFile);
const scoreOf = (id) => Number(db.prepare("SELECT score FROM memories WHERE id = ?").get(id)?.score ?? -1);
const before = scoreOf(idOne) + scoreOf(idTwo);

const landed = await engine.invoke("SYSTEM", {
  op: "admin",
  action: "dream-store",
  args: { ns: "agent:CB_ALPHA", text: "The parser walks the tokens in the order they appear.", sourceIds: [idOne, idTwo] },
});
const dreamId = String(landed.detail ?? "").match(/dream ([0-9a-f-]{36})/)?.[1] ?? "";
check("the dream was written", dreamId !== "", String(landed.detail));
check(
  `the union's score is the sum of the sources (${scoreOf(idOne)} + ${scoreOf(idTwo)} = ${before})`,
  scoreOf(dreamId) === before,
  `ficou ${scoreOf(dreamId)}`,
);
check("the sources were retired", db.prepare("SELECT retired_at FROM memories WHERE id = ?").get(idOne)?.retired_at !== null, "fonte ainda viva");
check("the dream is real = 0", Number(db.prepare("SELECT real FROM memories WHERE id = ?").get(dreamId)?.real) === 0, "real != 0");

// A dream that names no source still starts like any other memory.
const alone = await engine.invoke("SYSTEM", {
  op: "admin",
  action: "dream-store",
  args: { ns: "agent:CB_ALPHA", text: "A dream with no source names nothing.", sourceIds: [] },
});
const aloneId = String(alone.detail ?? "").match(/dream ([0-9a-f-]{36})/)?.[1] ?? "";
check("with no sources it starts at 10", scoreOf(aloneId) === 10, `ficou ${scoreOf(aloneId)}`);

// The sum is over ALL sources, not just two: a group of three carries three.
const three = [];
for (const text of ["Rule one about the queue.", "Rule two about the queue.", "Rule three about the queue."]) {
  const saved = await engine.invoke("CB_ALPHA", { op: "store", text });
  three.push(saved.id ?? saved.data?.id);
}
const groupSum = three.reduce((total, id) => total + scoreOf(id), 0);
const merged = await engine.invoke("SYSTEM", {
  op: "admin",
  action: "dream-store",
  args: { ns: "agent:CB_ALPHA", text: "The queue has one rule, kept in three places.", sourceIds: three },
});
const mergedId = String(merged.detail ?? "").match(/dream ([0-9a-f-]{36})/)?.[1] ?? "";
check(`three sources sum the three (${groupSum})`, scoreOf(mergedId) === groupSum, `ficou ${scoreOf(mergedId)}`);
check("the three sources were retired", three.every((id) => db.prepare("SELECT retired_at FROM memories WHERE id = ?").get(id)?.retired_at !== null), "alguma fonte ficou viva");

console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
