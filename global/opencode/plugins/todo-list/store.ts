// store.ts — JSON persistence for @oesc/todo-list (spec Q3/Q13, spec-ordering §9.2).
//
// Fixed path: ~/.local/share/opencode-todo/<sessionID>.json — our own storage
// only; OpenCode's DB and code are never touched. Writes are atomic (tmp file +
// rename in the same directory).
//
// §9 "no silent failure": `loadList` reports the REAL state of the store
// (absent | empty | ok | corrupt | unreadable) instead of flattening everything
// to `null`. Nothing is repaired and nothing is rewritten: the caller decides,
// and only the `clear` op may destroy a file that cannot be read.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { LoadResult, TodoList } from "./types.ts";

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

/** Shape check for one stored item — the JSON format itself is unchanged. */
function isStoredItem(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "number" &&
    typeof item.content === "string" &&
    typeof item.status === "string"
  );
}

/**
 * Reads the store WITHOUT interpreting a failure as "there is no list".
 *
 *   ENOENT                         → absent
 *   EACCES / EISDIR / EIO / …      → unreadable (path + "<code> <message>")
 *   JSON.parse failure or a shape
 *   that is not `{ items: [] }`    → corrupt (path + detail)
 *   items.length === 0             → empty
 *   otherwise                      → ok (the parsed list)
 */
export function loadList(sessionID: string): LoadResult {
  let filePath: string;
  try {
    filePath = filePathFor(sessionID);
  } catch (e) {
    return {
      status: "unreadable",
      path: "(session id is not usable as a file name)",
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (e) {
    const err = e as { code?: unknown; message?: unknown };
    const code = typeof err.code === "string" ? err.code : "EUNKNOWN";
    if (code === "ENOENT") return { status: "absent" };
    const message = typeof err.message === "string" ? err.message : String(e);
    return {
      status: "unreadable",
      path: filePath,
      detail: message.startsWith(code) ? message : `${code} ${message}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      status: "corrupt",
      path: filePath,
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { status: "corrupt", path: filePath, detail: "not a JSON object" };
  }
  const list = parsed as Record<string, unknown>;
  if (!Array.isArray(list.items) || !list.items.every(isStoredItem)) {
    return {
      status: "corrupt",
      path: filePath,
      detail: "shape is not { items: TodoItem[] }",
    };
  }
  if (list.items.length === 0) return { status: "empty" };
  return { status: "ok", list: parsed as TodoList };
}

/**
 * Thin wrapper kept for the sidebar panel (`tui.tsx`, out of scope): `null` for
 * absent/empty/corrupt/unreadable, exactly as before. The tool itself uses
 * `loadList` so it can tell those states apart.
 */
export function readList(sessionID: string): TodoList | null {
  const loaded = loadList(sessionID);
  return loaded.status === "ok" ? loaded.list : null;
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
