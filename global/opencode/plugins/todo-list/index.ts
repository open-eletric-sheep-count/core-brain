// todo-list — OpenCode V2 plugin, server entry (spec: todo-list-spec.md).
//
// Registers the single `todo` tool (incremental ops over one list per session)
// and a prompt hook that prepends at most ONE line per round when this
// session's list is non-empty (spec Q6/Q15).
//
// Module shape (deliberate, same rationale as context-inject): the
// default export is a PLAIN OBJECT { id, setup } and NO runtime package is
// imported — the V2 loader validates only the module shape, and a runtime
// import could resolve up to a stale V1 package (a V1 `@opencode-ai/plugin`
// lives in ~/.config/opencode/node_modules) and fail every load. The ctx
// surface used is declared structurally below.
// Source: https://opencode.ai/v2/docs/build/plugins — tools transform
// (`ctx.tool.transform`) and the session "prompt" hook (`ctx.session.hook`).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { clearList, readList, writeList } from "./store.ts";
import {
  clampDepthAt,
  deriveNumbers,
  displayContent,
  stripEnumeration,
} from "./format.ts";
import type {
  TodoItem,
  TodoList,
  TodoOp,
  TodoOpItem,
  TodoPriority,
  TodoStatus,
  TodoToolInput,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Structural slice of the V2 plugin context (see module-shape note above).
// ---------------------------------------------------------------------------

interface Registration {
  dispose(): void | Promise<void>;
}

interface ToolProgressLike {
  progress?(input: { status?: string }): Promise<void> | void;
}

interface ToolInfoLike {
  name: string;
  description: string;
  input: Record<string, unknown>;
  execute(input: unknown, tool?: unknown): Promise<{ content: string }>;
}

interface ToolEditorLike {
  add(tool: ToolInfoLike): void;
}

interface PromptHookEvent {
  readonly sessionID: string;
  prompt: { text?: unknown };
}

interface TodoPluginContext {
  tool: {
    transform(
      callback: (editor: ToolEditorLike) => void,
    ): Promise<Registration>;
  };
  session: {
    hook(
      name: "prompt",
      callback: (event: PromptHookEvent) => void | Promise<void>,
    ): Promise<Registration>;
  };
}

// ---------------------------------------------------------------------------
// Shared vocabulary (spec §6).
// ---------------------------------------------------------------------------

const LOG_TAG = "[todo-list]";

const OPS: readonly TodoOp[] = [
  "read",
  "write",
  "add",
  "update",
  "remove",
  "clear",
];
const STATUSES: readonly TodoStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
];
const PRIORITIES: readonly TodoPriority[] = ["high", "medium", "low"];

const GLYPH: Record<TodoStatus, string> = {
  pending: "[ ]",
  in_progress: "[~]",
  completed: "[x]",
  cancelled: "[!]",
};

// ---------------------------------------------------------------------------
// Session resolution.
//
// EMPIRICAL (spec §12 open item #1): the docs show `execute(input, tool)` with
// `tool.progress(...)`, but the full shape of the second argument is not
// documented. Resolve the session id defensively (direct field, then common
// nested carriers, then the last session seen by the prompt hook — which fires
// before tool execution within the same round) and record the observed keys
// ONCE into the debug log so the first live test confirms the real shape.
// ---------------------------------------------------------------------------

let activeSessionID: string | null = null;
let probedToolArg = false;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function resolveSessionID(toolArg: unknown): string | null {
  const top = asRecord(toolArg);
  if (top) {
    for (const key of ["sessionID", "sessionId"]) {
      const direct = top[key];
      if (typeof direct === "string" && direct) return direct;
    }
    for (const carrier of [
      "context",
      "ctx",
      "data",
      "call",
      "toolCall",
      "info",
      "session",
    ]) {
      const nested = asRecord(top[carrier]);
      if (!nested) continue;
      for (const key of ["sessionID", "sessionId"]) {
        const value = nested[key];
        if (typeof value === "string" && value) return value;
      }
    }
  }
  return activeSessionID;
}

