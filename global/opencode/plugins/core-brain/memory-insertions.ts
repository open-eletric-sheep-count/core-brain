// memory-insertions.ts — the record of every memory insertion, judged after the fact.
//
// WHY IT EXISTS (USER, 2026-11-19). When the plugin interrupts an agent that has gone too long
// without writing a memory, that interruption is ONE case made of TWO lines in the same
// append-only file, joined by the same `id`:
//
//   { "kind": "initialization", ... what the agent was doing when it was interrupted }
//   { "kind": "finalization",   ... the memories it wrote afterwards }
//
// Two lines, not one: a single line written at the end could only describe the cases that
// produced a memory, and the case that produced NOTHING is exactly the one worth studying.
//
// Append-only, one object per line, never rewritten — several plugin copies write, and an
// appended line never erases another. A truncated file loses a line, not the history, and each
// line is a portable test case.

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** One tool, and how many times it was used for something new. */
export interface ToolUse {
  type: string;
  times: number;
}

/** The first half: the moment the agent was interrupted. */
export interface InitializationLine {
  kind: "initialization";
  id: string;
  at: string;
  session: string;
  agent: string;
  /** Null when the interruption fired with no USER message to quote. */
  prompt: string | null;
  tools: ToolUse[];
}

/** The second half: what the agent wrote because of it. */
export interface FinalizationLine {
  kind: "finalization";
  id: string;
  at: string;
  session: string;
  written: { id: string; text: string }[];
}

export type InsertionRecord = InitializationLine | FinalizationLine;

/** Default location, beside the dream log. */
export function insertionLogPath(root: string): string {
  return join(root, "logs", "insertions.jsonl");
}

/** The id shared by a case's two lines. */
export function newInsertionId(now: number = Date.now()): string {
  const tail = Math.random().toString(36).slice(2, 5).padEnd(3, "0");
  return `ins-${now}-${tail}`;
}

/**
 * Appends one line. `appendFileSync` opens with O_APPEND, so two copies writing at the same
 * instant cannot overwrite each other. A failure is swallowed: a record that could not be
 * written is never a reason to fail a store.
 */
export function appendRecord(file: string, record: InsertionRecord): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    /* no data root: the agent's work matters more than the ledger */
  }
}

/** The initialization half, with the tools compressed by name (repetitions are not counted). */
export function buildInitializationLine(input: {
  id: string;
  session: string;
  agent: string;
  prompt: string | null;
  tools: ToolUse[];
  at?: string;
}): InitializationLine {
  return {
    kind: "initialization",
    id: input.id,
    at: input.at ?? new Date().toISOString(),
    session: input.session,
    agent: input.agent,
    prompt: input.prompt,
    tools: input.tools,
  };
}

/** The finalization half, joined to its initialization by `id`. */
export function buildFinalizationLine(input: {
  id: string;
  session: string;
  written: { id: string; text: string }[];
  at?: string;
}): FinalizationLine {
  return {
    kind: "finalization",
    id: input.id,
    at: input.at ?? new Date().toISOString(),
    session: input.session,
    written: input.written,
  };
}

/** Reads every record, skipping half-written lines. */
export function readRecords(file: string): InsertionRecord[] {
  try {
    const raw = readFileSync(file, "utf8");
    const records: InsertionRecord[] = [];
    for (const line of raw.split("\n")) {
      if (line.trim() === "") continue;
      try {
        const parsed = JSON.parse(line) as InsertionRecord;
        if (
          parsed &&
          typeof parsed.id === "string" &&
          (parsed.kind === "initialization" || parsed.kind === "finalization")
        ) {
          records.push(parsed);
        }
      } catch {
        /* a truncated tail line is not a reason to lose the rest */
      }
    }
    return records;
  } catch {
    return [];
  }
}

/** One case, both halves (either may be missing: an interruption that produced nothing). */
export interface InsertionCase {
  id: string;
  initialization: InitializationLine | null;
  finalization: FinalizationLine | null;
}

/** Joins the two lines of each case by `id`, in first-seen order. */
export function readCases(file: string): InsertionCase[] {
  const cases = new Map<string, InsertionCase>();
  for (const record of readRecords(file)) {
    const current = cases.get(record.id) ?? {
      id: record.id,
      initialization: null,
      finalization: null,
    };
    if (record.kind === "initialization") current.initialization = record;
    else current.finalization = record;
    cases.set(record.id, current);
  }
  return [...cases.values()];
}
