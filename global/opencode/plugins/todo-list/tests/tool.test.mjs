// tool.test.mjs — behaviours the 30-row ordering suite does not cover.
//
// Dev-only suite. Zero dependencies: node:test + node:assert/strict + node:fs,
// node:os, node:path. It drives the REAL tool — `index.ts` (default export) and
// its context hook — through a real `plugin.setup(ctx)`, and the REAL store
// (`store.ts`) for every state assertion. `HOME` is redirected to a fresh
// `mkdtemp` per test: `store.ts` resolves the data dir from `os.homedir()` at
// call time, so the real `$HOME` is never touched.
//
// Contract: spec-ordering.md §2/§4/§9 and the spec's §6 op vocabularies. Every
// assertion pins the EXACT message AND the resulting store state.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

const PLUGIN = new URL("../", import.meta.url);

const { default: plugin } = await import(new URL("index.ts", PLUGIN).href);
const { clearList, filePathFor, loadList, readList, writeList } = await import(
  new URL("store.ts", PLUGIN).href
);

// --- the registered tool and the context hook, from a real setup() ----------

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

// --- isolation: a fresh HOME per test ---------------------------------------

const ORIGINAL_HOME = process.env.HOME;
let currentHome = null;

beforeEach(() => {
  currentHome = fs.mkdtempSync(path.join(os.tmpdir(), "todo-tool-"));
  process.env.HOME = currentHome;
});

afterEach(() => {
  if (currentHome) fs.rmSync(currentHome, { recursive: true, force: true });
  currentHome = null;
  process.env.HOME = ORIGINAL_HOME;
});

// --- fixtures / helpers -----------------------------------------------------

function makeItem(id, over = {}) {
  return {
    id,
    content: `item ${id}`,
    status: "pending",
    priority: "medium",
    depth: 0,
    ...over,
  };
}

function seed(sessionID, items, nextId) {
  const list = {
    sessionID,
    nextId: nextId ?? items.reduce((max, it) => Math.max(max, it.id), 0) + 1,
    items,
  };
  writeList(sessionID, list);
  return list;
}

/** The list as persisted, asserted to be a readable `ok` store. */
function loadOk(sessionID) {
  const loaded = loadList(sessionID);
  assert.equal(loaded.status, "ok");
  return loaded.list;
}

function exists(sessionID) {
  return fs.existsSync(filePathFor(sessionID));
}

const run = async (sessionID, input) => (await tool.execute(input, { sessionID })).content;

// ---------------------------------------------------------------------------
// 0. Session resolution (must run FIRST — before any hook call records a id).
// ---------------------------------------------------------------------------

test("execute without any session id refuses instead of guessing", async () => {
  const out = await tool.execute({ op: "read" });
  assert.equal(
    out.content,
    "ERROR: todo-list could not determine this session's id; nothing was " +
      "read or written. (See ~/.local/share/opencode-todo/debug.log)",
  );
  assert.equal(loadList("anything").status, "absent");
});

// ---------------------------------------------------------------------------
// 1. Context hook — the ONE reminder line (spec Q6/Q15 / 0.2.2).
// ---------------------------------------------------------------------------

test("context hook pushes exactly one reminder line for a non-empty list", async () => {
  const sessionID = "hook-happy";
  seed(sessionID, [
    makeItem(1, { status: "in_progress" }),
    makeItem(2),
    makeItem(3, { status: "completed" }),
  ]);
  const system = [];
  await hook({ sessionID, system });
  assert.deepEqual(system, [
    {
      type: "text",
      text: "TODO: 3 items, 1 in progress — update it if something changed.",
    },
  ]);
});

test("context hook pushes nothing for an absent list", async () => {
  const system = [];
  await hook({ sessionID: "hook-absent", system });
  assert.deepEqual(system, []);
});

test("context hook pushes nothing for an empty list file", async () => {
  const sessionID = "hook-empty";
  seed(sessionID, []);
  const system = [];
  await hook({ sessionID, system });
  assert.deepEqual(system, []);
});

