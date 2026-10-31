// order.ts — v0.3.5 ordering law (contract: spec-ordering.md §2, §2.1, §4, §4.1).
//
// THREE rules, all mandatory.
//
//   numbers   = deriveNumbers(items)
//   CLOSED(s) = s === "completed" || s === "cancelled"
//   OPEN(s)   = !CLOSED(s)
//   anc(j, i) = numbers[i].startsWith(numbers[j] + ".")
//
//   legal(list) iff
//     (A)  for every in_progress item i, for every j < i:
//              CLOSED(items[j].status)
//           || ( anc(j, i) && items[j].status === "in_progress" )
//     (B)  for every closed item i, for every j > i:
//              anc(i, j) ⇒ CLOSED(items[j].status)
//     (C)  for every item i, for every descendant j:
//              CLOSED(items[j].status) ⇒ items[i].status !== "pending"
//
// Rule A — the START rule. An item may be in progress only when every item
// BEFORE it is already closed — the single exception being its own ancestors,
// which must themselves be in progress. Nothing may be skipped; nothing may run
// in a second branch. `pending` therefore BLOCKS an in-progress item that comes
// after it (`1.1` while `1` has not started is invalid, USER correction
// 2026-10-31), and an in-progress item never legalizes an earlier sibling or
// another branch (`4.3` while `3.1` is in progress is invalid). A nested chain
// (3, 3.1, 3.1.2) is legal because every ancestor on that path is itself in
// progress. The v0.3.2 law "one in-progress item per level" is REJECTED (§2.3):
// the level arithmetic is not the law. Items AFTER the in-progress one are
// unconstrained by rule A: future work may exist.
//
// Rule B — the CLOSE rule. Closing is a commitment that the branch is over, so
// it is only allowed bottom-up: a closed item may not have an OPEN descendant,
// whether that descendant is `pending` or `in_progress` (USER correction
// 2026-10-31 02:10: "Como pode cancelar o 1, se o 1.1 nao esta"). `cancelled`
// commits the branch exactly like `completed`. A `remove` that re-parents an
// open item under an already closed one is refused too, because the candidate
// list — never the gesture — is what the law judges.
//
// Rule C — the PENDING rule (new in v0.3.5). It is rule B's exact mirror:
// starting is a commitment in the other direction, so an item may be `pending`
// only while every descendant is `pending`. The moment a descendant is
// `completed` or `cancelled`, its ancestors can no longer claim "never
// started" (USER correction 2026-10-31 09:20: "errado, como que o 1 pode nao
// ter comecado se o 1.1 concluiu"). The antecedent is `pending` and ONLY
// `pending`: a `cancelled` ancestor is a finished branch and stays legal over
// a closed descendant (D15). `add`, `remove` and a depth move can create the
// state just as well as a status revert — the candidate is what is judged.
//
// The three rules never see the same pair: A pairs an OPEN earlier member with
// an IN-PROGRESS later one, B pairs a CLOSED earlier member with an OPEN later
// one, C pairs a PENDING earlier member with a CLOSED later one.
//
// ATTRIBUTION (§4.1). Rule A walks every in-progress item i and every earlier
// item j, collecting the violating pair with the blocker's own class (in
// progress → "still in progress"; pending → "not in progress") and attributing
// it to the item THE CURRENT OP STARTS. Starting 3.7 while 4.2 already runs must
// read "cannot start 3.7: 4.2 is still in progress" — not the reverse. Rule B's
// offender is always the CLOSED member and rule C's is always the PENDING one:
// each is the only item of its pair whose state can be denied, so `closes` and
// `reverts` are DECLARATIONS, never selectors (D11, D14).
//
// Pure: no I/O, no state — recomputed from the candidate list on every mutating
// op; nothing about any rule is stored (no schema drift).

import { deriveNumbers } from "./format.ts";
import type { OrderingViolation, TodoItem, TodoStatus } from "./types.ts";

/**
 * The single definition of "closed" (§1): `cancelled` counts, because cancelling
 * commits the branch just like completing it. Exported so `index.ts` never
 * writes CLOSED a second time (§5).
 */
export function isClosedStatus(status: TodoStatus): boolean {
  return status === "completed" || status === "cancelled";
}

/** The four offender/blocker classes, in the fixed emission order of §4. */
const REASONS = [
  "in_progress",
  "pending",
  "open_descendant",
  "closed_descendant",
] as const;

type Reason = (typeof REASONS)[number];

/** offender index → reason → blocking indexes, in visit order. */
type Acc = Map<number, Record<Reason, number[]>>;

/** The one record of an offender, created on first use (one map, three rules). */
function slotOf(acc: Acc, offender: number): Record<Reason, number[]> {
  const slot: Record<Reason, number[]> = acc.get(offender) ?? {
    in_progress: [],
    pending: [],
    open_descendant: [],
    closed_descendant: [],
  };
  acc.set(offender, slot);
  return slot;
}

/**
 * Rule A — the START rule: every in-progress item against every EARLIER item.
 * `starts` decides which member of the pair a line names (§4.1); when neither
 * member started, the fallback is the later item — the in-progress one.
 */
