# ORDERING RULE — contract for `@oesc/todo-list` v0.3.0

- Status: **ACTIVE — law AMENDED 2026-10-31 13:10** (contract revision v0.3.6:
  rule A restored in v0.3.3, **rule B — the close rule — added in v0.3.4**,
  **rule C — the pending rule — in v0.3.5**, **rule D — the started rule, which
  replaces A and deletes its loop — added here**; the per-level law of v0.3.2 is
  REJECTED, §2.3), §9 added 2026-10-30 20:55.
  The title tracks `package.json` (**0.3.0**); the `v0.3` / `v0.3.1` / `v0.3.2` /
  `v0.3.3` / `v0.3.4` / `v0.3.5` / `v0.3.6` markers in the section history below are
  **contract revisions**, not package versions.
- Scope: `global/opencode/plugins/todo-list/` only
- Parent contract: `todo-list-spec.md` (Q1–Q15 untouched)

USER's ask (2026-10-30), verbatim intent:

1. Do not start an item before the previous item is closed or deleted (example:
   start `4.2` while `3.7` is still open → not allowed).
2. Do not hold two in-progress items in impossible positions: `3`, `3.1`,
   `3.1.2` in progress at the same time **is** allowed; `3`, `3.1` and `4.3` at
   the same time is **not**.
3. Tests before code.

USER's correction of 2026-10-30 (verbatim, pt-BR) — **history only, superseded
below**: *"esta errado, pode aceitar o 4 desde que nao comecado ainda, nao é pra
proibir itens futuros, todo é pra isso, é proibir estado invalido"*. That sentence
is about **future work existing** in the list — a `pending` item may sit there,
unstarted, and that is not an invalid state. It never said a **descendant** may
run while its ancestor is unstarted.

USER's correction of 2026-10-31 (verbatim, pt-BR) — **governs**:
*"Como que o 1.1 pode estar em andamento se a 1 ainda nao iniciou?"*
An item may be in progress only when everything before it is closed, **except its
own ancestors, which must themselves be in progress**. The per-level law of
v0.3.2 — which accepted `{1.1}` under a pending `1`, `{3, 4.3}`, `{3, 4.2}` and
the level gap `{3, 3.1.2}` — is **REJECTED** (§2.3).

USER's correction of 2026-10-31 02:10 (verbatim, pt-BR) — **governs**:
*"Como pode cancelar o 1, se o 1.1 nao esta"*
Reported from live use: the tool let `1` be **cancelled** (and, earlier,
completed) while its child `1.1` was still pending. That state is **INVALID**.
The v0.3.3 law did not catch it because rule A constrains in-progress items
only — it never looks at a **closed** one. §2 gains **rule B**, the close rule:
a closed item may not have an open descendant. `1 cancelled` + `1.1 pending`,
`1 completed` + `1.1 in_progress`, and `1 completed` + `1.1 cancelled` are three
different answers (ILLEGAL, ILLEGAL, LEGAL) — §2.2 rows N1–N9.

USER's correction of 2026-10-31 09:20 (verbatim, pt-BR) — **governs**:
*"errado, como que o 1 pode nao ter comecado se o 1.1 concluiu. Concorda? acho
que ta faltando testes, crie testes pra todos estes casos, nao corrija ainda"*
Reported from live use: the tool let `1` be **reverted to `pending`** while its
child `1.1` was already `completed`. That state is **INVALID** — and it is the
exact mirror of rule B: rule B forbids *finishing* a branch from the top, this
correction forbids *un-starting* it from the top. Rules A and B both miss it —
A only looks at in-progress items, B only at closed ones, and a `pending` item is
neither. §2 gains **rule C**, the pending rule: **an item may be `pending` only
while every descendant is `pending`**. The two new illegal states are
`1 pending` + `1.1 completed` and `1 pending` + `1.1 cancelled` (§2.2 rows Y3,
Y4); §2.2 enumerates all sixteen status pairs at depth 1 and the depth-2 chains.
USER also ordered: **tests first, no code fix in this revision** (§6, §8.1).

## 1. Definitions

`items` = stored array in order (= display order).
`numbers = deriveNumbers(items)` — `format.ts`; the numbering the tool dump and
the panel show (depth clamped to `min(depth, prev+1)`).
**Level**: `level(i) = numbers[i].split(".").length - 1` → `3` = 0, `3.1` = 1,
**`4.3` = 1**, `3.1.2` = 2. The law does **not** use the level (§2); it is kept
because the tests print it and because it explains why `{3, 3.1, 4.3}` used to be
read as a "collision".
`CLOSED(s)` = `s === "completed" || s === "cancelled"` — the only two closed
states (`cancelled` counts, T6).
`OPEN(s) = !CLOSED(s)` — `pending` and `in_progress`. "Open descendant" means a
descendant whose status is `OPEN`; the word carries no other meaning here.
`STARTED(s) = s !== "pending"` — in progress or closed; "started descendant"
means a descendant whose status is `STARTED`. It is the **subject of rule D**
(v0.3.6): every started item — not only an `in_progress` one — must sit behind a
closed prefix (§2). Rule C's **collection** predicate is `CLOSED`, not `STARTED`
(§2): the `in_progress` half is already rule D's (formerly rule A's) and must not
be reported twice.
`anc(j, i) = numbers[i].startsWith(numbers[j] + ".")` — dot-prefix **is** ancestry
on derived numbers (`anc(3, 3.1.2)` true; `anc(3, 4.3)` **false**; an item is not
its own ancestor). `anc` is read left-to-right: `anc(a, b)` = **`a` is an
ancestor of `b`**.
`IN_PROGRESS` = items with `status === "in_progress"`.
**Blocking**: every earlier item is a potential blocker of a later **started**
item (in progress or closed). `completed` / `cancelled` never block; `pending`
**does** block (`not in progress`); `in_progress` blocks unless it is an ancestor
of the item (`still in progress`). The old line "`pending` never blocks" is
**withdrawn** — it holds only for items *after* the started one.
**Closing blocks its own branch**: a closed item constrains everything **after**
it — each of its descendants must be closed too (`open descendant`, §2 rule B).
Both `pending` and `in_progress` block a close; the blocker is always a
**descendant** of the closed item, never an earlier item.
**A pending item forbids its branch from having started**: rule C (§2) — while an
item is `pending`, no descendant may be `CLOSED`; again the blocker is a
**descendant**, never an earlier item. The two branch rules are the same symmetry
read in opposite directions: **rule B = nothing open under closed, rule C =
nothing closed under pending**.

## 2. The law (normative)

Three rules, all mandatory. **Rule D** — the started rule, v0.3.6 — says where a
**started** item may sit, whether it is in progress or closed; it is rule A
widened, and A survives only as a corollary of it (§2, below). **Rule B** — the
close rule, v0.3.4 — says what a closed item must leave behind it. **Rule C** —
the pending rule, v0.3.5 — says what a `pending` item may have underneath it.

```
numbers    = deriveNumbers(items)
CLOSED(s)  = s === "completed" || s === "cancelled"
OPEN(s)    = !CLOSED(s)
STARTED(s) = s !== "pending"
anc(j, i)  = numbers[i].startsWith(numbers[j] + ".")

legal(list) iff
  (D)  for every STARTED item i, for every j < i:
           CLOSED(items[j].status)
        || ( anc(j, i) && items[j].status === "in_progress" )
        || ( anc(j, i) && CLOSED(items[i].status) )
  (B)  for every closed item i, for every j > i:
           anc(i, j) ⇒ CLOSED(items[j].status)
  (C)  for every item i, for every descendant j:
           CLOSED(items[j].status) ⇒ items[i].status !== "pending"
```

In words: **(D)** the started items — running **and** finished — form one path,
walked in order: an item may be started only when every item before it is already
closed, the exceptions being its own in-progress ancestors (term 2) and, for a
**closed** item, its own ancestors whatever their status (term 3 — the bottom-up
close); nothing may be skipped, nothing may run in a second branch, and finishing
or cancelling is **not** a way to jump a `pending` sibling. **(B)** nothing may be
left open underneath a closed item — **a closed item with any open descendant is
an invalid state**, whatever the descendant is doing (`pending` or `in_progress`).
**(C)** nothing may be closed underneath a `pending` item — **an item may be
`pending` only while every descendant is `pending`**; the moment a descendant is
`completed` or `cancelled`, its ancestors can no longer claim "never started".

Why all three, in the USER's own words: rule A alone answered *"Como que o 1.1
pode estar em andamento se a 1 ainda nao iniciou?"* and let *"Como pode cancelar
o 1, se o 1.1 nao esta"* through — because rule A looks at in-progress items and
a closed `1` is not one. Rule B closed that hole: closing is a **commitment**
that the branch is over, so it is only allowed bottom-up. Rule B then let the
opposite gesture through — *"como que o 1 pode nao ter comecado se o 1.1
concluiu"* — because it only looks at **closed** items and a `pending` `1` is not
one. Rule C closes that hole, and it is B's exact mirror: **a branch that has
started (or finished) somewhere has started at its root**. Starting is a
commitment too — in the other direction.

And the gap found in the USER's own store (v0.3.6): **closing or cancelling** was
not ordered at all — `1.4` closed with `1.3` still `pending`, `2` and `3` closed
while `1` was running — because rule A only ever looked at **in-progress** items.
Rule D widens the subject of the start rule from `in_progress` to `STARTED`:
finishing or cancelling is a commitment that the work **in front of it** is done,
exactly like starting is.

**Rule D subsumes rule A — and the A check is DELETED, not kept beside D.** Rule A
(v0.3.3) is D restricted to `in_progress` items: term 3 requires `CLOSED(i)` and is
therefore vacuous there, leaving exactly A's two terms. A survives **in this text
only, as a corollary**; the runtime keeps **one** started-subject loop (§2.1),
because two loops would print every `cannot start` line twice. Term 3 is mandatory,
not an optimisation: it is what keeps rule C the **sole** owner of the
closed-under-pending-ancestor class, so D never adds a `cannot close` line to a
state C is already refusing.

What each earlier item `j` does to a started item `i` (rule D):

| earlier item `j` | `i` **in progress** (terms 1–2) | `i` **closed** (terms 1 and 3) |
| --- | --- | --- |
| `completed` / `cancelled` | passes — `CLOSED` (`cancelled` counts, T6) | passes — `CLOSED` |
| `in_progress` **and** an ancestor of `i` | passes — this is the chain (`3`, `3.1`, `3.1.2`) | passes — term 3: the bottom-up close (`1` running, `1.1` finished) |
| `pending` **and** an ancestor of `i` | **blocks** — `… is not in progress.` | passes here — term 3; rule **C** owns the pair and refuses it on the ancestor (`cannot revert <j> to pending`) |
| `in_progress`, **not** an ancestor | **blocks** — `… is still in progress.` | **blocks** — `cannot close <i>: … is still in progress.` |
| `pending` — earlier sibling or another branch | **blocks** — `… is not in progress.` | **blocks** — `cannot close <i>: … is not in progress.` |

What each later item `j` does to a closed item `i` (rule B):

| later item `j` | verdict |
| --- | --- |
| not a descendant of `i` | passes — rule B is per branch |
| descendant of `i`, `completed` / `cancelled` | passes — the branch was closed bottom-up |
| descendant of `i`, `in_progress` | **blocks** — `… is still open.` |
| descendant of `i`, `pending` | **blocks** — `… is still open.` |

What each later item `j` does to a `pending` item `i` (rule C):

| later item `j` | verdict |
| --- | --- |
| not a descendant of `i` | passes — rule C is per branch |
| descendant of `i`, `pending` | passes — the whole branch is still unstarted (the plan) |
| descendant of `i`, `completed` | **blocks** — `… is already closed.` |
| descendant of `i`, `cancelled` | **blocks** — `… is already closed.` (`cancelled` counts, as in B) |

**What rule C adds — and only this.** Check every pair against the three rules
(full matrix: §2.2 rows Y1–Y16, executed):

| pair (`i` ancestor, `j` descendant) | covered by | new? |
| --- | --- | --- |
| `pending` + `pending` | nothing — legal | — |
| `pending` + `in_progress` | **D** (was rule A) — `cannot start <j>: <i> is not in progress.` | no |
| **`pending` + `completed`** | **C** | **YES** |
| **`pending` + `cancelled`** | **C** | **YES** |
| `in_progress` + `pending` | nothing — legal (parent started, child not) | — |
| `in_progress` + `in_progress` | nothing — legal (the chain) | — |
| `in_progress` + `completed` / `cancelled` | nothing — legal (bottom-up close) | — |
| `closed` + `pending` / `in_progress` | **B** — `cannot close <i>: <j> is still open.` | no |
| `closed` + `completed` / `cancelled` | nothing — legal | — |

So rule C contributes **exactly two cells of the sixteen** — the two where a
`pending` item has a **closed** descendant. Everything else was already decided
by D or B, or is legal by design.

No pair is visited twice, and rule C never adds a blocker to a D or B line:
D pairs an **open earlier** member with a **started later** one, B pairs a
**closed earlier** member with an **open later** one, C pairs a **pending
earlier** member with a **closed later** one. The three predicates are mutually
exclusive on the same pair (an earlier member cannot be open and closed; a later
member cannot be started, open-not-started and closed at once). That is
why the `in_progress` half of C's statement is *not* collected (§1): rule D owns
it, with better attribution (it names the item the call started).

Corollaries, **not** the law:

- At most one in-progress item per level — a same-level collision always has one
  member earlier than the other, and two items on the same level are never
  ancestor/descendant. v0.3.2 mistook that corollary for the law (§2.3).
- Items *after* the started one are unconstrained: future work may exist.
  Unexplored future branches stay legal, so a plan is never rejected for being a
  plan. (Since v0.3.6 this is narrower: an item *closed* after a still-running
  earlier one **is** constrained by D — D2. The unconstrained part is the
  `pending` suffix.)
- Progress is **top-down to start, bottom-up to close**: you open the path
  (`3` → `3.1`) and you close it in reverse (`3.1` → `3`).
- Closing an ancestor is never a shortcut past its children: the children must be
  closed (or removed) first.
- **Finishing is ordered too.** Closing or cancelling is a step forward, not an
  escape: an item may be closed only when everything before it is closed, with the
  same ancestor exemption as starting (D). `4.3` cannot be closed while `4.1` is
  pending, and no root can be closed while an earlier root is running.
- A **`pending` item's whole branch is `pending`**. "I finished a child of
  something I never started" cannot be stored. A legacy list in that state is
  escapable only by starting the ancestor, by closing/cancelling it (rule B then
  requires its descendants closed), or by removing/reverting the descendant.

### 2.1 Reference implementation (normative; drop-in body for `order.ts`)

Three rules, collected first, grouped second. Rule D walks every **started** item
`i` and every earlier `j`, keeping the violating pair with its reason (`j` in
progress → `still in progress`; `j` pending → `not in progress`) and attributing it
to the offender of §4.1 — the item this op starts, or the later item when the pair
holds no start (in this directed rule the later member is always the started one,
`i`) — except when `i` is **closed**: then the offender is always `i`, exactly as
in rules B and C (`closes` is a declaration, §4.1, and a closed item's line has
one possible subject). The two skip lines are term 2 and term 3 of §2 — the
in-progress ancestor chain, and the closed item under its own ancestor. Rule B
walks every closed item `i` and every **later** `j` of its own branch, keeping `j`
as a blocker when it is still open; its offender is always the closed item `i`.
Rule C walks every `pending` item `i` and every **later** `j` of its own branch,
keeping `j` as a blocker when it is **closed**; its offender is always the pending
item `i` — B's mirror, with `reverts` as a declaration (D11, D14). All three rules
feed one map, so the formatter stays a single loop. **There is no rule-A loop**:
D is A's superset (§2), and a second loop over the in-progress items would emit
every `cannot start` line twice.