// ---------------------------------------------------------------------------
// 2. clear — the four real outcomes (§9.2), two of them here.
// ---------------------------------------------------------------------------

test("clear on an absent store says so and creates nothing", async () => {
  const sessionID = "clear-absent";
  assert.equal(
    await run(sessionID, { op: "clear" }),
    "TODO: no list for this session — nothing to clear.",
  );
  assert.equal(exists(sessionID), false);
});

test("clear on an already empty file reports it and removes the file", async () => {
  const sessionID = "clear-empty";
  seed(sessionID, []);
  assert.equal(
    await run(sessionID, { op: "clear" }),
    "TODO: the list for this session was already empty (file removed).",
  );
  assert.equal(exists(sessionID), false);
});

// ---------------------------------------------------------------------------
// 3. update / remove against no store and against an empty store.
// ---------------------------------------------------------------------------

test("update and remove on an absent store have distinct messages", async () => {
  const sessionID = "nothing-absent";
  assert.equal(
    await run(sessionID, { op: "update", items: [{ id: 1, status: "completed" }] }),
    "TODO: no list for this session yet — nothing to update.",
  );
  assert.equal(
    await run(sessionID, { op: "remove", items: [{ id: 1 }] }),
    "TODO: no list for this session yet — nothing to remove.",
  );
  assert.equal(exists(sessionID), false);
});

test("update and remove on an empty store have distinct messages", async () => {
  const sessionID = "nothing-empty";
  seed(sessionID, []);
  assert.equal(
    await run(sessionID, { op: "update", items: [{ id: 1, status: "completed" }] }),
    "TODO: the list for this session is empty — nothing to update.",
  );
  assert.equal(
    await run(sessionID, { op: "remove", items: [{ id: 1 }] }),
    "TODO: the list for this session is empty — nothing to remove.",
  );
  assert.equal(loadList(sessionID).status, "empty");
});

// ---------------------------------------------------------------------------
// 4. add — empty, all-invalid, `after` hit, `after` miss.
// ---------------------------------------------------------------------------

test("add with no items writes nothing", async () => {
  const sessionID = "add-none";
  assert.equal(
    await run(sessionID, { op: "add" }),
    "TODO: nothing valid to add (no items given).",
  );
  assert.equal(loadList(sessionID).status, "absent");
});

test("add with only invalid items is rejected and writes nothing", async () => {
  const sessionID = "add-invalid";
  assert.equal(
    await run(sessionID, { op: "add", items: [{ content: "   " }] }),
    "TODO: nothing valid to add (no items given).\nissues: skipped an item with no content",
  );
  assert.equal(loadList(sessionID).status, "absent");
});

test("add with `after` inserts directly after the anchor id", async () => {
  const sessionID = "add-after-hit";
  seed(sessionID, [makeItem(1), makeItem(2), makeItem(3)]);
  const out = await run(sessionID, {
    op: "add",
    items: [{ content: "inserted", after: 2 }],
  });
  assert.equal(
    out,
    [
      "TODO updated (added: 4).",
      "TODO: 4 items (4 pending)",
      "1: [ ] 1) item 1",
      "2: [ ] 2) item 2",
      "4: [ ] 3) inserted",
      "3: [ ] 4) item 3",
    ].join("\n"),
  );
  const list = loadOk(sessionID);
  assert.deepEqual(
    list.items.map((it) => it.id),
    [1, 2, 4, 3],
  );
  assert.equal(list.nextId, 5);
});

test("add with an unknown `after` appends and reports it", async () => {
  const sessionID = "add-after-miss";
  seed(sessionID, [makeItem(1), makeItem(2)]);
  const out = await run(sessionID, {
    op: "add",
    items: [{ content: "tail", after: 99 }],
  });
  assert.equal(
    out,
    [
      "TODO updated (added: 3).",
      "TODO: 3 items (3 pending)",
      "1: [ ] 1) item 1",
      "2: [ ] 2) item 2",
      "3: [ ] 3) tail",
      "issues: id 3: after 99 not found — appended at the end",
    ].join("\n"),
  );
  assert.deepEqual(
    loadOk(sessionID).items.map((it) => it.id),
    [1, 2, 3],
  );
});

