// ordering.test.mjs — v0.3.3 ordering rule (contract: spec-ordering.md §2/§6).
//
// THE LAW (ancestor law, restored 2026-10-31):
//   numbers = deriveNumbers(items);  CLOSED = {completed, cancelled}
//   anc(j, i) = numbers[i].startsWith(numbers[j] + ".")
//   legal  iff  for every in_progress item i, for every j < i:
//                 CLOSED(status[j]) || (anc(j, i) && status[j] === "in_progress")
// In words: the in-progress items form ONE path walked in order — nothing may be
// skipped, nothing may run in a second branch. `pending` blocks again (USER
// correction 2026-10-31: "Como que o 1.1 pode estar em andamento se a 1 ainda
// nao iniciou?"); only an in-progress ancestor may precede a running item.
//
// Dev-only suite. Zero dependencies: node:test + node:assert/strict + node:fs,
// node:os, node:path. It drives the REAL tool: `index.ts` (default export, its
// `setup(ctx)` registers `todo`) and the REAL store (`store.ts`), with `HOME`
// redirected to a fresh `mkdtemp` per test — `store.ts` resolves the data dir
// from `os.homedir()` at call time, so the real `$HOME` is never touched.
//
// `index.ts` exports only `default`; nothing here requires a test-only export.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const PLUGIN = new URL("../", import.meta.url);

const { default: plugin } = await import(new URL("index.ts", PLUGIN).href);
const { readList, writeList, filePathFor } = await import(
  new URL("store.ts", PLUGIN).href
);
const { deriveNumbers } = await import(new URL("format.ts", PLUGIN).href);
// T35 pins §2.1's fourth property (the `closes` set is a declaration, not a
// selector) against the pure predicate, the same function `index.ts` calls.
const { findOrderingViolations, formatOrderingRejection } = await import(
  new URL("order.ts", PLUGIN).href
);

// --- the registered tool, taken from a real setup() -------------------------

let tool = null;
let hook = null;
await plugin.setup({
  tool: {
    transform: async (cb) => {
      cb({
        add: (t) => {
          tool = t;
        },
      });
      return { dispose() {} };
    },
  },
  session: {
    hook: async (_name, callback) => {
      hook = callback;
      return { dispose() {} };
    },
  },
});
assert.ok(tool, "setup() did not register a tool");
assert.ok(hook, "setup() did not register the context hook");

const call = (input, sessionID = "order-test-session") =>
  tool.execute(input, { sessionID });

// --- isolation -------------------------------------------------------------

const ORIGINAL_HOME = process.env.HOME;
let currentHome = null;

function useHome() {
  currentHome = fs.mkdtempSync(path.join(os.tmpdir(), "todo-order-"));
  process.env.HOME = currentHome;
  return currentHome;
}

afterEach(() => {
  if (currentHome) fs.rmSync(currentHome, { recursive: true, force: true });
  currentHome = null;
  process.env.HOME = ORIGINAL_HOME;
});

// --- fixtures / helpers ----------------------------------------------------

const C = "completed";
const I = "in_progress";
const P = "pending";
const X = "cancelled";

/** `li` = one write/add item: depth, status, content. */
const li = (depth, status, content) => ({ depth, status, content });

/** Parses the numbered rows of a `read`/dump answer: id, glyph, derived number. */
function rows(content) {
  const out = [];
  for (const line of content.split("\n")) {
    const m = /^(\d+): (\[[ x~!]\]) ([\d.]+)\) /.exec(line);
    if (m) out.push({ id: Number(m[1]), glyph: m[2], number: m[3] });
  }
  return out;
}

const rowOf = (content, number) => rows(content).find((r) => r.number === number);
const rowById = (content, id) => rows(content).find((r) => r.id === id);

const rawStore = (sid) => fs.readFileSync(filePathFor(sid), "utf8");
const tmpLeft = (sid) => fs.existsSync(`${filePathFor(sid)}.tmp`);

/**
 * USER example C pre-state (T4/T5/T6), RE-DERIVED for v0.3.5: 3 in progress;
 * 3.1–3.6 completed; 3.7 in progress; 4 pending; 4.1 **pending**; 4.2 pending.
 * A completed `4.1` under a pending `4` would itself violate rule C (§6
 * fixture policy), so the pre-state starts from `4.1` pending; the old literal
 * fixture survives only as T51's ILLEGAL candidate.
 * Numbers: 1, 2, 3, 3.1 … 3.7, 4, 4.1, 4.2  → ids 1 … 13 in that order.
 */
const FOUR_TWO_PRE_C = [
  li(0, C, "root one"), //      1
  li(0, C, "root two"), //      2
  li(0, I, "three"), //         3
  li(1, C, "three one"), //     3.1
  li(1, C, "three two"), //     3.2
  li(1, C, "three three"), //   3.3
  li(1, C, "three four"), //    3.4
  li(1, C, "three five"), //    3.5
  li(1, C, "three six"), //     3.6
  li(1, I, "three seven"), //   3.7  (id 10)
  li(0, P, "four"), //          4    (id 11)
  li(1, P, "four one"), //      4.1  (id 12) — pending, not closed
  li(1, P, "four two"), //      4.2  (id 13)
];

/** The same pre-state with `3.7` merely `pending` (T4b / §2.2 row Fb). */
const FOUR_TWO_PRE_C_37_PENDING = FOUR_TWO_PRE_C.map((item, index) =>
  index === 9 ? { ...item, status: P } : item,
);

const ID_3_7 = 10;
const ID_3 = 3;
const ID_4 = 11;
const ID_4_1 = 12;
const ID_4_2 = 13;

const NOTHING_CHANGED = "Nothing was changed.";

// --- T1 -------------------------------------------------------------------

test("T1 numbering fixture: depths [0,1,2,2,0] → 1, 1.1, 1.1.1, 1.1.2, 2", () => {
  const items = [
    { id: 1, content: "a", status: P, priority: "medium", depth: 0 },
    { id: 2, content: "b", status: P, priority: "medium", depth: 1 },
    { id: 3, content: "c", status: P, priority: "medium", depth: 2 },
    { id: 4, content: "d", status: P, priority: "medium", depth: 2 },
    { id: 5, content: "e", status: P, priority: "medium", depth: 0 },
  ];
  assert.deepEqual(deriveNumbers(items), ["1", "1.1", "1.1.1", "1.1.2", "2"]);
  // the level arithmetic the law rests on: 4.3 is level 1, 3.1.2 is level 2.
  assert.equal("4.3".split(".").length - 1, 1);
  assert.equal("3.1.2".split(".").length - 1, 2);
});

// --- T2 -------------------------------------------------------------------

test("T2 user example A — nested chain {3, 3.1, 3.1.2} legal", async () => {
  useHome();
  const sid = "t2";
  const res = await call(
    {
      op: "write",
      items: [
        li(0, C, "root one"),
        li(0, C, "root two"),
        li(0, I, "three"),
        li(1, I, "three one"),
        li(2, C, "three one one"),
        li(2, I, "three one two"),
      ],
    },
    sid,
  );
  assert.match(res.content, /^TODO list replaced\./);

  const view = await call({ op: "read" }, sid);
  assert.deepEqual(rowOf(view.content, "3"), {
    id: 3,
    glyph: "[~]",
    number: "3",
  });
  assert.deepEqual(rowOf(view.content, "3.1"), {
    id: 4,
    glyph: "[~]",
    number: "3.1",
  });
  assert.deepEqual(rowOf(view.content, "3.1.1"), {
    id: 5,
    glyph: "[x]",
    number: "3.1.1",
  });
  assert.deepEqual(rowOf(view.content, "3.1.2"), {
    id: 6,
    glyph: "[~]",
    number: "3.1.2",
  });
});

// --- T31 (the case the restored law adds) ---------------------------------

test("T31 ancestor in progress — {1, 1.1} is legal", async () => {
  useHome();
  const sid = "t31";
  const res = await call(
    { op: "write", items: [li(0, I, "one"), li(1, I, "one one")] },
    sid,
  );
  assert.match(res.content, /^TODO list replaced\./);

  const view = await call({ op: "read" }, sid);
  assert.deepEqual(rowOf(view.content, "1"), { id: 1, glyph: "[~]", number: "1" });
  assert.deepEqual(rowOf(view.content, "1.1"), {
    id: 2,
    glyph: "[~]",
    number: "1.1",
  });

  // A single root start is legal on its own — both calls accepted (a fresh
  // session, so the rewritten item is id 1 again).
  const sid2 = "t31b";
  const rewritten = await call(
    { op: "write", items: [li(0, P, "one")] },
    sid2,
  );
  assert.match(rewritten.content, /^TODO list replaced\./);
  const start = await call(
    { op: "update", items: [{ id: 1, status: I }] },
    sid2,
  );
  assert.match(start.content, /^TODO updated \(1 change\)\./);
});

// --- T3 (headline) --------------------------------------------------------

test("T3 headline — the USER's set {3, 3.1, 4.3}: 4.3 is blocked by 3.1 and 3", async () => {
  useHome();
  const sid = "t3";
  const res = await call(
    {
      op: "write",
      items: [
        li(0, C, "root one"), //     1
        li(0, C, "root two"), //     2
        li(0, I, "three"), //        3   in progress
        li(1, I, "three one"), //    3.1 in progress (the chain)
        li(0, P, "four"), //         4   pending — blocks 4.3
        li(1, P, "four one"), //     4.1 pending — blocks 4.3
        li(1, P, "four two"), //     4.2 pending — blocks 4.3
        li(1, I, "four three"), //   4.3 in progress, second branch
      ],
    },
    sid,
  );
  assert.equal(
    res.content,
    "ERROR: cannot start 4.3: 3.1, 3 are still in progress.\n" +
      "ERROR: cannot start 4.3: 4.2, 4.1, 4 are not in progress.\n" +
      NOTHING_CHANGED,
  );
  assert.equal(readList(sid), null, "store must still be empty");
  assert.equal(fs.existsSync(filePathFor(sid)), false, "no file may be written");
  assert.equal(tmpLeft(sid), false, "no .tmp may be left behind");
});

// --- T4 -------------------------------------------------------------------

