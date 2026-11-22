// test/history-archive.selftest.mjs — retired memories leave the live table (USER, 2026-11-20).
//
// The USER's decision, in English: the retired rows are moved to `memories_history` when the dream
// closes, so the table every agent reads does not accumulate dead weight; the history exists for
// auditing and he may delete it from time to time.
//
// This suite runs the SQLITE path (the production one): it deletes CORE_BRAIN_STORE so the engine
// chooses the database even when check.sh exported the JSON escape hatch.
//
// What is pinned:
//   1. the archive moves every RETIRED row out of `memories` into `memories_history`;
//   2. it takes the FTS entry and the vector with it (a retired memory is never recalled again);
//   3. the ACTIVE rows are untouched;
//   4. a second archive moves nothing (idempotent);
//   5. `admin history` reports the size of the history.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { createFixtureEmbedder, FIXTURE_DIR } from "./fixtures/embedder.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "corebrain-history-"));
process.env.CORE_BRAIN_HOME = ROOT;
delete process.env.CORE_BRAIN_STORE; // force SQLite
writeFileSync(
  join(ROOT, "config.json"),
  JSON.stringify({ agents: [{ name: "CB_ALPHA", hasGlobalAccess: true, private: false }] }),
);

const { createEngine } = await import("../store.ts");
const engine = createEngine({ embedder: createFixtureEmbedder({ dir: FIXTURE_DIR }) });

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

const count = (table) => {
  const db = new DatabaseSync(join(ROOT, "memory.db"), { readOnly: true });
  const value = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0);
  db.close();
  return value;
};

// Arrange: one duplicated pair (so apply retires one) + one distinct memory.
const SAME = "The Jarvis tray shows the session name at the end of the tooltip.";
await engine.invoke("CB_ALPHA", { op: "store", text: SAME });
await engine.invoke("CB_ALPHA", { op: "store", text: SAME });
await engine.invoke("CB_ALPHA", { op: "store", text: "The Ravenloft glossary lists seventeen terms." });

check("3 rows live before the collapse", count("memories") === 3, `rows=${count("memories")}`);

const applied = await engine.invoke("CB_ALPHA", {
  op: "admin", action: "dedupe", args: { apply: true, mode: "text", ns: "agent:CB_ALPHA" },
});
check("the dedupe retired one copy", applied.ok === true && count("memories") === 3,
  `rows=${count("memories")}`);

// ---------------------------------------------------------------------------
// 1-3. The archive moves the retired rows, with their FTS entry and vector
// ---------------------------------------------------------------------------
const archive = await engine.invoke("CB_ALPHA", { op: "admin", action: "archive", args: {} });
check("the archive reports what it moved", String(archive.detail).startsWith("1 record"), archive.detail);
check("the live table keeps only the ACTIVE rows", count("memories") === 2, `rows=${count("memories")}`);
check("the history holds the retired row", count("memories_history") === 1, `rows=${count("memories_history")}`);
check("the FTS entry went with it", count("memories_fts") === 2, `rows=${count("memories_fts")}`);
check("the vector went with it", count("vectors") === 2, `rows=${count("vectors")}`);

// ---------------------------------------------------------------------------
// 4. Idempotent
// ---------------------------------------------------------------------------
const again = await engine.invoke("CB_ALPHA", { op: "admin", action: "archive", args: {} });
check("a second archive moves nothing", String(again.detail).startsWith("0 record"), again.detail);
check("the history did not grow", count("memories_history") === 1, `rows=${count("memories_history")}`);

// ---------------------------------------------------------------------------
// 5. The history size is readable
// ---------------------------------------------------------------------------
const history = await engine.invoke("CB_ALPHA", { op: "admin", action: "history", args: {} });
check("admin history reports the size", String(history.detail).includes("1 record"), history.detail);

console.log(failures === 0 ? "HISTORY OK" : `HISTORY FAILED (${failures})`);
process.exitCode = failures === 0 ? 0 : 1;
