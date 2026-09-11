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