// ---------------------------------------------------------------------------
// 5. write — every normalization is reported in `issues:` (§9.1 F3/F5/F6).
// ---------------------------------------------------------------------------

test("write normalizations are all reported, never silent", async () => {
  const sessionID = "write-normalize";
  const out = await run(sessionID, {
    op: "write",
    items: [
      { content: "alpha", status: "bogus" },
      { content: "beta", priority: "urgent" },
      { content: "gamma", depth: -1 },
      { content: "1.1) delta" },
      { content: "epsilon", id: 7 },
      { content: "zeta", id: 7 },
      { content: "eta", after: 2.5 },
      { content: "theta", id: 0 },
    ],
  });
  assert.equal(
    out,
    [
      "TODO list replaced.",
      "TODO: 8 items (8 pending)",
      "1: [ ] 1) alpha",
      "2: [ ] 2) beta",
      "3: [ ] 3) gamma",
      "4: [ ] 3.1) delta",
      "7: [ ] 4) epsilon",
      "8: [ ] 5) zeta",
      "9: [ ] 6) eta",
      "10: [ ] 7) theta",
      'issues: id 1: unknown status "bogus" — used "pending"; ' +
        'id 2: unknown priority "urgent" — used "medium"; ' +
        "id 3: invalid depth -1 — used 0; " +
        'id 4: removed the "1.1)" prefix from the text — numbering is generated; ' +
        "id 7 was already used by an item in this request — assigned id 8 instead; " +
        'id 9: "after" must be a positive integer (got 2.5) — appended at the end; ' +
        "id 0 is not a positive integer — assigned id 10 instead",
    ].join("\n"),
  );
  const list = loadOk(sessionID);
  assert.deepEqual(list.items, [
    { id: 1, content: "alpha", status: "pending", priority: "medium", depth: 0 },
    { id: 2, content: "beta", status: "pending", priority: "medium", depth: 0 },
    { id: 3, content: "gamma", status: "pending", priority: "medium", depth: 0 },
    { id: 4, content: "delta", status: "pending", priority: "medium", depth: 1 },
    { id: 7, content: "epsilon", status: "pending", priority: "medium", depth: 0 },
    { id: 8, content: "zeta", status: "pending", priority: "medium", depth: 0 },
    { id: 9, content: "eta", status: "pending", priority: "medium", depth: 0 },
    { id: 10, content: "theta", status: "pending", priority: "medium", depth: 0 },
  ]);
  assert.equal(list.nextId, 11);
});

// ---------------------------------------------------------------------------
// 6. update — every invalid input is reported and the store is untouched.
// ---------------------------------------------------------------------------

test("update reports every invalid input and changes nothing", async () => {
  const sessionID = "update-invalid";
  const before = seed(sessionID, [
    makeItem(1, { content: "one" }),
    makeItem(2, { content: "two" }),
  ]);
  const out = await run(sessionID, {
    op: "update",
    items: [
      {},
      { id: 99, status: "completed" },
      { id: 1, status: "bogus" },
      { id: 1, priority: "urgent" },
      { id: 1, depth: 1.5 },
      { id: 1, content: "   " },
    ],
  });
  assert.equal(
    out,
    [
      "TODO updated (0 changes).",
      "TODO: 2 items (2 pending)",
      "1: [ ] 1) one",
      "2: [ ] 2) two",
      "issues: update skipped: missing integer id; id 99: not in the list; " +
        'id 1: unknown status "bogus"; id 1: unknown priority "urgent"; ' +
        "id 1: invalid depth 1.5; id 1: empty content ignored",
    ].join("\n"),
  );
  assert.deepEqual(loadOk(sessionID).items, before.items);
});

// ---------------------------------------------------------------------------
// 7. update — a depth change that collides two in-progress items is rejected
//    whole (spec-ordering §2 / §4).
// ---------------------------------------------------------------------------

