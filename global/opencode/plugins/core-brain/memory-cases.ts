// memory-cases.ts — the training set for the memory-quality model.
//
// WHY IT EXISTS (USER, 2026-11-19). Every memory the agent writes is a CASE for the model that will
// later decide whether a memory deserves to exist. The cases live beside the virgin Laya model
// (`model-of-tests/`), one JSON object per line, and each one carries an EMPTY vote: the USER marks
// them by hand once there are a hundred or so, and that labelled base is what the model is trained on.
//
// ALL memories go in — not only the ones written after an interruption (USER, 2026-11-19: «todas»):
// the mass is what makes the set worth training on, and a case written in passing is as much a case
// as one written under a nudge.
//
// Append-only, one line per memory, never rewritten — same reasoning as the other ledgers: a vote is
// added later by whoever judges, in a separate file, so nothing here is ever edited.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** One memorised fact, with the context that produced it and its (future) verdict. */
export interface MemoryCase {
  /** The memory's own id — the same one the store gave it. */
  id: string;
  at: string;
  agent: string;
  /** The session it was written in, when the plugin knows it. */
  session: string | null;
  /** What was being asked when it was written (≤ 600 characters), when known. */
  prompt: string | null;
  /** The memory itself (already ≤ 600 characters by the store's own rule). */
  memory: string;
  /** Always null here: the USER fills the vote by hand later. */
  vote: null;
}

/**
 * Appends one case. A failure is swallowed — a dataset that could not grow is never a reason to
 * refuse a memory the agent legitimately wrote.
 */
export function appendMemoryCase(file: string, entry: Omit<MemoryCase, "at" | "vote">): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const line: MemoryCase = { ...entry, at: new Date().toISOString(), vote: null };
    appendFileSync(file, `${JSON.stringify(line)}\n`, "utf8");
  } catch {
    /* no path, no permission: the memory still matters more than the sample */
  }
}

/** Where the cases live for a given model folder. */
export function memoryCasePath(modelDir: string): string {
  return `${modelDir.replace(/\/+$/, "")}/cases.jsonl`;
}