function probeToolArgOnce(toolArg: unknown, sessionID: string | null): void {
  if (probedToolArg) return;
  probedToolArg = true;
  try {
    const top = asRecord(toolArg);
    const keys = top ? Object.keys(top).join(",") : String(toolArg);
    const dir = path.join(os.homedir(), ".local", "share", "opencode-todo");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, "debug.log"),
      `[${new Date().toISOString()}] execute second-arg keys: [${keys}]; ` +
        `resolved sessionID: ${sessionID}\n`,
    );
  } catch {
    // Diagnostics must never break the tool.
  }
}

// ---------------------------------------------------------------------------
// Formatting and validation helpers.
// ---------------------------------------------------------------------------

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function withIssues(base: string, issues: string[]): string {
  if (issues.length === 0) return base;
  return `${base}\nissues: ${issues.join("; ")}`;
}

function formatList(list: TodoList): string {
  const count = (status: TodoStatus) =>
    list.items.filter((item) => item.status === status).length;
  const bits: string[] = [];
  for (const status of STATUSES) {
    const n = count(status);
    if (n > 0) bits.push(`${n} ${status}`);
  }
  const total = list.items.length;
  const lines = [
    `TODO: ${total} item${total === 1 ? "" : "s"} (${bits.join(", ")})`,
  ];
  const numbers = deriveNumbers(list.items);
  list.items.forEach((item, index) => {
    const priority = item.priority !== "medium" ? ` [${item.priority}]` : "";
    lines.push(
      `${item.id}: ${GLYPH[item.status]} ${numbers[index]}) ${displayContent(item)}${priority}`,
    );
  });
  return lines.join("\n");
}

/**
 * Builds a fresh item array from raw input, assigning stable ids that are
 * never reused within the file's lifetime. `base` continues the id sequence
 * (used by write/add); pass null to start at id 1.
 */
function buildItems(
  rawItems: TodoOpItem[],
  base: TodoList | null,
): {
  items: TodoItem[];
  afters: Array<number | undefined>;
  nextId: number;
  issues: string[];
} {
  const used = new Set<number>();
  let nextId = 1;
  if (base) {
    for (const item of base.items) used.add(item.id);
    for (const id of used) if (id >= nextId) nextId = id + 1;
    if (typeof base.nextId === "number" && base.nextId > nextId) {
      nextId = base.nextId;
    }
  }
  const items: TodoItem[] = [];
  const afters: Array<number | undefined> = [];
  const issues: string[] = [];
  for (const raw of rawItems) {
    let content = typeof raw?.content === "string" ? raw.content.trim() : "";
    if (!content) {
      issues.push("skipped an item with no content");
      continue;
    }
    let id: number;
    if (isPositiveInt(raw.id) && !used.has(raw.id)) {
      id = raw.id;
    } else {
      while (used.has(nextId)) nextId++;
      id = nextId++;
    }
    used.add(id);
    for (const taken of used) if (taken >= nextId) nextId = taken + 1;

    let status: TodoStatus = "pending";
    if (raw.status !== undefined) {
      if (STATUSES.includes(raw.status)) {
        status = raw.status;
      } else {
        issues.push(
          `id ${id}: unknown status ${JSON.stringify(raw.status)} — used "pending"`,
        );
      }
    }
    let priority: TodoPriority = "medium";
    if (raw.priority !== undefined) {
      if (PRIORITIES.includes(raw.priority)) {
        priority = raw.priority;
      } else {
        issues.push(
          `id ${id}: unknown priority ${JSON.stringify(raw.priority)} — used "medium"`,
        );
      }
    }
    // 0.2: depth is explicit when valid; otherwise inferred from a legacy
    // "1.1)" prefix in the text; otherwise 0. The text prefix is stripped.
    const stripped = stripEnumeration(content);
    const rawDepth = raw.depth;
    let depth: number;
    if (rawDepth !== undefined) {
      if (
        typeof rawDepth === "number" &&
        Number.isInteger(rawDepth) &&
        rawDepth >= 0
      ) {
        depth = rawDepth;
      } else {
        issues.push(
          `id ${id}: invalid depth ${JSON.stringify(rawDepth)} — used ${stripped.depth ?? 0}`,
        );
        depth = stripped.depth ?? 0;
      }
    } else {
      depth = stripped.depth ?? 0;
    }
    content = stripped.text || content;
    items.push({ id, content, status, priority, depth });
    afters.push(isPositiveInt(raw.after) ? raw.after : undefined);
  }
  return { items, afters, nextId, issues };
}

