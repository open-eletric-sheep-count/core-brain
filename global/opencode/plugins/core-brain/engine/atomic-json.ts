// engine/atomic-json.ts — one way to replace a JSON file, used by every writer in the store.
//
// Why it exists: writing straight onto the target lets a reader (or a crash) see half a file. The
// replace is done beside the target and renamed into place, which is atomic on the same filesystem.
// One home for the policy: the store and the persistence layer both call this.

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Writes `data` as indented JSON, atomically. Creates the parent directory when missing. */
export function writeJsonFileAtomic(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(temporary, file);
}
