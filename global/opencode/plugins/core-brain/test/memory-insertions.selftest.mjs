#!/usr/bin/env node
// test/memory-insertions.selftest.mjs — the insertion record: TWO lines per case, joined by `id`.
//
// The format is what the memory-quality work (1.3.3.3) will be judged on, so it is pinned here
// before anything writes it: one `initialization` line when the agent is interrupted, one
// `finalization` line when it answers, the same `id` on both, and a case with no finalization
// half still readable (that is the case worth studying).
//
// Run: node --experimental-strip-types test/memory-insertions.selftest.mjs

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendRecord,
  buildFinalizationLine,
  buildInitializationLine,
  insertionLogPath,
  newInsertionId,
  readCases,
  readRecords,
} from "../memory-insertions.ts";

const root = mkdtempSync(join(tmpdir(), "core-brain-insertions-"));
const file = insertionLogPath(root);
const lines = [];
let failures = 0;

const check = (name, condition, detail = "") => {
  if (condition) lines.push(`PASS  ${name}`);
  else {
    failures += 1;
    lines.push(`FAIL  ${name}${detail ? `  (${detail})` : ""}`);
  }
};

try {
  const id = newInsertionId(1795071802123);
  const tools = [
    { type: "read", times: 12 },
    { type: "bash", times: 5 },
  ];

  appendRecord(
    file,
    buildInitializationLine({ id, session: "ses_a", agent: "ORACLE", prompt: "continua", tools }),
  );
  appendRecord(
    file,
    buildFinalizationLine({ id, session: "ses_a", written: [{ id: "m1", text: "uma memória" }] }),
  );

  // A second case that produced nothing — the negative case must survive too.
  const silent = newInsertionId(1795071900000);
  appendRecord(
    file,
    buildInitializationLine({ id: silent, session: "ses_b", agent: "DEVELOPER", prompt: null, tools }),
  );

  const raw = readFileSync(file, "utf8").trimEnd().split("\n");
  check("I1 one JSON object per line", raw.every((line) => line.startsWith("{") && line.endsWith("}")));
  check("I2 three lines for two cases", raw.length === 3, `got ${raw.length}`);

  const kinds = raw.map((line) => JSON.parse(line).kind);
  check(
    "I3 the kinds are initialization and finalization",
    kinds.join(",") === "initialization,finalization,initialization",
    kinds.join(","),
  );

  const records = readRecords(file);
  check("I4 every line parses", records.length === 3, `got ${records.length}`);

  const cases = readCases(file);
  check("I5 two cases after joining by id", cases.length === 2, `got ${cases.length}`);

  const complete = cases.find((entry) => entry.id === id);
  check(
    "I6 the complete case has both halves",
    complete?.initialization != null && complete?.finalization != null,
  );
  check(
    "I7 the finalization half carries the memories",
    complete?.finalization?.written[0]?.text === "uma memória",
  );
  check("I8 the prompt is stored as given", complete?.initialization?.prompt === "continua");
  check(
    "I9 the tools are an array of {type,times}",
    Array.isArray(complete?.initialization?.tools) &&
      complete?.initialization?.tools[1]?.times === 5,
  );

  const empty = cases.find((entry) => entry.id === silent);
  check(
    "I10 a case with no answer still reads",
    empty?.initialization != null && empty?.finalization == null,
  );
  check("I11 a null prompt is allowed", empty?.initialization?.prompt === null);
} finally {
  rmSync(root, { recursive: true, force: true });
}

for (const line of lines) console.log(line);
console.log("----");
console.log(`${lines.length - failures}/${lines.length} PASS`);
process.exit(failures === 0 ? 0 : 1);
