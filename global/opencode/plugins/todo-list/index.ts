// todo-list — OpenCode V2 plugin, server entry (spec: todo-list-spec.md).
//
// Registers the single `todo` tool (incremental ops over one list per session)
// and a context hook that adds at most ONE reminder line to the system block
// while this session's list is non-empty (spec Q6/Q15).
//
// 0.2.2: the reminder is delivered through `ctx.session.hook("context")` and
// `event.system` — NEVER by editing `event.prompt.text`. The prompt hook's text
// edits "become the canonical persisted user input" (host docs, quoted in
// context-inject), so prepending the line there glued it to the USER's own
// message and the transcript read as if the USER had typed
// "TODO: 12 items — update it if something changed." (measured in the live
// sessions of 2026-09-23). The system block is rebuilt by the host for every
// model request, so the reminder can never accumulate in the history.
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
import { clearList, filePathFor, loadList, writeList } from "./store.ts";
import { isChange } from "./changed.ts";
import { registerTodoRpc } from "./rpc.ts";
import {
  clampDepthAt,
  deriveNumbers,
  displayContent,
  stripEnumeration,
} from "./format.ts";
import {
  findOrderingViolations,
  formatOrderingRejection,
  isClosedStatus,
} from "./order.ts";
import type {
  LoadResult,
  OrderingViolation,
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

interface ContextHookEvent {
  readonly sessionID: string;
  system: Array<{ type: "text"; text: string }>;
}

interface TodoPluginContext {
  tool: {
    transform(
      callback: (editor: ToolEditorLike) => void,
    ): Promise<Registration>;
  };
  session: {
    hook(
      name: "context",
      callback: (event: ContextHookEvent) => void | Promise<void>,
    ): Promise<Registration>;
  };
  /** Optional: runtimes without plugin RPC omit it, and nothing is announced. */
  rpc?: {
    register?(
      definition: unknown,
      handlers: unknown,
    ): Promise<Registration & { events?: { emit?: (name: string, data: unknown) => Promise<unknown> } }>;
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

/** A stored/keyed text still carrying a legacy "1.1)" enumeration (§9 F3/F4). */
const LEGACY_PREFIX = /^\s*(\d+(?:\.\d+)*)\)/;

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

/**
 * v0.3 ordering rule (spec-ordering.md §2/§3): the CANDIDATE list is validated
 * whole — `add`/`remove` renumber and re-parent later items, so a per-item
 * check would miss the state that is about to be stored. `starts` carries the
 * ids this op actually STARTS (§4.1), so a rejection blames the item the caller
 * asked to start instead of the one already running. `closes` carries the ids
 * this op actually CLOSES — a declaration, not a selector (D11): rule B's
 * offender is always the closed member, so the set never changes a line.
 * `reverts` carries the ids this op actually sets back to `pending` — the same
 * kind of declaration for rule C (D14): its offender is always the pending item.
 * Returns the exact §4 rejection text, or null when the candidate is legal. A
 * rejection writes nothing: the stored list (and its `nextId`) stays
 * byte-identical.
 */
function orderRejection(
  items: TodoItem[],
  starts: ReadonlySet<number>,
  closes: ReadonlySet<number>,
  reverts: ReadonlySet<number>,
): string | null {
  const violations = findOrderingViolations(items, starts, closes, reverts);
  return violations.length === 0 ? null : formatOrderingRejection(violations);
}

// ---------------------------------------------------------------------------
// No silent failure (spec-ordering §9).
//
// A store that cannot be read must never look like "no list yet": the old
// `readList` collapsed absent/empty/corrupt/unreadable into `null`, so a broken
// file was reported as an empty session and the next `write` overwrote it.
// ---------------------------------------------------------------------------

/** A store state that CANNOT be trusted (and that no mutating op may touch). */
type BadLoad = Extract<
  LoadResult,
  { status: "corrupt" } | { status: "unreadable" }
>;

/** True when the loaded state refuses to be read (narrows the union). */
function isBadLoad(loaded: LoadResult): loaded is BadLoad {
  return loaded.status === "corrupt" || loaded.status === "unreadable";
}

/** The exact §9.2 refusal for a store we cannot trust. */
function storeRefusal(loaded: BadLoad, mode: "read" | "mutate"): string {
  const verb = mode === "read" ? "Nothing was read." : "Nothing was changed.";
  if (loaded.status === "corrupt") {
    return (
      `ERROR: the stored list for this session is corrupt (${loaded.path}): ` +
      `${loaded.detail}. ${verb} Run op "clear" to discard it (its data ` +
      `cannot be recovered), or repair the file by hand.`
    );
  }
  return (
    `ERROR: the stored list for this session could not be read ` +
    `(${loaded.path}): ${loaded.detail}. ${verb} Fix the permissions, or ` +
    `run op "clear" to discard it.`
  );
}

/** What `clear` actually did — every outcome says the truth (§9.2). */
function clearOutcome(sessionID: string): string {
  const loaded = loadList(sessionID);
  if (loaded.status === "absent") {
    return "TODO: no list for this session — nothing to clear.";
  }
  const removed = clearList(sessionID);
  if (!removed) return "TODO: no list for this session — nothing to clear.";
  if (loaded.status === "corrupt") {
    return "TODO: removed the corrupt list file for this session (it could not be parsed).";
  }
  if (loaded.status === "empty") {
    return "TODO: the list for this session was already empty (file removed).";
  }
  return "TODO list cleared (file removed).";
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
  /** Ids already assigned to an item OF THIS REQUEST (§9.1 F5). */
  const fromRequest = new Set<number>();
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
      // §9.1 F5: an id substitution is never silent.
      if (raw.id !== undefined) {
        if (!isPositiveInt(raw.id)) {
          issues.push(
            `id ${JSON.stringify(raw.id)} is not a positive integer — assigned id ${id} instead`,
          );
        } else if (fromRequest.has(raw.id)) {
          issues.push(
            `id ${raw.id} was already used by an item in this request — assigned id ${id} instead`,
          );
        }
      }
    }
    used.add(id);
    fromRequest.add(id);
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
    // §9.1 F3: stripping is reported, never silent.
    const prefixMatch = LEGACY_PREFIX.exec(content);
    const prefixText = prefixMatch ? `${prefixMatch[1]})` : null;
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
    if (prefixText && stripped.text && stripped.text !== content) {
      issues.push(
        `id ${id}: removed the "${prefixText}" prefix from the text — numbering is generated`,
      );
    }
    content = stripped.text || content;
    items.push({ id, content, status, priority, depth });
    // §9.1 F6: a non-integer `after` falls back to "append at the end" — and
    // says so instead of silently relocating the item.
    if (raw.after !== undefined && !isPositiveInt(raw.after)) {
      issues.push(
        `id ${id}: "after" must be a positive integer (got ${JSON.stringify(raw.after)}) — appended at the end`,
      );
    }
    afters.push(isPositiveInt(raw.after) ? raw.after : undefined);
  }
  return { items, afters, nextId, issues };
}

