---
name: sleep
description: Consolidate episodes into memories — the dream pass. Use when the scheduler calls it ("load the skill sleep") or when the USER asks to dream. Reads the episodes that never produced a memory, decides what is worth keeping, writes the memories with the core_memory tool, and records the dream.
---

# sleep

**What this skill is.** The dream pass: it turns **episodes** (what happened) into **memories** (what is
true). The judgement is yours; the store guarantees the rest.

## 0. If the caller says "help" — or just "sleep" — explain, do not dream

**How help is asked:** `@sleep help`, "sleep help", **or simply `@sleep` with nothing else after it**
— calling the skill without an instruction means the manual, nothing more.

**The help is what the SCRIPT prints.** Run `scripts/sleep.sh help` and relay its output,
translated to the USER's language, with the same sections in the same order. **Add nothing, remove
nothing, advise nothing** — the text is the manual.

That is what makes it deterministic: the content comes from the program, not from the agent, so
every agent answers the same thing; only the translation varies, and it stays with whoever delivers.

**Help is not a dream:** after explaining, stop — no listing, no memories, no writes.

## 1. Who called you

- **The scheduler** wakes the skill **every hour** and tells it the idle time. It **only dreams when
  the rest reaches the threshold** — `idleHoursRequired`, returned by the `dream` listing and read
  from `dreamIdleHours` in the config (default 4). Below it, end without writing: being woken is not
  a reason to dream.
- **The USER** (`dream`, `sonha`, `scripts/sleep.sh now`). **When triggered by the USER, the idle is
  ignored and the dream starts immediately** — no confirmation, no waiting, no "are you sure". Dream
  what is waiting, or the subset he named.

If a caller demands a threshold check and gives no number, say you cannot verify it and end.
**Never invent the number.**

## 2. See what is waiting

Call `core_memory` with `{ "op": "dream" }` — no payload.

It returns the episodes **without `dreamedAt`**, oldest first, each with `id`, `at`, `summary`,
`tags`, and the policy: **`idleHoursRequired`** and **`episodesPerPass`**. If the list is empty,
**end**: nothing to dream.

**Two numbers to respect from the listing**: compare the idle time (in the prompt) against
`idleHoursRequired` — below, end; and never dream more episodes than `episodesPerPass` allows
(0 = no ceiling) — pick the oldest.

## 3. Decide what becomes a memory

For every episode, ask: **«is this still true tomorrow?»**

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

## 5. Close with the numbers

Report to the caller, in two or three lines:

- episodes read, memories written, the dream id;
- what was **left out** and why (one line — it is the proof of judgement);
- the log line exists at `<data root>/logs/dream.log` (`START` / `END` / `ERROR`).

**Never paste episode texts or memory texts into the conversation.** Paths, ids and counts only.

## Rules

- **No memory without a written sentence** — the store does not summarise, you do.
- **Never re-dream an episode**: `dreamedAt` is the guard, and the store refuses.
- **Never fight a refusal**: an unknown episode, a re-dream or the daily limit are real; adapt.
- **English in memory text** unless the USER's own words are the point (a quote).
- **Nothing outside the dream**: no edits, no other tools, no side quests.