test("update that collides two in-progress items at one level is rejected", async () => {
  const sessionID = "update-collision";
  const before = seed(sessionID, [
    makeItem(1, { status: "in_progress", depth: 0 }),
    makeItem(2, { status: "in_progress", depth: 1 }),
  ]);
  const bytesBefore = fs.readFileSync(filePathFor(sessionID), "utf-8");

  const out = await run(sessionID, {
    op: "update",
    items: [{ id: 2, depth: 0 }],
  });
  assert.equal(
    out,
    "ERROR: cannot start 2: 1 is still in progress.\nNothing was changed.",
  );
  assert.deepEqual(loadOk(sessionID).items, before.items);
  assert.equal(fs.readFileSync(filePathFor(sessionID), "utf-8"), bytesBefore);
});

test("a rejected update names the non-offending changes it discarded", async () => {
  const sessionID = "update-collision-extra";
  const before = seed(sessionID, [
    makeItem(1, { status: "in_progress", depth: 0 }),
    makeItem(2, { status: "in_progress", depth: 1 }),
  ]);
  const out = await run(sessionID, {
    op: "update",
    items: [
      { id: 1, content: "renamed" },
      { id: 2, depth: 0 },
    ],
  });
  assert.equal(
    out,
    [
      "ERROR: cannot start 2: 1 is still in progress.",
      "refused whole: 1 other requested change was not applied (id 1 content).",
      "Nothing was changed.",
    ].join("\n"),
  );
  assert.deepEqual(loadOk(sessionID).items, before.items);
});

// ---------------------------------------------------------------------------
// 8. remove — mixed ids, then removing the last item.
// ---------------------------------------------------------------------------

test("remove deletes the valid ids and reports the invalid ones", async () => {
  const sessionID = "remove-mixed";
  seed(sessionID, [makeItem(1), makeItem(2), makeItem(3)]);
  const out = await run(sessionID, {
    op: "remove",
    items: [{ id: 1 }, { id: 99 }, {}],
  });
  assert.equal(
    out,
    [
      "TODO updated (items removed).",
      "TODO: 2 items (2 pending)",
      "2: [ ] 1) item 2",
      "3: [ ] 2) item 3",
      "issues: remove skipped: missing integer id; id 99: not in the list",
    ].join("\n"),
  );
  assert.deepEqual(
    loadOk(sessionID).items.map((it) => it.id),
    [2, 3],
  );
});

test("removing every item clears the store file", async () => {
  const sessionID = "remove-all";
  seed(sessionID, [makeItem(1), makeItem(2)]);
  assert.equal(
    await run(sessionID, { op: "remove", items: [{ id: 1 }, { id: 2 }] }),
    "TODO list is now empty — removed.",
  );
  assert.equal(exists(sessionID), false);
});

test("remove that would leave an illegal state is rejected whole", async () => {
  const sessionID = "remove-illegal";
  const before = seed(sessionID, [
    makeItem(1, { status: "in_progress", depth: 0 }),
    makeItem(2),
    makeItem(3, { status: "in_progress", depth: 0 }),
  ]);
  assert.equal(
    // Numbers are DERIVED from the candidate: after removing id 2 the two
    // in-progress roots renumber to 1 and 2, so the offender is "2".
    await run(sessionID, { op: "remove", items: [{ id: 2 }] }),
    "ERROR: cannot start 2: 1 is still in progress.\nNothing was changed.",
  );
  assert.deepEqual(loadOk(sessionID).items, before.items);
});

// ---------------------------------------------------------------------------
// 9. execute — an unknown op names the valid vocabulary.
// ---------------------------------------------------------------------------

test("execute refuses an unknown op with the expected vocabulary", async () => {
  const sessionID = "unknown-op";
  assert.equal(
    await run(sessionID, { op: "frobnicate" }),
    'ERROR: unknown op "frobnicate"; expected one of: read, write, add, ' +
      "update, remove, clear.",
  );
  assert.equal(
    await run(sessionID, { op: 42 }),
    "ERROR: unknown op 42; expected one of: read, write, add, update, " +
      "remove, clear.",
  );
  assert.equal(exists(sessionID), false);
});