test("T4 user example C — starting 4.2 while 3.7 is in progress is rejected", async () => {
  useHome();
  const sid = "t4";
  const written = await call({ op: "write", items: FOUR_TWO_PRE_C }, sid);
  assert.match(written.content, /^TODO list replaced\./);

  const before = readList(sid);
  const bytesBefore = rawStore(sid);

  const res = await call(
    { op: "update", items: [{ id: ID_4_2, status: I }] },
    sid,
  );
  assert.equal(
    res.content,
    "ERROR: cannot start 4.2: 3.7, 3 are still in progress.\n" +
      "ERROR: cannot start 4.2: 4.1, 4 are not in progress.\n" +
      NOTHING_CHANGED,
  );

  assert.deepEqual(readList(sid), before, "readList must deep-equal the pre-state");
  assert.equal(rawStore(sid), bytesBefore, "store bytes must be untouched");
  assert.equal(readList(sid).nextId, before.nextId, "nextId must not move");
  assert.equal(tmpLeft(sid), false, "no .tmp may be left behind");
});

// --- T4b ------------------------------------------------------------------

test("T4b the same pre-state with 3.7 pending: 4.2 is still blocked", async () => {
  useHome();
  const sid = "t4b";
  const written = await call({ op: "write", items: FOUR_TWO_PRE_C_37_PENDING }, sid);
  assert.match(written.content, /^TODO list replaced\./);

  const before = readList(sid);
  const bytesBefore = rawStore(sid);

  const res = await call(
    { op: "update", items: [{ id: ID_4_2, status: I }] },
    sid,
  );
  assert.equal(
    res.content,
    "ERROR: cannot start 4.2: 3 is still in progress.\n" +
      "ERROR: cannot start 4.2: 4.1, 4, 3.7 are not in progress.\n" +
      NOTHING_CHANGED,
  );

  assert.deepEqual(readList(sid), before, "readList must deep-equal the pre-state");
  assert.equal(rawStore(sid), bytesBefore, "store bytes must be untouched");
  assert.equal(tmpLeft(sid), false, "no .tmp may be left behind");
});

// --- T5 -------------------------------------------------------------------

test("T5 completing frees the path (five steps: 3.7 done, 3 done, 4 starts, 4.1 started and closed, 4.2 starts)", async () => {
  useHome();
  const sid = "t5";
  await call({ op: "write", items: FOUR_TWO_PRE_C }, sid);

  const a = await call(
    { op: "update", items: [{ id: ID_3_7, status: C }] },
    sid,
  );
  assert.match(a.content, /^TODO updated \(1 change\)\./);

  const b = await call(
    {
      op: "update",
      items: [
        { id: ID_3, status: C },
        { id: ID_4, status: I },
      ],
    },
    sid,
  );
  assert.match(b.content, /^TODO updated \(2 changes\)\./);

  // A pending sibling may no longer be skipped: `4.1` must be started (and
  // closed) before `4.2` may start — a completed `4.1` under a pending `4`
  // would itself violate rule C.
  const c = await call(
    { op: "update", items: [{ id: ID_4_1, status: I }] },
    sid,
  );
  assert.match(c.content, /^TODO updated \(1 change\)\./);

  const d = await call(
    { op: "update", items: [{ id: ID_4_1, status: C }] },
    sid,
  );
  assert.match(d.content, /^TODO updated \(1 change\)\./);

  const e = await call(
    { op: "update", items: [{ id: ID_4_2, status: I }] },
    sid,
  );
  assert.match(e.content, /^TODO updated \(1 change\)\./);

  const view = await call({ op: "read" }, sid);
  assert.equal(rowOf(view.content, "4.2").glyph, "[~]");
});

// --- T6 -------------------------------------------------------------------

test("T6 cancelling counts as closed (five steps, 4.1 cancelled too)", async () => {
  useHome();
  const sid = "t6";
  await call({ op: "write", items: FOUR_TWO_PRE_C }, sid);

  const a = await call(
    { op: "update", items: [{ id: ID_3_7, status: X }] },
    sid,
  );
  assert.match(a.content, /^TODO updated \(1 change\)\./);

  const b = await call(
    {
      op: "update",
      items: [
        { id: ID_3, status: X },
        { id: ID_4, status: I },
      ],
    },
    sid,
  );
  assert.match(b.content, /^TODO updated \(2 changes\)\./);

  // The same five-step route as T5, with `cancelled` in place of `completed`.
  const c = await call(
    { op: "update", items: [{ id: ID_4_1, status: I }] },
    sid,
  );
  assert.match(c.content, /^TODO updated \(1 change\)\./);

  const d = await call(
    { op: "update", items: [{ id: ID_4_1, status: X }] },
    sid,
  );
  assert.match(d.content, /^TODO updated \(1 change\)\./);

  const e = await call(
    { op: "update", items: [{ id: ID_4_2, status: I }] },
    sid,
  );
  assert.match(e.content, /^TODO updated \(1 change\)\./);

  const view = await call({ op: "read" }, sid);
  assert.equal(rowOf(view.content, "4.2").glyph, "[~]");
});

// --- T7 -------------------------------------------------------------------

test("T7 deleting does not bypass the child: the removal itself is refused (rule B)", async () => {
  useHome();
  const sid = "t7";
  // LITERAL §6 fixture. Under v0.3.4 the gesture dies one step EARLIER than in
  // v0.3.3: after the removal the pending child renumbers to 2.1 UNDER the
  // already closed `2`, and that candidate is not storable (rule B). The v0.3.3
  // "removal accepted" expectation is WITHDRAWN, not softened (§6); the v0.3.2
  // instruction "revert that child to pending so it blocks nothing" stays void.
  const written = await call(
    {
      op: "write",
      items: [
        li(0, C, "root one"), //     1   (id 1)
        li(0, C, "root two"), //     2   (id 2 — closed when the child lands here)
        li(0, I, "three"), //        3   (id 3 — in-progress root, removed)
        li(1, P, "three one"), //    3.1 (id 4) — stays pending
        li(0, P, "four"), //         4   (id 5)
        li(1, P, "four one"), //     4.1 (id 6)
      ],
    },
    sid,
  );
  assert.match(written.content, /^TODO list replaced\./);

  const before = readList(sid);
  const bytesBefore = rawStore(sid);
  const refused = await call({ op: "remove", items: [{ id: 3 }] }, sid);
  // Candidate after the removal: `1, 2, 2.1, 3, 3.1` — the pending `2.1` would
  // sit under the closed `2`, so the removal is refused (§6 T7).
  assert.equal(
    refused.content,
    "ERROR: cannot close 2: 2.1 is still open.\n" + NOTHING_CHANGED,
  );
  assert.deepEqual(readList(sid), before, "readList must deep-equal the pre-state");
  assert.equal(rawStore(sid), bytesBefore, "store bytes must be untouched");
  assert.equal(tmpLeft(sid), false, "no .tmp may be left behind");
  const stillThere = await call({ op: "read" }, sid);
  assert.deepEqual(rowById(stillThere.content, 3), {
    id: 3,
    glyph: "[~]",
    number: "3",
  });

  // The law-true escape — four accepted calls: close the child, remove the
  // root, then run the re-parented branch.
  const closeChild = await call(
    { op: "update", items: [{ id: 4, status: C }] },
    sid,
  );
  assert.match(closeChild.content, /^TODO updated \(1 change\)\./);

  const removed = await call({ op: "remove", items: [{ id: 3 }] }, sid);
  assert.match(removed.content, /^TODO updated \(items removed\)\./);

  // Renumbered: old 3.1 → 2.1, old 4 → 3, old 4.1 → 3.1.
  const afterRemove = await call({ op: "read" }, sid);
  assert.deepEqual(rowById(afterRemove.content, 4), {
    id: 4,
    glyph: "[x]",
    number: "2.1",
  });
  assert.deepEqual(rowById(afterRemove.content, 5), {
    id: 5,
    glyph: "[ ]",
    number: "3",
  });
  assert.deepEqual(rowById(afterRemove.content, 6), {
    id: 6,
    glyph: "[ ]",
    number: "3.1",
  });

  const startRoot = await call(
    { op: "update", items: [{ id: 5, status: I }] },
    sid,
  );
  assert.match(startRoot.content, /^TODO updated \(1 change\)\./);

  const startChild = await call(
    { op: "update", items: [{ id: 6, status: I }] },
    sid,
  );
  assert.match(startChild.content, /^TODO updated \(1 change\)\./);
});

// --- T8 (flipped back to ILLEGAL: no child under a pending parent) --------

test("T8 a pending parent blocks the child (2.1 under pending 2 is rejected)", async () => {
  useHome();
  const sid = "t8";
  const res = await call(
    {
      op: "write",
      items: [li(0, C, "root one"), li(0, P, "two"), li(1, I, "two one")],
    },
    sid,
  );
  assert.equal(
    res.content,
    "ERROR: cannot start 2.1: 2 is not in progress.\n" + NOTHING_CHANGED,
  );
  assert.equal(fs.existsSync(filePathFor(sid)), false, "no file may be written");
  assert.equal(tmpLeft(sid), false, "no .tmp may be left behind");
});

// --- T9 (flipped back to ILLEGAL: no skipped sibling) ---------------------

test("T9 skipping a sibling is illegal — {2, 2.2} is rejected", async () => {
  useHome();
  const sid = "t9";
  const res = await call(
    {
      op: "write",
      items: [
        li(0, C, "root one"),
        li(0, I, "two"), //      ancestor chain root
        li(1, P, "two one"), //  skipped sibling — blocks 2.2
        li(1, I, "two two"), //  second branch
      ],
    },
    sid,
  );
  assert.equal(
    res.content,
    "ERROR: cannot start 2.2: 2.1 is not in progress.\n" + NOTHING_CHANGED,
  );
  assert.equal(fs.existsSync(filePathFor(sid)), false, "no file may be written");
  assert.equal(tmpLeft(sid), false, "no .tmp may be left behind");
});

// --- T10 ------------------------------------------------------------------

