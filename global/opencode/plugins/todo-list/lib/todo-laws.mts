// todo-laws.mts — the ordering law shared by the OpenCode todo plugin and the Orca
// todo plugin. This file is the SOURCE: `lib/build.sh` emits `todo-laws.mjs` next to it,
// and that generated `.mjs` is what a non-compiled host (the Orca plugin) vendors.
//
//   numbers   = deriveNumbers(items)      CLOSED(s) = completed | cancelled
//   anc(j, i) = numbers[i].startsWith(numbers[j] + ".")
//
//   D  every item that is not `pending` needs every earlier item closed, except its own
//      ancestors while in progress — and, for a closed item, its ancestors at all
//   B  a closed item may not have an open descendant
//   C  a `pending` item may not have a closed descendant
//
// Keep the shapes structural on purpose: this file must compile and emit on its own,
// without importing the plugin's types.

export type LawStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type LawReason =
  | "in_progress"
  | "pending"
  | "open_descendant"
  | "closed_descendant";

export interface LawItem {
  id: number;
  status: LawStatus;
  depth?: number;
}

export interface LawViolation {
  itemId: number;
  number: string;
  blockerIds: number[];
  blockerNumbers: string[];
  reason: LawReason;
  offenderStatus: LawStatus;
}

const CLOSED = new Set<LawStatus>(["completed", "cancelled"]);

export function isClosedStatus(status: LawStatus): boolean {
  return CLOSED.has(status);
}

/** `1`, `1.1`, `1.1.1`… derived from `depth`; a jump is clamped to one level. */
export function deriveNumbers(items: ReadonlyArray<{ depth?: number }>): string[] {
  const out: string[] = [];
  const counters: number[] = [];
  let previous = -1;
  for (const item of items) {
    // Same rule as the plugin's normalizeDepth: a non-integer or negative depth is 0.
    const raw = typeof item.depth === "number" && Number.isInteger(item.depth) && item.depth >= 0
      ? item.depth
      : 0;
    const depth = Math.min(raw, previous + 1);
    counters.length = depth + 1;
    counters[depth] = (counters[depth] ?? 0) + 1;
    out.push(counters.join("."));
    previous = depth;
  }
  return out;
}

type Slot = Record<LawReason, number[]>;
type Acc = Map<number, Slot>;

const REASONS: LawReason[] = [
  "in_progress",
  "pending",
  "open_descendant",
  "closed_descendant",
];

function slotOf(acc: Acc, offender: number): Slot {
  const existing = acc.get(offender);
  if (existing) return existing;
  const created: Slot = {
    in_progress: [],
    pending: [],
    open_descendant: [],
    closed_descendant: [],
  };
  acc.set(offender, created);
  return created;
}

/** Rule D: every non-pending item against every earlier item. */
function collectOrderViolations(
  items: ReadonlyArray<LawItem>,
  numbers: string[],
  starts: ReadonlySet<number>,
  acc: Acc,
): void {
  const anc = (j: number, i: number) => numbers[i].startsWith(`${numbers[j]}.`);
  for (let i = 0; i < items.length; i++) {
    if (items[i].status === "pending") continue;
    const closedI = isClosedStatus(items[i].status);
    for (let j = 0; j < i; j++) {
      if (isClosedStatus(items[j].status)) continue;
      if (anc(j, i) && items[j].status === "in_progress") continue;
      if (closedI && anc(j, i)) continue;
      const offender = starts.has(items[i].id)
        ? i
        : starts.has(items[j].id) && !closedI
          ? j
          : i;
      const blocker = offender === i ? j : i;
      const reason: LawReason =
        items[blocker].status === "in_progress" ? "in_progress" : "pending";
      slotOf(acc, offender)[reason].push(blocker);
    }
  }
}