// ---------------------------------------------------------------------------
// 10. store.ts — path-traversal guard and the unreadable state (§9.2).
// ---------------------------------------------------------------------------

test("filePathFor rejects an unsafe sessionID", () => {
  assert.throws(() => filePathFor("../evil"), {
    message: 'unsafe sessionID: "../evil"',
  });
  assert.deepEqual(loadList("../evil"), {
    status: "unreadable",
    path: "(session id is not usable as a file name)",
    detail: 'unsafe sessionID: "../evil"',
  });
});

test("loadList reports a directory in place of the file as unreadable", () => {
  const sessionID = "unreadable-dir";
  const filePath = filePathFor(sessionID);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.mkdirSync(filePath); // a DIRECTORY where the JSON file should be
  const loaded = loadList(sessionID);
  assert.equal(loaded.status, "unreadable");
  assert.equal(loaded.path, filePath);
  // Node's message for readFileSync on a directory: "EISDIR: illegal
  // operation on a directory, read" (code first, then a colon).
  assert.match(loaded.detail, /^EISDIR: /);
  assert.equal(readList(sessionID), null);
});

// ---------------------------------------------------------------------------
// 11. read — the four states are reported, never collapsed (§9.2, §9.1 F4).
// ---------------------------------------------------------------------------

test("read reports absent, empty, a legacy prefix and an illegal state", async () => {
  const sessionID = "read-states";
  assert.equal(
    await run(sessionID, { op: "read" }),
    "TODO: no list for this session yet.",
  );

  const emptyID = "read-empty";
  seed(emptyID, []);
  assert.equal(
    await run(emptyID, { op: "read" }),
    "TODO: the list for this session is empty (the file exists and holds no items).",
  );

  seed(sessionID, [
    makeItem(1, { content: "1) legacy text" }),
    makeItem(2, { status: "in_progress", depth: 0 }),
    makeItem(3, { status: "in_progress", depth: 0 }),
  ]);
  assert.equal(
    await run(sessionID, { op: "read" }),
    [
      "TODO: 3 items (1 pending, 2 in_progress)",
      "1: [ ] 1) legacy text",
      "2: [~] 2) item 2",
      "3: [~] 3) item 3",
      "issues: list is in an invalid state — 2 is in progress while 1 is not in " +
        "progress; mutating ops will refuse until every item before an " +
        "in-progress item is closed or is one of its in-progress ancestors.",
      "issues: 1 items store a legacy numbered prefix; the display omits it — " +
        "rewrite those texts without the prefix to clear this note.",
    ].join("\n"),
  );
});

// ---------------------------------------------------------------------------
// 12. Corrupt and unreadable stores — refused, announced, only clear destroys.
// ---------------------------------------------------------------------------

function writeCorrupt(sessionID) {
  const filePath = filePathFor(sessionID);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "{oops", "utf-8");
  return filePath;
}

test("a corrupt store is refused by read and write, and only clear destroys it", async () => {
  const sessionID = "corrupt-store";
  const filePath = writeCorrupt(sessionID);

  const readOut = await run(sessionID, { op: "read" });
  assert.ok(
    readOut.startsWith(
      `ERROR: the stored list for this session is corrupt (${filePath}): `,
    ),
    readOut,
  );
  assert.ok(
    readOut.endsWith(
      "Nothing was read. Run op \"clear\" to discard it (its data cannot be " +
        "recovered), or repair the file by hand.",
    ),
    readOut,
  );

  const writeOut = await run(sessionID, {
    op: "write",
    items: [{ content: "would overwrite" }],
  });
  assert.ok(writeOut.includes(`corrupt (${filePath})`), writeOut);
  assert.ok(writeOut.includes("Nothing was changed."), writeOut);
  assert.equal(fs.readFileSync(filePath, "utf-8"), "{oops");

  assert.equal(
    await run(sessionID, { op: "clear" }),
    "TODO: removed the corrupt list file for this session (it could not be parsed).",
  );
  assert.equal(fs.existsSync(filePath), false);
});