```ts
export function findOrderingViolations(
  items: TodoItem[],                        // the candidate list
  starts: ReadonlySet<number> = new Set(),  // ids this op STARTS (§4.1)
  closes: ReadonlySet<number> = new Set(),  // ids this op CLOSES (§4.1)
  reverts: ReadonlySet<number> = new Set(), // ids this op REVERTS to pending (§4.1)
): OrderingViolation[] {
  const numbers = deriveNumbers(items);
  const closed = (s: TodoStatus) => s === "completed" || s === "cancelled";
  const started = (s: TodoStatus) => s !== "pending";               // STARTED (§1)
  const anc = (j: number, i: number) => numbers[i].startsWith(numbers[j] + ".");
  type Reason = "in_progress" | "pending" | "open_descendant" | "closed_descendant";
  const acc = new Map<number, Record<Reason, number[]>>(); // offender → reason → blockers
  const slotOf = (offender: number) => {
    const slot = acc.get(offender) ?? {
      in_progress: [],
      pending: [],
      open_descendant: [],
      closed_descendant: [],
    };
    acc.set(offender, slot);
    return slot;
  };
  // `closes` and `reverts` are kept referenced on purpose: they are declarations,
  // not filters (see the fourth and fifth properties below), so they can never
  // change a line.
  void closes;
  void reverts;

  // rule D — the STARTED rule: a not-pending item and every EARLIER item.
  // (rule A is D restricted to in_progress; its own loop is DELETED, §2)
  for (let i = 0; i < items.length; i++) {
    if (!started(items[i].status)) continue;                        // pending: no D
    for (let j = 0; j < i; j++) {                                   // every EARLIER item
      if (closed(items[j].status)) continue;                        // closed: passes
      if (anc(j, i) && items[j].status === "in_progress") continue;  // term 2: the chain
      if (anc(j, i) && closed(items[i].status)) continue;            // term 3: bottom-up close
      const offender = closed(items[i].status)                      // closed item: one subject
        ? i
        : starts.has(items[i].id)
          ? i
          : starts.has(items[j].id)
            ? j
            : i;                                                    // §4.1 attribution
      const blocker = offender === i ? j : i;
      const reason: Reason =
        items[blocker].status === "in_progress" ? "in_progress" : "pending";
      slotOf(offender)[reason].push(blocker);
    }
  }

  // rule B — the CLOSE rule: a closed item and every LATER item of its branch.
  for (let i = 0; i < items.length; i++) {
    if (!closed(items[i].status)) continue;
    for (let j = i + 1; j < items.length; j++) {                    // every LATER item
      if (!anc(i, j)) continue;                                     // another branch: passes
      if (closed(items[j].status)) continue;                        // closed descendant: passes
      slotOf(i).open_descendant.push(j);                            // the closed item offends
    }
  }

  // rule C — the PENDING rule: a pending item and every LATER item of its branch.
  for (let i = 0; i < items.length; i++) {
    if (items[i].status !== "pending") continue;                    // not pending: no C
    for (let j = i + 1; j < items.length; j++) {                    // every LATER item
      if (!anc(i, j)) continue;                                     // another branch: passes
      if (!closed(items[j].status)) continue;                       // open descendant: D/B own it
      slotOf(i).closed_descendant.push(j);                          // the pending item offends
    }
  }

  const out: OrderingViolation[] = [];
  for (const offender of [...acc.keys()].sort((a, b) => a - b)) {   // offenders in list order
    // for one offender: ip line, pending line, open-descendant line, closed-descendant line
    for (const reason of [
      "in_progress",
      "pending",
      "open_descendant",
      "closed_descendant",
    ] as const) {
      const blockers = acc.get(offender)![reason].sort(
        (p, q) =>
          Math.abs(p - offender) - Math.abs(q - offender) || q - p,  // nearest first
      );
      if (blockers.length === 0) continue;
      out.push({
        itemId: items[offender].id,
        number: numbers[offender],
        offenderStatus: items[offender].status,   // the formatter's head: start/close/revert (§4)
        blockerIds: blockers.map((k) => items[k].id),
        blockerNumbers: blockers.map((k) => numbers[k]),
        reason,
      });
    }
  }
  return out;
}
```

Five properties the implementation must keep:

- **One record per pair.** Every `(i, j)` is visited exactly once, so no
  de-duplication pass is needed and no blocker is listed twice for one offender.
  The three rules cannot visit the same pair: D pairs an **open earlier** member
  with a **started later** one, B pairs a **closed earlier** member with an
  **open later** one, C pairs a **pending earlier** member with a **closed later**
  one.
- **At most two records per offender** — D can yield two groups (`in_progress`,
  then `pending`), whether the offender is in progress or closed; B adds
  `open_descendant` to a closed offender, C yields the single `closed_descendant`
  group for a pending one. A blocker has exactly one status, and an offender's own
  status fixes which groups it can produce: `{in_progress, pending}` for a started
  item, `{in_progress, pending, open_descendant}` for a closed one, and
  `{closed_descendant}` for a pending one. Offenders are emitted in list order; for
  one offender the records come in the fixed order of §4.
- **Blockers in full.** No block is truncated or collapsed: every unmet
  prerequisite is listed (D7). A pending blocker needs to be started or closed, an
  in-progress blocker needs to be closed, an open descendant needs to be closed or
  removed — the message is the whole to-do list.
- **`closes` is a declaration, not a selector.** Rule B's offender is always the
  closed member — the only item of the pair whose close can be denied — so the set
  cannot change a verdict, a line or a blocker. It is still required of every call
  site, exactly like `starts`, so the op states what it did (and a future op that
  closes several items does not change the signature). T35 pins the equality: the
  same candidate yields the same text with `closes` empty and with `closes` naming
  the offender. It cannot change rule D's closed branch either, for the same reason:
  a closed item's line has exactly one possible subject (§2.1). Making `closes` a
  *filter* would silently tolerate an inherited illegal state — the whole-candidate
  rule (§3) forbids that.
- **`reverts` is a declaration too — the same class as `closes`.** Rule C's
  offender is always the pending member — the only item of the pair whose pending
  state can be denied — so the set cannot change a verdict, a line or a blocker.
  It is required of every call site so the op states what it did, and T46 pins the
  equality (the same candidate yields the same text with `reverts` empty and with
  `reverts` naming the offender). The `starts`-style "blame the item I moved"
  fallback was **considered and rejected for rule C** (D14): when the op *closes*
  a descendant under a pending ancestor, that fallback would blame a `completed`
  item and produce the impossible sentence `cannot revert <closed> to pending`.
  Rule C, like rule B, has exactly one possible offender.

### 2.2 Verified verdicts for every case the USER and the reviewer named

Rows **A–X** were executed 2026-10-31 00:40 on node **v24.15.0** against the real
`format.ts` / `deriveNumbers` (numbers and levels printed as computed, never
asserted); the fixtures are `write` items in list order, `[status@depth, …]`, ids
1…n (except W, where the ids are named). `in progress` lists derived numbers.

Rows **N1–N9** (rule B) were executed 2026-10-31 02:10 in the Code Mode JS sandbox
against a **verbatim copy of `deriveNumbers`** taken from `format.ts` (this session
has no shell: `browser-use`'s daemon is down and Playwright's VM blocks
`require`/`import` — declared, not skipped). They are contract evidence, not
plugin evidence: the DEVELOPER must reproduce them against the real file in the
red digest before touching `order.ts`. **A–X were re-derived under A+B**: every
verdict is unchanged and every text is unchanged except **row Q**, which gains rule
B's line (its fixture has a completed `2` with a pending `2.1`, which v0.3.3
accepted) and **row R**, whose text was already wrong under rule A alone — the `2`
in that candidate is `in_progress`, so it cannot be listed as "not in progress"
(corrected here; §6 T12a).

Rows **Y1–Y24** (rule C) were executed 2026-10-31 09:20 in the **Code Mode JS
sandbox**, against a verbatim copy of `deriveNumbers` from `format.ts` **plus the
§2.1 reference implementation including rule C** (this session again has no shell
— declared, not skipped; the same caveat as N1–N9: contract evidence, not plugin
evidence). Y1–Y16 are the complete 4×4 matrix of (ancestor status × descendant
status) at depth 1; Y17–Y24 are the depth-2 chains, the B+C compositions and the
legal counterparts. They confirm the scope claim of §2: rule C changes **exactly
two cells** (Y3, Y4).

Rows **D1–D6** (rule D) are the USER's three cases from his own store plus the
cells the rule was feared to break: D1–D3 are the refusals (term 1 and term 2 with
the `close` verb), D4–D6 are the legal guards. They were re-derived with the **same**
method as Y1–Y24 (verbatim `deriveNumbers` + the §2.1 body) and are contract
evidence: the DEVELOPER reproduces them against the real `order.ts` in the red
digest (T52–T60).

**Re-derivation under A+B+C — what the new rule broke in the old fixtures.**
`FOUR_TWO_PRE` had `4` **pending** above `4.1` **completed**: the USER's own
example-C pre-state is itself an invalid state under rule C. It therefore becomes
`FOUR_TWO_PRE_C` with `4.1` **pending**, and three things follow:
**row F** and **row Fb** gain `4.1` as a `not in progress` blocker (`4.1` sorts
before `4` — nearest first), **row U** likewise, and **row T (T5)** needs two
extra legal steps (`4.1 → in_progress`, `4.1 → completed`) before `4.2` may start
— because a `pending` sibling may no longer be skipped. The old literal fixture
survives as **row P2 (T51)**, where it pins the **C+A composition** instead
(offender `4` via C, offender `4.2` via A). **Row N9 / T35** is re-derived with
`1` **in_progress** instead of `pending` (`[I@0, C@1, P@1]`): with a pending `1`
the pre-removal list was already C-illegal, and its text (`cannot close 1: 1.1 is
still open.`) is unchanged. Every other row of A–X and N1–N9 keeps its verdict
and its exact text.