test("T10 write is rejected whole: existing list is byte-identical", async () => {
  useHome();
  const sid = "t10";
  const seeded = await call(
    { op: "write", items: [li(0, C, "keep one"), li(0, I, "keep two")] },
    sid,
  );
  assert.match(seeded.content, /^TODO list replaced\./);

  const before = readList(sid);
  const bytesBefore = rawStore(sid);

  // The first four items are legal on their own; the fifth (a second
  // in-progress branch) violates the law — so nothing at all may be written.
  const res = await call(
    {
      op: "write",
      items: [
        li(0, C, "root one"),
        li(0, C, "root two"),
        li(0, I, "three"),
        li(1, I, "three one"),
        li(0, I, "four"),
      ],
    },
    sid,
  );
  assert.equal(
    res.content,
    "ERROR: cannot start 4: 3.1, 3 are still in progress.\n" + NOTHING_CHANGED,
  );
  assert.deepEqual(readList(sid), before, "readList must deep-equal the pre-state");
  assert.equal(rawStore(sid), bytesBefore, "store bytes must be untouched");
  assert.equal(readList(sid).nextId, before.nextId, "nextId must not move");
  assert.equal(tmpLeft(sid), false, "no .tmp may be left behind");
});

// --- T11 -----------------------------------------------------------------

test("T11 no false positives (content/priority edits, write [], clear on illegal list)", async () => {
  useHome();
  const sid = "t11";
  await call(
    {
      op: "write",
      items: [
        li(0, C, "root one"),
        li(0, C, "root two"),
        li(0, I, "three"),
        li(1, I, "three one"),
        li(2, C, "three one one"),
        li(2, I, "three one two"),
      ],
    },
    sid,
  );

  const edited = await call(
    {
      op: "update",
      items: [
        { id: 4, content: "renamed child" },
        { id: 5, priority: "high" },
      ],
    },
    sid,
  );
  assert.match(edited.content, /^TODO updated \(2 changes\)\./);

  const view = await call({ op: "read" }, sid);
  assert.match(view.content, /renamed child/);
  assert.match(view.content, /\[high\]/);

  const cleared = await call({ op: "write", items: [] }, sid);
  assert.match(cleared.content, /^TODO list cleared\./);
  assert.equal(readList(sid), null);

  // Legacy-illegal list (seeded behind the tool's back) may always be cleared.
  writeList(sid, {
    sessionID: sid,
    nextId: 3,
    items: [
      { id: 1, content: "a", status: I, priority: "medium", depth: 0 },
      { id: 2, content: "b", status: I, priority: "medium", depth: 0 },
    ],
  });
  const clearedIllegal = await call({ op: "clear" }, sid);
  assert.equal(clearedIllegal.content, "TODO list cleared (file removed).");
  assert.equal(readList(sid), null);
});

// --- T12 -----------------------------------------------------------------

test("T12 legacy illegal list is never locked out (update/remove/clear)", async () => {
  useHome();
  const sid = "t12";

  // (a) starting 3.1 under an unstarted predecessor is refused; the refusal
  // names the real blockers of the CANDIDATE list (§2.2 row R). The third line
  // follows §9.1 F9 / §9.2 (same shape as T25): `id 1 status` is a change that
  // offends no rule and is discarded with the whole candidate, so it is
  // itemised — §6 T12 predates F9 and only lists the two ERROR lines.
  writeList(sid, {
    sessionID: sid,
    nextId: 5,
    items: [
      { id: 1, content: "a", status: I, priority: "medium", depth: 0 },
      { id: 2, content: "b", status: I, priority: "medium", depth: 0 },
      { id: 3, content: "c", status: P, priority: "medium", depth: 0 },
      { id: 4, content: "d", status: P, priority: "medium", depth: 1 },
    ],
  });
  const before = readList(sid);
  const bytesBefore = rawStore(sid);
  const refused = await call(
    {
      op: "update",
      items: [
        { id: 1, status: X },
        { id: 4, status: I },
      ],
    },
    sid,
  );
  assert.equal(
    refused.content,
    "ERROR: cannot start 3.1: 2 is still in progress.\n" +
      "ERROR: cannot start 3.1: 3 is not in progress.\n" +
      "refused whole: 1 other requested change was not applied (id 1 status).\n" +
      NOTHING_CHANGED,
  );
  assert.deepEqual(readList(sid), before, "readList must deep-equal the pre-state");
  assert.equal(rawStore(sid), bytesBefore, "store bytes must be untouched");

  // (b) a remove that leaves the list illegal is rejected (fail-closed).
  writeList(sid, {
    sessionID: sid,
    nextId: 4,
    items: [
      { id: 1, content: "a", status: I, priority: "medium", depth: 0 },
      { id: 2, content: "b", status: I, priority: "medium", depth: 0 },
      { id: 3, content: "c", status: P, priority: "medium", depth: 0 },
    ],
  });
  const beforeRemove = readList(sid);
  const bytesBeforeRemove = rawStore(sid);
  const leavingIllegal = await call({ op: "remove", items: [{ id: 3 }] }, sid);
  assert.equal(
    leavingIllegal.content,
    "ERROR: cannot start 2: 1 is still in progress.\n" + NOTHING_CHANGED,
  );
  assert.deepEqual(
    readList(sid),
    beforeRemove,
    "readList must deep-equal the pre-state",
  );
  assert.equal(rawStore(sid), bytesBeforeRemove, "store bytes must be untouched");
  assert.equal(tmpLeft(sid), false, "no .tmp may be left behind");

  // (c) a corrective update that closes the earlier item is accepted (§2.2 S).
  writeList(sid, {
    sessionID: sid,
    nextId: 3,
    items: [
      { id: 1, content: "a", status: I, priority: "medium", depth: 0 },
      { id: 2, content: "b", status: I, priority: "medium", depth: 0 },
    ],
  });
  const fixed = await call({ op: "update", items: [{ id: 1, status: X }] }, sid);
  assert.match(fixed.content, /^TODO updated \(1 change\)\./);
  const fixedView = await call({ op: "read" }, sid);
  assert.deepEqual(rowById(fixedView.content, 2), {
    id: 2,
    glyph: "[~]",
    number: "2",
  });

  // (d) clear still works on an illegal list — the guaranteed escape hatch.
  writeList(sid, {
    sessionID: sid,
    nextId: 3,
    items: [
      { id: 1, content: "a", status: I, priority: "medium", depth: 0 },
      { id: 2, content: "b", status: I, priority: "medium", depth: 0 },
    ],
  });
  const cleared = await call({ op: "clear" }, sid);
  assert.equal(cleared.content, "TODO list cleared (file removed).");
  assert.equal(readList(sid), null);
});

// --- T13 -----------------------------------------------------------------

test("T13 add obeys the law (legal child accepted, second root rejected)", async () => {
  useHome();
  const sid = "t13";

  // (a) in-progress child under an in-progress parent: levels 0 and 1.
  await call(
    { op: "write", items: [li(0, C, "root one"), li(0, I, "root two")] },
    sid,
  );
  const legalAdd = await call(
    { op: "add", items: [li(1, I, "child of two")] },
    sid,
  );
  assert.match(legalAdd.content, /^TODO updated \(added: 3\)\./);
  const view = await call({ op: "read" }, sid);
  assert.deepEqual(rowOf(view.content, "2.1"), {
    id: 3,
    glyph: "[~]",
    number: "2.1",
  });

  // (b) a second level-0 in-progress item while a previous root is in progress.
  const sid2 = "t13b";
  await call(
    { op: "write", items: [li(0, C, "root one"), li(0, I, "root two")] },
    sid2,
  );
  const before = readList(sid2);
  const bytesBefore = rawStore(sid2);
  const illegalAdd = await call(
    { op: "add", items: [li(0, I, "root three")] },
    sid2,
  );
  assert.equal(
    illegalAdd.content,
    "ERROR: cannot start 3: 2 is still in progress.\n" + NOTHING_CHANGED,
  );
  assert.deepEqual(readList(sid2), before, "readList must deep-equal the pre-state");
  assert.equal(rawStore(sid2), bytesBefore, "store bytes must be untouched");
  assert.equal(readList(sid2).nextId, before.nextId, "nextId must not move");
  assert.equal(tmpLeft(sid2), false, "no .tmp may be left behind");
});

// --- T14 (flipped back to ILLEGAL) ---------------------------------------

test("T14 an entirely-pending earlier branch blocks", async () => {
  useHome();
  const sid = "t14";
  const res = await call(
    {
      op: "write",
      items: [
        li(0, P, "root one"), //       1   pending
        li(1, P, "root one child"), // 1.1 pending
        li(0, I, "root two"), //       2   in progress
      ],
    },
    sid,
  );
  assert.equal(
    res.content,
    "ERROR: cannot start 2: 1.1, 1 are not in progress.\n" + NOTHING_CHANGED,
  );
  assert.equal(fs.existsSync(filePathFor(sid)), false, "no file may be written");
  assert.equal(tmpLeft(sid), false, "no .tmp may be left behind");
});

// --- T15 (flipped back to ILLEGAL: {3, 4.3} and {3, 4.2}) -----------------

test("T15 {3, 4.3} and {3, 4.2} are illegal (a pending root blocks)", async () => {
  useHome();

  // (a) 4/4.1/4.2 pending, 4.3 in progress → 3 is still in progress.
  const a = await call(
    {
      op: "write",
      items: [
        li(0, C, "root one"),
        li(0, C, "root two"),
        li(0, I, "three"), //        3   in progress
        li(0, P, "four"), //         4   pending
        li(1, P, "four one"), //     4.1
        li(1, P, "four two"), //     4.2
        li(1, I, "four three"), //   4.3 second branch
      ],
    },
    "t15a",
  );
  assert.equal(
    a.content,
    "ERROR: cannot start 4.3: 3 is still in progress.\n" +
      "ERROR: cannot start 4.3: 4.2, 4.1, 4 are not in progress.\n" +
      NOTHING_CHANGED,
  );
  assert.equal(fs.existsSync(filePathFor("t15a")), false, "no file may be written");

  // (b) 4 pending, 4.1 pending, 4.2 in progress → same verdict. Re-derived for
  // v0.3.5: a closed `4.1` under a pending `4` is itself a rule-C violation
  // (that literal fixture now lives on as T51).
  const b = await call(
    {
      op: "write",
      items: [
        li(0, C, "root one"),
        li(0, C, "root two"),
        li(0, I, "three"), //        3   in progress
        li(0, P, "four"), //         4   pending
        li(1, P, "four one"), //     4.1 pending
        li(1, I, "four two"), //     4.2 second branch
      ],
    },
    "t15b",
  );
  assert.equal(
    b.content,
    "ERROR: cannot start 4.2: 3 is still in progress.\n" +
      "ERROR: cannot start 4.2: 4.1, 4 are not in progress.\n" +
      NOTHING_CHANGED,
  );
  assert.equal(fs.existsSync(filePathFor("t15b")), false, "no file may be written");
});