// ---------------------------------------------------------------------------
// Operations (spec §6).
// ---------------------------------------------------------------------------

function opRead(sessionID: string): string {
  // §9.1 F1/F2: report the REAL state — absent, empty, corrupt and unreadable
  // are four different answers, never collapsed into "no list".
  const loaded = loadList(sessionID);
  if (isBadLoad(loaded)) return storeRefusal(loaded, "read");
  if (loaded.status === "absent") return "TODO: no list for this session yet.";
  if (loaded.status === "empty") {
    return "TODO: the list for this session is empty (the file exists and holds no items).";
  }
  const list = loaded.list;
  const notes: string[] = [];
  // §9.1 F10 / §8 D8: a stored list that violates the ordering law is
  // announced — the FIRST offending pair (lowest offender index; for one
  // offender the in-progress clause first, then pending, then the new
  // open-descendant clause) in the §4 reason sentences, then the law restated.
  const violations = findOrderingViolations(list.items);
  if (violations.length > 0) {
    const first = violations[0];
    if (first.reason === "open_descendant") {
      notes.push(
        `list is in an invalid state — ${first.number} is closed while ` +
          `${first.blockerNumbers[0]} is still open; mutating ops will refuse ` +
          `until every descendant of a closed item is closed too.`,
      );
    } else if (first.reason === "closed_descendant") {
      notes.push(
        `list is in an invalid state — ${first.number} is pending while ` +
          `${first.blockerNumbers[0]} is already closed; mutating ops will ` +
          `refuse until every descendant of a pending item is pending too.`,
      );
    } else {
      // Rule D (v0.3.6) owns both directions of the same pair: the earlier
      // blocker's state decides the sentence, the offender's own status only
      // decides whether the gesture was a start or a close.
      const blockerState =
        first.reason === "in_progress"
          ? "is still in progress"
          : "is not in progress";
      const offenderState = isClosedStatus(first.offenderStatus)
        ? "is closed"
        : "is in progress";
      notes.push(
        `list is in an invalid state — ${first.number} ${offenderState} while ` +
          `${first.blockerNumbers[0]} ${blockerState}; mutating ops will refuse ` +
          `until every item before a started item is closed or is one of its ` +
          `in-progress ancestors.`,
      );
    }
  }
  // §9.1 F4: stored text that still carries a legacy prefix is not what the
  // dump shows — say it once instead of pretending the two agree.
  const legacy = list.items.filter((item) => LEGACY_PREFIX.test(item.content))
    .length;
  if (legacy > 0) {
    notes.push(
      `${legacy} items store a legacy numbered prefix; the display omits it — ` +
        `rewrite those texts without the prefix to clear this note.`,
    );
  }
  return notes.reduce(
    (text, note) => `${text}\nissues: ${note}`,
    formatList(list),
  );
}

