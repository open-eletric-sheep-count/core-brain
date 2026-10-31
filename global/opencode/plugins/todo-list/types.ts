// types.ts — local structural types for @oesc/todo-list (spec Q10: zero
// runtime dependencies; no imports here, type-only).
//
// Keep this file ERASABLE-ONLY TypeScript (interfaces + type aliases; no TS
// enums, no namespaces, no parameter properties): the V2 loader may execute it
// through native type-stripping, which cannot handle constructs that require
// code generation.

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type TodoPriority = "high" | "medium" | "low";

export interface TodoItem {
  id: number;
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
  /** Nesting level: 0 = top, 1 = child, … (0.2). Numbering is derived. */
  depth?: number;
}

export interface TodoList {
  sessionID: string;
  nextId: number;
  items: TodoItem[];
}

export type TodoOp = "read" | "write" | "add" | "update" | "remove" | "clear";

export interface TodoOpItem {
  id?: number;
  /** `add` only: insert right after this item id (0.2). */
  after?: number;
  content?: string;
  status?: TodoStatus;
  priority?: TodoPriority;
  /** Nesting level: 0 = top, 1 = child, … (0.2). */
  depth?: number;
}

export interface TodoToolInput {
  op: TodoOp;
  items?: TodoOpItem[];
}

/** v0.3.5 ordering law, three rules (spec-ordering.md §1, §2): the item the
 * candidate list cannot accept, with the items still standing in its way. Ids
 * serve the tests; the user-facing message uses the derived `number`s. One
 * record per offender AND reason. `reason` is the RULE/BLOCKER CLASS, not
 * strictly the blocker's own status: `in_progress` ("is/are still in progress.")
 * and `pending` ("is/are not in progress.") are rule A — an item that may not be
 * started; `open_descendant` ("is/are still open.") is rule B — a closed item
 * with an open descendant, where the descendant itself may be `pending` or
 * `in_progress`; `closed_descendant` ("is/are already closed.") is rule C — a
 * `pending` item with a closed descendant, where the descendant is `completed`
 * or `cancelled`. */
export interface OrderingViolation {
  itemId: number;
  number: string;
  blockerIds: number[];
  blockerNumbers: string[];
  reason: "in_progress" | "pending" | "open_descendant" | "closed_descendant";
  /** The offender's own status — it decides the verb: `close` for a closed
   * offender, `start` for a running one (contract v0.3.6 §4). */
  offenderStatus: TodoStatus;
}

/**
 * The real state of the store (spec-ordering §9.2): `readList` used to collapse
 * absent, empty, corrupt and unreadable into `null`, which made a broken file
 * look like "no list yet" — and the next `write` overwrote it.
 */
export type LoadResult =
  | { status: "absent" }
  | { status: "empty" }
  | { status: "ok"; list: TodoList }
  | { status: "corrupt"; path: string; detail: string }
  | { status: "unreadable"; path: string; detail: string };
