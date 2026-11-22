// migrate-score-baseline.mjs — the Score starts at 10 (USER, 2026-11-20).
//
// Every existing memory receives +10 on its current `retrievals`, so the whole corpus obeys the
// "born with 10" rule before the nightly decrement starts eating it. Dry-run unless --apply.
//
//   node scripts/migrate-score-baseline.mjs            # report only
//   node scripts/migrate-score-baseline.mjs --apply    # write
//
// The same file documents the number: 10.

import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

const DB = process.env.CORE_BRAIN_DB || join(homedir(), ".config", "core-brain", "memory.db");
const BONUS = 10;
const apply = process.argv.includes("--apply");

const db = new DatabaseSync(DB);
const summary = () => {
  const row = db
    .prepare("SELECT COUNT(*) AS n, MIN(retrievals) AS min, MAX(retrievals) AS max, ROUND(AVG(retrievals), 2) AS avg FROM memories")
    .get();
  return { rows: Number(row.n), min: Number(row.min ?? 0), max: Number(row.max ?? 0), avg: Number(row.avg ?? 0) };
};

const before = summary();
console.log(`base: ${DB}`);
console.log(`antes: ${JSON.stringify(before)}`);
if (!apply) {
  console.log(`dry-run: ${before.rows} memórias receberiam +${BONUS}`);
  process.exit(0);
}

db.exec("BEGIN");
try {
  db.prepare("UPDATE memories SET retrievals = retrievals + ?").run(BONUS);
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}
console.log(`depois: ${JSON.stringify(summary())}`);
console.log(`ok: +${BONUS} em ${before.rows} memórias`);
