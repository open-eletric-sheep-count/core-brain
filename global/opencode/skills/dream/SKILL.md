---
name: dream
description: Consolidate episodes into memories — the dream pass. Use when the scheduler calls it ("load the skill dream") or when the USER asks to dream. Reads the episodes that never produced a memory, decides what is worth keeping, writes the memories with the core_memory tool, and records the dream.
---

# dream

**What this skill is.** The dream pass: it turns **episodes** (what happened) into **memories** (what is
true). The judgement is yours; the store guarantees the rest.

## 0. If the caller says "help" — or just "dream" — explain, do not dream

**How help is asked:** `@dream help`, "dream help", **or simply `@dream` with nothing else after it**
— calling the skill without an instruction means the manual, nothing more.

**The help is what the SCRIPT prints.** Run `scripts/dream.sh help` — the path is INSIDE this skill's
own folder, shipped with the skill (USER, 2026-11-20), so it resolves wherever the skill is installed —
and relay its output, translated to the USER's language, with the same sections in the same order.
**Add nothing, remove nothing, advise nothing** — the text is the manual.

That is what makes it deterministic: the content comes from the program, not from the agent, so
every agent answers the same thing; only the translation varies, and it stays with whoever delivers.

**Help is not a dream:** after explaining, stop — no listing, no memories, no writes.

## 1. Who called you

- **The scheduler** wakes the skill **every hour** and tells it the idle time. It **only dreams when
  the rest reaches the threshold** — `idleHoursRequired`, returned by the `dream` listing and read
  from `dreamIdleHours` in the config (default 4). Below it, end without writing: being woken is not
  a reason to dream.
- **The USER** (`dream`, `sonha`, `scripts/dream.sh now`). **When triggered by the USER, the idle is
  ignored and the dream starts immediately** — no confirmation, no waiting, no "are you sure". Dream
  what is waiting, or the subset he named.

If a caller demands a threshold check and gives no number, say you cannot verify it and end.
**Never invent the number.**

**Nobody answers at night** (USER, 2026-11-21): the scheduled pass runs while the USER sleeps, so it
**never asks, never waits for a confirmation and never leaves a decision open** — a question at 3 a.m.
stalls the whole night. The rules below decide everything: how many episodes, which pairs, what
becomes a memory, what is left out. When two readings are possible, do **less** and say it in the
report; asking is not an option.

**The switch** (USER, 2026-11-22): `dreams` in the config is the master switch, and it is **off
unless it is literally `true`**. Off is the default on purpose — the dream is **experimental and
spends tokens** (ten sessions of synthesis can run in one night). With it off the listing comes back
as `dreamsEnabled: false` and any write is refused: **end there** — no dream, no synthesis, no
report beyond one line saying it is off. Turning it on is the USER's decision, never yours.

## 2. See what is waiting

Call `core_memory` with `{ "op": "dream" }` — no payload.

It returns the episodes **without `dreamedAt`**, oldest first, each with `id`, `at`, `summary`,
`tags`, and the policy: **`idleHoursRequired`**, **`episodesPerPass`** and **`dreamsEnabled`**. If the
list is empty **or `dreamsEnabled` is false**, **end**: nothing to dream.

**Two numbers to respect from the listing**: compare the idle time (in the prompt) against
`idleHoursRequired` — below, end; and never dream more episodes than `episodesPerPass` allows
(0 = no ceiling) — pick the oldest.

## 3. Decide what becomes a memory

An episode says **what happened**. A memory keeps only the part that **stays true** — a rule, a
decision, a trap — and leaves the occasion behind:

- session numbers, dates, window names, what was delivered → **stays in the episode**;
- decisions, conventions, rules the USER stated, technical traps that would cost time again →
  **become memories**;
- **one memory, one fact**. A sentence about the world, in the present tense;
- a rule from the USER always becomes a memory;
- discarding is half the job: a dream that keeps everything is a transcript, not a dream.

Aim for the fewest memories that keep the value. Two or three per episode is normal; ten is a smell.

## 4. Write the dream

One call, everything together:

