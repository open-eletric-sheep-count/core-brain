# @oesc/todo-list

> Part of the **OESC OpenCode plugin suite** (hub: [`core-brain`](https://github.com/open-eletric-sheep-count/core-brain) — installs everything). Standalone: `opencode2 plugin add @oesc/todo-list`.

OpenCode V2 plugin: a real todo list the assistant maintains and the user
watches live.

- **Server entry** (`index.ts`): registers the single `todo` tool and a context
  hook that adds **at most one reminder line** to the **system block** while the
  session's list is non-empty (never to the USER's prompt text, v0.2.2).
- **TUI entry** (`tui.tsx`): live panel in the sidebar (`sidebar.content`,
  below the MCP block) showing the current session's list.

Contract: `todo-list-spec.md` (Q1–Q15 decisions).

## Storage

One list per session, in our own JSON store — OpenCode's DB is never touched:

```
~/.local/share/opencode-todo/<sessionID>.json
```

Writes are atomic (tmp file + rename). An empty/absent list means "no list":
the panel hides and nothing is injected.

## Tool contract (`todo`)

Single tool, `op` field (ids are stable integers, never reused):

| op       | effect                                                        |
| -------- | ------------------------------------------------------------- |
| `read`   | return the current list                                       |
| `write`  | replace the whole list (`items`; empty array clears)           |
| `add`    | append items (new ids assigned and reported)                  |
| `update` | change `content`/`status`/`priority`/`depth` of items addressed by id |
| `remove` | delete items by id                                             |
| `clear`  | delete the entire list (storage file removed)                 |

Statuses: `pending` `[ ]` · `in_progress` `[~]` · `completed` `[x]` `(struck)` ·
`cancelled` `[!]` `(struck)`. Priorities: `high` `medium` `low`.

Items carry an optional **`depth`** (0 = top; children +1). The hierarchical
numbering (`1)`, `1.1)`) is **generated** from depth + order at display time —
never stored nor written in content (legacy prefixes are stripped); it
renumbers automatically on add/remove, and `add` accepts **`after: <id>`** to
insert right after an existing item.

## Ordering rule (v0.3)

An item may be **started, closed or cancelled** only when **every item before
it is already `completed` or `cancelled`** — the single exception being its
**own ancestors, which must themselves be `in_progress`** (and, for a closed
item, its ancestors being closed too). The started items form one path, walked
in order: nothing may be skipped and nothing may run in a second branch.
`pending` is not a free pass — an unstarted item blocks everything after it,
and the same holds for closing: jumping over an open item is refused.

- **Legal** — `{1, 1.1}`: the parent runs, and the child runs with it.
- **Legal** — `{3, 3.1, 3.1.2}`: one chain, every ancestor in progress.
- **Rejected** — `{1.1}` while `1` is `pending`:
  `ERROR: cannot start 1.1: 1 is not in progress.`
- **Rejected** — closing `1.4` while `1.3` is still `pending`:
  `ERROR: cannot close 1.4: 1.3 is not in progress.`
- **Rejected** — closing root `2` while root `1` still runs:
  `ERROR: cannot close 2: 1 is still in progress.`
- **Rejected** — `{3, 3.1, 4.3}`: `4.3` comes after `3` and `3.1`, so it needs
  both closed first — it is not a branch they may run beside.

Ancestry comes from the **derived** numbers, never from stored `depth`
(`3.1.2` starts with `3.1.`; `4.3` does not).

Two sentences for a start, one per blocker state, singular or plural by the
blocker count of that line (the close rule adds a third, below, and the pending
rule a fourth):

| blocker state | one blocker | several blockers |
| --- | --- | --- |
| `in_progress` | `ERROR: cannot start <N> (id <i>): <B> (id <b>) is still in progress.` | `ERROR: cannot start <N> (id <i>): <B1> (id <b1>), <B2> (id <b2>) are still in progress.` |
| `pending` | `ERROR: cannot start <N>: <B> is not in progress.` | `ERROR: cannot start <N>: <B1>, <B2> are not in progress.` |

`write`, `add`, `update` and `remove` validate the **whole resulting list** (a
`depth` change, or a `remove` that re-clamps an item, moves the ancestry, and
only a whole-list evaluation sees it). A violation rejects the operation
**entirely**: one line per offending item **and reason**, running blockers first,
blockers nearest-first, then the trailer:

```
ERROR: cannot start 4.3: 3.1, 3 are still in progress.
ERROR: cannot start 4.3: 4.2, 4.1, 4 are not in progress.
Nothing was changed.
```

Nothing is written — the stored list stays byte-identical (`nextId` unchanged).
The line names the item the call tried to start, and the sentence always
describes the state that was **refused**.

### The close rule (v0.3.4)

The other direction is a second mandatory law: **a closed item may not have an
open descendant** — `completed` and `cancelled` are closed, `pending` and
`in_progress` are open. Closing is a commitment that the branch is over, so a
branch is closed **bottom-up**, never over its children's heads. The start rule
looks at in-progress items and therefore never sees a closed one; that is the
hole this law closes, and the reverse is a corollary: progress runs top-down to
start and bottom-up to close.

- **Legal** — `1 completed` + `1.1 completed`; `1 completed` + `1.1 cancelled`
  (`cancelled` counts as closed).
- **Illegal** — `1 cancelled` + `1.1 pending`:
  `ERROR: cannot close 1: 1.1 is still open.`
- **Illegal** — `1 completed` + `1.1 in_progress`: the same single line — the
  start rule passes the pair, only the close rule refuses it.
- **Illegal** — `1 completed` with `1.1`, `1.1.1`, `1.1.2` open:
  `ERROR: cannot close 1: 1.1, 1.1.1, 1.1.2 are still open.`

A deep chain is fixed bottom-up — `1.1.2`, `1.1.1`, `1.1`, then `1` — and every
closed ancestor that still has an open descendant is named:

```
ERROR: cannot close 1: 1.1.2 is still open.
ERROR: cannot close 1.1: 1.1.2 is still open.
Nothing was changed.
```

`remove` is validated too: deleting a parent re-parents its children, so a
removal that would leave an open item under a closed one is refused with the same
line — `ERROR: cannot close 1: 1.1 is still open.` `cannot close` names the
**state class** being refused, not the field the call touched. Message layout is
unchanged: one line per offending item **and reason**, offenders in list order,
blockers nearest-first, and for one offender the lines follow one fixed order —
`still in progress.`, then `not in progress.`, then `still open.`, then
`already closed.` — with the trailer `Nothing was changed.`

### The pending rule (v0.3.5)

The third law is the close rule's mirror: **an item may be `pending` only while
every descendant is `pending`.** The moment a descendant is `completed` or
`cancelled`, its ancestors can no longer claim "never started". Rule B forbids
*finishing* a branch from the top; rule C forbids *un-starting* it from the top.

- **Legal** — `1 in_progress` + `1.1 completed`: the parent started, so the
  bottom-up close stands.
- **Illegal** — `1 pending` + `1.1 completed`:
  `ERROR: cannot revert 1 to pending: 1.1 is already closed.`
  A `cancelled` descendant blocks exactly the same way, and several of them are
  listed nearest-first with `are`:
  `ERROR: cannot revert 1 to pending: 1.1, 1.1.1 are already closed.`
- **Rule B, not C** — `1 cancelled` + `1.1 pending`:
  `ERROR: cannot close 1: 1.1 is still open.` A closed *descendant* constrains a
  `pending` ancestor, but a `cancelled` **ancestor** is not constrained by C —
  that branch is already finished.

The way out is the law read forwards: start the parent (`1 → in_progress`), then
close bottom-up — `1.1 → completed`, then `1` — or remove the closed descendant.
Cancelling the pending ancestor (once its descendants are closed) is legal too,
and `clear` always works.

The four ops reach it just as they reach A and B — `update` by a status revert or
a `depth` move, `write` by arriving with the state, `add` by `after:` + `depth`
inserting a `pending` item above an existing closed one, `remove` by
re-clamping a closed child under a `pending` ancestor — and all four are refused
whole. `read` announces a store that only violates C:
`issues: list is in an invalid state — 1 is pending while 1.1 is already closed; mutating ops will refuse until every descendant of a pending item is pending too.`

`read` and `clear` are never validated, so **`clear` always works**: that is the
way out of a list that is already illegal. Lists are not migrated; the next
mutating op validates them, and any corrective `update` (or `remove`) that yields
a legal list is accepted — there is no lockout.

All three laws are validated on the same four ops (`write`, `add`, `update`,
`remove`), and nothing about them is stored. Normative contract:
`spec-ordering.md` v0.3.5, rules A, B and C (`todo-list-spec.md` §13 is the
pointer).

## Never fails silently

No path of the tool hides a state. `ERROR: …` means the call was refused and
**nothing** was persisted (`Nothing was changed.`, or `Nothing was read.` for
`read`); `issues: …` means it succeeded but data was adjusted, and says exactly
what was adjusted.

- **A store that cannot be trusted is never overwritten.** A corrupt or
  unreadable file used to be swallowed as "no list", so the next `write`/`add`
  replaced it. `write`, `add`, `update` and `remove` now refuse before any
  computation, naming the path and the cause; `read` answers the same and ends
  with `Nothing was read.`; `clear` is the only op allowed to destroy such a
  file, and it says so:
  `TODO: removed the corrupt list file for this session (it could not be parsed).`
- **An all-rejected `write` does not clear the list.** If every requested item is
  rejected (e.g. `[{content: ""}]`), the call used to leave an empty candidate
  list — i.e. it cleared the session. It now refuses:
  `ERROR: nothing valid to write: every item in the request was rejected.` plus
  the `issues:` line naming the skipped item; the stored list is untouched. Only
  an explicit `items: []` clears.
- **Absent and empty are distinct.** `TODO: no list for this session yet.`
  versus `TODO: the list for this session is empty (the file exists and holds no items).`
  `clear` likewise reports what it found: file removed, already empty, or
  nothing to clear.
- **A refused multi-change `update` itemises what it dropped** — between the
  `ERROR:` line and the trailer, only when a non-offending change was discarded:
  `refused whole: 2 other requested changes were not applied (id 1 content, id 3 status).`
- **`read` announces an already-inconsistent stored list** — the list first, then
  `issues: list is in an invalid state — 2 is in progress while 1 is still in progress; mutating ops will refuse until every item before an in-progress item is closed or is one of its in-progress ancestors.`
  Stored text that still carries a legacy prefix gets one summary line
  (`… items store a legacy numbered prefix; the display omits it — …`).
- **Substituted inputs are reported**, one `issues:` clause each, in this order:
  a skipped item with no content; a duplicate `id` (`id 3 was already used … assigned id 7 instead`);
  a non-positive `id` (`id 0 is not a positive integer — assigned id 7 instead`);
  a non-integer `after` (`id 7: "after" must be a positive integer (got "3") — appended at the end`);
  and a stripped legacy prefix (`id 4: removed the "1.1)" prefix from the text — numbering is generated`).
- **The context reminder** says when the list is unreadable
  (`TODO: list unreadable (corrupt store) — run the todo tool op "read" for details.`)
  instead of staying silent. The sidebar panel still hides on an unreadable store:
  it has no message channel, and the tool carries the announcement.
- **A thrown exception states the outcome** —
  `ERROR: todo <op> failed: <msg>. Nothing was changed (writes are atomic: a leftover "<path>.tmp" can be deleted safely).`

## Check

```bash
cd global/opencode/plugins/todo-list && ./check.sh
```

Import smoke check (node native TS) + typecheck (uses `tsc` when available,
else `npx typescript@5.9.2`). **Single-folder layout**: this directory is
both the source and the distribution artifact — the installer copies it
as-is (in-place TS, no bundling — the loader loads TS directly; the host
supplies OpenTUI and solid-js; zero runtime deps). `npm publish` also runs
from here (`files`: the flat `.ts`/`.tsx` entries + `README.md`).

### Tests (dev only)

```bash
cd global/opencode/plugins/todo-list && node --test tests/*.test.mjs
```

Zero dependencies (`node:test`, `node:assert/strict`, `node:fs`, `node:os`,
`node:path`). Every test runs under a temporary `HOME`, so the real
`~/.local/share/opencode-todo/` is never touched. `tests/` is dev-only and is
not published (`files`); `check.sh` does not run it.

## Install

```bash
core-brain/global/opencode/install-global.sh
```

Copies `global/opencode/.` into `~/.config/opencode/` (auto-discovery; no
`opencode.json` entry needed). The plugin only becomes usable after the `todo`
permission entries exist in the host `opencode.json` (global deny + ORACLE
allow).

## How-to injection (`context-inject`)

A static **how-to** (`TODO_TOOL_HOWTO.md`) is injected into sessions by the
`context-inject` plugin (core-brain `global/opencode/plugins/context-inject/`),
so agents know the tool contract before the first call. (The dynamic one-line
`TODO: …` reminder stays owned by this plugin's own **context hook**
(`event.system`, v0.2.2 — it was moved off the prompt text so it can never look
like the USER's own words) — spec §7/Q15.
The sidebar panel and that reminder are agent-agnostic; scope applies to the
static how-to and the tool permission.)

**Current scope: `ORACLE` only** — matching the tool's permission model
(global `todo` deny + ORACLE allow). It fires on `session.created` and
`session.compacted`.

Files (source of truth: `global/opencode/plugins/context-inject/` in this
repo; shipped to the mirror by the installers):

- `global/opencode/plugins/context-inject/TODO_TOOL_HOWTO.md`
- `global/opencode/plugins/context-inject/config.json`:

```jsonc
"injections": {
  "agents": {
    "ORACLE": {
      "session.created": ["TODO_TOOL_HOWTO.md"],
      "session.compacted": ["TODO_TOOL_HOWTO.md"]
    }
  }
}
```

After install, the file lives at
`~/.config/opencode/plugins/context-inject/TODO_TOOL_HOWTO.md`.

### Expanding to other agents

1. **Injection config** — add the agent under `injections.agents.<AGENT>`
   (or use the reserved `ALL` key to inject for every session). For one
   event, `ALL` files come first, then the agent's; relative entries resolve
   against the plugin directory, `/...` entries are used as-is, dedup by
   resolved absolute path.
2. **Permission** — grant the `todo` tool to that agent in
   the target OpenCode configuration (`~/.config/opencode/opencode.json`, or
   your own configuration source), inside the agent's `permissions` array.
   Keep the global deny when using that access policy:

   ```json
   { "action": "todo", "resource": "*", "effect": "allow" }
   ```

3. **Install** — from the OESC repository root, run
   `bash install.sh --host opencode`. The suite is installed under
   `~/.config/opencode/` by default. See the root
   [installation guide](../../../../INSTALATION.md) for prerequisites and paths.

Example — also enabling `DEVELOPER`:

```jsonc
"agents": {
  "ORACLE": {
    "session.created": ["TODO_TOOL_HOWTO.md"],
    "session.compacted": ["TODO_TOOL_HOWTO.md"]
  },
  "DEVELOPER": {
    "session.created": ["TODO_TOOL_HOWTO.md"],
    "session.compacted": ["TODO_TOOL_HOWTO.md"]
  }
}
```

## Empirical items (first live test)

1. **Execute context**: the shape of `execute(input, tool)`'s second argument
   is undocumented; the plugin resolves `sessionID` defensively and writes the
   observed keys once to `~/.local/share/opencode-todo/debug.log`. If the
   resolved id is wrong, adjust `resolveSessionID` in `index.ts`.
2. **Slot placement**: if the panel does not land below the MCP block, switch
   `append: "sidebar.content"` to `append: "sidebar.footer"` in `tui.tsx`.
3. **Layout**: the panel root uses `flexShrink={0}`/`flexGrow={0}` and NO
   `scrollbox` — an inner scrollbox squeezed the MCP block above it (garbled
   rows) whenever the list existed (bug found 2026-09-11). Bounded scrolling
   for long lists is a follow-up iteration.