/** Rule B: every closed item against every later member of its own branch. */
function collectCloseViolations(
  items: ReadonlyArray<LawItem>,
  numbers: string[],
  acc: Acc,
): void {
  const anc = (i: number, j: number) => numbers[j].startsWith(`${numbers[i]}.`);
  for (let i = 0; i < items.length; i++) {
    if (!isClosedStatus(items[i].status)) continue;
    for (let j = i + 1; j < items.length; j++) {
      if (!anc(i, j)) continue;
      if (isClosedStatus(items[j].status)) continue;
      slotOf(acc, i).open_descendant.push(j);
    }
  }
}

/** Rule C: every pending item against every later closed member of its branch. */
function collectPendingViolations(
  items: ReadonlyArray<LawItem>,
  numbers: string[],
  acc: Acc,
): void {
  const anc = (i: number, j: number) => numbers[j].startsWith(`${numbers[i]}.`);
  for (let i = 0; i < items.length; i++) {
    if (items[i].status !== "pending") continue;
    for (let j = i + 1; j < items.length; j++) {
      if (!anc(i, j)) continue;
      if (!isClosedStatus(items[j].status)) continue;
      slotOf(acc, i).closed_descendant.push(j);
    }
  }
}

/** Nearest first: ascending `|offender − blocker|`, ties to the later index. */
function nearestFirst(offender: number) {
  return (p: number, q: number) =>
    Math.abs(p - offender) - Math.abs(q - offender) || q - p;
}

/**
 * One record per offender AND reason: offenders in list order, and for one offender
 * `in_progress` → `pending` → `open_descendant` → `closed_descendant`.
 */
export function findOrderingViolations(
  items: ReadonlyArray<LawItem>,
  starts: ReadonlySet<number> = new Set(),
  closes: ReadonlySet<number> = new Set(),
  reverts: ReadonlySet<number> = new Set(),
): LawViolation[] {
  // `closes` and `reverts` are declarations, never selectors: rule B's offender is
  // always the closed member and rule C's always the pending one.
  void closes;
  void reverts;
  const numbers = deriveNumbers(items);
  const acc: Acc = new Map();
  collectOrderViolations(items, numbers, starts, acc);
  collectCloseViolations(items, numbers, acc);
  collectPendingViolations(items, numbers, acc);
  const out: LawViolation[] = [];
  for (const offender of [...acc.keys()].sort((a, b) => a - b)) {
    for (const reason of REASONS) {
      const blockers = acc.get(offender)![reason].sort(nearestFirst(offender));
      if (blockers.length === 0) continue;
      out.push({
        itemId: items[offender].id,
        number: numbers[offender],
        blockerIds: blockers.map((k) => items[k].id),
        blockerNumbers: blockers.map((k) => numbers[k]),
        reason,
        offenderStatus: items[offender].status,
      });
    }
  }
  return out;
}

const STATE: Record<LawReason, string> = {
  in_progress: "still in progress.",
  pending: "not in progress.",
  open_descendant: "still open.",
  closed_descendant: "already closed.",
};

/** Rule C always reverts to `pending`; every other reason takes its verb from the
 * offender's own status. Every item named carries its STABLE ID: the display number
 * is regenerated on insert/remove, so a caller cannot address an item by it alone. */
function head(variant: LawViolation): string {
  if (variant.reason === "closed_descendant") {
    return `cannot revert ${variant.number} (id ${variant.itemId}) to pending: `;
  }
  const verb = isClosedStatus(variant.offenderStatus) ? "close" : "start";
  return `cannot ${verb} ${variant.number} (id ${variant.itemId}): `;
}

/** Exact rejection text: one line per offender AND reason, then the trailer. */
export function formatOrderingRejection(violations: LawViolation[]): string {
  // No violation means the list is legal: the sentence alone, never a blank first line.
  if (violations.length === 0) return "Nothing was changed.";
  const lines = violations.map((variant) => {
    const plural = variant.blockerNumbers.length === 1 ? "is" : "are";
    const blockers = variant.blockerNumbers
      .map((number, i) => `${number} (id ${variant.blockerIds[i]})`)
      .join(", ");
    return `ERROR: ${head(variant)}${blockers} ${plural} ${STATE[variant.reason]}`;
  });
  return `${lines.join("\n")}\nNothing was changed.`;
}