test("an unreadable store is refused by read and announced by the hook", async () => {
  const sessionID = "unreadable-store";
  const filePath = filePathFor(sessionID);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.mkdirSync(filePath);

  const readOut = await run(sessionID, { op: "read" });
  assert.ok(
    readOut.startsWith(
      `ERROR: the stored list for this session could not be read (${filePath}): EISDIR: `,
    ),
    readOut,
  );
  assert.ok(
    readOut.endsWith(
      "Nothing was read. Fix the permissions, or run op \"clear\" to discard it.",
    ),
    readOut,
  );

  const system = [];
  await hook({ sessionID, system });
  assert.deepEqual(system, [
    {
      type: "text",
      text:
        'TODO: list unreadable (store could not be read) — run the todo tool ' +
        'op "read" for details.',
    },
  ]);
});

test("the hook announces a corrupt store instead of staying silent", async () => {
  const sessionID = "hook-corrupt";
  writeCorrupt(sessionID);
  const system = [];
  await hook({ sessionID, system });
  assert.deepEqual(system, [
    {
      type: "text",
      text:
        'TODO: list unreadable (corrupt store) — run the todo tool op "read" ' +
        "for details.",
    },
  ]);
});

// ---------------------------------------------------------------------------
// 13. write — empty requests and all-invalid requests never destroy a list.
// ---------------------------------------------------------------------------

test("write [] tells the truth for absent, empty and non-empty stores", async () => {
  const absentID = "write-empty-absent";
  assert.equal(
    await run(absentID, { op: "write", items: [] }),
    "TODO: no list for this session — nothing to clear.",
  );
  assert.equal(exists(absentID), false);

  const emptyID = "write-empty-file";
  seed(emptyID, []);
  assert.equal(
    await run(emptyID, { op: "write", items: [] }),
    "TODO: the list for this session was already empty (file removed).",
  );
  assert.equal(exists(emptyID), false);

  const okID = "write-empty-ok";
  seed(okID, [makeItem(1)]);
  assert.equal(await run(okID, { op: "write", items: [] }), "TODO list cleared.");
  assert.equal(exists(okID), false);
});

test("write whose every item was rejected leaves the stored list untouched", async () => {
  const sessionID = "write-all-invalid";
  const before = seed(sessionID, [makeItem(1, { content: "keep me" })]);
  assert.equal(
    await run(sessionID, { op: "write", items: [{ content: " " }] }),
    [
      "ERROR: nothing valid to write: every item in the request was rejected.",
      "issues: skipped an item with no content",
      "Nothing was changed.",
    ].join("\n"),
  );
  assert.deepEqual(loadOk(sessionID).items, before.items);
});

// ---------------------------------------------------------------------------
// 14. Session resolution — nested carriers, the hook's last-seen id, progress.
// ---------------------------------------------------------------------------

test("the session id is resolved from a nested carrier and from the hook", async () => {
  const sessionID = "resolve-session";
  seed(sessionID, [makeItem(1, { content: "found me" })]);
  const nested = await tool.execute({ op: "read" }, { info: { sessionID } });
  assert.equal(
    nested.content,
    "TODO: 1 item (1 pending)\n1: [ ] 1) found me",
  );

  // The hook records the last session it saw; a bare call reuses it.
  await hook({ sessionID, system: [] });
  const bare = await tool.execute({ op: "read" });
  assert.equal(bare.content, "TODO: 1 item (1 pending)\n1: [ ] 1) found me");
});

test("a throwing progress reporter never fails the tool", async () => {
  const sessionID = "progress-throws";
  const out = await tool.execute(
    { op: "clear" },
    {
      sessionID,
      progress: () => {
        throw new Error("progress is advisory");
      },
    },
  );
  assert.equal(
    out.content,
    "TODO: no list for this session — nothing to clear.",
  );
});

// ---------------------------------------------------------------------------
// 15. store.ts — every corrupt shape and the unusable-id guard (§9.2).
// ---------------------------------------------------------------------------