// --- T16 (flipped back to ILLEGAL: a level gap is not a free pass) --------

test("T16 level gap is illegal: {3, 3.1.2} with 3.1 pending", async () => {
  useHome();
  const sid = "t16";
  const res = await call(
    {
      op: "write",
      items: [
        li(0, C, "root one"),
        li(0, C, "root two"),
        li(0, I, "three"), //          3     in progress
        li(1, P, "three one"), //      3.1   pending — blocks
        li(2, P, "three one one"), //  3.1.1 pending — blocks
        li(2, I, "three one two"), //  3.1.2 the gap
      ],
    },
    sid,
  );
  assert.equal(
    res.content,
    "ERROR: cannot start 3.1.2: 3.1.1, 3.1 are not in progress.\n" +
      NOTHING_CHANGED,
  );
  assert.equal(fs.existsSync(filePathFor(sid)), false, "no file may be written");
  assert.equal(tmpLeft(sid), false, "no .tmp may be left behind");
});

// --- T18 (attribution) ----------------------------------------------------

test("T18 attribution — the started 3.7 is named; the legacy 4.2 refusals follow", async () => {
  useHome();
  const sid = "t18";
  const seeded = await call({ op: "write", items: FOUR_TWO_PRE_C }, sid);
  assert.match(seeded.content, /^TODO list replaced\./);

  // Behind the tool's back (§2.2 row U): 3.7 → pending, 4.2 → in_progress.
  const legacy = readList(sid);
  legacy.items = legacy.items.map((item) =>
    item.id === ID_3_7
      ? { ...item, status: P }
      : item.id === ID_4_2
        ? { ...item, status: I }
        : item,
  );
  writeList(sid, legacy);

  const before = readList(sid);
  const bytesBefore = rawStore(sid);

  // 3.7 is the item THIS CALL starts: it is named first, and the two refusals
  // of the already-invalid 4.2 come after it — never before.
  const res = await call(
    { op: "update", items: [{ id: ID_3_7, status: I }] },
    sid,
  );
  assert.equal(
    res.content,
    "ERROR: cannot start 3.7: 4.2 is still in progress.\n" +
      "ERROR: cannot start 4.2: 3 is still in progress.\n" +
      "ERROR: cannot start 4.2: 4.1, 4 are not in progress.\n" +
      NOTHING_CHANGED,
  );
  assert.deepEqual(readList(sid), before, "readList must deep-equal the pre-state");
  assert.equal(rawStore(sid), bytesBefore, "store bytes must be untouched");

  const view = await call({ op: "read" }, sid);
  assert.equal(rowOf(view.content, "4.2").glyph, "[~]", "4.2 keeps running");
  assert.equal(rowOf(view.content, "3.7").glyph, "[ ]", "3.7 stays pending");
  assert.equal(tmpLeft(sid), false, "no .tmp may be left behind");
});

// --- T19 -----------------------------------------------------------------

test("T19 one update starting two conflicting items: one line per offender", async () => {
  useHome();
  const sid = "t19";
  const seeded = await call(
    {
      op: "write",
      items: [
        li(0, C, "root one"), //   1
        li(0, I, "two"), //       2   level 0
        li(1, I, "two one"), //   2.1 level 1  (id 3)
        li(1, P, "two two"), //   2.2 (id 4)
        li(1, P, "two three"), // 2.3 (id 5)
      ],
    },
    sid,
  );
  assert.match(seeded.content, /^TODO list replaced\./);

  const before = readList(sid);
  const bytesBefore = rawStore(sid);

  // Both starts: 2.2 offends against the running 2.1; 2.3 offends against 2.2
  // and 2.1 (nearest first, de-duplicated).
  const res = await call(
    {
      op: "update",
      items: [
        { id: 4, status: I },
        { id: 5, status: I },
      ],
    },
    sid,
  );
  assert.equal(
    res.content,
    "ERROR: cannot start 2.2: 2.1 is still in progress.\n" +
      "ERROR: cannot start 2.3: 2.2, 2.1 are still in progress.\n" +
      NOTHING_CHANGED,
  );
  assert.deepEqual(readList(sid), before, "readList must deep-equal the pre-state");
  assert.equal(rawStore(sid), bytesBefore, "store bytes must be untouched");
  assert.equal(tmpLeft(sid), false, "no .tmp may be left behind");
});

// --- T20 (was T17) --------------------------------------------------------

test("T20 write with three in-progress roots: later item is the offender", async () => {
  useHome();
  const sid = "t20";
  const res = await call(
    {
      op: "write",
      items: [li(0, I, "one"), li(0, I, "two"), li(0, I, "three")],
    },
    sid,
  );
  assert.equal(
    res.content,
    "ERROR: cannot start 2: 1 is still in progress.\n" +
      "ERROR: cannot start 3: 2, 1 are still in progress.\n" +
      NOTHING_CHANGED,
  );
  assert.equal(fs.existsSync(filePathFor(sid)), false, "no file may be written");
  assert.equal(tmpLeft(sid), false, "no .tmp may be left behind");
});

// --- T21 (fallback: neither member started) -------------------------------

test("T21 fallback — remove re-clamps 1.1.1 next to 2.1, later item is the offender", async () => {
  useHome();
  const sid = "t21";
  // §6 writes this fixture with `write`, but that pre-state is ILLEGAL under
  // §2 (a `pending` ancestor `1.1` precedes the running `1.1.1`, row B/M), so
  // the store is seeded behind the tool's back — exactly like T12/T18. The
  // candidate after the removal is the one §4.1(b) specifies.
  writeList(sid, {
    sessionID: sid,
    nextId: 6,
    items: [
      { id: 1, content: "one", status: I, priority: "medium", depth: 0 }, //      1
      { id: 2, content: "one one", status: P, priority: "medium", depth: 1 }, //  1.1 (removed)
      { id: 3, content: "deep", status: I, priority: "medium", depth: 2 }, //     1.1.1
      { id: 4, content: "two", status: P, priority: "medium", depth: 0 }, //      2
      { id: 5, content: "two one", status: I, priority: "medium", depth: 1 }, //  2.1
    ],
  });

  const before = readList(sid);
  const bytesBefore = rawStore(sid);

  // Removing id 2 re-clamps the deep item from 1.1.1 to 1.1, next to the
  // running 2.1. `remove` starts nothing → fallback: later item = offender.
  const res = await call({ op: "remove", items: [{ id: 2 }] }, sid);
  assert.equal(
    res.content,
    "ERROR: cannot start 2.1: 1.1, 1 are still in progress.\n" +
      "ERROR: cannot start 2.1: 2 is not in progress.\n" +
      NOTHING_CHANGED,
  );
  assert.deepEqual(readList(sid), before, "readList must deep-equal the pre-state");
  assert.equal(rawStore(sid), bytesBefore, "store bytes must be untouched");

  const view = await call({ op: "read" }, sid);
  assert.deepEqual(rowById(view.content, 2), {
    id: 2,
    glyph: "[ ]",
    number: "1.1",
  });
  assert.equal(tmpLeft(sid), false, "no .tmp may be left behind");
});

// =========================================================================
// §9 — no silent failure (T22–T30)
// =========================================================================

const isRoot = () => typeof process.getuid === "function" && process.getuid() === 0;

const storeDir = () => path.dirname(filePathFor("x"));

function writeRawFile(sid, text) {
  const file = filePathFor(sid);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf-8");
  return file;
}

const CORRUPT_BYTES = '{"items": [ {\n';
const CORRUPT_TAIL_MUTATE =
  'Nothing was changed. Run op "clear" to discard it (its data cannot be ' +
  "recovered), or repair the file by hand.";
const CORRUPT_TAIL_READ =
  'Nothing was read. Run op "clear" to discard it (its data cannot be ' +
  "recovered), or repair the file by hand.";

// --- T22 -----------------------------------------------------------------

