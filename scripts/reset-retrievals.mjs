#!/usr/bin/env node
// scripts/reset-retrievals.mjs — lower the `retrievals` counter of named records.
//
// WHY THIS EXISTS (2026-11-19): the automatic context injection used to count
// itself as a retrieval, so five records reached ~70 000 and won every session
// forever. Stopping the inflation froze those numbers; lowering them lets the
// records earn their place again. It is a counter reset, nothing else: no text,
// no id, no date and no feedback mark is touched.
//
// Usage:
//   node scripts/reset-retrievals.mjs --ids <id,id,...> [--value 1] [--root DIR] [--apply]
//
// Dry-run by default: it prints the plan and writes nothing. `--apply` performs
// the change and then re-reads the file to prove the invariants (same records,
// same ids, no clones, only `retrievals` changed).

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};

const root = flag("--root", join(process.env.HOME ?? "", ".config", "core-brain"));
const value = Number(flag("--value", "1"));
const apply = args.includes("--apply");
const ids = String(flag("--ids", ""))
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

if (ids.length === 0) {
  console.error("reset-retrievals: --ids is required (comma separated)");
  process.exit(2);
}
if (!Number.isFinite(value) || value < 0) {
  console.error("reset-retrievals: --value must be a non-negative number");
  process.exit(2);
}

const file = join(root, "global", "memories.json");
const raw = readFileSync(file, "utf8");
const parsed = JSON.parse(raw);
const carry = (list) => (Array.isArray(list) ? list : parsed.memories ?? parsed.records ?? []);
const before = carry(Array.isArray(parsed) ? parsed : parsed.memories ?? parsed.records);
const beforeCount = before.length;
const beforeIds = new Set(before.map((record) => record.id));

const planned = [];
for (const record of before) {
  if (!ids.includes(String(record.id))) continue;
  planned.push({
    id: record.id,
    from: Number(record.retrievals) || 0,
    to: value,
    head: String(record.text ?? "").slice(0, 46),
  });
}

const missing = ids.filter((id) => !beforeIds.has(id));
console.log(`file: ${file}`);
console.log(`records: ${beforeCount} · matched: ${planned.length} · missing: ${missing.length}`);
for (const row of planned) {
  console.log(`  ${row.id}  retrievals ${row.from} -> ${row.to}  :: ${row.head}`);
}
if (missing.length > 0) console.log(`  not found: ${missing.join(", ")}`);

if (!apply) {
  console.log("dry-run: nothing written (pass --apply to write)");
  process.exit(0);
}

for (const record of before) {
  if (ids.includes(String(record.id))) record.retrievals = value;
}

const payload = Array.isArray(parsed) ? before : { ...parsed, memories: before };
const temp = `${file}.tmp-${process.pid}`;
writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
renameSync(temp, file);

// Invariants: same number of records, same ids, no clones, only `retrievals` differs.
const after = JSON.parse(readFileSync(file, "utf8"));
const afterList = Array.isArray(after) ? after : after.memories ?? after.records ?? [];
const afterIds = new Set(afterList.map((record) => record.id));
const sameCount = afterList.length === beforeCount;
const sameIds = afterIds.size === beforeIds.size && [...beforeIds].every((id) => afterIds.has(id));
const changed = afterList.filter((record) => {
  const old = before.find((candidate) => candidate.id === record.id);
  if (!old) return true;
  const copyOld = { ...old };
  const copyNew = { ...record };
  delete copyOld.retrievals;
  delete copyNew.retrievals;
  return JSON.stringify(copyOld) !== JSON.stringify(copyNew);
});

console.log(`applied: ${planned.length} record(s) set to retrievals=${value}`);
console.log(`invariants: count ${sameCount ? "ok" : "BROKEN"} · ids ${sameIds ? "ok" : "BROKEN"} · other fields ${changed.length === 0 ? "ok" : `BROKEN (${changed.length})`}`);
process.exit(sameCount && sameIds && changed.length === 0 ? 0 : 1);