test("store reports corrupt shapes precisely and refuses unusable ids", () => {
  const writeRaw = (sessionID, text) => {
    const filePath = filePathFor(sessionID);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, text, "utf-8");
    return filePath;
  };
  const SHAPE = "shape is not { items: TodoItem[] }";

  // JSON that parses but is not an object
  writeRaw("shape-null", "null");
  assert.deepEqual(loadList("shape-null"), {
    status: "corrupt",
    path: filePathFor("shape-null"),
    detail: "not a JSON object",
  });

  // `items` is not an array
  writeRaw("shape-no-array", '{"items":{}}');
  assert.equal(loadList("shape-no-array").detail, SHAPE);

  // an item that is not an object at all, and an explicit null item
  writeRaw("shape-item-scalar", '{"items":["text"]}');
  assert.equal(loadList("shape-item-scalar").detail, SHAPE);
  writeRaw("shape-item-null", '{"items":[null]}');
  assert.equal(loadList("shape-item-null").detail, SHAPE);

  // each required item field is type-checked (id, content, status)
  writeRaw("shape-id", '{"items":[{"id":"1","content":"a","status":"pending"}]}');
  assert.equal(loadList("shape-id").detail, SHAPE);
  writeRaw("shape-content", '{"items":[{"id":1,"content":2,"status":"pending"}]}');
  assert.equal(loadList("shape-content").detail, SHAPE);
  writeRaw("shape-status", '{"items":[{"id":1,"content":"a","status":3}]}');
  assert.equal(loadList("shape-status").detail, SHAPE);

  // the panel's wrapper stays `null` for anything it cannot trust
  assert.equal(readList("shape-id"), null);

  // a non-string id is never coerced into a path
  assert.throws(() => filePathFor(42), /unsafe sessionID/);

  // clearList refuses an unusable id without throwing (§9: the tool says why)
  const seen = [];
  const original = console.error;
  console.error = (...args) => seen.push(args.map(String).join(" "));
  try {
    assert.equal(clearList("../evil"), false);
    assert.equal(clearList("never-written"), false, "absent file → false, no error");
  } finally {
    console.error = original;
  }
  assert.equal(seen.length, 1, "only the unusable id is reported");
  assert.match(seen[0], /^\[todo-list\] clearList:/);
});

// ---------------------------------------------------------------------------
// 16. Remaining guarantees: id stability, hook/host robustness, dispose.
// ---------------------------------------------------------------------------

test("add continues the stored nextId — ids are never reused", async () => {
  const sessionID = "nextid-stable";
  seed(sessionID, [makeItem(1)], 50);
  const out = await run(sessionID, { op: "add", items: [{ content: "new" }] });
  assert.equal(out.split("\n")[0], "TODO updated (added: 50).");
  assert.deepEqual(
    loadOk(sessionID).items.map((it) => it.id),
    [1, 50],
  );
  assert.equal(loadOk(sessionID).nextId, 51);
});

test("the hook swallows a host that refuses the push — admission never breaks", async () => {
  const sessionID = "hook-frozen";
  seed(sessionID, [makeItem(1)]);
  const seen = [];
  const original = console.error;
  console.error = (...args) => seen.push(args.map(String).join(" "));
  try {
    // a frozen system block makes push() throw: the hook logs and returns
    await hook({ sessionID, system: Object.freeze([]) });
  } finally {
    console.error = original;
  }
  assert.equal(seen.length, 1);
  assert.match(seen[0], /^\[todo-list\] context hook failed:/);
});

test("an item whose text is only a legacy prefix keeps its text, never vanishes", async () => {
  const sessionID = "prefix-only";
  // "1)" strips to nothing: the stored/displayed text must fall back to the
  // original instead of turning the item into an empty row (format.ts).
  assert.equal(
    (await run(sessionID, { op: "add", items: [{ content: "1)" }] })).split("\n")[0],
    "TODO updated (added: 1).",
  );
  assert.equal(loadOk(sessionID).items[0].content, "1)");
  assert.equal(
    await run(sessionID, { op: "read" }),
    [
      "TODO: 1 item (1 pending)",
      "1: [ ] 1) 1)",
      // the stored text still carries the prefix, so `read` says so (§9.1 F4)
      "issues: 1 items store a legacy numbered prefix; the display omits it — " +
        "rewrite those texts without the prefix to clear this note.",
    ].join("\n"),
  );
});

