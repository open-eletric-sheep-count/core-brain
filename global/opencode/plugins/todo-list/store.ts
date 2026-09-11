// store.ts — JSON persistence for @oesc/todo-list (spec Q3/Q13).
//
// Fixed path: ~/.local/share/opencode-todo/<sessionID>.json — our own storage
// only; OpenCode's DB and code are never touched. Writes are atomic
// (tmp file + rename in the same directory).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TodoList } from "./types.ts";

const LOG_TAG = "[todo-list]";

export function storeDir(): string {
  return path.join(os.homedir(), ".local", "share", "opencode-todo");
}

/** Path-traversal guard: session ids are opaque but must stay filename-safe. */
function assertSafeSessionID(sessionID: string): void {
  if (typeof sessionID !== "string" || !/^[A-Za-z0-9_-]+$/.test(sessionID)) {
    throw new Error(`unsafe sessionID: ${JSON.stringify(sessionID)}`);
  }
}

export function filePathFor(sessionID: string): string {
  assertSafeSessionID(sessionID);
  return path.join(storeDir(), `${sessionID}.json`);
}

/**
 * Returns the session's list, or null when there is nothing to show: absent
 * file, unreadable/corrupt file, or an empty list. An empty list is treated as
 * "no list" for both the injection and the sidebar panel (spec §5.2/§7).
 */
export function readList(sessionID: string): TodoList | null {
  let filePath: string;
  try {
    filePath = filePathFor(sessionID);
  } catch (e) {
    console.error(`${LOG_TAG} readList:`, e);
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as TodoList;
    if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) {
      return null;
    }
    return parsed;
  } catch {
    return null; // absent, unreadable or corrupt — same semantics as "no list"
  }
}

/** Atomic write: tmp + rename in the same directory (POSIX-atomic). */
export function writeList(sessionID: string, list: TodoList): void {
  const filePath = filePathFor(sessionID);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(list, null, 2)}\n`, "utf-8");
  fs.renameSync(tmpPath, filePath);
}

/** Complete removal (spec op `clear`). Returns true when a file was removed. */
export function clearList(sessionID: string): boolean {
  try {
    const filePath = filePathFor(sessionID);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  } catch (e) {
    console.error(`${LOG_TAG} clearList:`, e);
    return false;
  }
}