function opWrite(sessionID: string, rawItems: TodoOpItem[] | undefined): string {
  // §9.1 F1: a store we cannot trust is refused BEFORE any computation.
  const loaded = loadList(sessionID);
  if (isBadLoad(loaded)) return storeRefusal(loaded, "mutate");
  const raw = rawItems ?? [];
  // §9.1 F7/F8: only an EXPLICIT empty request clears. A request whose every
  // item was rejected must never destroy the existing list — and with no file
  // behind it, `write []` must not claim it cleared one.
  if (raw.length === 0) {
    if (loaded.status === "absent") {
      return "TODO: no list for this session — nothing to clear.";
    }
    // §9.2: the empty-store sentence says "(file removed)" — so the file must
    // actually go, exactly as the `clear` op does. Returning first left the
    // empty file on disk and the next `read` contradicted the answer.
    clearList(sessionID);
    if (loaded.status === "empty") {
      return "TODO: the list for this session was already empty (file removed).";
    }
    return "TODO list cleared.";
  }
  const base = loaded.status === "ok" ? loaded.list : null;
  const { items, nextId, issues } = buildItems(raw, base);
  if (items.length === 0) {
    return (
      withIssues(
        "ERROR: nothing valid to write: every item in the request was rejected.",
        issues,
      ) + "\nNothing was changed."
    );
  }
  items.forEach((_, index) => clampDepthAt(items, index, issues));
  // §4.1: `write` replaces the list — no item has a prior state, so EVERY
  // in-progress item of the candidate is a start, and there is nothing to
  // close (the close set is deliberately empty for `write`).
  const rejection = orderRejection(
    items,
    new Set(
      items.filter((item) => item.status === "in_progress").map((item) => item.id),
    ),
    new Set(),
    new Set(),
  );
  if (rejection !== null) return rejection;
  const list: TodoList = { sessionID, nextId, items };
  writeList(sessionID, list);
  return withIssues(`TODO list replaced.\n${formatList(list)}`, issues);
}