```
core_memory {
  op: "dream",
  episodeIds: [ "EP-…", "EP-…" ],
  memories: [
    { text: "…", meta: { type: "decision", domain: "…", tags: ["…"] } },
    { text: "…", meta: { type: "gotcha",  domain: "…", tags: ["…"] } }
  ]
}
```

- **Manual dream** (the USER asked now): add **`force: true`** to that call — it bypasses the daily
  limit. **The scheduled path never sets it.**
- **A duplicate is reinforcement, not a copy** (USER, 2026-11-19): when the sentence already exists
  as an active memory, the store does **not** create a second one — it adds this dream to that
  memory's list, raises its counters and marks the episode. Nothing refuses; nothing duplicates.
- **When it is REFUSED:** the episode does not exist; the episode was already dreamed; **more
  episodes in one call than `dreamEpisodesPerPass` allows**; and, on the scheduled path, **not
  enough rest yet** (below the threshold it simply ends — a pause, not an error). A refusal changes
  nothing: no memory, no dream record, no mark on the episode.
- **The daily limit** is a pause, not a refusal: once the day's dreams are used, the automatic pass
  stops until tomorrow; a manual request still goes through (`force: true`).
- The store writes `dreams.json`, marks every episode with `dreamedAt`, and puts the dream id and its
  date in each memory's `meta.dreams`. **Never write those fields yourself.**

## 5. The pairs the dream joined — review them before you close (USER, 2026-11-20)

A memory that says the same thing in other words is not a second memory: the store joins the two and
puts the pair in **`dream_memories`** — both texts, the cosine, and `status: "pending"`. The machine
picks the richest text and sums the score; **it does not rewrite a memory on its own judgement.**

**The review is part of the dream, not a second step for the caller** (USER, 2026-11-20): when the
dream is written, before you close, do this yourself — no extra command, no extra session:

1. **Read the queue** — `core_memory { op: "admin", action: "dream-memories" }` returns the pending
   rows: `survivorText`, `absorbedText`, `cosine`, `namespace`, the two ids.
2. **Decide, row by row** — do they really say the same thing?
   - **The survivor already says it all** → write nothing; settle the row with
     `admin { action: "dream-memory", args: { id, mergedText: <survivorText>, mergedMemoryId: <survivorId> } }`.
     That records the verdict; a second copy would be the duplicate we just removed.
   - **The absorbed text adds a fact the survivor lacks** → write ONE memory with the union
     (`store`, up to `memoryMaxChars` — 650 by default, read from the config — **in the namespace
     the row belongs to**), retire the survivor
     (`forget` its id), and settle the row with `mergedText` and the **new** id — one memory again.
   - **They do not say the same thing** → settle it with `{ id, skipped: true }` and say why in the
     report. Nothing is written.
3. **Never cross a namespace** (USER, 2026-11-20): one agent's memories become that agent's memory,
   two globals become one global, and a global beside an agent memory is **not** duplication — both
   stay. A row is always inside one namespace; never move a fact out of it.

The passes are also recorded in the **`dreams`** table (start, end, counts, `running`/`done`), so the
USER can analyse them: `core_memory { op: "admin", action: "dreams" }`.

## 6. Before you close: the retired rows leave the live table (USER, 2026-11-20)
`memories` is what every agent reads on every call, so it must not accumulate audit data. When the
pass closes, the store moves **every retired record** to **`memories_history`** (same columns plus
`archived_at`) and drops its FTS entry and vector — a retired memory is never recalled again. You do
nothing: it happens inside the dream, and the pass reports how many moved (`archived`).

The history belongs to the USER: `admin { action: "history" }` shows how many records it holds, and he
may delete them whenever he wants — it exists for auditing, not for answering.

## 7. The second half: the synthesis band (USER, 2026-11-20)

Above 0.97 the store unites two memories by itself. Between **`synthesisMinCosine` and 0.97** — 0.90
by default, the same for every install — they say the same thing in other words, and only a writer can put them together — that is the synthesis, and it is
a script, not a judgement you make in this session:

```
scripts/dream.sh synthesize
```