// ---------------------------------------------------------------------------
// Operations (spec §6).
// ---------------------------------------------------------------------------

function opRead(sessionID: string): string {
  const list = readList(sessionID);
  if (!list) return "TODO: no list for this session yet.";
  return formatList(list);
}

function opWrite(sessionID: string, rawItems: TodoOpItem[] | undefined): string {
  const base = readList(sessionID);
  const { items, nextId, issues } = buildItems(rawItems ?? [], base);
  if (items.length === 0) {
    clearList(sessionID);
    return withIssues("TODO list cleared.", issues);
  }
  items.forEach((_, index) => clampDepthAt(items, index, issues));
  const list: TodoList = { sessionID, nextId, items };
  writeList(sessionID, list);
  return withIssues(`TODO list replaced.\n${formatList(list)}`, issues);
}

function opAdd(sessionID: string, rawItems: TodoOpItem[] | undefined): string {
  const base = readList(sessionID);
  const previous: TodoList = base ?? { sessionID, nextId: 1, items: [] };
  const { items, afters, nextId, issues } = buildItems(rawItems ?? [], previous);
  if (items.length === 0) {
    return withIssues("TODO: nothing valid to add (no items given).", issues);
  }
  // 0.2: `after: <id>` inserts right after that item (default: append at the
  // end); each insert's depth is clamped against its position.
  const merged = [...previous.items];
  items.forEach((item, i) => {
    const after = afters[i];
    let index = merged.length;
    if (after !== undefined) {
      const anchor = merged.findIndex((candidate) => candidate.id === after);
      if (anchor >= 0) {
        index = anchor + 1;
      } else {
        issues.push(
          `id ${item.id}: after ${after} not found — appended at the end`,
        );
      }
    }
    merged.splice(index, 0, item);
    clampDepthAt(merged, index, issues);
  });
  const list: TodoList = { sessionID, nextId, items: merged };
  writeList(sessionID, list);
  const added = items.map((item) => item.id).join(", ");
  return withIssues(
    `TODO updated (added: ${added}).\n${formatList(list)}`,
    issues,
  );
}

function opUpdate(
  sessionID: string,
  rawItems: TodoOpItem[] | undefined,
): string {
  const base = readList(sessionID);
  if (!base) return "TODO: no list for this session yet — nothing to update.";
  const issues: string[] = [];
  let changes = 0;
  for (const raw of rawItems ?? []) {
    if (!isPositiveInt(raw?.id)) {
      issues.push("update skipped: missing integer id");
      continue;
    }
    const item = base.items.find((candidate) => candidate.id === raw.id);
    if (!item) {
      issues.push(`id ${raw.id}: not in the list`);
      continue;
    }
    if (raw.content !== undefined) {
      const trimmed = typeof raw.content === "string" ? raw.content.trim() : "";
      const stripped = stripEnumeration(trimmed);
      const content = stripped.text || trimmed;
      if (content) {
        item.content = content;
        changes++;
      } else {
        issues.push(`id ${raw.id}: empty content ignored`);
      }
    }
    if (raw.status !== undefined) {
      if (STATUSES.includes(raw.status)) {
        item.status = raw.status;
        changes++;
      } else {
        issues.push(`id ${raw.id}: unknown status ${JSON.stringify(raw.status)}`);
      }
    }
    if (raw.priority !== undefined) {
      if (PRIORITIES.includes(raw.priority)) {
        item.priority = raw.priority;
        changes++;
      } else {
        issues.push(
          `id ${raw.id}: unknown priority ${JSON.stringify(raw.priority)}`,
        );
      }
    }
    if (raw.depth !== undefined) {
      const rd = raw.depth;
      if (typeof rd === "number" && Number.isInteger(rd) && rd >= 0) {
        item.depth = rd;
        changes++;
      } else {
        issues.push(`id ${raw.id}: invalid depth ${JSON.stringify(rd)}`);
      }
    }
    clampDepthAt(base.items, base.items.indexOf(item), issues);
  }
  writeList(sessionID, base);
  return withIssues(
    `TODO updated (${changes} change${changes === 1 ? "" : "s"}).\n${formatList(base)}`,
    issues,
  );
}