test("T22 corrupt store is not overwritten (F1)", async () => {
  useHome();
  const sid = "t22";
  const file = writeRawFile(sid, CORRUPT_BYTES);

  const read = await call({ op: "read" }, sid);
  assert.match(
    read.content,
    /^ERROR: the stored list for this session is corrupt \(/,
  );
  assert.ok(read.content.endsWith(CORRUPT_TAIL_READ), read.content);
  assert.equal(fs.readFileSync(file, "utf-8"), CORRUPT_BYTES);

  const attempts = [
    { op: "update", items: [{ id: 1, content: "x" }] },
    { op: "add", items: [li(0, P, "x")] },
    { op: "write", items: [li(0, P, "x")] },
    { op: "remove", items: [{ id: 1 }] },
  ];
  for (const input of attempts) {
    const res = await call(input, sid);
    assert.match(
      res.content,
      /^ERROR: the stored list for this session is corrupt \(/,
      `${input.op}: ${res.content}`,
    );
    assert.ok(res.content.endsWith(CORRUPT_TAIL_MUTATE), `${input.op}: ${res.content}`);
    assert.equal(
      fs.readFileSync(file, "utf-8"),
      CORRUPT_BYTES,
      `${input.op} must not rewrite a corrupt store`,
    );
  }

  const cleared = await call({ op: "clear" }, sid);
  assert.equal(
    cleared.content,
    "TODO: removed the corrupt list file for this session (it could not be parsed).",
  );
  assert.equal(fs.existsSync(file), false);
});

// --- T23 -----------------------------------------------------------------

test("T23 unreadable store refuses read and mutations (F1)", async (t) => {
  if (isRoot()) {
    t.skip("chmod-based row cannot run as root");
    return;
  }
  useHome();
  const sid = "t23";
  const seeded = await call({ op: "write", items: [li(0, P, "one")] }, sid);
  assert.match(seeded.content, /^TODO list replaced\./);
  const file = filePathFor(sid);
  const bytes = fs.readFileSync(file, "utf-8");
  fs.chmodSync(file, 0o000);
  try {
    const read = await call({ op: "read" }, sid);
    assert.match(
      read.content,
      /^ERROR: the stored list for this session could not be read \(/,
    );
    assert.match(read.content, /: (EACCES|EPERM)/);
    assert.ok(
      read.content.endsWith(
        'Nothing was read. Fix the permissions, or run op "clear" to discard it.',
      ),
      read.content,
    );

    const res = await call({ op: "remove", items: [{ id: 1 }] }, sid);
    assert.match(
      res.content,
      /^ERROR: the stored list for this session could not be read \(/,
    );
    assert.ok(
      res.content.endsWith(
        'Nothing was changed. Fix the permissions, or run op "clear" to discard it.',
      ),
      res.content,
    );
  } finally {
    fs.chmodSync(file, 0o600);
  }
  assert.equal(fs.readFileSync(file, "utf-8"), bytes);
});

// --- T23b ----------------------------------------------------------------

test("T23b write failure is reported and nothing is persisted (F12)", async (t) => {
  if (isRoot()) {
    t.skip("chmod-based row cannot run as root");
    return;
  }
  useHome();
  const sid = "t23b";
  const seeded = await call({ op: "write", items: [li(0, P, "original")] }, sid);
  assert.match(seeded.content, /^TODO list replaced\./);
  const file = filePathFor(sid);
  const dir = path.dirname(file);
  const bytes = fs.readFileSync(file, "utf-8");
  fs.chmodSync(dir, 0o500);
  try {
    const res = await call({ op: "write", items: [li(0, P, "replacement")] }, sid);
    assert.match(res.content, /^ERROR: todo write failed: /, res.content);
    assert.match(
      res.content,
      /Nothing was changed \(writes are atomic: a leftover ".*\.tmp" can be deleted safely\)\.$/,
    );
  } finally {
    fs.chmodSync(dir, 0o700);
  }
  assert.equal(fs.readFileSync(file, "utf-8"), bytes);
});

// --- T24 -----------------------------------------------------------------

test("T24 read announces an inconsistent list (F10)", async () => {
  useHome();
  const sid = "t24";
  writeList(sid, {
    sessionID: sid,
    nextId: 3,
    items: [
      { id: 1, content: "one", status: I, priority: "medium", depth: 0 },
      { id: 2, content: "two", status: I, priority: "medium", depth: 0 },
    ],
  });
  const res = await call({ op: "read" }, sid);
  assert.match(res.content, /^TODO: 2 items/);
  assert.ok(
    res.content.endsWith(
      "issues: list is in an invalid state — 2 is in progress while 1 is " +
        "still in progress; mutating ops will refuse until every item before " +
        "an in-progress item is closed or is one of its in-progress ancestors.",
    ),
    res.content,
  );
});

// --- T25 -----------------------------------------------------------------

test("T25 multi-change update refused whole itemises the discarded changes (F9)", async () => {
  useHome();
  const sid = "t25";
  const seeded = await call({ op: "write", items: FOUR_TWO_PRE_C }, sid);
  assert.match(seeded.content, /^TODO list replaced\./);
  const file = filePathFor(sid);
  const bytes = fs.readFileSync(file, "utf-8");

  const res = await call(
    {
      op: "update",
      items: [
        { id: 5, content: "renamed" },
        { id: 13, status: I },
        { id: 8, priority: "high" },
      ],
    },
    sid,
  );
  assert.equal(
    res.content,
    "ERROR: cannot start 4.2: 3.7, 3 are still in progress.\n" +
      "ERROR: cannot start 4.2: 4.1, 4 are not in progress.\n" +
      "refused whole: 2 other requested changes were not applied " +
      "(id 5 content, id 8 priority).\n" +
      NOTHING_CHANGED,
  );
  assert.equal(fs.readFileSync(file, "utf-8"), bytes, "store must be byte-identical");
  const stored = readList(sid);
  assert.equal(stored.items.find((item) => item.id === 5).content, "three two");
  assert.equal(stored.items.find((item) => item.id === 8).priority, "medium");
});

// --- T26 -----------------------------------------------------------------

test("T26 write with only-rejected items must not clear (F7)", async () => {
  useHome();
  const sid = "t26";
  const seeded = await call({ op: "write", items: [li(0, P, "keep me")] }, sid);
  assert.match(seeded.content, /^TODO list replaced\./);
  const file = filePathFor(sid);
  const bytes = fs.readFileSync(file, "utf-8");

  const res = await call({ op: "write", items: [{ content: "" }] }, sid);
  assert.equal(
    res.content,
    "ERROR: nothing valid to write: every item in the request was rejected.\n" +
      "issues: skipped an item with no content\n" +
      NOTHING_CHANGED,
  );
  assert.equal(fs.readFileSync(file, "utf-8"), bytes, "the list must survive");
  const kept = readList(sid);
  assert.equal(kept.items.length, 1);
  assert.equal(kept.items[0].content, "keep me");
});

// --- T27 -----------------------------------------------------------------

test("T27 id / after / prefix normalization is reported (F3/F5/F6)", async () => {
  useHome();
  const a = await call(
    {
      op: "write",
      items: [
        { id: 5, content: "five" },
        { id: 6, content: "six" },
        { id: 6, content: "six duplicate" },
        { content: "1.1) milk" },
        { content: "after string", after: "3" },
      ],
    },
    "t27a",
  );
  assert.match(a.content, /^TODO list replaced\./);
  assert.ok(
    a.content.includes(
      "issues: id 6 was already used by an item in this request — assigned id 7 " +
        'instead; id 8: removed the "1.1)" prefix from the text — numbering is ' +
        'generated; id 9: "after" must be a positive integer (got "3") — appended ' +
        "at the end",
    ),
    a.content,
  );

  const b = await call(
    {
      op: "write",
      items: [
        { id: 5, content: "five" },
        { id: 6, content: "six" },
        { id: 0, content: "zero" },
      ],
    },
    "t27b",
  );
  assert.match(b.content, /^TODO list replaced\./);
  assert.ok(
    b.content.includes(
      "issues: id 0 is not a positive integer — assigned id 7 instead",
    ),
    b.content,
  );
});

// --- T28 -----------------------------------------------------------------

test("T28 legacy prefix: read note + update report (F3/F4)", async () => {
  useHome();
  const sid = "t28";
  writeList(sid, {
    sessionID: sid,
    nextId: 2,
    items: [
      { id: 1, content: "1.1) Buy milk", status: P, priority: "medium", depth: 1 },
    ],
  });

  const read = await call({ op: "read" }, sid);
  assert.match(read.content, /^1: \[ \] 1\) Buy milk$/m, read.content);
  assert.ok(
    read.content.endsWith(
      "issues: 1 items store a legacy numbered prefix; the display omits it — " +
        "rewrite those texts without the prefix to clear this note.",
    ),
    read.content,
  );

  const upd = await call(
    { op: "update", items: [{ id: 1, content: "2) Other" }] },
    sid,
  );
  assert.match(upd.content, /^TODO updated \(1 change\)\./, upd.content);
  assert.ok(
    upd.content.includes(
      'issues: id 1: removed the "2)" prefix from the text — numbering is generated',
    ),
    upd.content,
  );
  assert.equal(readList(sid).items[0].content, "Other");
});

// --- T29 -----------------------------------------------------------------

test("T29 absent vs empty vs cleared (F2/F8)", async () => {
  useHome();
  const sid = "t29";

  const first = await call({ op: "read" }, sid);
  assert.equal(first.content, "TODO: no list for this session yet.");

  writeRawFile(
    sid,
    `${JSON.stringify({ sessionID: sid, nextId: 1, items: [] }, null, 2)}\n`,
  );
  const second = await call({ op: "read" }, sid);
  assert.equal(
    second.content,
    "TODO: the list for this session is empty (the file exists and holds no items).",
  );

  const cleared = await call({ op: "clear" }, sid);
  assert.equal(
    cleared.content,
    "TODO: the list for this session was already empty (file removed).",
  );

  const again = await call({ op: "clear" }, sid);
  assert.equal(again.content, "TODO: no list for this session — nothing to clear.");
});

// --- T30 -----------------------------------------------------------------

test("T30 the context hook announces an unreadable store (F11)", async () => {
  useHome();
  const sid = "t30";
  writeRawFile(sid, CORRUPT_BYTES);
  const system = [];
  await hook({ sessionID: sid, system });
  assert.deepEqual(system, [
    {
      type: "text",
      text:
        'TODO: list unreadable (corrupt store) — run the todo tool op "read" for details.',
    },
  ]);
});

// --- rule B (v0.3.4): a closed item may not keep an open descendant ---------

test("T32 a closed parent may not keep an open child (the USER's case)", async () => {
  useHome();
  const sid = "t32";

  // (a) `write [C@0, P@1]` — the pending child sits under the closed root.
  const closedPending = await call(
    { op: "write", items: [li(0, C, "one"), li(1, P, "one one")] },
    sid,
  );
  assert.equal(
    closedPending.content,
    "ERROR: cannot close 1: 1.1 is still open.\n" + NOTHING_CHANGED,
  );
  assert.equal(readList(sid), null, "no file may be written by a refused write");

  // (b) `write [C@0, I@1]` — rule A PASSES this pair (1 is closed); only rule B
  // refuses, which is the whole point of the new law (§2.2 N2).
  const closedRunning = await call(
    { op: "write", items: [li(0, C, "one"), li(1, I, "one one")] },
    sid,
  );
  assert.equal(
    closedRunning.content,
    "ERROR: cannot close 1: 1.1 is still open.\n" + NOTHING_CHANGED,
  );
  assert.equal(readList(sid), null, "no file may be written by a refused write");

  // (c) a legal running chain, then the parent is closed under the running child.
  const seeded = await call(
    { op: "write", items: [li(0, I, "one"), li(1, I, "one one")] },
    sid,
  );
  assert.match(seeded.content, /^TODO list replaced\./);
  const before = readList(sid);
  const bytesBefore = rawStore(sid);
  const completed = await call(
    { op: "update", items: [{ id: 1, status: C }] },
    sid,
  );
  assert.equal(
    completed.content,
    "ERROR: cannot close 1: 1.1 is still open.\n" + NOTHING_CHANGED,
  );
  assert.deepEqual(readList(sid), before, "readList must deep-equal the pre-state");
  assert.equal(rawStore(sid), bytesBefore, "store bytes must be untouched");
  assert.equal(tmpLeft(sid), false, "no .tmp may be left behind");

  // (d) `cancelled` is a close too — the same single line, nothing written.
  const cancelled = await call(
    { op: "update", items: [{ id: 1, status: X }] },
    sid,
  );
  assert.equal(
    cancelled.content,
    "ERROR: cannot close 1: 1.1 is still open.\n" + NOTHING_CHANGED,
  );
  assert.deepEqual(readList(sid), before, "readList must deep-equal the pre-state");
  assert.equal(rawStore(sid), bytesBefore, "store bytes must be untouched");

  // (e) the same illegal state written behind the tool's back is announced.
  writeList(sid, {
    sessionID: sid,
    nextId: 3,
    items: [
      { id: 1, content: "one", status: C, priority: "medium", depth: 0 },
      { id: 2, content: "one one", status: P, priority: "medium", depth: 1 },
    ],
  });
  const dump = await call({ op: "read" }, sid);
  assert.match(dump.content, /^1: \[x\] 1\) one$/m);
  assert.match(dump.content, /^2: \[ \] 1\.1\) one one$/m);
  assert.equal(
    dump.content.split("\n").pop(),
    "issues: list is in an invalid state — 1 is closed while 1.1 is still " +
      "open; mutating ops will refuse until every descendant of a closed item " +
      "is closed too.",
  );
});

test("T33 deep chain: a closed root over a pending branch, fixed bottom-up", async () => {
  useHome();
  const sid = "t33";
  // The §6 fixture itself: `3` already closed over three open descendants — the
  // `write` is refused whole and leaves no file behind.
  const refusedFixture = await call(
    {
      op: "write",
      items: [
        li(0, C, "root one"), //      1
        li(0, C, "root two"), //      2
        li(0, C, "three"), //         3  — closed over an open branch
        li(1, P, "three one"), //     3.1
        li(2, P, "three one one"), // 3.1.1
        li(2, P, "three one two"), // 3.1.2
      ],
    },
    sid,
  );
  assert.equal(
    refusedFixture.content,
    "ERROR: cannot close 3: 3.1, 3.1.1, 3.1.2 are still open.\n" + NOTHING_CHANGED,
  );
  assert.equal(readList(sid), null, "no file may be written by a refused write");
  // A LEGAL seed with the same six ids as the §6 fixture (`3` not yet closed):
  // 1, 2 closed roots; 3 and 3.1 IN PROGRESS with 3.1.1 / 3.1.2 pending below
  // them. Re-derived for v0.3.5: closing a leaf under a PENDING ancestor is rule
  // C's violation (T48), so the bottom-up escape starts the chain first — every
  // assertion above (deep chain refused, then closed bottom-up) is preserved.
  // §6 T33's own escape cannot follow the refused `write` (nothing was written,
  // so there is no store to update) and, applied to the fixture's statuses,
  // closing a leaf under two pending ancestors is itself the §4.1(h) refusal.
  // The running seed below is the lawful route: Y7 (bottom-up close under a
  // running parent) for each of 3.1.2, 3.1.1, 3.1, then the all-closed write.
  const seeded = await call(
    {
      op: "write",
      items: [
        li(0, C, "root one"), //     1
        li(0, C, "root two"), //     2
        li(0, I, "three"), //        3
        li(1, I, "three one"), //    3.1     (id 4)
        li(2, P, "three one one"), // 3.1.1  (id 5)
        li(2, P, "three one two"), // 3.1.2  (id 6)
      ],
    },
    sid,
  );
  assert.match(seeded.content, /^TODO list replaced\./);

  // The seed is intact — the refused write never reached the file.
  const afterSeed = await call({ op: "read" }, sid);
  assert.deepEqual(rowById(afterSeed.content, 3), {
    id: 3,
    glyph: "[~]",
    number: "3",
  });

  // The law-true escape, bottom-up — every step accepted.
  for (const id of [6, 5, 4]) {
    const closed = await call(
      { op: "update", items: [{ id, status: C }] },
      sid,
    );
    assert.match(closed.content, /^TODO updated \(1 change\)\./);
  }

  // Only now is the same write legal — its candidate is all closed.
  const closedAfter = await call(
    {
      op: "write",
      items: [
        li(0, C, "root one"),
        li(0, C, "root two"),
        li(0, C, "three"),
        li(1, C, "three one"),
        li(2, C, "three one one"),
        li(2, C, "three one two"),
      ],
    },
    sid,
  );
  assert.match(closedAfter.content, /^TODO list replaced\./);
});

test("T34 the closes that stay legal (bottom-up, cancelled child, removed child)", async () => {
  useHome();

  // (a) a closed child under a closed parent — completed and cancelled alike.
  const completedAll = await call(
    { op: "write", items: [li(0, C, "one"), li(1, C, "one one")] },
    "t34a",
  );
  assert.match(completedAll.content, /^TODO list replaced\./);
  const cancelledChild = await call(
    { op: "write", items: [li(0, C, "one"), li(1, X, "one one")] },
    "t34b",
  );
  assert.match(cancelledChild.content, /^TODO list replaced\./);

  // (b) bottom-up close from running: the child closes while the parent runs.
  const running = await call(
    { op: "write", items: [li(0, I, "one"), li(1, I, "one one")] },
    "t34c",
  );
  assert.match(running.content, /^TODO list replaced\./);
  const childFirst = await call(
    { op: "update", items: [{ id: 2, status: C }] },
    "t34c",
  );
  assert.match(childFirst.content, /^TODO updated \(1 change\)\./);
  const parentAfter = await call(
    { op: "update", items: [{ id: 1, status: C }] },
    "t34c",
  );
  assert.match(parentAfter.content, /^TODO updated \(1 change\)\./);

  // (c) bottom-up close after starting a pending chain. Re-derived for v0.3.5:
  // closing `1.1` under a PENDING `1` is rule C's violation (T48), so the
  // ancestor starts first — then the same bottom-up close is legal (§2.2:
  // Y3 `[P@0, C@1]` is illegal, Y7 `[I@0, C@1]` is the legal bottom-up close;
  // text pinned character for character by §4.1(h)).
  const pending = await call(
    { op: "write", items: [li(0, P, "one"), li(1, P, "one one")] },
    "t34d",
  );
  assert.match(pending.content, /^TODO list replaced\./);
  const started = await call(
    { op: "update", items: [{ id: 1, status: I }] },
    "t34d",
  );
  assert.match(started.content, /^TODO updated \(1 change\)\./);
  const childClosed = await call(
    { op: "update", items: [{ id: 2, status: C }] },
    "t34d",
  );
  assert.match(childClosed.content, /^TODO updated \(1 change\)\./);
  const parentClosed = await call(
    { op: "update", items: [{ id: 1, status: C }] },
    "t34d",
  );
  assert.match(parentClosed.content, /^TODO updated \(1 change\)\./);

  // (d) removing the open descendant first makes the parent's close legal.
  const removable = await call(
    { op: "write", items: [li(0, P, "one"), li(1, P, "one one")] },
    "t34e",
  );
  assert.match(removable.content, /^TODO list replaced\./);
  const childRemoved = await call({ op: "remove", items: [{ id: 2 }] }, "t34e");
  assert.match(childRemoved.content, /^TODO updated \(items removed\)\./);
  const thenClosed = await call(
    { op: "update", items: [{ id: 1, status: C }] },
    "t34e",
  );
  assert.match(thenClosed.content, /^TODO updated \(1 change\)\./);
});

test("T35 a remove that re-parents an open item under a closed one is refused", async () => {
  useHome();
  const sid = "t35";
  // Re-derived for v0.3.5: the root is `in_progress` (a `pending` `1` above a
  // completed `1.1` would already violate rule C). `1.1` is closed and has no
  // descendant of its own, so the seed is legal; T35's text is unchanged.
  const seeded = await call(
    {
      op: "write",
      items: [li(0, I, "one"), li(1, C, "one one"), li(1, P, "one two")],
    },
    sid,
  );
  assert.match(seeded.content, /^TODO list replaced\./);
  assert.deepEqual(
    rows(seeded.content).map((row) => row.number),
    ["1", "1.1", "1.2"],
  );

  const before = readList(sid);
  const bytesBefore = rawStore(sid);
  // Removing `1` re-clamps the closed `1.1` to the top — the pending `1.2`
  // becomes its `1.1`. `remove` closes nothing, yet the close rule refuses it.
  const refused = await call({ op: "remove", items: [{ id: 1 }] }, sid);
  assert.equal(
    refused.content,
    "ERROR: cannot close 1: 1.1 is still open.\n" + NOTHING_CHANGED,
  );
  assert.deepEqual(readList(sid), before, "readList must deep-equal the pre-state");
  assert.equal(rawStore(sid), bytesBefore, "store bytes must be untouched");
  assert.equal(tmpLeft(sid), false, "no .tmp may be left behind");

  // §2.1 fourth property: `closes` is a DECLARATION, not a selector — the same
  // candidate yields the identical violations with `closes` empty and with
  // `closes` naming the closed offender.
  // The candidate is literally the post-removal list: the closed `1.1` re-clamped
  // to the top (`C@0`, id 2 → number `1`) and the pending `1.2` becoming `1.1`.
  const candidate = [
    { id: 2, content: "one one", status: C, priority: "medium", depth: 0 },
    { id: 3, content: "one two", status: P, priority: "medium", depth: 1 },
  ];
  assert.deepEqual(
    findOrderingViolations(candidate, new Set(), new Set([2])),
    findOrderingViolations(candidate),
  );
  assert.equal(
    formatOrderingRejection(
      findOrderingViolations(candidate, new Set(), new Set([2])),
    ),
    "ERROR: cannot close 1: 1.1 is still open.\n" + NOTHING_CHANGED,
  );

  // Escape: remove the open descendant first, then the parent.
  const childRemoved = await call({ op: "remove", items: [{ id: 3 }] }, sid);
  assert.match(childRemoved.content, /^TODO updated \(items removed\)\./);
  const parentRemoved = await call({ op: "remove", items: [{ id: 1 }] }, sid);
  assert.match(parentRemoved.content, /^TODO updated \(items removed\)\./);
});

// --- rule C (v0.3.5): a pending item may not keep a CLOSED descendant ------
//
// Rows T36–T51, contract: spec-ordering.md §6 (the T36–T51 table), with
//   §2 rule C, §2.2 rows Y3/Y4/Y7/Y15/Y17–Y24 and P2, §3 (the four-op mechanism
//   table), §4 (exact wording and group order), §4.1 (the `reverts` set and
//   attribution). The expected strings are §4's, character for character.
//
// Rule C: an item may be `pending` only while every descendant is `pending`.
// Offender = the PENDING item; blockers = its CLOSED descendants. `cancelled`
// counts as closed (as in rule B). These rows are RED on v0.3.4 (rules A+B only)
// except the guard rows T46/T47/T49, which pin that the fix does not over-refuse
// (T47 and T49 must stay green before AND after; T46 compares identical arrays).

test("T36 a completed item reverted to pending over a closed child is refused", async () => {
  useHome();
  const sid = "t36";
  // Legal seed (N5): both closed, bottom-up already done.
  const seeded = await call(
    { op: "write", items: [li(0, C, "one"), li(1, C, "one one")] },
    sid,
  );
  assert.match(seeded.content, /^TODO list replaced\./);
  const before = readList(sid);
  const bytesBefore = rawStore(sid);

  // The USER's case: "como que o 1 pode nao ter comecado se o 1.1 concluiu".
  const reverted = await call(
    { op: "update", items: [{ id: 1, status: P }] },
    sid,
  );
  assert.equal(
    reverted.content,
    "ERROR: cannot revert 1 to pending: 1.1 is already closed.\n" +
      NOTHING_CHANGED,
  );
  assert.deepEqual(readList(sid), before, "readList must deep-equal the pre-state");
  assert.equal(rawStore(sid), bytesBefore, "store bytes must be untouched");
  assert.equal(tmpLeft(sid), false, "no .tmp may be left behind");

  // The refusal changed nothing the user sees: both rows are still closed.
  const view = await call({ op: "read" }, sid);
  assert.equal(rowOf(view.content, "1").glyph, "[x]");
  assert.equal(rowOf(view.content, "1.1").glyph, "[x]");
});

test("T37 a cancelled descendant blocks the revert too (Y4)", async () => {
  useHome();
  const sid = "t37";
  // Legal seed (N4): `1` completed, `1.1` cancelled — closed under closed.
  const seeded = await call(
    { op: "write", items: [li(0, C, "one"), li(1, X, "one one")] },
    sid,
  );
  assert.match(seeded.content, /^TODO list replaced\./);
  const before = readList(sid);
  const bytesBefore = rawStore(sid);

  const reverted = await call(
    { op: "update", items: [{ id: 1, status: P }] },
    sid,
  );
  assert.equal(
    reverted.content,
    "ERROR: cannot revert 1 to pending: 1.1 is already closed.\n" +
      NOTHING_CHANGED,
  );
  assert.deepEqual(readList(sid), before, "readList must deep-equal the pre-state");
  assert.equal(rawStore(sid), bytesBefore, "store bytes must be untouched");
  assert.equal(tmpLeft(sid), false, "no .tmp may be left behind");
});

test("T38 revert from in_progress over a closed child is refused (Y7→Y3)", async () => {
  useHome();
  const sid = "t38";
  // Legal seed (Y7): started parent with a closed child (bottom-up close).
  const seeded = await call(
    { op: "write", items: [li(0, I, "one"), li(1, C, "one one")] },
    sid,
  );
  assert.match(seeded.content, /^TODO list replaced\./);
  const before = readList(sid);
  const bytesBefore = rawStore(sid);

  // `in_progress → pending` is a revert (§4.1), not a fresh state.
  const reverted = await call(
    { op: "update", items: [{ id: 1, status: P }] },
    sid,
  );
  assert.equal(
    reverted.content,
    "ERROR: cannot revert 1 to pending: 1.1 is already closed.\n" +
      NOTHING_CHANGED,
  );
  assert.deepEqual(readList(sid), before, "readList must deep-equal the pre-state");
  assert.equal(rawStore(sid), bytesBefore, "store bytes must be untouched");
  const view = await call({ op: "read" }, sid);
  assert.equal(rowOf(view.content, "1").glyph, "[~]", "1 must still be running");
});

test("T39 reverting a cancelled item over a closed child is refused (Y15→Y3)", async () => {
  useHome();
  const sid = "t39";
  // Legal seed (Y15): a closed descendant does not constrain a cancelled root.
  const seeded = await call(
    { op: "write", items: [li(0, X, "one"), li(1, C, "one one")] },
    sid,
  );
  assert.match(seeded.content, /^TODO list replaced\./);
  const before = readList(sid);
  const bytesBefore = rawStore(sid);

  // `cancelled → pending` is a revert, and rule C's antecedent is `pending`
  // only: the cancelled root was legal until the call asked for `pending`.
  const reverted = await call(
    { op: "update", items: [{ id: 1, status: P }] },
    sid,
  );
  assert.equal(
    reverted.content,
    "ERROR: cannot revert 1 to pending: 1.1 is already closed.\n" +
      NOTHING_CHANGED,
  );
  assert.deepEqual(readList(sid), before, "readList must deep-equal the pre-state");
  assert.equal(rawStore(sid), bytesBefore, "store bytes must be untouched");
  const view = await call({ op: "read" }, sid);
  assert.equal(rowOf(view.content, "1").glyph, "[!]", "1 must still be cancelled");
});

test("T40 write refuses a list arriving with a closed item under a pending one (Y3/Y4)", async () => {
  useHome();
  // `completed` and `cancelled` alike: both are closed for rule C.
  for (const [child, label] of [
    [C, "completed"],
    [X, "cancelled"],
  ]) {
    const sid = `t40-${label}`;
    const written = await call(
      { op: "write", items: [li(0, P, "one"), li(1, child, "one one")] },
      sid,
    );
    assert.equal(
      written.content,
      "ERROR: cannot revert 1 to pending: 1.1 is already closed.\n" +
        NOTHING_CHANGED,
      `a ${label} child under a pending root must be refused`,
    );
    assert.equal(
      readList(sid),
      null,
      "no file may be written by a refused write",
    );
    assert.equal(tmpLeft(sid), false, "no .tmp may be left behind");
  }
});

test("T41 deep chain: every pending ancestor of a closed leaf is an offender", async () => {
  useHome();
  const sid = "t41";
  // Y17: `1.1.1` completed under two pending ancestors.
  const written = await call(
    {
      op: "write",
      items: [li(0, P, "one"), li(1, P, "one one"), li(2, C, "leaf")],
    },
    sid,
  );
  assert.equal(
    written.content,
    "ERROR: cannot revert 1 to pending: 1.1.1 is already closed.\n" +
      "ERROR: cannot revert 1.1 to pending: 1.1.1 is already closed.\n" +
      NOTHING_CHANGED,
  );
  assert.equal(readList(sid), null);
});

test("T42 B and C on one candidate — line order follows candidate order", async () => {
  useHome();

  // (a) Y19: offender 1 (B) sits before offender 1.1 (C).
  const a = await call(
    {
      op: "write",
      items: [li(0, C, "one"), li(1, P, "one one"), li(2, C, "leaf")],
    },
    "t42a",
  );
  assert.equal(
    a.content,
    "ERROR: cannot close 1: 1.1 is still open.\n" +
      "ERROR: cannot revert 1.1 to pending: 1.1.1 is already closed.\n" +
      NOTHING_CHANGED,
  );
  assert.equal(readList("t42a"), null);

  // (b) Y20: the same two rules with the statuses reversed — the C line is
  // first because offender 1 sits first, never because of the rule number.
  const b = await call(
    {
      op: "write",
      items: [li(0, P, "one"), li(1, C, "one one"), li(2, P, "leaf")],
    },
    "t42b",
  );
  assert.equal(
    b.content,
    "ERROR: cannot revert 1 to pending: 1.1 is already closed.\n" +
      "ERROR: cannot close 1.1: 1.1.1 is still open.\n" +
      NOTHING_CHANGED,
  );
  assert.equal(readList("t42b"), null);
});

test("T43 two closed descendants under one pending item are listed in full", async () => {
  useHome();
  const sid = "t43";
  // Y24: plural, nearest-first, de-duplicated.
  const written = await call(
    {
      op: "write",
      items: [li(0, P, "one"), li(1, C, "one one"), li(2, C, "leaf")],
    },
    sid,
  );
  assert.equal(
    written.content,
    "ERROR: cannot revert 1 to pending: 1.1, 1.1.1 are already closed.\n" +
      NOTHING_CHANGED,
  );
  assert.equal(readList(sid), null);
});

test("T44 add re-parents a closed item under a new pending item — refused", async () => {
  useHome();
  const sid = "t44";
  // The §3 fixture: `[I@0, I@1, C@2]`; the new pending item is inserted after
  // id 2 at depth 1, so the closed item is renumbered to `1.2.1`.
  const seeded = await call(
    {
      op: "write",
      items: [li(0, I, "one"), li(1, I, "one one"), li(2, C, "leaf")],
    },
    sid,
  );
  assert.match(seeded.content, /^TODO list replaced\./);
  const before = readList(sid);
  const bytesBefore = rawStore(sid);

  const added = await call(
    {
      op: "add",
      // §6: insert a NEW pending item after `1.1` (id 2) at depth 1; the
      // existing closed `1.1.1` is renumbered to `1.2.1` under it.
      items: [{ content: "inserted", status: P, after: 2, depth: 1 }],
    },
    sid,
  );
  assert.equal(
    added.content,
    "ERROR: cannot revert 1.2 to pending: 1.2.1 is already closed.\n" +
      NOTHING_CHANGED,
  );
  assert.deepEqual(readList(sid), before, "nothing may be added by a refused add");
  assert.equal(rawStore(sid), bytesBefore);
  assert.equal(tmpLeft(sid), false);
});

test("T45 remove re-clamps a closed child under a pending item — refused", async () => {
  useHome();
  const sid = "t45";
  // The §3 fixture: `[I@0, P@1, C@1, C@2]` — legal as it stands (the closed
  // `1.2` keeps its own closed child `1.2.1`).
  const seeded = await call(
    {
      op: "write",
      items: [
        li(0, I, "one"),
        li(1, P, "one one"),
        li(1, C, "one two"),
        li(2, C, "leaf"),
      ],
    },
    sid,
  );
  assert.match(seeded.content, /^TODO list replaced\./);
  assert.deepEqual(
    rows(seeded.content).map((row) => row.number),
    ["1", "1.1", "1.2", "1.2.1"],
  );
  const before = readList(sid);
  const bytesBefore = rawStore(sid);

  // Removing `1.2` re-parents `1.2.1` to the pending `1.1` → candidate
  // `1, 1.1, 1.1.1(closed)`, which rule C refuses. `remove` reverts nothing.
  const removed = await call({ op: "remove", items: [{ id: 3 }] }, sid);
  assert.equal(
    removed.content,
    "ERROR: cannot revert 1.1 to pending: 1.1.1 is already closed.\n" +
      NOTHING_CHANGED,
  );
  assert.deepEqual(readList(sid), before);
  assert.equal(rawStore(sid), bytesBefore);
});

test("T46 reverts is a declaration, not a selector (§2.1 fifth property)", () => {
  // The T42(a) candidate: `1` closed over an open `1.1`, and `1.1` pending over
  // a closed `1.1.1` — two offenders, one per branch rule. Declaring the revert
  // (on either offender) must not change a verdict, a line or a blocker.
  const candidate = [
    { id: 1, content: "one", status: C, priority: "medium", depth: 0 },
    { id: 2, content: "one one", status: P, priority: "medium", depth: 1 },
    { id: 3, content: "leaf", status: C, priority: "medium", depth: 2 },
  ];
  const baseline = JSON.stringify(findOrderingViolations(candidate));
  assert.equal(
    JSON.stringify(
      findOrderingViolations(candidate, new Set(), new Set(), new Set([1])),
    ),
    baseline,
    "reverts {1} must not change the verdict",
  );
  assert.equal(
    JSON.stringify(
      findOrderingViolations(candidate, new Set(), new Set(), new Set([2])),
    ),
    baseline,
    "reverts {1.1} must not change the verdict",
  );
});

test("T47 the legal counterparts of the 4×4 matrix stay legal (Y1/Y5–Y8/Y11/Y12/Y15/Y16/Y21/Y22)", async () => {
  useHome();
  const legal = [
    ["Y1", [li(0, P, "one"), li(1, P, "one one")]],
    ["Y5", [li(0, I, "one"), li(1, P, "one one")]],
    ["Y6", [li(0, I, "one"), li(1, I, "one one")]],
    ["Y7", [li(0, I, "one"), li(1, C, "one one")]],
    ["Y8", [li(0, I, "one"), li(1, X, "one one")]],
    ["Y11", [li(0, C, "one"), li(1, C, "one one")]],
    ["Y12", [li(0, C, "one"), li(1, X, "one one")]],
    ["Y15", [li(0, X, "one"), li(1, C, "one one")]],
    ["Y16", [li(0, X, "one"), li(1, X, "one one")]],
    ["Y21", [li(0, I, "one"), li(1, I, "one one"), li(2, C, "leaf")]],
    ["Y22", [li(0, I, "one"), li(1, C, "one one"), li(2, C, "leaf")]],
  ];
  for (const [row, items] of legal) {
    const written = await call({ op: "write", items }, `t47-${row}`);
    assert.match(
      written.content,
      /^TODO list replaced\./,
      `${row} is a legal cell and must stay accepted`,
    );
  }

  // The two shapes a careless reading of rule C would wrongly refuse:
  // `I` + `P` (started parent, unstarted child) …
  const started = await call({ op: "read" }, "t47-Y5");
  assert.equal(rowOf(started.content, "1").glyph, "[~]");
  assert.equal(rowOf(started.content, "1.1").glyph, "[ ]");
  // … and `X` + `C` (a closed descendant does not constrain a cancelled root).
  const cancelledRoot = await call({ op: "read" }, "t47-Y15");
  assert.equal(rowOf(cancelledRoot.content, "1").glyph, "[!]");
  assert.equal(rowOf(cancelledRoot.content, "1.1").glyph, "[x]");

  // The deep legal chain with a closed leaf (Y21), glyph for glyph.
  const chain = await call({ op: "read" }, "t47-Y21");
  assert.deepEqual(
    rows(chain.content).map((row) => [row.number, row.glyph]),
    [
      ["1", "[~]"],
      ["1.1", "[~]"],
      ["1.1.1", "[x]"],
    ],
  );
});

test("T48 the way out of the descendant-side case (Y1 → start, then close)", async () => {
  useHome();
  const sid = "t48";

  // The accepted plan (Y1): both pending.
  const seeded = await call(
    { op: "write", items: [li(0, P, "one"), li(1, P, "one one")] },
    sid,
  );
  assert.match(seeded.content, /^TODO list replaced\./);
  const before = readList(sid);

  // (a) The mirror direction: the call closes `1.1`, yet the refused state is
  // `1`'s — so the line names `1`, never the item the call touched. Verdict and
  // text are §2.2 Y3 (`[P@0, C@1]` illegal) and §4.1(h), which pins this exact
  // shape for T48a: `cannot revert` is the state-class verb.
  const refused = await call(
    { op: "update", items: [{ id: 2, status: C }] },
    sid,
  );
  assert.equal(
    refused.content,
    "ERROR: cannot revert 1 to pending: 1.1 is already closed.\n" +
      NOTHING_CHANGED,
  );
  assert.deepEqual(readList(sid), before, "the refusal must not persist");

  // (b) Start the ancestor — accepted …
  const started = await call(
    { op: "update", items: [{ id: 1, status: I }] },
    sid,
  );
  assert.match(started.content, /^TODO updated \(1 change\)\./);
  // (c) … then the same close is accepted: C is about the state, not the gesture.
  const closedAfter = await call(
    { op: "update", items: [{ id: 2, status: C }] },
    sid,
  );
  assert.match(closedAfter.content, /^TODO updated \(1 change\)\./);

  const view = await call({ op: "read" }, sid);
  assert.equal(rowOf(view.content, "1").glyph, "[~]");
  assert.equal(rowOf(view.content, "1.1").glyph, "[x]");
});

test("T49 a C-violating legacy store is repairable by cancelling the branch (Y15)", async () => {
  useHome();
  const sid = "t49";
  // Written behind the tool's back: `1` pending over a completed `1.1` — the
  // exact state rule C forbids.
  writeList(sid, {
    sessionID: sid,
    nextId: 3,
    items: [
      { id: 1, content: "one", status: P, priority: "medium", depth: 0 },
      { id: 2, content: "one one", status: C, priority: "medium", depth: 1 },
    ],
  });

  // §7/§9.2 F10: a store that violates ONLY rule C is announced, never read in
  // silence — the fourth clause of the inconsistency note.
  const broken = await call({ op: "read" }, sid);
  assert.match(
    broken.content,
    /^issues: list is in an invalid state — 1 is pending while 1\.1 is already closed; mutating ops will refuse until every descendant of a pending item is pending too\.$/m,
  );

  // Cancelling the branch root makes the candidate legal (Y15): a closed
  // descendant does not constrain a cancelled ancestor.
  const repaired = await call(
    { op: "update", items: [{ id: 1, status: X }] },
    sid,
  );
  assert.match(repaired.content, /^TODO updated \(1 change\)\./);

  const view = await call({ op: "read" }, sid);
  assert.equal(rowOf(view.content, "1").glyph, "[!]");
  assert.equal(rowOf(view.content, "1.1").glyph, "[x]");
  // The repair is complete: the dump carries no inconsistency note any more.
  assert.doesNotMatch(view.content, /^issues: list is in an invalid state/m);
});

test("T50 a depth move lands a closed item under a pending ancestor — refused", async () => {
  useHome();
  const sid = "t50";
  // Accepted seed: `1` running, `1.1` pending, `1.2` closed (§6).
  const seeded = await call(
    {
      op: "write",
      items: [li(0, I, "one"), li(1, P, "one one"), li(1, C, "one two")],
    },
    sid,
  );
  assert.match(seeded.content, /^TODO list replaced\./);
  assert.deepEqual(
    rows(seeded.content).map((row) => row.number),
    ["1", "1.1", "1.2"],
  );
  const before = readList(sid);
  const bytesBefore = rawStore(sid);

  // Moving `1.2` to depth 2 re-parents it under the pending `1.1`: the single
  // offender is `1.1` (its root `1` is in progress, not pending), exactly as
  // §6 T50 states. No `refused whole:` line follows: the only change this call
  // made is the depth move on the blocker itself, so nothing non-offending was
  // discarded (§9.1 F9).
  const moved = await call({ op: "update", items: [{ id: 3, depth: 2 }] }, sid);
  assert.equal(
    moved.content,
    "ERROR: cannot revert 1.1 to pending: 1.1.1 is already closed.\n" +
      NOTHING_CHANGED,
  );
  assert.deepEqual(readList(sid), before, "the move must not persist");
  assert.equal(rawStore(sid), bytesBefore, "store bytes must be untouched");
  assert.equal(tmpLeft(sid), false, "no .tmp may be left behind");
  const view = await call({ op: "read" }, sid);
  assert.equal(rowById(view.content, 3).number, "1.2", "1.2 keeps its depth");
});

test("T51 C+A composition: reverting 4 to pending and starting 4.2 (row P2)", async () => {
  useHome();
  const sid = "t51";
  const written = await call(
    {
      op: "write",
      items: [
        li(0, C, "root one"), //      1
        li(0, C, "root two"), //      2
        li(0, I, "three"), //         3
        li(0, P, "four"), //          4
        li(1, C, "four one"), //      4.1
        li(1, I, "four two"), //      4.2
      ],
    },
    sid,
  );
  // Three lines: the C offender (`4`, index 3) precedes the A offender (`4.2`,
  // index 5); inside `4.2` the in-progress group precedes the pending group.
  assert.equal(
    written.content,
    "ERROR: cannot revert 4 to pending: 4.1 is already closed.\n" +
      "ERROR: cannot start 4.2: 3 is still in progress.\n" +
      "ERROR: cannot start 4.2: 4 is not in progress.\n" +
      NOTHING_CHANGED,
  );
  assert.equal(readList(sid), null);
  assert.equal(tmpLeft(sid), false);
});