**Always through `dream.sh synthesize`, never the worker in the foreground** (USER, 2026-11-21): a
foreground shell command is cut at 5 minutes by the anti-loop guard, and the night may need up to 30
minutes of deadline. The command launches the worker with `nohup`, writes
`<data root>/logs/dream-synthesize.log`, and refuses a second run while one is alive.

**One session writes the whole night** (USER, 2026-11-22): every group goes into ONE prompt and ONE
answer brings back one union per group — not one session per pair.

- **Only living memories are elected** (USER, 2026-11-22): the selection reads the active records
  only — a retired memory and a dream (`real = false`) never enter a group.
- **How the night picks its pair** (USER, 2026-11-22): inside **`synthesisMinCosine`–0.97** (0.90 by
  default — the same fact in PT and in EN lands there), every memory proposes its nearest neighbour; the
  candidates are ordered by cosine, highest first, and the night takes **only the highest — one
  group**. Below the floor nothing is united (two texts can share a style and say different things).
  **A tie is settled at random** — two pairs with the same cosine are equally good tonight. The rule
  is the store's (`admin synthesis-pairs`), not a choice made here. `--limit N` is a deliberate pen,
  never the rule.
- **The window keeps it linear** (`synthesisWindowHours`, 48 by default): only **one side** of the
  pair has to be younger than the window — a new memory still finds an old duplicate — and `0` reads
  the whole living base. Without it, every night would re-read everything.
- It opens **ONE session for the night**, sends **PROMPT A** with every group (`{{count}}` and
  `{{groups}}`), waits up to **30 minutes** for the single answer, and reads one union per numbered
  block (`## 1`, `## 2`, …). Each union lands with `admin dream-store` — `real = false`, the sources
  retired in the same write, and **the union inherits the strength it replaces: its score is the SUM
  of its sources'** (USER, 2026-11-22), so uniting two strong memories never produces a newborn 10.
  A dream that names no source still starts at 10.
- **Every union obeys the memory ceiling** (`memoryMaxChars` in the config, 650 by default — the
  same key `store` enforces): the prompt carries it as `{{max}}`, the worker refuses longer answers
  before writing, and the store refuses them again. A group whose block is missing, too long or
  refused is IGNORED: nothing is removed for it, and the night goes on with the others. If the session does not answer at all, the whole night is
  ignored in one line and every group stays intact.
- **A memory appears in ONE dream per night** (USER, 2026-11-21): when two of the chosen pairs share
  a memory, they are **not** dreamed twice — the store merges them into a single group, and that
  group travels whole in the prompt. The first dream would otherwise absorb that memory and the
  second would dream about something already gone.
- At the end it tells the **10 most recently used top-level sessions** what was dreamed (**PROMPT
  B**) — subagent sessions and the dream's own sessions are left out.
- The worker's flags pass through: `--dry-run` lists the pairs and writes nothing; `--limit N` dreams
  fewer; `--no-notify` skips the telling.
- The prompts live in `<data root>/prompts/dream-a.txt` and `dream-b.txt` when present (the USER may
  edit them); otherwise the copies shipped with this skill are used.

Run it once the dream is written, before you close — the numbers (−1, retire at zero, archive) belong
to the dream, the dreams themselves belong to this script.

## 8. Close with the numbers

Report to the caller, in two or three lines:

- episodes read, memories written, the dream id;
- what was **left out** and why (one line — it is the proof of judgement);
- the log line exists at `<data root>/logs/dream.log` (`START` / `END` / `ERROR`).

**Never paste episode texts or memory texts into the conversation.** Paths, ids and counts only.

## Rules

- **Never ask the USER anything.** The night has nobody to answer: the sections above decide, and the
  report carries what was left out. A question is a stalled night, not caution.
- **No memory without a written sentence** — the store does not summarise, you do.
- **Never re-dream an episode**: `dreamedAt` is the guard, and the store refuses.
- **Never fight a refusal**: an unknown episode, a re-dream or the daily limit are real; adapt.
- **English in memory text** unless the USER's own words are the point (a quote).
- **Nothing outside the dream**: no edits, no other tools, no side quests.