function collectStartViolations(
  items: TodoItem[],
  numbers: string[],
  starts: ReadonlySet<number>,
  acc: Acc,
): void {
  const anc = (j: number, i: number) => numbers[i].startsWith(`${numbers[j]}.`);
  for (let i = 0; i < items.length; i++) {
    if (items[i].status !== "in_progress") continue;
    for (let j = 0; j < i; j++) { // every EARLIER item
      if (isClosedStatus(items[j].status)) continue; // closed: passes
      if (anc(j, i) && items[j].status === "in_progress") continue; // the chain: passes
      const started = starts.has(items[i].id)
        ? i
        : starts.has(items[j].id)
          ? j
          : i; // §4.1: started item, else the later (in-progress) one
      const blocker = started === i ? j : i;
      const reason: Reason =
        items[blocker].status === "in_progress" ? "in_progress" : "pending";
      slotOf(acc, started)[reason].push(blocker);
    }
  }
}

/**
 * Rule B — the CLOSE rule: every closed item against every LATER member of its
 * own branch. The closed item `i` is the offender; its open descendants are the
 * blockers (§4.1).
 */
function collectCloseViolations(
  items: TodoItem[],
  numbers: string[],
  acc: Acc,
): void {
  const anc = (i: number, j: number) => numbers[j].startsWith(`${numbers[i]}.`);
  for (let i = 0; i < items.length; i++) {
    if (!isClosedStatus(items[i].status)) continue;
    for (let j = i + 1; j < items.length; j++) { // every LATER item
      if (!anc(i, j)) continue; // another branch: passes
      if (isClosedStatus(items[j].status)) continue; // closed descendant: passes
      slotOf(acc, i).open_descendant.push(j);
    }
  }
}

/**
 * Rule C — the PENDING rule: every pending item against every LATER member of
 * its own branch. The pending item `i` is the offender — the only member whose
 * `pending` state can be denied — and its closed descendants are the blockers
 * (§4.1, D14). An open descendant is rule A's or rule B's business, never this.
 */
function collectPendingViolations(
  items: TodoItem[],
  numbers: string[],
  acc: Acc,
): void {
  const anc = (i: number, j: number) => numbers[j].startsWith(`${numbers[i]}.`);
  for (let i = 0; i < items.length; i++) {
    if (items[i].status !== "pending") continue; // not pending: rule C is silent
    for (let j = i + 1; j < items.length; j++) { // every LATER item
      if (!anc(i, j)) continue; // another branch: passes
      if (!isClosedStatus(items[j].status)) continue; // open descendant: A/B own it
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
 * One record per offender AND reason (blockers in full, nearest first, never
 * listed twice — every pair is visited once); offenders in candidate-index
 * order, and for one offender `in_progress` → `pending` → `open_descendant` →
 * `closed_descendant`.
 */
export function findOrderingViolations(
  items: TodoItem[], // the candidate list
  starts: ReadonlySet<number> = new Set(), // ids this op STARTS (§4.1)
  closes: ReadonlySet<number> = new Set(), // ids this op CLOSES (§4.1)
  reverts: ReadonlySet<number> = new Set(), // ids this op REVERTS to pending (§4.1)
): OrderingViolation[] {
  // `closes` and `reverts` are kept referenced on purpose: both are
  // declarations, not selectors (§2.1, D11 and D14) — rule B's offender is
  // always the closed member and rule C's always the pending one, so neither
  // set can change a verdict, a line or a blocker. They stay in the signature
  // so every call site states what the op did; T35 and T46 pin the equality.
  void closes;
  void reverts;
  const numbers = deriveNumbers(items);
  const acc: Acc = new Map();
  collectStartViolations(items, numbers, starts, acc);
  collectCloseViolations(items, numbers, acc);
  collectPendingViolations(items, numbers, acc);
  const out: OrderingViolation[] = [];
  for (const offender of [...acc.keys()].sort((a, b) => a - b)) { // list order
    for (const reason of REASONS) { // fixed group order (§4)
      const blockers = acc.get(offender)![reason].sort(nearestFirst(offender));
      if (blockers.length === 0) continue;
      out.push({
        itemId: items[offender].id,
        number: numbers[offender],
        blockerIds: blockers.map((k) => items[k].id),
        blockerNumbers: blockers.map((k) => numbers[k]),
        reason,
      });
    }
  }
  return out;
}

/** The state sentence of each reason, and the head its line uses (§4). */
const STATE: Record<OrderingViolation["reason"], string> = {
  in_progress: "still in progress.",
  pending: "not in progress.",
  open_descendant: "still open.",
  closed_descendant: "already closed.",
};

/** The per-reason head: rule A starts, B closes, C reverts to `pending` — the
 * target state is part of the head, not of the reason text (§4). */
const HEAD: Record<OrderingViolation["reason"], (number: string) => string> = {
  in_progress: (number) => `cannot start ${number}: `,
  pending: (number) => `cannot start ${number}: `,
  open_descendant: (number) => `cannot close ${number}: `,
  closed_descendant: (number) => `cannot revert ${number} to pending: `,
};

/** Exact rejection text (contract §4): one line per offender AND reason, then
 * the trailer. `is`/`are` follows that line's own blocker count; a single line
 * never mixes two reasons or two verbs. */
export function formatOrderingRejection(
  violations: OrderingViolation[],
): string {
  const lines = violations.map((variant) => {
    const plural = variant.blockerNumbers.length === 1 ? "is" : "are";
    return (
      `ERROR: ${HEAD[variant.reason](variant.number)}` +
      `${variant.blockerNumbers.join(", ")} ${plural} ${STATE[variant.reason]}`
    );
  });
  return `${lines.join("\n")}\nNothing was changed.`;
}