function opAdd(sessionID: string, rawItems: TodoOpItem[] | undefined): string {
  const loaded = loadList(sessionID);
  if (isBadLoad(loaded)) return storeRefusal(loaded, "mutate");
  const base = loaded.status === "ok" ? loaded.list : null;
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
  // §4.1: only the items created by THIS call can be starts — and only those
  // that arrive already closed can be closes, or already `pending` a revert.
  // All three sets are declarations (§2.1, D11/D14), never selectors.
  const rejection = orderRejection(
    merged,
    new Set(
      items.filter((item) => item.status === "in_progress").map((item) => item.id),
    ),
    new Set(
      items.filter((item) => isClosedStatus(item.status)).map((item) => item.id),
    ),
    new Set(
      items.filter((item) => item.status === "pending").map((item) => item.id),
    ),
  );
  if (rejection !== null) return rejection;
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
  const loaded = loadList(sessionID);
  if (isBadLoad(loaded)) return storeRefusal(loaded, "mutate");
  if (loaded.status === "absent") {
    return "TODO: no list for this session yet — nothing to update.";
  }
  if (loaded.status === "empty") {
    return "TODO: the list for this session is empty — nothing to update.";
  }
  const base = loaded.list;
  // §4.1: snapshot the statuses BEFORE any mutation — a start is a TRANSITION
  // to in_progress; re-sending in_progress for a running item is NOT a start.
  const before = new Map(
    base.items.map((item) => [item.id, item.status] as const),
  );
  const issues: string[] = [];
  /** Changes this call would apply, itemised for the §9.1 F9 refusal line. */
  const applied: Array<{ id: number; field: string }> = [];
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
      // §9.1 F3: a stripped legacy prefix is reported on update too.
      const prefixMatch = LEGACY_PREFIX.exec(trimmed);
      const prefixText = prefixMatch ? `${prefixMatch[1]})` : null;
      const stripped = stripEnumeration(trimmed);
      const content = stripped.text || trimmed;
      if (content) {
        if (prefixText && stripped.text && stripped.text !== trimmed) {
          issues.push(
            `id ${raw.id}: removed the "${prefixText}" prefix from the text — numbering is generated`,
          );
        }
        if (item.content !== content) {
          applied.push({ id: raw.id, field: "content" });
        }
        item.content = content;
        changes++;
      } else {
        issues.push(`id ${raw.id}: empty content ignored`);
      }
    }
    if (raw.status !== undefined) {
      if (STATUSES.includes(raw.status)) {
        if (item.status !== raw.status) {
          applied.push({ id: raw.id, field: "status" });
        }
        item.status = raw.status;
        changes++;
      } else {
        issues.push(`id ${raw.id}: unknown status ${JSON.stringify(raw.status)}`);
      }
    }
    if (raw.priority !== undefined) {
      if (PRIORITIES.includes(raw.priority)) {
        if (item.priority !== raw.priority) {
          applied.push({ id: raw.id, field: "priority" });
        }
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
        if (item.depth !== rd) {
          applied.push({ id: raw.id, field: "depth" });
        }
        item.depth = rd;
        changes++;
      } else {
        issues.push(`id ${raw.id}: invalid depth ${JSON.stringify(rd)}`);
      }
    }
    clampDepthAt(base.items, base.items.indexOf(item), issues);
  }
  // §4.1: ids whose requested status transitions to in_progress in this call
  // are starts — one `before` snapshot serves both sets.
  const starts = new Set<number>();
  for (const raw of rawItems ?? []) {
    if (
      raw?.status === "in_progress" &&
      isPositiveInt(raw.id) &&
      before.get(raw.id) !== "in_progress"
    ) {
      starts.add(raw.id);
    }
  }
  // §4.1: the sibling set — ids whose status transitions to a CLOSED state in
  // this call (the same `before` snapshot serves both sets). Re-sending
  // `completed` for an already completed item is not a close, and neither is
  // switching `completed` → `cancelled`.
  const closes = new Set<number>();
  for (const raw of rawItems ?? []) {
    if (!raw || !isPositiveInt(raw.id)) continue; // unknown ids are refused
    const prior = before.get(raw.id); // undefined ⇒ the id is not in the list
    if (
      prior !== undefined &&
      raw.status !== undefined &&
      STATUSES.includes(raw.status) &&
      isClosedStatus(raw.status) &&
      !isClosedStatus(prior)
    ) {
      closes.add(raw.id);
    }
  }
  // §4.1: ids whose requested status transitions back to `pending` are reverts
  // (rule C) — read from the same `before` snapshot. Re-sending `pending` for
  // an item already pending is not a revert.
  const reverts = new Set<number>();
  for (const raw of rawItems ?? []) {
    if (!raw || !isPositiveInt(raw.id)) continue;
    const prior = before.get(raw.id);
    if (
      prior !== undefined &&
      prior !== "pending" &&
      raw.status === "pending"
    ) {
      reverts.add(raw.id);
    }
  }
  // v0.3: one candidate list (all requested changes applied + clamped, never
  // per item) is validated before anything is persisted. §9.1 F9: a refusal
  // itemises the non-offending changes that were discarded with it.
  const violations = findOrderingViolations(
    base.items,
    starts,
    closes,
    reverts,
  );
  if (violations.length > 0) {
    // §9.1 F9: only NON-offending changes are "discarded". Besides the
    // offenders, a blocker is involved when THIS call changed its `status` or
    // `depth` — that is the change that made it a blocker (T48: `1.1` closed
    // under a pending `1`; T50: the depth move itself). A content/priority edit
    // on a blocker stays an unrelated discarded change.
    const causal = new Set(
      applied
        .filter((change) => change.field === "status" || change.field === "depth")
        .map((change) => change.id),
    );
    const involved = new Set<number>();
    for (const violation of violations) {
      involved.add(violation.itemId);
      for (const blockerId of violation.blockerIds) {
        if (causal.has(blockerId)) involved.add(blockerId);
      }
    }
    const discarded = applied.filter((change) => !involved.has(change.id));
    const lines = formatOrderingRejection(violations).split("\n");
    const trailer = lines.pop() ?? "Nothing was changed.";
    if (discarded.length > 0) {
      const plural = discarded.length === 1 ? "" : "s";
      lines.push(
        `refused whole: ${discarded.length} other requested change${plural} ` +
          `${discarded.length === 1 ? "was" : "were"} not applied (` +
          `${discarded.map((change) => `id ${change.id} ${change.field}`).join(", ")}).`,
      );
    }
    lines.push(trailer);
    return lines.join("\n");
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
  const loaded = loadList(sessionID);
  if (isBadLoad(loaded)) return storeRefusal(loaded, "mutate");
  if (loaded.status === "absent") {
    return "TODO: no list for this session yet — nothing to remove.";
  }
  if (loaded.status === "empty") {
    return "TODO: the list for this session is empty — nothing to remove.";
  }
  const base = loaded.list;
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
  // §4.1: fail-closed (D12) — a removal that leaves the list illegal is
  // rejected too; removals that FIX a violation are accepted. A removal never
  // starts, closes nor reverts anything, so all three sets are empty (fallback
  // attribution applies) — it can still CAUSE the close-rule violation by
  // re-parenting an open item under a closed one (§4, N9), or the pending-rule
  // violation by re-parenting a closed item under a pending one (§4, T45).
  const rejection = orderRejection(
    keep,
    new Set<number>(),
    new Set<number>(),
    new Set<number>(),
  );
  if (rejection !== null) return rejection;
  const list: TodoList = { sessionID, nextId: base.nextId, items: keep };
  writeList(sessionID, list);
  return withIssues(`TODO updated (items removed).\n${formatList(list)}`, issues);
}