test("setup() returns a disposer that releases both registrations", async () => {
  const disposed = [];
  const teardown = await plugin.setup({
    tool: {
      transform: async (cb) => {
        cb({ add() {} });
        return { dispose: () => disposed.push("tool") };
      },
    },
    session: {
      hook: async () => ({ dispose: async () => disposed.push("hook") }),
    },
  });
  assert.equal(typeof teardown, "function");
  await teardown();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(disposed.sort(), ["hook", "tool"]);
});

test("an unusable diagnostics directory never breaks the tool", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "todo-diag-"));
  const script = `
    import fs from "node:fs";
    import path from "node:path";
    const blocked = path.join(process.env.HOME, ".local", "share", "opencode-todo");
    fs.mkdirSync(path.dirname(blocked), { recursive: true });
    fs.writeFileSync(blocked, "not a directory");
    const { default: plugin } = await import(process.argv[1]);
    let tool = null;
    await plugin.setup({
      tool: { transform: async (cb) => {
        cb({ add: (t) => { tool = t; } });
        return { dispose() {} };
      } },
      session: { hook: async () => ({ dispose() {} }) },
    });
    const res = await tool.execute({ op: "read" }, { sessionID: "diag" });
    process.stdout.write(res.content);
  `;
  try {
    const out = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", script, new URL("index.ts", PLUGIN).href],
      {
        cwd: new URL(PLUGIN).pathname,
        env: { ...process.env, HOME: home },
        encoding: "utf8",
      },
    );
    // the debug append failed silently (§9.1: diagnostics are advisory) and the
    // tool still answered with the real store state
    assert.match(
      out,
      /^ERROR: the stored list for this session could not be read \(/,
    );
    assert.match(out, /ENOTDIR/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 17. The ACCEPTED paths: valid normalization on write, valid fields on update.
// ---------------------------------------------------------------------------

test("write accepts a valid status, priority and depth without issues", async () => {
  const sessionID = "write-valid";
  // Re-derived for v0.3.5 (spec-ordering §6 collateral audit): a `pending`
  // parent above a closed child is itself an invalid state now, so the parent
  // is `in_progress`. Every assertion this test exists for is preserved.
  assert.equal(
    await run(sessionID, {
      op: "write",
      items: [
        { content: "parent", status: "in_progress" },
        { content: "child", status: "completed", priority: "low", depth: 1 },
      ],
    }),
    [
      "TODO list replaced.",
      "TODO: 2 items (1 in_progress, 1 completed)",
      "1: [~] 1) parent",
      "2: [x] 1.1) child [low]",
    ].join("\n"),
  );
  const list = loadOk(sessionID);
  assert.deepEqual(list.items, [
    {
      id: 1,
      content: "parent",
      status: "in_progress",
      priority: "medium",
      depth: 0,
    },
    { id: 2, content: "child", status: "completed", priority: "low", depth: 1 },
  ]);
  assert.equal(list.nextId, 3);
});

test("update applies a valid status, priority and prefix strip, and may start an item", async () => {
  const sessionID = "update-applied";
  seed(sessionID, [
    makeItem(1, { content: "old text" }),
    makeItem(2, { content: "other" }),
  ]);
  assert.equal(
    await run(sessionID, {
      op: "update",
      items: [
        {
          id: 1,
          content: "2) nested text",
          status: "in_progress",
          priority: "high",
        },
      ],
    }),
    [
      "TODO updated (3 changes).",
      "TODO: 2 items (1 pending, 1 in_progress)",
      "1: [~] 1) nested text [high]",
      "2: [ ] 2) other",
      'issues: id 1: removed the "2)" prefix from the text — numbering is generated',
    ].join("\n"),
  );
  assert.deepEqual(loadOk(sessionID).items, [
    {
      id: 1,
      content: "nested text",
      status: "in_progress",
      priority: "high",
      depth: 0,
    },
    { id: 2, content: "other", status: "pending", priority: "medium", depth: 0 },
  ]);
});