| # | fixture | in progress | this law | required |
| --- | --- | --- | --- | --- |
| A | `[I@0, I@1]` — `{1, 1.1}` | `1, 1.1` | **legal** | legal (ancestor in progress) |
| B | `[P@0, I@1]` — `{1.1}`, `1` pending | `1.1` | **illegal** (1.1 ← 1) | illegal |
| C | `[C@0, C@0, I@0, I@1, C@2, I@2]` — `{3, 3.1, 3.1.2}` | `3, 3.1, 3.1.2` | **legal** | legal |
| D | `[C@0, C@0, I@0, I@1, P@0, P@1, P@1, I@1]` — `{3, 3.1, 4.3}` (T3) | `3, 3.1, 4.3` | **illegal** (4.3 ← 3.1, 3 / 4.2, 4.1, 4) | illegal |
| E | `[C@0, C@0, I@0, P@0, P@1, P@1, I@1]` — `{3, 4.3}` (T15a) | `3, 4.3` | **illegal** (4.3 ← 3 / 4.2, 4.1, 4) | illegal |
| F | `FOUR_TWO_PRE_C` (`4.1` **pending** — see the note below) + `update 4.2 → in_progress` (`3.7` in progress) (T4) | `3, 3.7, 4.2` | **illegal** (4.2 ← 3.7, 3 / 4.1, 4) | illegal |
| Fb | `FOUR_TWO_PRE_C` with `3.7` pending + `update 4.2` | `3, 4.2` | **illegal** (4.2 ← 3 / 4.1, 4, 3.7) | illegal |
| G | `[C@0, C@0, I@0, P@1, P@2, I@2]` — level gap `{3, 3.1.2}`, `3.1` pending (T16) | `3, 3.1.2` | **illegal** (3.1.2 ← 3.1.1, 3.1) | illegal |
| H | `[I@0, I@0, I@0]` (T20) | `1, 2, 3` | **illegal** (2 ← 1; 3 ← 2, 1) | illegal |
| I | `[C@0, I@0, I@1, P@1, P@1]`, one `update` starting 2.2 **and** 2.3 (T19) | `2, 2.1, 2.2, 2.3` | **illegal** (2.2 ← 2.1; 2.3 ← 2.2, 2.1) | illegal |
| J | `[C@0, C@0, I@0, I@1, I@0]` — second root (T10) | `3, 3.1, 4` | **illegal** (4 ← 3.1, 3) | illegal |
| K | `[C@0, I@0]` + `add` `I@0` (T13b) | `2, 3` | **illegal** (3 ← 2) | illegal |
| L | `[I@0, I@1, P@0, I@1]` + `remove` re-clamping to `1.1` (T21) | `1, 1.1, 2.1` | **illegal** (2.1 ← 1.1, 1 / 2) | illegal |
| M | `[C@0, P@0, I@1]` — pending parent (T8) | `2.1` | **illegal** (2.1 ← 2) | illegal |
| N | `[C@0, I@0, P@1, I@1]` — skipped sibling `{2, 2.2}` (T9) | `2, 2.2` | **illegal** (2.2 ← 2.1) | illegal |
| O | `[P@0, P@1, I@0]` — entirely pending branch (T14) | `2` | **illegal** (2 ← 1.1, 1) | illegal |
| P | `[C@0, C@0, I@0, P@0, P@1, I@1]` — `{3, 4.2}`, `4.1` pending (T15b, re-derived) | `3, 4.2` | **illegal** (4.2 ← 3 / 4.1, 4) | illegal |
| P2 | `[C@0, C@0, I@0, P@0, C@1, I@1]` — `{3, 4.2}` with `4.1` **closed**: C+A composition (T51) | `3, 4.2` | **illegal** (4 ← 4.1 already closed; 4.2 ← 3 / 4) | illegal |
| Q | `[C@0, C@0, P@1, I@0, P@1]` — closed `2` with a dangling `pending` `2.1` **and** start `3` (T7) | `3` | **illegal** (2 ← 2.1 open descendant; 3 ← 2.1) | illegal |
| R | legacy `[I@0, I@0, P@0, P@1]`, `update 1 → cancelled` + `3.1 → in_progress` (T12a) | `3.1` | **illegal** (3.1 ← 2 in progress / 3 pending) | illegal |
| S | legacy `[I@0, I@0]`, `update 1 → cancelled` only (T12 corrective) | `2` | **legal** | legal |
| T | `FOUR_TWO_PRE_C`: `3.7→C`, then `3→C`+`4→I`, then `4.1→I`, `4.1→C`, `4.2→I` (T5, re-derived) | `4` then `4, 4.1` then `4, 4.2` | **legal** at every step | legal |
| U | legacy store (`4.2` already in progress, written behind the tool's back) + start `3.7` | `3, 3.7, 4.2` | **illegal** (3.7 ← 4.2; 4.2 ← 3 / 4.1, 4) | illegal |
| V | `[P@0, P@0, P@0, P@0, I@0]` — start the 5th of five | `5` | **illegal** (5 ← 4, 3, 2, 1) | illegal |
| W | `[P@0 id1, I@0 id2, P@0 id3, I@0 id4]` — two branches running | `2, 4` | **illegal** (2 ← 1; 4 ← 2 / 3, 1) | illegal |
| X | `[C@0, C@0, C@1, I@0, I@1]` — after Q's child is closed | `3, 3.1` | **legal** | legal |
| N1 | `[C@0, P@1]` — `1 completed`, `1.1 pending` (T32a) | — | **illegal** (1 ← 1.1 open) | illegal |
| N2 | `[C@0, I@1]` — `1 completed`, `1.1 in_progress` (T32b) | `1.1` | **illegal** (1 ← 1.1 open) | illegal |
| N3 | `[X@0, P@1]` — `1 cancelled`, `1.1 pending` — **the USER's report** (T32c) | — | **illegal** (1 ← 1.1 open) | illegal |
| N4 | `[C@0, X@1]` — `1 completed`, `1.1 cancelled` (T34) | — | **legal** | legal (`cancelled` counts as closed) |
| N5 | `[C@0, C@1]` — `1 completed`, `1.1 completed` (T34) | — | **legal** | legal |
| N6 | `[C@0, C@0, C@0, P@1, P@2, P@2]` — `3 completed` under `3.1`/`3.1.1`/`3.1.2` pending (T33) | — | **illegal** (3 ← 3.1, 3.1.1, 3.1.2 open) | illegal |
| N7 | `[C@0, C@1, C@2, P@2]` — `1` and `1.1` closed, `1.1.2` open | — | **illegal** (1 ← 1.1.2; 1.1 ← 1.1.2) | illegal (every closed ancestor is named) |
| N8 | `[C@0, P@1, P@0, I@0]` — rules A **and** B broken in one candidate, `starts = {4}`, `closes = {1}` | `3` | **illegal** (close 1 ← 1.1; start 3 ← 2, 1.1) | illegal |
| N9 | `[I@0, C@1, P@1]` — legal as it stands; after `remove id 1` it becomes `[C@0, P@1]` (T35, re-derived) | — | **legal**; the removal makes it **N1** | the removal is illegal |
| Y1 | `[P@0, P@1]` — pending / pending | — | **legal** | legal (the plan: a branch nobody started) |
| Y2 | `[P@0, I@1]` — pending / in_progress (**= row B**) | `1.1` | **illegal** — rule **A**, not C | illegal |
| Y3 | `[P@0, C@1]` — pending / completed | — | **illegal** — **rule C (NEW)** | illegal |
| Y4 | `[P@0, X@1]` — pending / cancelled | — | **illegal** — **rule C (NEW)** | illegal |
| Y5 | `[I@0, P@1]` — in_progress / pending | `1` | **legal** | legal (started parent, child not started) |
| Y6 | `[I@0, I@1]` — in_progress / in_progress (**= row A**) | `1, 1.1` | **legal** | legal (the chain) |
| Y7 | `[I@0, C@1]` — in_progress / completed | `1` | **legal** | legal (bottom-up close) |
| Y8 | `[I@0, X@1]` — in_progress / cancelled | `1` | **legal** | legal |
| Y9 | `[C@0, P@1]` — completed / pending (**= N1**) | — | **illegal** — rule **B** | illegal |
| Y10 | `[C@0, I@1]` — completed / in_progress (**= N2**) | `1.1` | **illegal** — rule **B** | illegal |
| Y11 | `[C@0, C@1]` — completed / completed (**= N5**) | — | **legal** | legal |
| Y12 | `[C@0, X@1]` — completed / cancelled (**= N4**) | — | **legal** | legal |
| Y13 | `[X@0, P@1]` — cancelled / pending (**= N3**) | — | **illegal** — rule **B** | illegal |
| Y14 | `[X@0, I@1]` — cancelled / in_progress | `1.1` | **illegal** — rule **B** | illegal |
| Y15 | `[X@0, C@1]` — cancelled / completed | — | **legal** | legal (a closed descendant does **not** constrain a cancelled ancestor) |
| Y16 | `[X@0, X@1]` — cancelled / cancelled | — | **legal** | legal |
| Y17 | `[P@0, P@1, C@2]` — `1.1.1` completed under two pending ancestors (T41) | — | **illegal** — **C, two offenders** | illegal (every pending ancestor is named) |
| Y18 | `[P@0, P@1, I@2]` — `1.1.1` in progress under two pending ancestors | `1.1.1` | **illegal** — rule **A** only | illegal (C adds nothing: the descendant is not closed) |
| Y19 | `[C@0, P@1, C@2]` — `1` completed, `1.1` pending, `1.1.1` completed (T42a) | — | **illegal** — **B (offender 1) + C (offender 1.1)** | illegal |
| Y20 | `[P@0, C@1, P@2]` — `1` pending, `1.1` completed, `1.1.1` pending (T42b) | — | **illegal** — **C (offender 1) + B (offender 1.1)** | illegal |
| Y21 | `[I@0, I@1, C@2]` — the deep legal chain with a closed leaf (T47) | `1, 1.1` | **legal** | legal |
| Y22 | `[I@0, C@1, C@2]` — `1` started, both descendants closed | `1` | **legal** | legal |
| Y23 | `[I@0, C@1, P@2]` — `1.1` completed with a pending child | `1` | **illegal** — rule **B** only | illegal |
| Y24 | `[P@0, C@1, C@2]` — two closed descendants under one pending item (T43) | — | **illegal** — **C, plural** | illegal |
| D1 | `[I@0, C@1, C@1, P@1, C@1]` — **USER's case 1**: `1.4` closed, `1.3` still `pending` | `1` | **illegal** — **D (NEW)**: 1.4 ← 1.3 | illegal |
| D2 | `[I@0, C@0, C@0]` — **USER's case 2**: `2` and `3` closed while `1` runs | `1` | **illegal** — **D**: 2 ← 1; 3 ← 1 | illegal |
| D3 | `[I@0, C@1, C@1, P@1, C@0, C@0, P@0, P@0, C@0]` — **USER's case 3** (reduced): `6` closed with `5` pending, `1` running | `1` | **illegal** — **D**: 2 ← 1; 3 ← 1; 6 ← 1 / 5, 4, 1.3 | illegal |
| D4 | `[I@0, C@1]`, `[C@0, C@1]`, `[I@0, X@1]`, `[X@0, C@1]` — the legal cells D4 was feared to break | `1` (rows 1 and 3) | **legal** — term 3 (bottom-up close) and plain `CLOSED` | legal |
| D5 | `[C@0, C@0, P@0]` — a fully closed prefix with a trailing `pending` root (T57) | — | **legal** — D only constrains items that are started | legal |
| D6 | `[I@0, C@1, P@1]` — started parent, closed child, `pending` later item (T56) | `1` | **legal** — the closed child passes by term 3 (bottom-up close) and the `pending` item comes **after** the started one | legal |

Every row matches the required verdict. Exact output of the illegal rows
(character for character; `Nothing was changed.` is the last line of each):

```

> **Every item named in a rejection carries its STABLE ID next to the display
> number** (`cannot start 4.3 (id 8): 3.1 (id 4) is not in progress.`). The number
> is regenerated on every insert/remove, so a caller that reads only `4.3` cannot
> address the item afterwards; the id is what it must send back (2026-11-05).
B   ERROR: cannot start 1.1 (id 2): 1 (id 1) is not in progress.

D   ERROR: cannot start 4.3: 3.1, 3 are still in progress.
    ERROR: cannot start 4.3: 4.2, 4.1, 4 are not in progress.

E   ERROR: cannot start 4.3: 3 is still in progress.
    ERROR: cannot start 4.3: 4.2, 4.1, 4 are not in progress.

F   ERROR: cannot start 4.2: 3.7, 3 are still in progress.
    ERROR: cannot start 4.2: 4.1, 4 are not in progress.

Fb  ERROR: cannot start 4.2: 3 is still in progress.
    ERROR: cannot start 4.2: 4.1, 4, 3.7 are not in progress.

G   ERROR: cannot start 3.1.2: 3.1.1, 3.1 are not in progress.

H   ERROR: cannot start 2: 1 is still in progress.
    ERROR: cannot start 3: 2, 1 are still in progress.

I   ERROR: cannot start 2.2: 2.1 is still in progress.
    ERROR: cannot start 2.3: 2.2, 2.1 are still in progress.

J   ERROR: cannot start 4: 3.1, 3 are still in progress.

K   ERROR: cannot start 3: 2 is still in progress.

L   ERROR: cannot start 2.1: 1.1, 1 are still in progress.
    ERROR: cannot start 2.1: 2 is not in progress.

M   ERROR: cannot start 2.1: 2 is not in progress.

N   ERROR: cannot start 2.2: 2.1 is not in progress.

O   ERROR: cannot start 2: 1.1, 1 are not in progress.

P   ERROR: cannot start 4.2: 3 is still in progress.
    ERROR: cannot start 4.2: 4.1, 4 are not in progress.

P2  ERROR: cannot revert 4 to pending: 4.1 is already closed.
    ERROR: cannot start 4.2: 3 is still in progress.
    ERROR: cannot start 4.2: 4 is not in progress.

Q   ERROR: cannot close 2: 2.1 is still open.
    ERROR: cannot start 3: 2.1 is not in progress.

N1  ERROR: cannot close 1: 1.1 is still open.

N2  ERROR: cannot close 1: 1.1 is still open.

N3  ERROR: cannot close 1: 1.1 is still open.

N6  ERROR: cannot close 3: 3.1, 3.1.1, 3.1.2 are still open.

N7  ERROR: cannot close 1: 1.1.2 is still open.
    ERROR: cannot close 1.1: 1.1.2 is still open.

N8  ERROR: cannot close 1: 1.1 is still open.
    ERROR: cannot start 3: 2, 1.1 are not in progress.

N9  ERROR: cannot close 1: 1.1 is still open.          (candidate AFTER `remove id 1`)

R   ERROR: cannot start 3.1: 2 is still in progress.
    ERROR: cannot start 3.1: 3 is not in progress.

U   ERROR: cannot start 3.7: 4.2 is still in progress.
    ERROR: cannot start 4.2: 3 is still in progress.
    ERROR: cannot start 4.2: 4.1, 4 are not in progress.

V   ERROR: cannot start 5: 4, 3, 2, 1 are not in progress.

W   ERROR: cannot start 2: 1 is not in progress.
    ERROR: cannot start 4: 2 is still in progress.
    ERROR: cannot start 4: 3, 1 are not in progress.
```

Rule C's own rows (each one ends with `Nothing was changed.`):

```
Y3  ERROR: cannot revert 1 to pending: 1.1 is already closed.

Y4  ERROR: cannot revert 1 to pending: 1.1 is already closed.

Y17 ERROR: cannot revert 1 to pending: 1.1.1 is already closed.
    ERROR: cannot revert 1.1 to pending: 1.1.1 is already closed.

Y19 ERROR: cannot close 1: 1.1 is still open.
    ERROR: cannot revert 1.1 to pending: 1.1.1 is already closed.

Y20 ERROR: cannot revert 1 to pending: 1.1 is already closed.
    ERROR: cannot close 1.1: 1.1.1 is still open.

Y24 ERROR: cannot revert 1 to pending: 1.1, 1.1.1 are already closed.
```

Rule D's own rows (each one ends with `Nothing was changed.`):

```
D1  ERROR: cannot close 1.4: 1.3 is not in progress.

D2  ERROR: cannot close 2: 1 is still in progress.
    ERROR: cannot close 3: 1 is still in progress.

D3  ERROR: cannot close 2: 1 is still in progress.
    ERROR: cannot close 3: 1 is still in progress.
    ERROR: cannot close 6: 1 is still in progress.
    ERROR: cannot close 6: 5, 4, 1.3 are not in progress.
```

D4, D5 and D6 produce **no line** — they are legal. In D3 the two lines of
offender `6` are the USER's own text, character for character: the in-progress
group first, then the `pending` group with its blockers **nearest first**
(`5`, `4`, `1.3` — distances 1, 2, 5), and `1` never appears in both groups because
a blocker has exactly one status.

Y1, Y5, Y6, Y7, Y8, Y11, Y12, Y15, Y16, Y21 and Y22 produce **no line** — they
are legal. Y2, Y9, Y10, Y13, Y14, Y18 and Y23 produce exactly their A/B lines and
nothing more: rule C does not touch them.

Two properties these verdicts settle, both of which v0.3.2 got wrong: an
in-progress item **never** legalizes an earlier sibling or another branch (N, O,
V, W), and a `pending` ancestor **never** legalizes its child (M, E, P, G). The
level arithmetic is irrelevant to all of it: `4.3` is level 1 and `3.1.2` is level
2, but what blocks `4.3` is that `3.1` and `3` sit before it, and what blocks
`3.1.2` is that `3.1` and `3.1.1` sit before it.

Rule B settles three more: **closing is not a way out of the branch** — a closed
item with an open descendant is refused whether the descendant is `pending` (N1,
N3, N6) or `in_progress` (N2), `cancelled` still counts as closed (N4), and the
way out is to close the descendants first (N5, `3.1.1`/`3.1.2` → `3.1` → `3`).
N8 is the composition: one candidate, rules A and B broken, all three lines in one
refusal, close line first because offender `1` sits before offender `3` in the
list. N9 is the removal that would *create* the state: the pre-removal list is
legal, the post-removal candidate is not, so the removal is refused.

Rule C settles two more, and they are the USER's own case from the other side:
**un-starting is not a way out of the branch either** — a `pending` item with a
closed descendant is refused whether that descendant is `completed` (Y3) or
`cancelled` (Y4), and the refusal names the **pending ancestor** (Y3: `cannot
revert 1 to pending: 1.1 is already closed.`), not the closed child. Y15 is the
mirror-image non-case worth stating: a closed descendant does **not** constrain a
`cancelled` ancestor — `1 cancelled` + `1.1 completed` stays legal (N4, Y15),
because a cancelled branch is a finished branch, and rule B only demands that its
descendants be closed too. Y17 shows the deep chain (every pending ancestor is
named, exactly as N7 names every closed one); Y19/Y20 are the two-way composition
of B and C on one candidate — offender order decides the line order (candidate
index), not the rule number. Y18/Y23 are the negative controls: an `in_progress`
descendant is rule A's business (or legal under a started ancestor), and a closed
item with a pending child is rule B's.

Rule D settles the gesture the USER reported from his own store: **finishing is not
a way to jump the queue either**. `1.4` closed over a `pending` `1.3` (D1), `2` and
`3` closed while `1` still runs (D2), `6` closed behind `4`/`5` (D3) are all refused,
and each line names the **closed** item with the verb `close` — the class of state
being refused — never `start`. The legal cells of D4 are the guard against
over-refusal: closing a child under its running parent (term 3, Y7), a closed child
under a closed parent (N5) and a cancelled child under a running parent (Y8) all
stay accepted; D5/D6 pin that a `pending` suffix is never a violation by itself — D
constrains only items that have **started**.

### 2.3 REJECTED law — "one in-progress item per level" (v0.3.2, shipped, now withdrawn)

```
legal(list)  iff  ∀ p, q ∈ IN_PROGRESS, p ≠ q :  level(p) ≠ level(q)
```

**REJECTED by the USER on 2026-10-31, verbatim (pt-BR):**
*"Como que o 1.1 pode estar em andamento se a 1 ainda nao iniciou?"*

Live use killed it: the shipped tool accepted `{1.1}` while `1` was pending (T8),
`{2, 2.2}` with `2.1` skipped (T9), an entirely pending earlier branch (T14),
`{3, 4.3}` (T15a), `{3, 4.2}` (T15b) and the level gap `{3, 3.1.2}` (T16). The
USER calls every one of those states invalid: a descendant may not run while its
ancestor has not started, and an item may not be skipped. The law worked because
`pending` was declared non-blocking — true only for items *after* the running one.

It must be rewritten from §2.1. Its rows are flipped in §6 (T8, T9, T14, T15a,
T15b, T16 become ILLEGAL) and the `order.ts` header, the tool `description`, the
`README.md` and `todo-list-spec.md` §13 all still state it (§5, §8 OPEN).

A second, weaker variant is rejected too — the **ancestry-only** law of v0.3.0
("all in-progress items are in one ancestor chain, order ignored"):

```
legal(list) iff ∀ p,q ∈ IN_PROGRESS, p≠q:
  numbers[p].startsWith(numbers[q] + ".") || numbers[q].startsWith(numbers[p] + ".")
```

It gets B, C, D, E, F, G, H right but accepts `[P@0, I@1]` — a child running under
a `pending` parent — which is exactly the USER's counterexample above. The shipped
law (§2) is strictly stronger: ancestry **plus** order.

## 3. Op-level behaviour

| op | validated? | when | on violation |
| --- | --- | --- | --- |
| `read` | no | — | — |
| `write` | **yes** | after `buildItems` + `clampDepthAt`, before writing | rejected **whole** — nothing written, existing list byte-identical (`nextId` unchanged) |
| `add` | **yes** | after the `after:`-insert merge + clamps, before `writeList` | rejected whole; nothing added |
| `update` | **yes** | after **all** changes and clamps (one candidate list), before `writeList` | rejected whole; file untouched |
| `remove` | **yes** (fail-closed) | after `keep` is built, before `writeList` | rejected; removals that fix a violation are accepted, removals that create one (N9) are refused |
| `clear` | no | — | always allowed (empty list is legal) — escape hatch |

Empty-result branches (`write []`, `remove` leaving nothing) run first and are
never rejected.

**Three rules, the same four ops.** Rules B and C validate exactly the ops rule D
validates — `write`, `add`, `update`, `remove` — at the same points, with the same
whole-list refusal. Nothing new is validated and no new op is guarded: `read` and
`clear` never produce a new state, so neither can create a closed item with an
open descendant (B) nor a closed descendant under a pending item (C). A `write`
or `add` that *arrives* with such a state is refused exactly like an `update` that
closes into it (N1–N3, N6; Y3, Y4).

Rule C per op — **all four can produce it, and each through a different
mechanism** (all four executed, §6 T36–T51):

| op | how rule C is produced | example |
| --- | --- | --- |
| `update` | **status revert**: an item with a closed descendant is set back to `pending` | T36: `1 completed` + `1.1 completed`, `update 1 → pending` |
| `update` | **depth move**: an item's `depth` changes so it lands under a `pending` ancestor — **unreachable since v0.3.6** (the pre-state needs a closed item behind a `pending` one, which rule D forbids): the retired T50 | — |
| `write` | the list arrives with a `pending` item above a closed one | T40: `write [P@0, C@1]` |
| `add` | **`after:` + `depth` insertion**: the new `pending` item becomes the parent of an existing **closed** item (it must be inserted *before* that item and one level shallower — the closed item is renumbered to `N.1`) | T44: `[I@0, I@1, C@2]` + `add {after: id 2, depth: 1, status: pending}` → `1.2` pending over `1.2.1` closed |
| `remove` | **re-clamping**: the removed item's child is re-parented to the item that now precedes it, which may be `pending` — **unreachable since v0.3.6**, same reason: the retired T45 | — |

`add` at the **end** of the list can never create it (nothing follows it), and a
removal that *removes* a closed descendant or a pending ancestor fixes it and is
accepted (D9).

**Whole-candidate rationale.** `remove` and `after:` insertion rewrite the
numbers, and the numbers carry the ancestry: deleting a parent re-parents its
children, a `depth` change moves an item in or out of a chain, and any of those
turns an item that was legal into one whose earlier items are no longer closed.
A per-item check cannot see that. So every mutating op validates the complete list
it is about to store — `remove` included, and a `remove`/`update` that *fixes* a
violation is still accepted. Invariant: **every stored list satisfies the law.**

Legacy lists are not migrated; the next mutating op validates them; `clear` and
any corrective `update`/`remove` always remain available. Nothing about the rule
is stored — no schema drift.

## 4. Exact error text (character for character)

One line per **offender and reason** (§4.1): offenders in **ascending candidate
index**, and for one offender the lines come in one fixed order —

1. `still in progress.` (rule D, blocker `in_progress` — verb `start` or `close`, §4 table)
2. `not in progress.` (rule D, blocker `pending` — verb `start` or `close`, §4 table)
3. `still open.` (rule B, open descendant)
4. `already closed.` (rule C, closed descendant)

— the same grouping discipline as before, with the close rule and then the
pending rule appended in that order. **The four groups are unchanged by rule D**:
D feeds groups 1–2 with whichever verb its offender's status dictates; it adds no
group, only strings. Each line lists its blockers **nearest first** (ascending
`|index(offender) − index(blocker)|`, tie broken by the **later** index),
de-duplicated. Then a trailer.

Four reasons, **twelve** sentences (six shapes × singular/plural); the
singular/plural pair follows the blocker count of **that line**. The **head**
follows the **offender's status** (`offenderStatus` on the record, §2.1) —
`in_progress` → `cannot start `, closed → `cannot close `, `pending` →
`cannot revert ` + ` to pending` — so rule D and rule B share the `close` head,
which is exactly why rule D adds only four strings and no new grammar:

| reason | offender | one blocker | several blockers |
| --- | --- | --- | --- |
| `in_progress` | `in_progress` | `ERROR: cannot start <N>: <B> is still in progress.` | `ERROR: cannot start <N>: <B1>, <B2> are still in progress.` |
| `pending` | `in_progress` | `ERROR: cannot start <N>: <B> is not in progress.` | `ERROR: cannot start <N>: <B1>, <B2> are not in progress.` |
| `in_progress` | **closed** (rule **D**) | `ERROR: cannot close <N>: <B> is still in progress.` | `ERROR: cannot close <N>: <B1>, <B2> are still in progress.` |
| `pending` | **closed** (rule **D**) | `ERROR: cannot close <N>: <B> is not in progress.` | `ERROR: cannot close <N>: <B1>, <B2> are not in progress.` |
| `open_descendant` | `closed` | `ERROR: cannot close <N>: <B> is still open.` | `ERROR: cannot close <N>: <B1>, <B2> are still open.` |
| `closed_descendant` | `pending` | `ERROR: cannot revert <N> to pending: <B> is already closed.` | `ERROR: cannot revert <N> to pending: <B1>, <B2> are already closed.` |

- trailer, always: `Nothing was changed.`

`<N>`/`<B>` are derived numbers of the **candidate** list. Ids stay in the
structured violation. A pair carries exactly one reason (its blocker has one
status), so an offender yields **at most two** lines (rule D's two groups) and
never a mixed sentence; `is`/`are` never straddles two reasons, and a single line
never mixes `start`, `close` or `revert`. An **in-progress** offender carries only
groups 1–2; a **closed** offender carries groups 1–2 (rule D) and group 3 (rule B),
so it may also reach two lines; a **pending** offender carries only group 4. The
head and the offender's own status always agree — `cannot close <N>` names an item
that really is `completed`/`cancelled` in the candidate, `cannot start <N>` an item
that really is `in_progress` — and the fixed order keeps the formatter a single loop
and the output deterministic.

**Composition — one op, all rules.** A refusal carries every offender of the
candidate, whatever produced it, in candidate order; there is no priority, no
"first rule wins" and no second message. Three shapes:

(a) one offender per rule, close first because it sits earlier in the list
   (N8), and the open descendant is also a rule-A blocker of the item being
   started:
```
ERROR: cannot close 1: 1.1 is still open.
ERROR: cannot start 3: 2, 1.1 are not in progress.
Nothing was changed.
```
Both statements are true and both are needed: the caller must close `1.1` **and**
`2`. Line order is candidate order, not rule order — a close line is not
privileged.

(b) two offenders of the close rule, the same open item under two closed
   ancestors (N7) — one line per offender and reason, every closed ancestor is
   named:
```
ERROR: cannot close 1: 1.1.2 is still open.
ERROR: cannot close 1.1: 1.1.2 is still open.
Nothing was changed.
```
The first line is the real fix (close the whole branch `1.1`…`1.1.2` before `1`);
the second reports that `1.1` is itself closed while `1.1.2` is open — a state the
candidate cannot keep either.

(c) both branch rules on one candidate, one offender each — the pending-rule line
   obeys the same candidate order as every other (Y19):
```
ERROR: cannot close 1: 1.1 is still open.
ERROR: cannot revert 1.1 to pending: 1.1.1 is already closed.
Nothing was changed.
```
`1` is closed over an open `1.1`, and `1.1` is pending over a closed `1.1.1`:
rules B and C catch **different offenders** on the same list, so the refusal
carries one line from each, ordered by offender index, never by rule number.
Reversing the statuses (Y20) swaps the lines, not the rules:
`cannot revert 1 to pending: 1.1 is already closed.` comes first because
offender `1` sits first.

**On the verb.** `cannot close <N>` names the **state class being refused** — a
closed item with an open descendant — not necessarily the field the call touched.
`remove` has no close set at all (§4.1) and can still produce this line (N9): the
removal re-parents an open item under an already closed one. The sentence is
therefore read like the `cannot start` lines of a `remove` (§4.1(b), T21): nothing
is persisted, so it describes the state that was refused. The blocker number is
the way out: close or remove the descendant first, then close (or delete) the
parent.

**On the verb, rule C: `cannot revert <N> to pending`.** Same doctrine — the verb
names the **state class being refused** (`<N>` is `pending` while a descendant is
closed), not the field the call touched. `revert … to pending` is chosen over
`cannot leave/keep/set <N> pending` because it is the USER's own word for the
gesture (*"o 1 pode nao ter comecado"*, live report: the tool let `1` be set back
to `pending`) and because it names the resulting state unambiguously; it is used
by **every** op, `write`, `add` and `remove` included, exactly as `remove` already
uses `cannot close` (§4.1(g), T35). So closing `1.1` under a `pending` `1`
(T48a) answers `ERROR: cannot revert 1 to pending: 1.1 is already closed.` even
though the call was about `1.1` — the candidate is what is refused, and the way
out is to start `1` first (or delete/revert `1.1`), which T48 pins as accepted.
The alternative of a direction-aware second sentence (`cannot close 1.1: 1 has not
been started.`) was **rejected**: it doubles the grammar for one more line shape
and contradicts the whole-candidate doctrine shared with B (D17).

### 4.1 Attribution — which item is the offender (and which is the blocker)

**Defect this fixes** (reproduced 2026-10-30 with the real plugin, temp `$HOME`):
seed `3` in progress, `3.1`…`3.7` pending, `4`, `4.1`, `4.2` pending;
`update 4.2 → in_progress` **accepted**; then `update 3.7 → in_progress` answered

```
ERROR: cannot start 4.2: 3.7 is still in progress.
```

— it blamed `4.2`, the item **already running**, and called `3.7` (the item the
call was starting) "still in progress". The model reads a sentence that
contradicts the call it made. Under the restored law that exact reproduction is
no longer reachable through the tool (the `4.2` start is itself refused, §2.2 F),
but the principle stands and is what row U of §2.2 exercises on a store written
behind the tool's back: **the line for the pair involving the started item names
the started item.**

**Rule.** Each violating pair is reported against the item **this op starts** (the
offender); the other member is the blocker. `starts` is defined per op:

| op | `starts` (ids) |
| --- | --- |
| `update` | ids whose status **transitions** to `in_progress` (`before !== "in_progress"` and `after === "in_progress"`). Capture the prior statuses **before** mutating. Re-sending `in_progress` for an item already in progress is **not** a start. |
| `add` | the ids of the newly created items that arrive with `status: "in_progress"`. |
| `write` | **every** `in_progress` item of the candidate list — the list is replaced, so no item has a prior state and no item is "already running". |
| `remove` | **empty set** — a removal never starts anything. |

When **both** members of a pair are starts (one `update` starting two items, or a
`write`), or **neither** is (reachable through `remove`, through an `update` that
only moves `depth`, or through an `add` that re-parents), the pair falls back
deterministically: **later item in the candidate list = offender, earlier =
blocker** — which, in this directed law, is the in-progress member `i` itself.
So, for rule D's **in-progress** half, the offender is always an in-progress item
of the candidate list; the blocker is whatever earlier item blocks it (in progress
or pending).

**Rule D's closed branch has no attribution choice (v0.3.6).** When the later
member `i` is `completed`/`cancelled`, the offender is **`i`** — the only member
whose close can be denied — and `starts` plays no part: `closes` declares what the
call did (see below), and blaming a started earlier item would print
`cannot start <j>` for a call that only started `j` while `i` was already closed.
Consequence for `starts`: it **selects** inside the in-progress half only; the
closed half is B/C's shape (one possible subject per line).

**`closes` — the sibling set (rule B, new in v0.3.4).** The same discipline, on
the other side of the transition: `closes` is the set of items whose status this
op **transitions to a closed state** (`completed` or `cancelled`).

| op | `closes` (ids) |
| --- | --- |
| `update` | ids whose status **transitions** to a closed state (`before` not closed and `after` closed). Same snapshot of the prior statuses as `starts` — one `before` map serves both. Re-sending `completed` for an item already completed, or `cancelled` for an already cancelled one, is **not** a close; switching `completed` → `cancelled` is not a close either (the item was already closed). |
| `add` | the ids of the newly created items that arrive with a closed status. |
| `write` | **empty set** — the list is replaced; there is no prior state to close (deliberate asymmetry with `starts`, §2.1: a start must be attributed because the offender can be either member of the pair, a close never needs to be). |
| `remove` | **empty set** — a removal never closes anything; it can still *cause* the violation (N9) by re-parenting. |

**Rule B's attribution.** The offender is the **closed item** of the pair — the
only member whose close can be denied — and the blockers are its open descendants.
`closes` cannot change that (there is no second candidate), so rule B's lines are
identical with `closes` populated, with `closes` empty, and for `write`/`remove`
(the fallback). This is stated, not hidden, because it is the difference between
the two sets: `starts` **selects** which member is blamed, `closes` **declares**
what the op did (§2.1, fourth property). A `closes` that *filtered* would let an
inherited illegal state survive a mutation — the whole-candidate rule forbids it
(§3, D9).

**`reverts` — the third set (rule C, new in v0.3.5).** The same discipline, on the
pending side: `reverts` is the set of items whose status this op **transitions to
`pending`**.

| op | `reverts` (ids) |
| --- | --- |
| `update` | ids whose status **transitions** to `pending` (`before !== "pending"` and `after === "pending"`). Same `before` snapshot as `starts`/`closes` — one map serves all three. Re-sending `pending` for an item that was already `pending` is **not** a revert. `completed → pending`, `cancelled → pending` and `in_progress → pending` all are (T36, T38, T39). |
| `add` | the ids of the newly created items that arrive with `status: "pending"`. |
| `write` | **empty set** — the list is replaced; there is no prior state to revert (identical asymmetry to `closes`, and for the same reason: a revert never needs to be attributed). |
| `remove` | **empty set** — a removal never reverts anything; it can still *cause* the violation by re-clamping (T45). |

**Rule C's attribution.** The offender is the **`pending` item** of the pair — the
only member whose `pending` state can be denied — and the blockers are its closed
descendants. `reverts` cannot change that, so rule C's lines are identical with
`reverts` populated, with `reverts` empty, and for `write`/`remove` (T46 pins the
equality). This is exactly rule B's shape, not rule A's: rule A's pair has two
members that can each be "the one you started", so `starts` must *select*; rules B
and C each have one possible offender, so their sets only *declare*. The
`starts`-style fallback ("later item in candidate order") must **not** be applied
to rule C: when the op closes a descendant under a pending ancestor (T48a), the
later member is `completed`, and blaming it would produce `cannot revert <a
completed item> to pending` — a sentence that is simply false (D14).

Ordering inside a line: blockers sorted **nearest first** = ascending
`|index(offender) − index(blocker)|`, tie broken by the **later** index;
de-duplicated per offender. Offenders are emitted in ascending index order; for
one offender the `in_progress` line precedes the `pending` line, which precedes
the `open_descendant` line, which precedes the `closed_descendant` line (§4).

Exact shapes (all measured on the candidate lists below; §2.2 has the rest):

(a) the op **starts** an item that is legal on its own while the store already
holds an illegal one (legacy file written behind the tool's back: `3` in progress
and `3.7` pending as in `FOUR_TWO_PRE_C`, plus `4.2` forced `in_progress`), then
`update 3.7 → in_progress` (row U):
```
ERROR: cannot start 3.7: 4.2 is still in progress.
ERROR: cannot start 4.2: 3 is still in progress.
ERROR: cannot start 4.2: 4.1, 4 are not in progress.
Nothing was changed.
```
Line 1 names the started item; lines 2–3 report the state that was already
invalid, which is why the whole candidate list is refused.

(b) **fallback**, neither member started — a `remove` that re-clamps an in-progress
item next to a running one; candidate after the removal is
`[I@0, I@2→1, P@0, I@1]` → numbers `1, 1.1, 2, 2.1`, `starts = ∅` (T21 / row L):
```
ERROR: cannot start 2.1: 1.1, 1 are still in progress.
ERROR: cannot start 2.1: 2 is not in progress.
Nothing was changed.
```

(c) one `update` starting **two** conflicting items while `2.1` runs; candidate
`2, 2.1, 2.2, 2.3` with `starts = {2.2, 2.3}` (T19 / row I):
```
ERROR: cannot start 2.2: 2.1 is still in progress.
ERROR: cannot start 2.3: 2.2, 2.1 are still in progress.
Nothing was changed.
```

(d) `write` with three in-progress roots — all are starts, so the **later** item
of each pair is the offender (T20 / row H):
```
ERROR: cannot start 2: 1 is still in progress.
ERROR: cannot start 3: 2, 1 are still in progress.
Nothing was changed.
```

(e) the common case — the blocker is **pending**, not running (T8 / row M;
the child runs while its parent has not started):
```
ERROR: cannot start 2.1: 2 is not in progress.
Nothing was changed.
```

(f) **the USER's case** — closing a parent whose child is still open. Seed
`update 1.1 → in_progress` (or `write [I@0, I@1]`), then `update 1 → completed`
(and, separately, `update 1 → cancelled` — the two produce the same line, N2/N3,
because both are closes); candidate `1, 1.1`, `closes = {1}` (T32c):
```
ERROR: cannot close 1: 1.1 is still open.
Nothing was changed.
```
Rule A passes this pair — `1` is `CLOSED`, which is exactly what rule A lets
through — so the close line is the **only** thing standing between the USER and
the state he rejected. Closing `1.1` first, or removing it, then makes the same
`update 1 → completed` legal (T34).

(g) `closes = ∅` — a `remove` that re-parents an open item under an already
closed one; pre-removal `[I@0, C@1, P@1]` is legal (re-derived for v0.3.5: a
`pending` `1` would already violate rule C), `remove id 1` re-clamps the closed
child to the top and leaves `[C@0, P@1]` (T35 / N9):
```
ERROR: cannot close 1: 1.1 is still open.
Nothing was changed.
```
Identical text with `closes = {1}`: the set is a declaration, not a selector
(§2.1, fourth property).

(h) **the USER's case** — an item reverted to `pending` while its child is already
closed. Seed `[C@0, C@1]` (legal, N5), then `update 1 → pending`; candidate
`1, 1.1`, `reverts = {1}` (T36):
```
ERROR: cannot revert 1 to pending: 1.1 is already closed.
Nothing was changed.
```
The line names the item the op reverted — here the two coincide, which is why
attribution looks trivial until the *other* direction is exercised: closing `1.1`
under a `pending` `1` (T48a) produces the **same** line with `reverts = ∅`,
because the refused state is `1`'s, not `1.1`'s. `cannot revert` is therefore the
state-class verb, exactly as `cannot close` is for a `remove`.

Note on the verbs: the shapes stay `cannot start <N>`, `cannot close <N>` and
`cannot revert <N> to pending` in every case, `remove` and `write` included, on
purpose — one grammar for the model to parse, and nothing is persisted, so the
sentence always describes the state that was **refused**. `cannot close`
therefore also appears when the call asked for a deletion, and `cannot revert … to
pending` when the call asked to close something; the blocker number is the way
out.

No `issues:` line is appended to a rejection.

**`read`'s inconsistency clauses — fifth and sixth (rule D, v0.3.6).** The F10
note (§9.2) gains two sentences for a **closed** offender, chosen exactly like the
first two (by the reason of the first offence) and appended after the four
existing clauses:

```
issues: list is in an invalid state — <N> is closed while <B> is still in progress; mutating ops will refuse until every item before a started item is closed or is one of its in-progress ancestors.
issues: list is in an invalid state — <N> is closed while <B> is not in progress; mutating ops will refuse until every item before a started item is closed or is one of its in-progress ancestors.
```

`<N>` is the closed offender, `<B>` the first blocker of that clause; both are
candidate numbers. Without them a store that violates **only** rule D would be
read in silence — and the first/second clauses would print the false sentence
`<N> is in progress while …` for an item that is closed. Tested by T58.

## 5. Implementation contract (DEVELOPER — attribution pass)

`order.ts` keeps its two exports (and adds a third, see below);
`findOrderingViolations` takes the optional `starts`, `closes` **and** `reverts`
parameters of §2.1 and `OrderingViolation` carries the `reason` discriminator (one
record per offender **and** reason, so the formatter keeps its flat shape):

```ts
function orderRejection(
  items: TodoItem[],
  starts: ReadonlySet<number>,
  closes: ReadonlySet<number>,
  reverts: ReadonlySet<number>,
): string | null
```

`index.ts` must compute **all three** sets per op (§4.1) and pass them in:

- `opUpdate` — snapshot the statuses **before** applying changes
  (`const before = new Map(base.items.map((i) => [i.id, i.status]));`, already
  there at `index.ts:566`, used by the `starts` block at `:644-653`); then
  - `starts = ids whose raw.status === "in_progress" && before.get(id) !== "in_progress"`;
  - `closes = ids whose raw.status is closed && the prior status was not` — reuse
    the **one** definition: `order.ts` exports `isClosedStatus(status: TodoStatus)`
    (its third export) and both files import it, so `CLOSED` is never written
    twice. `before.get(id) === undefined` (id not in the list) never reaches here,
    the id is already refused.
  - `reverts = ids whose raw.status === "pending" && before.get(id) !== "pending"`
    — the same `before` map, read a third time.
- `opAdd` — `starts = new Set(items.filter((i) => i.status === "in_progress").map((i) => i.id))`,
  `closes = new Set(items.filter((i) => isClosedStatus(i.status)).map((i) => i.id))`,
  `reverts = new Set(items.filter((i) => i.status === "pending").map((i) => i.id))`,
  where `items` are the freshly built items of this call.
- `opWrite` — `starts = new Set(items.filter((i) => i.status === "in_progress").map((i) => i.id))`
  (`items` here is the whole candidate list: every in-progress item counts as
  started), `closes = new Set()`, `reverts = new Set()`.
- `opRemove` — `starts = new Set()`, `closes = new Set()`, `reverts = new Set()`.

Everything else stays: four call sites (write/add/update/remove), `read`/`clear`
unvalidated, empty-result branches first. `opRead`'s note (`:430`) keeps calling
`findOrderingViolations(list.items)` with all three defaults.

- `formatOrderingRejection`: **twelve** strings, chosen by `v.reason` **and
  `v.offenderStatus`** — `is still in progress.` / `are still in progress.`, `is
  not in progress.` / `are not in progress.`, `is still open.` / `are still open.`,
  `is already closed.` / `are already closed.`; `is`/`are` follows the blocker
  count of that line, and the head follows the **offender's status**:
  `in_progress` → `cannot start `, closed → `cannot close ` (rules D and B),
  `pending` → `cannot revert ` **+ ` to pending` before the colon**. The head is
  the pair (offender status, reason), because the rule-C line carries the target
  state between the number and the colon —
  `ERROR: cannot revert 1 to pending: 1.1 is already closed.`
- `types.ts`: `OrderingViolation.reason` stays
  `"in_progress" | "pending" | "open_descendant" | "closed_descendant"` and gains
  **`offenderStatus: TodoStatus`** (the formatter's head, §4); the `reason` doc
  comment is restated — the field is the **rule/blocker class**, not strictly the
  blocker's own status (an open descendant may be `pending` or `in_progress`; a
  closed descendant may be `completed` or `cancelled`); every other field and
  every other type unchanged.
- `order.ts` header comment: restate §2 (**all three** rules), name rule D and say
  rule A survives only as its corollary (the A loop is deleted, not hidden), and
  delete "one item per level"; keep the attribution note of §4.1, including the
  sentence that `closes` and `reverts` are declarations, not selectors.
- Tool `description`: *"An item may be in progress only when every item before it
  is closed (completed/cancelled) or is one of its own ancestors in progress:
  `3`, `3.1`, `3.1.2` together are fine; `4.3` while `3.1` is in progress — or
  `1.1` while `1` has not started — is not. A closed item may not have an open
  descendant: finish or cancel `1.1` before closing or cancelling `1`. A pending
  item may not have a completed or cancelled descendant: start `1` (or close it)
  before finishing `1.1`, and an item with a closed descendant cannot be set back
  to pending. A removal or insertion that would leave either state behind is
  refused too. Rejections change nothing."*
- `README.md` / `CHANGELOG.md`: not touched by the DEVELOPER (documentation
  follows after the code is fixed).
- `check.sh` gains no test step.

§9 obligations on the same pass (no silent failure):

- `store.ts`: add `loadList(sessionID): LoadResult` exactly as in §9.2. `readList`
  keeps its current `null` semantics (absent/empty/corrupt → `null`) so `tui.tsx`
  is untouched. `clearList` keeps returning a boolean; `opClear` calls `loadList`
  first and composes the outcome text from it (removed / already empty /
  corrupt file removed / nothing to clear).
- `index.ts`: every op starts from `loadList`; `corrupt`/`unreadable` **refuse
  before any computation** (`write`/`add`/`update`/`remove`), `read` reports them,
  `clear` is the only op allowed to destroy such a file (and says so).
- `opWrite`: the `items.length === 0` branch splits in two — an explicit empty
  request still clears; a request whose items were **all rejected** refuses
  (§9.2 F7) and never touches the file.
- `buildItems` / `opUpdate`: report the id substitution, the invalid `after`
  fallback and the stripped enumeration prefix as `issues:` (§9.2). `buildItems`
  must return the count of skipped items so `opWrite` can distinguish F7.
- `opUpdate`: when the call is refused, emit the `refused whole:` line (§9.2 F9)
  itemising every requested change that was not applied (id + field), only when
  at least one non-offending change was discarded.
- `opRead`: append the inconsistency `issues:` line (F10) and the legacy-prefix
  note (F4). The F10 emitter gains its **third to sixth** clauses: when the
  first offender is a closed item (rule B) the sentence is
  `issues: list is in an invalid state — 1 is closed while 1.1 is still open;
  mutating ops will refuse until every descendant of a closed item is closed too.`,
  and when it is a `pending` item (rule C) it is
  `issues: list is in an invalid state — 1 is pending while 1.1 is already closed;
  mutating ops will refuse until every descendant of a pending item is pending too.`,
  and when it is a **closed** item whose blocker is earlier (rule D) the fifth or
  sixth clause of §4 applies:
  `issues: list is in an invalid state — 2 is closed while 1 is still in progress;
  mutating ops will refuse until every item before a started item is closed or is one
  of its in-progress ancestors.` (or `… while 1.3 is not in progress; …`)
  (exact text §9.2/§4; same emitter, same `findOrderingViolations`, no second pass;
  reason order `in_progress` → `pending` → `open_descendant` → `closed_descendant`
  when the first offender somehow carries two, and offenders by candidate index).
- context hook: on `corrupt`/`unreadable`, push the §9.2 one-liner instead of
  nothing (F11).
- `execute` catch: append `. Nothing was changed.` + the atomicity note (F12).

Must NOT change: module shape (plain-object default export), zero runtime deps,
erasable-only TS, store JSON format, `deriveNumbers`/`clampDepthAt`/
`stripEnumeration`, the context hook, id stability, `after`, `issues` wording for
accepted ops. Rules B, C and D store nothing either — the closed/open and
closed/pending relations are recomputed
from `deriveNumbers` on every candidate, so there is still **no schema drift** and
a v0.2.2 store keeps loading unchanged.

## 6. Test contract — red before green for the correction

`tests/ordering.test.mjs` (one file, `node:test`, zero deps, temp `$HOME` from
`os.homedir()`, drives the real `setup`/`execute`) — harness as in v0.3 §6.

**Illegal rows.** Rows T3–T25 were RED against the v0.3.2 code; for v0.3.4 the
baseline is the **v0.3.3 code on disk** (green, 70 rows), and T7 (re-derived),
T32, T33, T35 must be RED against it — v0.3.3 accepts every one of those states.
For **v0.3.5 the baseline is the v0.3.4 code on disk**, and the new rows
**T36–T51 must be RED against it**: v0.3.4 accepts every rule-C state (it has no
rule C at all), which is exactly the USER's defect.
For **v0.3.6 the baseline is the v0.3.5 code on disk** (green, 90 rows) and
**T52–T60 must be RED against it**: v0.3.5 has no rule D, so it **accepts** closing
or cancelling an item behind a `pending` sibling — the USER's live store. T55/T56/
T57 are the legal guards and must stay green. The DEVELOPER writes them
**before touching `order.ts`** and records the red digest in the forum first. The
USER's order is explicit: *"crie testes pra todos estes casos, nao corrija ainda"*.

| # | name | exact expectation |
| --- | --- | --- |
| T3 | **headline** `{3, 3.1, 4.3}` — the USER's set: `write [C@0, C@0, I@0, I@1, P@0, P@1, P@1, I@1]` | two lines (§2.2 D): `ERROR: cannot start 4.3: 3.1, 3 are still in progress.` / `ERROR: cannot start 4.3: 4.2, 4.1, 4 are not in progress.` + `Nothing was changed.`; store empty afterwards |
| T4 | user example C — `FOUR_TWO_PRE_C` (`3 I`, `3.1–3.6 C`, `3.7 I`, `4 P`, `4.1 **P**`, `4.2 P` — re-derived: a completed `4.1` under a pending `4` is a rule-C violation), then `update 4.2 → in_progress` | `ERROR: cannot start 4.2: 3.7, 3 are still in progress.` / `ERROR: cannot start 4.2: 4.1, 4 are not in progress.` + `Nothing was changed.`; `readList` deep-equals the pre-state |
| T4b | the same pre-state with `3.7` merely `pending` | `ERROR: cannot start 4.2: 3 is still in progress.` / `ERROR: cannot start 4.2: 4.1, 4, 3.7 are not in progress.` + trailer; store unchanged |
| T8 | **pending parent blocks the child** — `write [C@0, P@0, I@1]` | `ERROR: cannot start 2.1: 2 is not in progress.` + trailer; no file written |
| T9 | **a skipped sibling blocks** — `write [C@0, I@0, P@1, I@1]` (`{2, 2.2}`) | `ERROR: cannot start 2.2: 2.1 is not in progress.` + trailer |
| T14 | entirely pending earlier branch — `write [P@0, P@1, I@0]` | `ERROR: cannot start 2: 1.1, 1 are not in progress.` + trailer |
| T15a | `{3, 4.3}` — `write [C@0, C@0, I@0, P@0, P@1, P@1, I@1]` | `ERROR: cannot start 4.3: 3 is still in progress.` / `ERROR: cannot start 4.3: 4.2, 4.1, 4 are not in progress.` + trailer |
| T15b | `{3, 4.2}` — `write [C@0, C@0, I@0, P@0, P@1, I@1]` (re-derived: the old literal fixture had a closed `4.1` under a pending `4`; that state is now T51) | `ERROR: cannot start 4.2: 3 is still in progress.` / `ERROR: cannot start 4.2: 4.1, 4 are not in progress.` + trailer |
| T16 | level gap — `write [C@0, C@0, I@0, P@1, P@2, I@2]` (`{3, 3.1.2}`, `3.1` pending) | `ERROR: cannot start 3.1.2: 3.1.1, 3.1 are not in progress.` + trailer |
| T10 | `write` rejected whole — the fifth item is a second in-progress root | `ERROR: cannot start 4: 3.1, 3 are still in progress.` + trailer; store byte-identical, `nextId` same, no `.tmp` |
| T12 | legacy illegal list `[I@0, I@0, P@0, P@1]` seeded via real `writeList` | (a) `update 1 → cancelled` + `3.1 → in_progress` in one call rejected: `ERROR: cannot start 3.1: 2 is still in progress.` / `ERROR: cannot start 3.1: 3 is not in progress.` — **corrected here**: §2.2 row R carried the v0.3.2 text (`3, 2 are not in progress.`), which contradicts the law because `2` is `in_progress` (the DEVELOPER's 01:15 finding, fixed in the contract, not bypassed); (b) `remove` leaving it illegal rejected; (c) a corrective `update` that closes the earlier item **accepted**; (d) `clear` accepted |
| T13b | `add` a second `in_progress` root while another root is `in_progress` | `ERROR: cannot start 3: 2 is still in progress.` + trailer; store unchanged (deep-equal, `nextId` same, no `.tmp`) |
| T18 | **attribution** on a legacy store — `FOUR_TWO_PRE_C` with `3.7` `pending` and `4.2` forced `in_progress` behind the tool's back; `update 3.7 → in_progress` | three lines (§2.2 U), the first being `ERROR: cannot start 3.7: 4.2 is still in progress.` — the started item, never the already-running one; lines 2–3 report `4.2`'s own illegality (`4.1, 4 are not in progress.`); store unchanged |
| T19 | one `update` starting two items — `write [C@0, I@0, I@1, P@1, P@1]` then `update ids 4,5 → in_progress` | the two lines of §4.1(c) + `Nothing was changed.` (one line per offender, blockers nearest-first, de-duplicated) |
| T20 | `write` with three in-progress roots — every in-progress item is a start | the two lines of §4.1(d) + trailer (later item = offender, deterministic) |
| T21 | **fallback**, neither member started — `write [I@0, P@1, I@2, P@0, I@1]` (accepted), then `remove` id 2 re-clamps `1.1.1` to `1.1` | the two lines of §4.1(b) + trailer; store unchanged (id 2 still present) |
| T25 | multi-change `update` refused whole (F9) — `FOUR_TWO_PRE_C`, `update [{id 5 content}, {id 13 status I}, {id 8 priority}]` | T4's two lines + `refused whole: 2 other requested changes were not applied (id 5 content, id 8 priority).` + trailer; store byte-identical |
| T7 | **deleting does not bypass the child — rule B now refuses the deletion itself.** `write [C@0, C@0, I@0, P@1, P@0, P@1]` (accepted: `1`, `2` closed roots; `3` running with `3.1`; `4`, `4.1`), then `remove` id 3 | **`ERROR: cannot close 2: 2.1 is still open.` + `Nothing was changed.`** — removing the running root would re-parent its `pending` child under the closed `2` (candidate `1, 2, 2.1, 3, 3.1`). Store byte-identical (id 3 still present, no `.tmp`). Escape, then accepted: (i) `update 3.1 → completed` (id 4), (ii) `remove` id 3, (iii) `update` id 5 → `in_progress`, (iv) `update` id 6 → `in_progress` — four accepted calls; after step (ii) the list numbers `1, 2, 2.1, 3, 3.1` |
| T32 | **closed parent + open child is refused, for `write` and for `update`** (the USER's case) | (a) `write [C@0, P@1]` → `ERROR: cannot close 1: 1.1 is still open.` + trailer, no file written; (b) `write [C@0, I@1]` → the same single line + trailer (rule A passes the pair; only rule B refuses); (c) seed `write [I@0, I@1]`, then `update 1 → completed` → the same line + trailer, store byte-identical; (d) the same seed, then `update 1 → cancelled` → the same line + trailer (`cancelled` is a close too); (e) seed the illegal state behind the tool's back with real `writeList` (`1 completed`, `1.1 pending`), then `read` → the dump plus `issues: list is in an invalid state — 1 is closed while 1.1 is still open; mutating ops will refuse until every descendant of a closed item is closed too.` |
| T33 | **deep chain** — `write [C@0, C@0, C@0, P@1, P@2, P@2]` (`3` closed, `3.1`, `3.1.1`, `3.1.2` pending) | `ERROR: cannot close 3: 3.1, 3.1.1, 3.1.2 are still open.` + trailer; no file written. Then the law-true escape, all accepted: `update 3.1.2 → C`, `3.1.1 → C`, `3.1 → C` (`write`'s candidate becomes `1, 2, 3, 3.1, 3.1.1, 3.1.2` all closed → legal) |
| T35 | **`remove` leaving a closed parent with an open descendant** — `write [I@0, C@1, P@1]` (re-derived: with a `pending` `1` the pre-state was already a rule-C violation; accepted, numbers `1, 1.1, 1.2`), then `remove` id 1 | `ERROR: cannot close 1: 1.1 is still open.` + trailer; store unchanged (id 1 still present). **Same text with `closes` populated** (`findOrderingViolations(items, ∅, {1})` equals `findOrderingViolations(items)`) — §2.1, fourth property. Escape: `remove` id 3 first (accepted) then `remove` id 1 (accepted) |
| T36 | **THE USER'S CASE — `1` reverted to `pending` while `1.1` is `completed`** (RED against v0.3.4: accepted today). Seed `write [C@0, C@1]` (accepted, N5), then `update 1 → pending` | `ERROR: cannot revert 1 to pending: 1.1 is already closed.` + `Nothing was changed.`; store **byte-identical** (`1` still `completed`, `nextId` same, no `.tmp`); `read` still shows both `[x]` |
| T37 | **a `cancelled` descendant blocks the revert too** — seed `write [C@0, X@1]` (accepted, N4), then `update 1 → pending` | `ERROR: cannot revert 1 to pending: 1.1 is already closed.` + trailer; store unchanged (Y4) |
| T38 | **revert from `in_progress`** — seed `write [I@0, C@1]` (accepted, Y7: bottom-up close), then `update 1 → pending` | the same single line + trailer; store unchanged (`1` still `[~]`). Pins that `in_progress → pending` is a revert |
| T39 | **reverting a `cancelled` item** — seed `write [X@0, C@1]` (accepted, Y15: a closed descendant does not constrain a cancelled ancestor), then `update 1 → pending` | the same single line + trailer; store unchanged (Y15 → Y3 shape). Pins that `cancelled → pending` is a revert and that the C antecedent is `pending` only |
| T40 | **`write` arrives illegal** — `write [P@0, C@1]` and `write [P@0, X@1]` | `ERROR: cannot revert 1 to pending: 1.1 is already closed.` + trailer; **no file written** (`readList` null, no `.tmp`) for both |
| T41 | **deep chain — every pending ancestor is named** — `write [P@0, P@1, C@2]` | two lines (Y17): `ERROR: cannot revert 1 to pending: 1.1.1 is already closed.` / `ERROR: cannot revert 1.1 to pending: 1.1.1 is already closed.` + trailer; no file written |
| T42 | **B+C composition, both directions** — (a) `write [C@0, P@1, C@2]`; (b) `write [P@0, C@1, P@2]` | (a) `ERROR: cannot close 1: 1.1 is still open.` / `ERROR: cannot revert 1.1 to pending: 1.1.1 is already closed.` + trailer; (b) `ERROR: cannot revert 1 to pending: 1.1 is already closed.` / `ERROR: cannot close 1.1: 1.1.1 is still open.` + trailer — offender order, never rule order (Y19, Y20) |
| T43 | **plural + nearest first** — `write [P@0, C@1, C@2]` | `ERROR: cannot revert 1 to pending: 1.1, 1.1.1 are already closed.` + trailer (Y24): both closed descendants listed, nearest first, `are` |
| T44 | **`add` creates it** — seed `write [I@0, I@1, C@2]` (accepted, Y21), then `add {content: "inserted", status: "pending", after: <id of 1.1>, depth: 1}` (**re-derived for v0.3.6: +1 rule-D line**) | two lines: `ERROR: cannot revert 1.2 to pending: 1.2.1 is already closed.` / `ERROR: cannot close 1.2.1: 1.1 is still in progress.` + trailer; store unchanged (deep-equal, `nextId` same, no `.tmp`). The new `pending` item becomes the parent of the existing closed `1.1.1` → renumbered `1.2.1`, whose earlier sibling `1.1` is still running — so the closed leaf offends under D as well (T60) |
| T45 | **RETIRED in v0.3.6** (see the §6 collateral ruling) — its seed `[I@0, P@1, C@1, C@2]` is a rule-D violation (`1.2` closed behind the running `1`), so the `remove` this row tests can never be performed. Withdrawn, not softened; `remove` re-clamping stays covered by T44/T60 | — | **no expectation** — the row must not exist in the suite |
| T46 | **`reverts` is a declaration, not a selector** — the T42(a) candidate | `findOrderingViolations(items, ∅, ∅, {1})` and `findOrderingViolations(items, ∅, ∅, {1.1})` equal `findOrderingViolations(items)` — identical arrays (byte-compared via `JSON.stringify`). Mirror of T35 |
| T48 | **the way out of the descendant-side case** — seed `write [P@0, P@1]` (accepted, Y1) | (a) `update 1.1 → completed` **refused**: `ERROR: cannot revert 1 to pending: 1.1 is already closed.` + trailer; (b) `update 1 → in_progress` **accepted**; (c) `update 1.1 → completed` **accepted** — C is about the state, not the direction of the gesture |
| T49 | **a C-violating legacy store is repairable by cancelling the branch** — seed `1 pending` + `1.1 completed` behind the tool's back with real `writeList`, then `update 1 → cancelled` | accepted; candidate `1 cancelled`, `1.1 completed` is legal (Y15) — and `read` no longer prints the inconsistency note |
| T50 | **RETIRED in v0.3.6** (see the §6 collateral ruling) — its seed `[I@0, P@1, C@1]` is a rule-D violation (`1.2` closed behind the running `1`), so the depth move this row tests can never be performed. Withdrawn, not softened; the closed-offender shape stays pinned by T59/T60 | — | **no expectation** — the row must not exist in the suite |
| T51 | **C+D+A composition on `write`** — `write [C@0, C@0, I@0, P@0, C@1, I@1]` (the old T15b literal fixture, now itself a C violation; **re-derived for v0.3.6: +1 rule-D line**) | four lines (row P2 + T60): `ERROR: cannot revert 4 to pending: 4.1 is already closed.` / `ERROR: cannot close 4.1: 3 is still in progress.` / `ERROR: cannot start 4.2: 3 is still in progress.` / `ERROR: cannot start 4.2: 4 is not in progress.` + trailer; no file written |
| T52 | **the live store (7 lines)** — the USER's own list as measured (reduced fixture = §2.2 D3: `[I@0, C@1, C@1, P@1, C@0, C@0, P@0, P@0, C@0]`) | **seven** lines against the full store, offenders in candidate order, character for character; the anchors measured and quoted here are `ERROR: cannot close 2: 1 is still in progress.`, `ERROR: cannot close 6: 1 is still in progress.` and `ERROR: cannot close 6: 5, 4, 1.3 are not in progress.` The reduced fixture reproduces **four** of the seven (`2`, `3`, and `6`'s two lines); the remaining three are pinned from the ORACLE's digest of the live file. `Nothing was changed.`, store byte-identical, no `.tmp` |
| T53 | **sibling skip on close** — `[I@0, C@1, P@1, C@1]` (`1.3` closed with `1.2` still `pending`) | `ERROR: cannot close 1.3: 1.2 is not in progress.` + trailer; store byte-identical |
| T54 | **root closed while an earlier root runs** — `write [I@0, C@0]` | `ERROR: cannot close 2: 1 is still in progress.` + trailer; **no file written** (`readList` null, no `.tmp`) |
| T58 | **`read` announces a rule-D-only store** (the fifth and sixth clauses) — seeded behind the tool's back with the real `writeList` | (a) `[I@0, C@0]` → dump + `issues: list is in an invalid state — 2 is closed while 1 is still in progress; mutating ops will refuse until every item before a started item is closed or is one of its in-progress ancestors.`; (b) `[I@0, C@1, C@1, P@1, C@1]` → the same note with `1.4 is closed while 1.3 is not in progress; …`. Both read **without** any `ERROR:` line |
| T59 | **one offender, both D and B lines** — `[I@0, C@0, P@1]` seeded via `writeList` (`1` running, `2` closed, `2.1` pending) | `ERROR: cannot close 2: 1 is still in progress.` / `ERROR: cannot close 2: 2.1 is still open.` + trailer — **one offender, two groups**, group 1 then group 3, `close` head in both; store unchanged |
| T60 | **D adds exactly one line to the re-derived T44 and T51 candidates** | T44's candidate (`1 I, 1.1 I, 1.2 P, 1.2.1 C`): the C line **and** `ERROR: cannot close 1.2.1: 1.1 is still in progress.` — offender `1.2` (index 2) before offender `1.2.1` (index 3). T51's candidate (`1 C, 2 C, 3 I, 4 P, 4.1 C, 4.2 I`): `cannot revert 4 to pending: 4.1 is already closed.` / `cannot close 4.1: 3 is still in progress.` / the two `4.2` lines — four lines, candidate order. Both rows: `Nothing was changed.`, store byte-identical |

**Legal rows (must be accepted; T8/T9/T14/T15/T16 are the v0.3.2 rows that now
flip to ILLEGAL, T31 is the row the restored law adds, and T34 is the row rule B
adds — the closes that stay legal):**

| # | name | fixture | expectation |
| --- | --- | --- | --- |
| T31 | **ancestor in progress** — `{1, 1.1}` | `write [I@0, I@1]`, then `write [P@0]` + `update 1 → in_progress` | both accepted; `1` and `1.1` both `[~]` |
| T2 | nested chain `{3, 3.1, 3.1.2}` | `write [C@0, C@0, I@0, I@1, C@2, I@2]` | accepted; rows `3`, `3.1`, `3.1.2` all `[~]` |
| T5 | completing frees the path (**re-derived: five steps**) | `FOUR_TWO_PRE_C`: `3.7→C`, then `3→C`+`4→I`, then `4.1→I`, `4.1→C`, `4.2→I` | all five accepted; `4.2` `[~]`. The two extra steps are the point: a `pending` sibling (`4.1`) may not be skipped, and a `completed` `4.1` under a pending `4` is now itself invalid — so the legitimate route is start-then-close `4.1` |
| T6 | cancelling counts as closed | same as T5 with `X` instead of `C` (including `4.1→X`) | all five accepted |
| T34 | **the closes that are legal** | (a) `write [C@0, C@1]` and `write [C@0, X@1]` — a closed child under a closed parent, `completed` and `cancelled` alike (N4, N5): both accepted; (b) bottom-up close from running: `write [I@0, I@1]`, then `update 1.1 → completed` → accepted (`1` still running, child closed), then `update 1 → completed` → accepted; (c) bottom-up close from pending: `write [P@0, P@1]`, `update` id 2 → completed, `update` id 1 → completed → both accepted; (d) removing the open descendant first makes the parent's close legal: `write [P@0, P@1]`, `remove` id 2, `update 1 → completed` → accepted | all accepted |
| T11 | no false positives | chain list; `update` content/priority; `write []`; `clear` on an illegal store | all accepted |
| T13a | legal `add` | `[C@0, I@0]` + `add I@1` | accepted; `2.1` `[~]` |
| T47 | **the legal counterparts of the 4×4 matrix** — rule C must not over-refuse (Y1, Y5, Y6, Y7, Y8, Y11, Y12, Y15, Y16, Y21, Y22) | `write [P@0, P@1]`, `[I@0, P@1]`, `[I@0, I@1]`, `[I@0, C@1]`, `[I@0, X@1]`, `[C@0, C@1]`, `[C@0, X@1]`, `[X@0, C@1]`, `[X@0, X@1]`, `[I@0, I@1, C@2]`, `[I@0, C@1, C@2]` | **all eleven accepted** — in particular `I`+`P` (started parent, unstarted child), `I`+`C`/`X` (bottom-up close), `X`+`C` (a closed descendant does not constrain a cancelled ancestor) and the deep chain |
| T55 | **the cells rule D must not break** (§2.2 D4) | `write [I@0, C@1]`, `write [C@0, C@1]`, `write [I@0, X@1]`, `write [X@0, C@1]` | **all four accepted** — bottom-up close under a running parent (term 3), closed child under a closed parent, cancelled child under a running parent, cancelled child under a cancelled parent. A rule D that refuses any of them is a false red |
| T56 | **started parent + closed child + `pending` sibling** (§2.2 D6) | `write [I@0, C@1, P@1]` | accepted; the `pending` sibling sits **after** a started item, so D has nothing to say (D constrains only started items) and C sees no closed descendant |
| T57 | **all-closed prefix, trailing `pending`** (§2.2 D5) | `write [C@0, C@0, P@0]` | accepted — the plan's suffix is untouched: the closed roots are behind a closed prefix and the `pending` root is not started |

**Still green, must stay green:** T1 (numbering), T5, T6, T11, plus every §9 row
(T22–T30) whose texts do not depend on the ordering law — T24's expected text is
**unchanged** (its seed `[I@0, I@0]` breaks rule A only; the rule-B variant is
T32(e)) and T25's second line follows T4.

**Collateral audit — rule C's price, measured here so the DEVELOPER does not meet
it blind.** Every fixture in `tests/ordering.test.mjs` and `tests/tool.test.mjs`
was re-read (static reading of the two files; this session has no shell, declared)
for the shape rule C forbids: a `pending` item with a `completed`/`cancelled`
descendant. **Three fixtures have it**, all re-derived above:

1. `ordering.test.mjs:117-131` — `FOUR_TWO_PRE` has `4` **pending** over `4.1`
   **completed**. This is the USER's own example-C pre-state, and it is an invalid
   state under rule C. It becomes **`FOUR_TWO_PRE_C`** (`4.1` pending), which
   changes T4, T4b, T5, T6, T18 and T25 as tabulated.
2. `ordering.test.mjs` T35's seed — `write [P@0, C@1, P@1]` — same shape.
   Re-derived to `[I@0, C@1, P@1]`; **T35's text is unchanged**.
3. `tool.test.mjs:904-927` — `write [{parent}, {child, status: "completed", depth:
   1}]` renders `1: [ ] 1) parent` / `2: [x] 1.1) child [low]`. That is `[P@0,
   C@1]` — the exact state the USER rejected. It must be re-derived to **parent
   `in_progress`** (`write [{parent, status: "in_progress"}, {child, status:
   "completed", priority: "low", depth: 1}]`), keeping every assertion it exists
   for (valid status, valid priority, valid depth, no `issues:`, `nextId`), with
   the summary becoming `TODO: 2 items (1 in progress, 1 completed)` and the dump
   `1: [~] 1) parent`. **Do not weaken it** (dropping the `completed` child would
   delete the very evidence the test exists for); record the reason in the forum.

The near misses are clean: `tool.test.mjs:325` and `ordering.test.mjs:145-147` are
all `pending`; `ordering.test.mjs:984-987` (T21's seed) has no closed item; T7's
seed `[C@0, C@0, I@0, P@1, P@0, P@1]` has `4`+`4.1` both pending; T12's seed and
T21's seed contain no closed item at all; T32/T33/T34's seeds put the closed item
**below**, never above, a pending one. Any further fixture that starts failing for
rule C must be **re-examined and re-derived, never weakened** — and the reason
recorded in the forum.

**Collateral audit — rule D's price (v0.3.6), measured here so the DEVELOPER does
not meet it blind.** Rule D forbids a closed item behind a non-closed prefix, so
every fixture that **opens a `pending` item in front of a closed one** is now an
invalid pre-state. Four consequences, and one of them is a **ruling**, not a
re-derivation:

1. **RULING — retire T45 and T50.** Both rows build their violation by *creating*
   a closed item under a `pending` ancestor (`remove` re-clamping, and an `update`
   depth move). Their mechanisms are **impossible under D+C**: the seed those rows
   need — a closed item behind a `pending` one — cannot be stored, so the row can
   never reach its own assertion. **T45 and T50 are withdrawn, not softened**; the
   mechanisms they covered (`remove` re-clamping, `depth` move) stay covered by T44
   (`add`) and by T60, which pin the same re-parenting path on legal seeds.
2. **T44 re-derived — +1 rule-D line** (see the row): after the `add`, the closed
   leaf `1.2.1` also sits behind the running `1.1`, so the refusal carries
   `cannot close 1.2.1: 1.1 is still in progress.` beside the rule-C line.
3. **T51 re-derived — +1 rule-D line** (see the row): its closed `4.1` sits behind
   the running `3`, so `cannot close 4.1: 3 is still in progress.` joins the three
   existing lines in candidate order.
4. **`tests/tool.test.mjs:122-137` re-derived to `[C@0, I@0, P@0]`.** The context
   hook row seeds `[I@0, P@0, C@0]` — a closed item behind a `pending` one, which D
   forbids even though `seed()` writes it straight to disk. Re-order it to closed,
   started, pending; the assertion it exists for
   (`TODO: 3 items, 1 in progress — update it if something changed.`) is unchanged.
   **Never weaken it.**


Protocol: run the suite against the **current** implementation, record the red
digest (names + actual vs expected) in the forum **before** editing `order.ts`,
then implement, then record the green digest.

**Runner form (measured, node v24.15.0).** `node --test tests/` (directory
positional) fails with `Cannot find module '…/tests'`; use
`node --test tests/*.test.mjs` (what `tests/run.sh` and `npm test` do) or bare
`node --test`.

**T7 — re-derived for v0.3.4: the deletion itself is now refused.** T7's literal
fixture is `[C@0, C@0, I@0, P@1, P@0, P@1]`. Under v0.3.3 the removal of the
running root was accepted and the dangling child then blocked `3` (§2.2 Q). With
rule B the gesture dies one step earlier: after the removal the child renumbers to
`2.1` **under the closed `2`**, and that candidate is not storable — `ERROR:
cannot close 2: 2.1 is still open.`. The row keeps its name and its lesson
("deleting does not bypass the child") and now proves it is impossible to bypass:
the escape is closing the child first, removed afterwards. The v0.3.2
instruction "revert that child to `pending` so it blocks nothing" stays void, and
the v0.3.3 expectation ("removal accepted") is **withdrawn, not softened**.

**T8 / T9 / T14 / T15 / T16 are flipped.** They were the v0.3.2 legal rows; §2.2
shows they are the very states the USER rejected ("Como que o 1.1 pode estar em
andamento se a 1 ainda nao iniciou?"). Their expectations now live in the illegal
table, and `pending` no longer means "non-blocking" for anything that precedes a
running item.

**v0.3.5 — what the new rows pin, and the one thing they must not do.** T36–T51
are rule C only; their red baseline is the **v0.3.4 code**, which accepts every one
of them. Each row must show (i) the refusal text character for character, (ii) a
**byte-identical** store, and, where it exists, (iii) the legal counterpart
accepted (T47, T48). Two rows exist precisely to stop rule C from becoming a
blanket ban:

- **T48** proves the same target state is reachable from the other direction —
  start `1`, then close `1.1`. Rule C forbids the **state**, never the work.
- **T47** proves the eleven legal cells still pass, including `I`+`P` (started
  parent, unstarted child) and `X`+`C` (a closed descendant does not constrain a
  cancelled ancestor). A careless reading of the rule — "a closed descendant
  forces the ancestor to be closed" — would wrongly refuse both.

**Fixture policy for v0.3.5.** `FOUR_TWO_PRE` becomes **`FOUR_TWO_PRE_C`** (`4.1`
→ `pending`) and the old literal fixture must **not** survive anywhere as a legal
pre-state, because it is not legal any more; it lives on only as T51's *illegal*
candidate. T35's seed switches its root from `pending` to `in_progress`. The tool
test's `[P@0, C@1]` write becomes `[I@0, C@1]`. None of those edits may drop an
assertion — each keeps every field it existed to prove (§6 collateral audit), and
the reason goes in the forum.

## 7. Acceptance checklist

- [ ] Red digest of the correction recorded in the forum **before** touching `order.ts`: T3, T4, T4b, T8, T9, T14, T15a, T15b, T16, T10, T12, T13b, T18, T19, T20, T21, T25 red (wrong verdict, wrong attribution or missing second line).
- [ ] **v0.3.5 red digest, before any edit:** T36–T51 red against the v0.3.4 code — every rule-C state is **accepted** today, which is the USER's defect (*"crie testes pra todos estes casos, nao corrija ainda"*). The digest names each row and its actual (accepted) vs expected (refused) result.
- [ ] **Rule C rejected character for character:** T36–T43 (the USER's case, the cancelled descendant, the `in_progress`/`cancelled` reverts, `write`, the deep chain, the two B+C compositions, the plural line), T44/T45/T50 (`add`, `remove`, depth move), T51 (C+A on `write`).
- [ ] **Rule C accepted where it must be:** T47's eleven legal cells and T48's three steps — `I`+`P`, `I`+`C`/`X`, `X`+`C`, `P`+`P`, and the start-then-close route. A rule C that refuses any of them is a false red.
- [ ] **The fourth wording, singular and plural:** `is already closed.` (T36) and `are already closed.` (T43); with rule D's two close shapes, **twelve** strings in the suite.
- [ ] **Group order pinned (four groups):** for one offender `still in progress` → `not in progress` → `still open` → `already closed`; offenders in candidate order (Y19/Y20, T42).
- [ ] **`reverts` is a declaration:** T46 — `reverts` populated and empty produce identical output; `write`/`remove` pass `∅`.
- [ ] **Store untouched after every rule-C refusal:** T36/T37/T38/T39/T40/T41/T42/T43/T44/T45/T50/T51 compare `readList` deep-equal or the raw bytes, `nextId` same, no `.tmp`.
- [ ] **`read`'s fourth clause:** T49's seed (and T24's unchanged text) — a store violating only rule C is announced, never read in silence.
- [ ] **No `cannot close <closed>` ever emitted:** every `cannot close <N>` names an item that is `completed`/`cancelled` in the candidate and every `cannot start <N>` an `in_progress` one — the head comes from `offenderStatus` (§4) — and D never adds a `cannot close` line to a state rule C already refuses (T44, T51, T60).
- [ ] **Rule D subsumes A with the A loop DELETED:** `order.ts` holds **one** started-subject loop; no second pass over the in-progress items survives, and no refusal prints a `cannot start` line twice.
- [ ] **Ordering enforced on close and cancel:** closing or cancelling behind a `pending` sibling or a running root is refused (T52–T54), `cancelled` counts as closed for D exactly as for B (T55), and the legitimate closes (T34, T55, T56, T57) stay accepted — plus `read`'s fifth/sixth clauses (T58).
- [ ] `npm test` (`node --test tests/*.test.mjs`) green, zero new dependencies, non-zero exit on a deliberately broken assertion.
- [ ] T8, T9, T14, T15a, T15b, T16 **rejected** with the §4 text character for character — no descendant runs under a `pending` ancestor, no earlier item is skipped.
- [ ] **Rule B rejected character for character:** `update 1 → completed` and `update 1 → cancelled` over an open `1.1` answer `ERROR: cannot close 1: 1.1 is still open.` + `Nothing was changed.` (T32c/T32d); `write [C@0, P@1]` and `write [C@0, I@1]` answer the same line and write no file (T32a/T32b); the deep chain answers `cannot close 3: 3.1, 3.1.1, 3.1.2 are still open.` (T33); the re-parenting `remove` answers `cannot close 1: 1.1 is still open.` and leaves the store untouched (T35, T7).
- [ ] **Rule B accepted where it must be:** T34(a)–(d) all accepted — `completed`/`cancelled` child under a closed parent, and closing bottom-up or after removing the open descendant. No legitimate close is blocked.
- [ ] T31 (`{1, 1.1}`) and T2 (`{3, 3.1, 3.1.2}`) **accepted** — the ancestor chain is the only thing that runs ahead of a closed prefix.
- [ ] T3, T4, T4b, T10, T12, T13b, T18, T19, T20, T21, T25 rejected with §4/§4.1 text **character for character**, including `Nothing was changed.`
- [ ] **All three wordings exercised, singular and plural of each:** `is/are still in progress.` (T19, T20, T21), `is/are not in progress.` (T8, T9, T14, T16) and `is/are still open.` (T32 singular, T33 plural); with rule C, `is/are already closed.` (T36, T43); with rule D's `close` head, `cannot close … is/are still in progress.` (T54 singular, T52 several) and `cannot close … is/are not in progress.` (T53 singular, T52) — **twelve** strings in the suite.
- [ ] **Group order pinned:** for one offender `still in progress` → `not in progress` → `still open` → `already closed`; offenders in candidate order, so a close or revert line follows candidate position, not rule order (N8 / T32e / T42).
- [ ] **Attribution:** T18's first line names `3.7` (the item the call started); the legacy `4.2` refusals follow, never precede it. Rule B's line always names the **closed** item and lists its open descendants nearest-first (T33, T35); rule C's always names the **pending** ancestor and lists its closed descendants nearest-first (T41, T43, T45).
- [ ] T19: one line per offender, blockers nearest-first and de-duplicated; T20: later item is the offender; T21: fallback with neither member started; **T35: `closes` populated and `closes` empty produce the identical text**; **T46: `reverts` populated and empty produce the identical text** (both are declarations, not selectors).
- [ ] T5, T6, T11, T12, T13a, T34 still green; **T7's old "removal accepted" assertion is gone** (re-derived, §6); **T5/T6 are five-step rows now**.
- [ ] **No fixture weakened:** the collateral audit of §6 holds — `FOUR_TWO_PRE_C` (not `FOUR_TWO_PRE`) everywhere, T35's seed `[I@0, C@1, P@1]`, and `tool.test.mjs:904-927` re-derived to a started parent with the same assertions (`priority: low`, `depth: 1`, `nextId`, no `issues:`).
- [ ] T10 / T13b: store untouched after rejection (`readList` deep-equal, `nextId` same, no `.tmp`).
- [ ] `clear` and a corrective `update`/`remove` still work on an illegal legacy list (including one that violates rule B: `remove` of the open descendant, or closing it, is accepted).
- [ ] `./check.sh` passes (import smoke + typecheck); `OrderingViolation.reason` typechecks at all four call sites, and `closes` is passed at all four.
- [ ] Registered tool `description` carries §2's **both** rules (quoted in §5).
- [ ] `order.ts` header no longer says "one item per level"; `README.md` corrected in the documentation pass.
- [ ] v0.2.2 JSON store still loads unchanged (no schema drift — nothing about the rule is stored).
- [ ] Real `$HOME` untouched; temp dirs removed.
- [ ] **§9:** no path fails silently — T22–T30 green, each message matching §9.2 character for character.
- [ ] A **corrupt or unreadable** store is never overwritten: `read`/`update`/`add`/`write`/`remove` refuse, file bytes unchanged (compared before/after); only `clear` destroys it, saying so.
- [ ] `write` whose items were **all rejected** leaves the existing list intact (no accidental clear).
- [ ] Every substituted input (duplicate/invalid id, invalid `after`, stripped prefix) is reported in `issues:`; `read` announces an inconsistent list (new wording, §9.2 F10) and legacy prefixes.
- [ ] A refused multi-change `update` itemises the changes it did not apply (`refused whole:` line) before the trailer.

## 8. Decisions on cases the USER's words did not cover

- **D1 the ancestor chain is the only exception.** `{1, 1.1}` and
  `{3, 3.1, 3.1.2}` are legal because the ancestors are themselves in progress;
  no other item may precede an in-progress one unstarted.
- **D2 level gap, `{3, 3.1.2}` with `3.1` pending — ILLEGAL** (flipped from
  v0.3.2): `3.1` and `3.1.1` sit before `3.1.2` and are not closed, and `3.1` is
  on the chain without being in progress. A gap is not a free pass.
- **D3 closing a parent while a child is still open — ILLEGAL (decided 2026-10-31
  02:10, supersedes the v0.3.0–v0.3.3 "unconstrained").** The old OPEN item ("not
  asked, so not blocked") is **closed by the USER**: *"Como pode cancelar o 1, se
  o 1.1 nao esta"*. A closed item with any open descendant is an invalid state —
  rule B, §2. It also covers `cancelled` (a cancel commits the branch just like a
  completion) and it is the reason `remove` can now be refused. Do not "soften" it
  for `in_progress` children either: `1 completed` + `1.1 in_progress` is refused
  (N2), because closing the ancestor removes the very `in_progress` chain rule A
  was allowing.
- **D4 no depth cap:** an arbitrarily deep chain is legal; a cap would be a new
  rule.
- **D5 message register:** derived numbers only; ids stay in `OrderingViolation`.
- **D6 the ancestry-only law is rejected too** (§2.3): it accepts `[P@0, I@1]` — a
  child running under a `pending` parent — which is the USER's counterexample.
  Order is part of the law, not a detail.
- **D7 blockers are listed in full.** No truncation and no "first blocker only":
  every earlier item that is not closed and not an in-progress ancestor is named,
  because each one is an unmet prerequisite the caller must clear. That makes a
  line long for a deep pending chain (`cannot start 5: 4, 3, 2, 1 are not in
  progress.`); completeness was chosen over brevity. Nearest-first ordering is
  kept for determinism, not because the order carries meaning. Rule B follows the
  same discipline: every open descendant is named (`cannot close 3: 3.1, 3.1.1,
  3.1.2 are still open.`), intermediate levels included — closing `3.1` alone
  leaves `3.1.1`/`3.1.2` blocking, and the message says so up front.
- **D8 `read`'s inconsistent-state note names the first offending pair** (lowest
  offender index; for one offender the `in_progress` clause wins, then `pending`,
  then `open_descendant`, then `closed_descendant`) and restates the law: it is a
  note, not a rejection (§9.2 F10). The third clause arrived in v0.3.4 and the
  **fourth in v0.3.5**; all four reuse the same violation records — no second pass,
  no second formatter.
- **D9 legacy / illegal stores stay repairable:** `clear`, and any `update` or
  `remove` whose candidate list becomes legal, are always accepted; refusals are
  fail-closed and change nothing. This includes a legacy store that violates rule
  B (removing the open descendant, or closing it, is accepted) **and one that
  violates rule C** (starting the pending ancestor, closing/cancelling it, or
  removing/reverting the closed descendant is accepted — T48, T49); nothing is
  auto-repaired.
- **D10 `starts` keeps its §4.1 role** although the restored law is directed: it
  decides which member of a pair a line names when the pair involves the item the
  call started (T18 first line). When no member is a start, the later item — the
  in-progress one — is the offender.
- **D11 `closes` is a declaration, not a selector** (§2.1, fourth property). The
  brief for v0.3.4 asks for a sibling set computed like `starts`; it is defined
  and required at every call site, but rule B's offender is uniquely the closed
  member, so no verdict, line or blocker depends on it (T35 pins the equality). A
  `closes` that filtered the reported offenders was considered and **rejected**:
  it would let an inherited illegal state survive a mutation, contradicting the
  whole-candidate rule (D9). If a later op closes many items at once and the
  message must distinguish "closed by this call" from "already closed", that is a
  new decision with new text — not a quiet semantic change.
- **D12 the verb of rule B is `cannot close <N>` for every op**, `remove` and
  `write` included (§4, "On the verb"). It names the state class refused, exactly
  as `cannot start` already did for `remove` (T21). No fourth verb ("cannot
  delete", "cannot keep") is introduced: the grammar stays one line per offender
  and reason, and the blocker number is the way out.
- **D13 every closed ancestor with an open descendant is an offender** (N7): `1`
  and `1.1` both closed over an open `1.1.2` produce two lines, because the
  candidate is refused whole and either line alone would leave a state that is
  still illegal. This is rule A's row-U discipline (report the whole candidate),
  not a new rule.
- **D14 rule C's offender is ALWAYS the pending item — `reverts` is a declaration,
  not a selector (decided 2026-10-31 09:20; refines the brief's fallback clause).**
  The brief proposed the `starts` recipe: "offender = the item the op reverts,
  fallback = the later item in candidate order". Worked through on T48a, the
  fallback is **impossible**: the op closes `1.1` under a `pending` `1`, so the
  later member is `completed`, and blaming it yields `cannot revert <completed> to
  pending`. Rule C, like rule B, has exactly **one** member whose state can be
  denied — the pending ancestor — so there is no attribution choice to make. The
  set is still computed per op and required at every call site (it records what the
  op did, and keeps the signature uniform), and T46 pins that it cannot change a
  line. Rejected alternative: a direction-aware second sentence (`cannot close 1.1:
  1 has not been started.`) — a fifth grammar for one more line shape, against the
  whole-candidate doctrine B already established (D12).
- **D15 `cancelled` counts on the descendant side; a `cancelled` ANCESTOR is not
  constrained by C.** A cancelled descendant forbids the pending ancestor exactly
  like a completed one (Y4): cancelling is a decision about the branch, so the root
  cannot still claim "never started" — the same logic as N4 for rule B. On the
  ancestor side the antecedent of C is `pending` and **only** `pending`, so
  `1 cancelled` + `1.1 completed` stays legal (Y15): that is a finished branch, and
  rule B already guarantees its descendants are closed. Consequence worth stating:
  **cancelling the ancestor is a legal repair** for a store that violates C
  (T49) — the whole refusal is about `pending`, not about the children.
- **D16 a pending MIDDLE item is an offender twice over** (Y17): `1 pending`,
  `1.1 pending`, `1.1.1 completed` produces one line per pending ancestor (`1` and
  `1.1`), mirroring D13 for closed ancestors. The alternative — report only the
  nearest pending ancestor — was rejected: the whole candidate is refused, and
  `1` alone would still be an invalid state after `1.1` were fixed, so hiding it
  would just cost a second round trip. Deep chains behave the same at any depth
  (D4, no cap): the number of lines equals the number of pending ancestors above a
  closed item.
- **D17 the verb of rule C is `cannot revert <N> to pending` for every op** (§4,
  "On the verb, rule C"), `write`, `add` and `remove` included. It is the USER's
  own word for the gesture and the only one that names both the item and the target
  state; "cannot keep/leave/set pending" were considered and are weaker (they
  suggest a no-op). The `to pending` qualifier is part of the head, not of the
  reason text, so the grammar stays one line per offender and reason.
- **D18 rule D — the started rule, and it REPLACES rule A (decided 2026-10-31
  13:10; evidence: the USER's live store).** The USER read his own list and found
  `1.4` closed with `1.3` still `pending`, `2` and `3` closed while `1` was
  running, and `6` closed behind `4`/`5` — every one of them **accepted** by
  v0.3.5, because rule A only looked at `in_progress` items and a closed item is
  not one (§2.2 D1–D3, T52). Rule D widens the **subject** from `in_progress` to
  `STARTED` (`status !== "pending"`) and keeps A's two terms verbatim, so D is a
  strict superset: every state A refuses, D refuses with the same text. A survives
  **only as a corollary in §2's prose**, and its loop is **deleted** from the
  runtime (§2.1) — two loops would print every `cannot start` line twice. Term 3
  (`anc(j, i) && CLOSED(i)`) is mandatory, not an optimisation: it keeps a closed
  item legal under its own ancestor whatever that ancestor is doing (the bottom-up
  close, Y7/N5) and it leaves the closed-under-pending-ancestor class entirely to
  rule C, so D never emits `cannot close` for a state C is already refusing. Verbs:
  the **offender's status** decides the head — closed → `cannot close`,
  `in_progress` → `cannot start` (§4) — so `cannot close <N>` always names a closed
  item. `closes` stays a declaration; `starts` keeps its selecting role on the
  in-progress half only (§4.1, T53).

### 8.1 OPEN (decided elsewhere, not by this revision)

- **Code untouched.** `order.ts` (header + body: rule B, third reason, six-string
  formatter), `types.ts` (`reason` union + doc comment), `index.ts` (`closes` at
  the four call sites — `:494`, `:535`, `:657`, `:719` — plus the tool
  `description` and the third clause of the `read` note at `:430-443`) and
  `tests/ordering.test.mjs` (T7 re-derived, T32/T33/T35 added to the illegal
  table, T34 added to the legal one) must be rewritten from §2.1/§5/§6 — this
  revision is contract only, no file of the plugin was touched.
- **Rows whose expectations change in v0.3.4:** T7 (accepted → **refused**),
  T12(a) (text corrected to the law), T24 (unchanged text, but the note emitter
  gains the third clause), plus the NEW T32, T33, T34, T35. Everything else keeps
  its exact text — §2.2 was re-derived row by row and only Q gains a line.
- **Documentation** — `README.md` line 51 ("One in-progress item **per level**")
  and line 58 ("never block") still describe v0.3.2, and nothing there mentions
  the close rule; `CHANGELOG.md` likewise. They follow the code fix.
- **`todo-list-spec.md` §13** states the per-level law as normative summary; it
  needs one line pointing at §2 instead (and now must also mention rule B). Not
  edited here, to leave the parent contract's Q1–Q15 untouched.
- **Flagged consistency edits made in v0.3.4** (confirm before implementing):
  1. §9.2 F10 / T24 / D8 — the `read` note gains the `open_descendant` clause
     (`1 is closed while 1.1 is still open …`). Without it a store that only
     violates rule B would be read in silence, against §9.
  2. §2.2 row R / T12(a) — the TEXT was wrong, not the law: it read `cannot start
     3.1: 3, 2 are not in progress.` for a candidate whose `2` is `in_progress`.
     Corrected to `2 is still in progress.` + `3 is not in progress.` (the
     DEVELOPER's 01:15 finding; owned here rather than left for the test to
     contradict the contract).
  3. T7 — re-derived (the v0.3.3 "removal accepted" expectation is withdrawn, §6).
- **Length trade-off (D7)** is a judgement call: if the USER prefers short
  messages, the alternative is "nearest blocker per reason", at the cost of one
  retry per prerequisite. Rule B inherits it: a closed root with a long pending
  branch lists every level of that branch. Rule C inherits it too: a pending root
  over a fully closed branch lists **every** closed descendant (Y24), not just the
  nearest one.

### 8.2 OPEN / raised by v0.3.5

- **Code and tests untouched (USER's order: "nao corrija ainda").** `order.ts`
  (fourth reason + fourth loop + eight-string formatter), `types.ts` (`reason`
  union), `index.ts` (`reverts` at the four call sites, tool `description`, fourth
  clause of the `read` note) and `tests/ordering.test.mjs` (T36–T51,
  `FOUR_TWO_PRE_C`, T4/T4b/T5/T6/T15b/T18/T25/T35 re-derived) are **contract
  only** here. The DEVELOPER's next step is: write the tests RED first, record the
  red digest, then — and only on the USER's word — implement.
- **Rows whose expectations change in v0.3.5:** T4, T4b, T5, T6, T15b, T18, T25
  (blocker lists / step count), T35 (fixture only, text unchanged), plus the NEW
  T36–T51. §2.2 was re-derived row by row (sandbox-executed) and only F, Fb, P, T,
  U and N9 change.
- **One fixture-level consequence the USER should know:** the pre-state of his own
  example C (`4 P` with `4.1 C`) is itself an invalid state under rule C, so the
  T4/T5 narrative now starts from `4.1 P` and the legitimate route closes `4.1`
  before `4.2` starts. This is not a softening: it is the same rule applied to the
  fixture that motivated the spec.
- **Documentation** — `README.md` line 51 ("One in-progress item **per level**")
  and line 58 ("never block") still describe v0.3.2; nothing there mentions rule B
  **or rule C**; `CHANGELOG.md` likewise. They follow the code fix.
- **`todo-list-spec.md` §13** states the per-level law as normative summary; it
  needs one line pointing at §2 instead, and now must mention **all three** rules.
  Not edited here, to leave the parent contract's Q1–Q15 untouched.
- **Flagged consistency edits made in v0.3.5** (confirm before implementing):
  1. §9.2 F10 / D8 / T49 — the `read` note gains the **`closed_descendant`**
     clause (`1 is pending while 1.1 is already closed …`). Without it a store that
     violates **only** rule C would be read in silence, against §9.
  2. §2.2 rows F/Fb/T/U + §6 T4/T4b/T5/T6/T18/T25 — fixture re-derivation
     (`FOUR_TWO_PRE` → `FOUR_TWO_PRE_C`), driven by the law, not by convenience.
  3. §2.2 row N9 / §6 T35 — fixture re-derivation (`1` `in_progress` instead of
     `pending`); text unchanged.
  4. `tool.test.mjs:904-927` — the only *pure acceptance* test the new rule breaks;
     re-derived with a started parent, every assertion preserved.
- **Length trade-off (D7)** is a judgement call: if the USER prefers short
  messages, the alternative is "nearest blocker per reason", at the cost of one
  retry per prerequisite. Rule B inherits it: a closed root with a long pending
  branch lists every level of that branch. Rule C inherits it too: a pending root
  over a fully closed branch lists **every** closed descendant (Y24), not just the
  nearest one.

### 8.3 OPEN / raised by v0.3.6

- **Code and tests untouched.** This revision is contract only: `order.ts` (rule A
  loop **deleted**, closed-offender branch of what is now rule D, `offenderStatus`
  on the record, twelve strings), `types.ts` (`offenderStatus`), `index.ts` (the
  fifth and sixth `read` clauses; the tool `description`) and
  `tests/ordering.test.mjs` (T52–T60, T55–T57 legal, T44/T51 +1 line,
  `tool.test.mjs:122-137` re-derived) are the DEVELOPER's next pass — **tests
  first, red digest in the forum before any edit**.
- **Rows retired:** **T45** and **T50** are withdrawn (their seeds are impossible
  under D+C, §6 ruling). Nothing is dropped silently: the re-parenting mechanism is
  still pinned by T44 (`add`) and the closed-offender shape by T59/T60.
- **Documentation** — `README.md` line 51 and line 58 and `CHANGELOG.md` still stop
  at rule B; they follow the code fix, and now owe one sentence for rule D.
  `todo-list-spec.md` §13 must point at §2 and mention **all three** rules.
- **Deferred, not decided here:** whether `read`'s note should name **every**
  offending pair (it names the first, D8). Rule D makes that question louder
  (a live store yields seven lines), and it is a judgement call for the USER.

## 9. No silent failure

USER requirement (2026-10-30, binding, verbatim): *"Importante que nao pode dar
erro silencioso, tem que impedir um estado inconsistente e dizer o motivo"* — no
silent failure anywhere in the `todo` tool. Every refusal names the item, the
reason and the way out; nothing is normalized, skipped or discarded without
saying so.

Conventions, unchanged: `ERROR: …` = the call was refused and **nothing** was
persisted; `issues: …` = the call succeeded but data was adjusted and here is
exactly what happened; `Nothing was changed.` = the trailer of every refused
mutation. §2/§4/§4.1 (the ordering law and its attribution) are **not** touched
by this section.

### 9.1 Findings (audited 2026-10-30 against `index.ts`, `store.ts`, `format.ts`)

| # | path | current behaviour | specified behaviour | test |
| --- | --- | --- | --- | --- |
| F1 | `store.ts readList` | corrupt **and** unreadable files are swallowed → `null`; the tool answers "no list for this session yet" and the next `write`/`add` **overwrites the file** — silent data loss plus a false statement of the state | new `loadList()` distinguishes `absent` / `empty` / `corrupt` / `unreadable`; mutating ops **refuse** on `corrupt`/`unreadable` and never write; `read` reports the real state | T22, T23 |
| F2 | `store.ts readList` | absent and empty are indistinguishable | both are reported distinctly (§9.2) | T29 |
| F3 | `buildItems` / `opUpdate` → `stripEnumeration` | a leading `"1.1)"` in the text is silently removed before storing | reported as an `issues:` line naming the id and the removed prefix | T28 |
| F4 | `format.ts displayContent` (`read`, `add`, `update` dumps) | an item whose **stored** text still carries the prefix is displayed without it — the dump is not the stored state | `read` adds one summary `issues:` line when any stored item carries a prefix | T28 |
| F5 | `buildItems` | a duplicate `raw.id`, or a non-positive `raw.id`, is silently replaced by a fresh id | `issues:` line naming the requested id and the assigned id | T27 |
| F6 | `buildItems` | a non-integer `after` (`"3"`, `0`, `-1`) silently becomes "append at the end" | `issues:` line naming the value and the fallback | T27 |
| F7 | `opWrite` | if **every** requested item is rejected (e.g. `[{content: ""}]`), `items.length === 0` → `clearList()` → **the existing list is destroyed** and the answer is "TODO list cleared." | refuse: a request whose items were all rejected must not clear anything; only an explicit `items: []` (or no items) clears | T26 |
| F8 | `opWrite` | with no prior file it still answers "TODO list cleared." | distinguishes absent / empty / removed (§9.2) | T29 |
| F9 | `opUpdate` (multi-change) | a refusal names the offending item but not that the other requested changes were dropped | one `refused whole:` line itemising every discarded change (id + field), emitted only when at least one non-offending change was discarded | T25 |
| F10 | `opRead` | an already-inconsistent stored list is printed without a word | the list, plus one `issues:` line naming the first offending pair and restating the law (§8 D8) — **six** clauses since v0.3.6: `in_progress` / `pending` / `open_descendant` / `closed_descendant`, plus the two closed-offender clauses of rule D (fifth and sixth) | T24, T32(e), T49, T58 |
| F11 | `index.ts` context hook | on a corrupt store the reminder is silently omitted | one line: `TODO: list unreadable (corrupt store) — run the todo tool op "read" for details.` | T30 |
| F12 | `execute` catch | `ERROR: todo <op> failed: <msg>` does not say whether anything was persisted | append `. Nothing was changed.` and the reason it is safe (atomic tmp+rename) | T23b |

Verified **not** silent (no change needed): unknown `op`; unresolvable `sessionID`;
`update` id not in the list; `update` missing/invalid id; empty `update` content;
unknown `status`/`priority` (message says what was used); invalid `depth`;
depth clamp at a position; `after` id not found; `remove` id not in the list;
`add` with nothing valid; `read`/`update`/`remove` on a session with no list.

**Out of scope (declared, with reason):** the TUI panel (`tui.tsx`) hides the
section on an unreadable store instead of printing a warning — it has no message
channel and it does not claim a state; the tool announces it. `progress`
reporting and `probeToolArgOnce` are advisory/diagnostic and never carry data.

### 9.2 Exact texts

**Store `loadList()` contract** (new in `store.ts`; `readList` stays as the
panel's thin wrapper and keeps returning `null` for absent/empty, so `tui.tsx`
is untouched):

```ts
type LoadResult =
  | { status: "absent" }
  | { status: "empty" }
  | { status: "ok"; list: TodoList }
  | { status: "corrupt"; path: string; detail: string }
  | { status: "unreadable"; path: string; detail: string };
```

Detection point: `fs.readFileSync` error codes (`ENOENT` → absent; `EACCES`,
`EISDIR`, `EIO`, … → unreadable), then `JSON.parse` failure or a shape that is
not `{ items: TodoItem[] }` → corrupt. **Nothing is repaired, nothing is
rewritten.**

Corrupt — mutating ops (`write`, `add`, `update`, `remove`):

```
ERROR: the stored list for this session is corrupt (<path>): <detail>. Nothing was changed. Run op "clear" to discard it (its data cannot be recovered), or repair the file by hand.
```

Unreadable — mutating ops:

```
ERROR: the stored list for this session could not be read (<path>): <code> <message>. Nothing was changed. Fix the permissions, or run op "clear" to discard it.
```

`read` on corrupt / unreadable — same sentence, different trailer:

```
ERROR: the stored list for this session is corrupt (<path>): <detail>. Nothing was read. Run op "clear" to discard it (its data cannot be recovered), or repair the file by hand.
```

Absent / empty:

```
TODO: no list for this session yet.
TODO: the list for this session is empty (the file exists and holds no items).
```

`clear` outcomes (each says what actually happened):

```
TODO list cleared (file removed).
TODO: the list for this session was already empty (file removed).
TODO: removed the corrupt list file for this session (it could not be parsed).
TODO: no list for this session — nothing to clear.
```

`write` whose every item was rejected (F7) — the list is **not** touched:

```
ERROR: nothing valid to write: every item in the request was rejected.
issues: skipped an item with no content
Nothing was changed.
```

Input-normalization reports (§9.1 F3/F5/F6) — appended to the normal `issues:` line:

```
issues: skipped an item with no content; id 3 was already used by an item in this request — assigned id 7 instead; id 0 is not a positive integer — assigned id 7 instead; id 7: "after" must be a positive integer (got "3") — appended at the end; id 4: removed the "1.1)" prefix from the text — numbering is generated
```

(each clause emitted independently, in that order, joined with `; `)

`read` on an inconsistent stored list (F10) — list first, then the **first**
offending pair (lowest offender index; for one offender the `in_progress` clause
wins, then `pending`, then `open_descendant`, then `closed_descendant`), in the §4
reason sentences:

```
issues: list is in an invalid state — 2 is in progress while 1 is still in progress; mutating ops will refuse until every item before an in-progress item is closed or is one of its in-progress ancestors.
issues: list is in an invalid state — 2.1 is in progress while 2 is not in progress; mutating ops will refuse until every item before an in-progress item is closed or is one of its in-progress ancestors.
issues: list is in an invalid state — 1 is closed while 1.1 is still open; mutating ops will refuse until every descendant of a closed item is closed too.
issues: list is in an invalid state — 1 is pending while 1.1 is already closed; mutating ops will refuse until every descendant of a pending item is pending too.
issues: list is in an invalid state — 2 is closed while 1 is still in progress; mutating ops will refuse until every item before a started item is closed or is one of its in-progress ancestors.
issues: list is in an invalid state — 1.4 is closed while 1.3 is not in progress; mutating ops will refuse until every item before a started item is closed or is one of its in-progress ancestors.
```

The third line is rule B (v0.3.4) and is emitted by the same pass: when the first
offender is a closed item, the clause is `<N> is closed while <B> is still open`
(numbers of the candidate) and the tail is the close rule. Tested by T32(e). The
**fourth** line is rule C (v0.3.5), same emitter and same records: when the first
offender is a `pending` item, the clause is `<N> is pending while <B> is already
closed` and the tail is the pending rule. Tested by T49. The **fifth and sixth**
lines are rule D (v0.3.6), same emitter and same records: when the first offender
is a **closed** item, the clause is `<N> is closed while <B> is still in progress`
or `<N> is closed while <B> is not in progress` (§4) and the tail restates rule D.
Tested by T58.

`read` when stored text carries a legacy prefix (F4):

```
issues: 2 items store a legacy numbered prefix; the display omits it — rewrite those texts without the prefix to clear this note.
```

Multi-change refusal (F9) — between the `ERROR:` lines and the trailer, only when
a non-offending change was discarded:

```
ERROR: cannot start 4.2: 3.7, 3 are still in progress.
ERROR: cannot start 4.2: 4 is not in progress.
refused whole: 2 other requested changes were not applied (id 5 content, id 8 priority).
Nothing was changed.
```

Thrown exception (F12):

```
ERROR: todo update failed: EACCES: permission denied, open '<path>.tmp'. Nothing was changed (writes are atomic: a leftover "<path>.tmp" can be deleted safely).
```

### 9.3 Test rows

| # | name | expectation |
| --- | --- | --- |
| T22 | `corrupt store is not overwritten` — hand-write `{"items": [ {` into the session file | `read` → the corrupt `ERROR:` + `Nothing was read.`; `update`/`add`/`write` → the corrupt `ERROR:` + `Nothing was changed.` **and the file bytes are unchanged** (byte compare); `clear` → `TODO: removed the corrupt list file…` |
| T23 | `unreadable store` — `chmod 000` the file (skip when `process.getuid?.() === 0`) | `read` → `ERROR: … could not be read (<path>): EACCES …` + `Nothing was read.`; `remove` refused, file untouched |
| T23b | `write fails, nothing persisted` — `chmod 500` the store dir | `write` → `ERROR: todo write failed: … Nothing was changed …`; original file bytes unchanged |
| T24 | `read announces an inconsistent list` — store `[I@0, I@0]` via real `writeList` | dump + `issues: list is in an invalid state — 2 is in progress while 1 is still in progress; mutating ops will refuse until every item before an in-progress item is closed or is one of its in-progress ancestors.` (text **unchanged**; the rule-B clause is pinned by T32(e), the rule-C clause by T49, and all four clauses are §9.2 F10) |
| T25 | `multi-change update, refused whole` — legal pre-state (`FOUR_TWO_PRE_C`), `update [{id 5, content: "renamed"}, {id 13, status: "in_progress"}, {id 8, priority: "high"}]` | `ERROR: cannot start 4.2: 3.7, 3 are still in progress.` + `ERROR: cannot start 4.2: 4.1, 4 are not in progress.` + `refused whole: 2 other requested changes were not applied (id 5 content, id 8 priority).` + `Nothing was changed.`; store byte-identical (id 5 text and id 8 priority unchanged) |
| T26 | `write with only-rejected items must not clear` — existing list, `write [{content: ""}]` | `ERROR: nothing valid to write: every item in the request was rejected.` + `issues: skipped an item with no content` + `Nothing was changed.`; list intact |
| T27 | `id / after normalization is reported` — `write [{id 3}, {id 3}, {id 0}, {content: "1.1) milk"}, {after: "3"}]` | accepted; `issues:` carries the four named substitutions (`already used … assigned id 7`, `not a positive integer … assigned id 7`, `removed the "1.1)" prefix …`, `"after" must be a positive integer …`) |
| T28 | `legacy prefix: read note + update report` — store one item whose text is `1.1) Buy milk` | `read` shows `Buy milk` **and** the `issues: 1 items store a legacy numbered prefix …` line; `update` with `content: "2) Other"` reports `removed the "2)" prefix` |
| T29 | `absent vs empty vs cleared` | `read` before anything → `TODO: no list for this session yet.`; hand-written empty `{items: []}` → `TODO: the list … is empty (the file exists and holds no items).`; `clear` on it → `TODO: the list for this session was already empty (file removed).`; `clear` again → `TODO: no list for this session — nothing to clear.` |
| T30 | `hook announces an unreadable store` — corrupt file + context hook call | the system block gains exactly `TODO: list unreadable (corrupt store) — run the todo tool op "read" for details.` |