function opClear(sessionID: string): string {
  // §9.1 F1: `clear` is the ONLY op allowed to destroy a store that cannot be
  // read — and it says which of the four outcomes actually happened.
  return clearOutcome(sessionID);
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
    // §9.1 F12: a thrown exception says whether anything was persisted and why
    // it is safe to assume it was not (writes are atomic tmp + rename).
    const message = e instanceof Error ? e.message : String(e);
    let leftover = "a leftover .tmp file can be deleted safely";
    try {
      leftover = `a leftover "${filePathFor(sessionID)}.tmp" can be deleted safely`;
    } catch {
      // the path itself is unusable — keep the generic note
    }
    return {
      content:
        `ERROR: todo ${op} failed: ${message}. Nothing was changed (writes ` +
        `are atomic: ${leftover}).`,
    };
  }
}

// ---------------------------------------------------------------------------
// Plugin definition.
// ---------------------------------------------------------------------------

export default {
  id: "todo-list",
  async setup(ctx: TodoPluginContext) {
    // Announce "something changed" after a successful mutation, so a listener (today:
    // the Orca panel bridge) can react without this plugin knowing it exists. A runtime
    // without RPC, or with no listener, changes nothing here.
    const announce = await registerTodoRpc(ctx, (message) => console.error(`${LOG_TAG} ${message}`));
    const executeAndAnnounce = async (input: unknown, toolArg?: unknown) => {
      const outcome = await execute(input, toolArg);
      const op = (input as Partial<TodoToolInput> | undefined)?.op;
      if (announce && isChange(op, outcome?.content)) {
        const sessionID = resolveSessionID(toolArg);
        if (sessionID) announce(sessionID);
      }
      return outcome;
    };

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
          "always reuse the ids reported by previous calls. " +
          "Order is one path, walked in order: to START, CLOSE or CANCEL an " +
          "item, every item before it must already be closed " +
          "(completed/cancelled) or be one of its own ancestors in progress: " +
          "`3`, `3.1`, `3.1.2` together are fine; `4.3` while `3.1` is in " +
          "progress, `1.1` while `1` has not started, closing `1.4` while " +
          "`1.3` is pending, or closing `2` while `1` still runs are all " +
          "refused. A closed item may not have an open descendant: finish or " +
          "cancel `1.1` before closing or cancelling `1`. A pending item may " +
          "not have a completed or cancelled descendant: start `1` (or close " +
          "it) before finishing `1.1`, and an item with a closed descendant " +
          "cannot be set back to pending. A removal or insertion that would " +
          "leave any of these states behind is refused too. Rejections change " +
          "nothing.",
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
        execute: executeAndAnnounce,
      });
    });

    // ONE reminder line while the list is non-empty (spec Q6/Q15), delivered as
    // system context — never by editing the USER's prompt text (0.2.2, see the
    // module header). The static API how-to lives in context-inject, not here.
    const hookRegistration = await ctx.session.hook("context", async (event) => {
      const sessionID = event?.sessionID;
      if (typeof sessionID !== "string" || !sessionID) return;
      // Remember for tool calls whose second argument does not carry the id.
      activeSessionID = sessionID;
      try {
        const loaded = loadList(sessionID);
        if (loaded.status === "corrupt" || loaded.status === "unreadable") {
          // §9.1 F11: a broken store is announced, never silently skipped.
          const reason =
            loaded.status === "corrupt"
              ? "corrupt store"
              : "store could not be read";
          if (Array.isArray(event?.system)) {
            event.system.push({
              type: "text",
              text:
                `TODO: list unreadable (${reason}) — run the todo tool op ` +
                `"read" for details.`,
            });
          }
          return;
        }
        if (loaded.status !== "ok") return; // absent or empty — inject nothing
        const list = loaded.list;
        const inProgress = list.items.filter(
          (item) => item.status === "in_progress",
        ).length;
        const suffix = inProgress > 0 ? `, ${inProgress} in progress` : "";
        const total = list.items.length;
        const line =
          `TODO: ${total} item${total === 1 ? "" : "s"}${suffix} — ` +
          `update it if something changed.`;
        // The host rebuilds `system` for every model request, so pushing here
        // never accumulates in the history; a runtime that hands over no array
        // is simply skipped.
        if (Array.isArray(event?.system)) {
          event.system.push({ type: "text", text: line });
        }
      } catch (e) {
        // The hook must never break prompt admission.
        console.error(`${LOG_TAG} context hook failed:`, e);
      }
    });

    return () => {
      void Promise.resolve(toolRegistration?.dispose?.()).catch(() => {});
      void Promise.resolve(hookRegistration?.dispose?.()).catch(() => {});
    };
  },
};