function opRemove(
  sessionID: string,
  rawItems: TodoOpItem[] | undefined,
): string {
  const base = readList(sessionID);
  if (!base) return "TODO: no list for this session yet — nothing to remove.";
  const issues: string[] = [];
  const ids = new Set<number>();
  for (const raw of rawItems ?? []) {
    if (isPositiveInt(raw?.id)) {
      ids.add(raw.id);
    } else {
      issues.push("remove skipped: missing integer id");
    }
  }
  const keep: TodoItem[] = [];
  for (const item of base.items) {
    if (ids.has(item.id)) {
      ids.delete(item.id);
      continue;
    }
    keep.push(item);
  }
  for (const leftover of ids) issues.push(`id ${leftover}: not in the list`);
  if (keep.length === 0) {
    clearList(sessionID);
    return withIssues("TODO list is now empty — removed.", issues);
  }
  const list: TodoList = { sessionID, nextId: base.nextId, items: keep };
  writeList(sessionID, list);
  return withIssues(`TODO updated (items removed).\n${formatList(list)}`, issues);
}

function opClear(sessionID: string): string {
  const removed = clearList(sessionID);
  return removed
    ? "TODO list cleared (file removed)."
    : "TODO: no list for this session — nothing to clear.";
}

// ---------------------------------------------------------------------------
// Tool execution.
// ---------------------------------------------------------------------------

