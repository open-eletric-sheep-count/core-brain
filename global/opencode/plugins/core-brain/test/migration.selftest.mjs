// test/migration.selftest.mjs — the 1.1 → 1.2 migration (USER, 2026-11-22).
//
// Pinned:
//   1. a JSON store is seeded into `memory.db` on the first database open;
//   2. the seeded memories are readable through the database afterwards;
//   3. the JSON files the database replaced are MOVED to `legacy/` — memories.json per space and the
//      vectors tree — while `episodes.json` stays where it is (still the live store for episodes);
//   4. the move keeps the bytes (nothing is rewritten).

import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFixtureEmbedder, FIXTURE_DIR } from "./fixtures/embedder.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "corebrain-migration-"));
process.env.CORE_BRAIN_HOME = ROOT;
writeFileSync(
  join(ROOT, "config.json"),
  JSON.stringify({ dreams: true, agents: [{ name: "CB_ALPHA", hasGlobalAccess: true, private: false }] }),
);

const { createEngine } = await import("../store.ts");

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

// --- 1.1: write a JSON store, the way the old version did --------------------
process.env.CORE_BRAIN_STORE = "json";
const before = createEngine({ embedder: createFixtureEmbedder({ dir: FIXTURE_DIR }) });
for (const text of ["The queue is drained by the worker.", "Retries are capped at three.", "The log is append-only."]) {
  await before.invoke("CB_ALPHA", { op: "store", text });
}
const episodes = join(ROOT, "agents", "CB_ALPHA", "episodes.json");
writeFileSync(episodes, JSON.stringify([{ id: "EP-legacy-0001", at: new Date().toISOString(), summary: "A legacy episode." }]));
const jsonMemories = join(ROOT, "agents", "CB_ALPHA", "memories.json");
check("the 1.1 store left memories.json behind", existsSync(jsonMemories), jsonMemories);
const originalBytes = readFileSync(jsonMemories, "utf8");

// --- 1.2: open the same root with the database -------------------------------
delete process.env.CORE_BRAIN_STORE;
const after = createEngine({ embedder: createFixtureEmbedder({ dir: FIXTURE_DIR }) });
const recalled = await after.invoke("CB_ALPHA", { op: "recall", query: "worker queue retries", limit: 5 });
check("the old memories answer through the database", (recalled.results ?? []).length >= 2, String((recalled.results ?? []).length));

// --- the JSON store went to legacy/ -----------------------------------------
const legacyMemories = join(ROOT, "legacy", "agents", "CB_ALPHA", "memories.json");
check("memories.json was moved to legacy/", existsSync(legacyMemories), legacyMemories);
check("the old file is no longer in the live place", !existsSync(jsonMemories), jsonMemories);
check("the bytes were not rewritten", readFileSync(legacyMemories, "utf8") === originalBytes, "content differs");
check("the vectors/ tree was moved to legacy/", existsSync(join(ROOT, "legacy", "vectors")), "vectors/ ficou");
check("episodes.json stays where it was (still the live store)", existsSync(episodes), episodes);

console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