async function execute(
  input: unknown,
  toolArg?: unknown,
): Promise<{ content: string }> {
  const sessionID = resolveSessionID(toolArg);
  probeToolArgOnce(toolArg, sessionID);
  if (!sessionID) {
    return {
      content:
        "ERROR: todo-list could not determine this session's id; nothing was " +
        "read or written. (See ~/.local/share/opencode-todo/debug.log)",
    };
  }
  const parsed = (input ?? {}) as Partial<TodoToolInput>;
  const op = parsed.op;
  if (typeof op !== "string" || !OPS.includes(op as TodoOp)) {
    return {
      content: `ERROR: unknown op ${JSON.stringify(parsed.op)}; expected one of: ${OPS.join(", ")}.`,
    };
  }
  const progress = (toolArg as ToolProgressLike | undefined)?.progress;
  if (typeof progress === "function") {
    try {
      await progress.call(toolArg, { status: `todo ${op}` });
    } catch {
      // progress reporting is advisory — never fail the tool over it
    }
  }
  try {
    switch (op as TodoOp) {
      case "read":
        return { content: opRead(sessionID) };
      case "write":
        return { content: opWrite(sessionID, parsed.items) };
      case "add":
        return { content: opAdd(sessionID, parsed.items) };
      case "update":
        return { content: opUpdate(sessionID, parsed.items) };
      case "remove":
        return { content: opRemove(sessionID, parsed.items) };
      case "clear":
        return { content: opClear(sessionID) };
    }
    return { content: `ERROR: unreachable op ${op}.` };
  } catch (e) {
    console.error(`${LOG_TAG} execute failed:`, e);
    return {
      content: `ERROR: todo ${op} failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Plugin definition.
// ---------------------------------------------------------------------------

export default {
  id: "todo-list",
  async setup(ctx: TodoPluginContext) {
    const toolRegistration = await ctx.tool.transform((editor) => {
      editor.add({
        name: "todo",
        description:
          "Maintain this session's todo list (the sidebar panel shows it " +
          "live to the user). Write item texts in plain, user-friendly " +
          "language — the user reads the panel (no internal jargon). " +
          "Ops: read — return the current list; write — " +
          "replace the whole list with `items` (an empty array clears it); " +
          "add — append or insert items (`after: <id>` inserts right after " +
          "an item; stable integer ids are assigned and reported); update — " +
          "change content/status/priority/depth of items addressed by `id`; " +
          "remove — delete items by `id`; clear — delete the entire list. " +
          "Structure: before adding an item, check the existing list for a " +
          "fitting parent — sub-steps should be nested (add with `after: " +
          "<parent id>` and `depth: <parent depth + 1>`), not added as new " +
          "roots. Set `depth` (0 = top level, 1 = child, …); do NOT " +
          "write numbers like `1)` in content — the hierarchical numbering " +
          "(1, 1.1, 1.1.1…) is generated automatically and renumbers itself " +
          "on insert/remove; a level jump is clamped and reported. Statuses: " +
          "pending | in_progress | completed | cancelled. Priorities: " +
          "high | medium | low. Ids are stable integers, never reused — " +
          "always reuse the ids reported by previous calls.",
        input: {
          type: "object",
          properties: {
            op: { type: "string", enum: [...OPS] },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: {
                    type: "integer",
                    description:
                      "Existing item id (required for update/remove).",
                  },
                  after: {
                    type: "integer",
                    description:
                      "add only: insert right after this item id " +
                      "(default: append at the end).",
                  },
                  content: {
                    type: "string",
                    description:
                      "Item text. Do NOT prefix numbers like '1)' — the " +
                      "numbering is generated (a legacy prefix is stripped).",
                  },
                  status: { type: "string", enum: [...STATUSES] },
                  priority: { type: "string", enum: [...PRIORITIES] },
                  depth: {
                    type: "integer",
                    description:
                      "Nesting level: 0 = top, 1 = child, … (never jump " +
                      "more than one level below the previous item).",
                  },
                },
              },
            },
          },
          required: ["op"],
        },
        execute,
      });
    });

    // One line per round, only when the list is non-empty (spec Q6/Q15). The
    // static API how-to lives in context-inject, not here.
    const hookRegistration = await ctx.session.hook("prompt", async (event) => {
      const sessionID = event?.sessionID;
      if (typeof sessionID !== "string" || !sessionID) return;
      // Remember for tool calls whose second argument does not carry the id.
      activeSessionID = sessionID;
      try {
        const list = readList(sessionID);
        if (!list) return; // absent or empty — inject nothing
        const inProgress = list.items.filter(
          (item) => item.status === "in_progress",
        ).length;
        const suffix = inProgress > 0 ? `, ${inProgress} in progress` : "";
        const total = list.items.length;
        const line =
          `TODO: ${total} item${total === 1 ? "" : "s"}${suffix} — ` +
          `update it if something changed.`;
        const base = typeof event.prompt?.text === "string" ? event.prompt.text : "";
        const separator = base.trim() ? "\n\n" : "";
        event.prompt.text = `${line}${separator}${base}`;
      } catch (e) {
        // The hook must never break prompt admission.
        console.error(`${LOG_TAG} prompt hook failed:`, e);
      }
    });

    return () => {
      void Promise.resolve(toolRegistration?.dispose?.()).catch(() => {});
      void Promise.resolve(hookRegistration?.dispose?.()).catch(() => {});
    };
  },
};
