---
name: core-brain-memory
description: Persistent memory for AI agents backed by the core-brain store (core_memory). Store corrections, preferences, and conventions as they happen; recall relevant knowledge before acting; give feedback and retire stale records. Use every session — memory is a continuous layer, not a feature you toggle.
---

# Core-Brain Memory

Persistent memory for AI agents. Corrections, preferences, and patterns are stored as **memory records** and recalled by meaning, not just spelling. The system gets more useful the longer you use it.

## When to Use

Always. Memory is not a feature you toggle — it is a layer that runs continuously:

- **Recall before you act** — when the user references earlier work, decisions, or conventions, search first. Core-brain does not inject memory automatically; `recall` is how memory surfaces.
- **Store as you learn** — corrections, stated preferences, discovered conventions (see the Learning Protocol below).
- **Give feedback** — after a recalled record helped or misled you.
- **Retire stale records** — `forget` what is no longer true.

## Memory Lifecycle

- **`recall`** — `core_memory({ op: "recall", query: "..." })` searches the namespaces you may read (your own + `global`, when your policy grants it). Retrieval is hybrid: keyword (BM25) + vector, so meaning matches even without shared words. A recall without a query lists the most recent/ranked records.
- **`store`** — `core_memory({ op: "store", text: "...", target: "self", meta: { type, domain, scope, tags } })`. Use `target: "global"` only for knowledge that belongs to every agent; everything else stays in your namespace (`"self"`, the default). Common `meta` slots: `type` (correction | preference | convention | decision | gotcha | fact), `domain`, `scope`, `tags`.
- **`feedback`** — `core_memory({ op: "feedback", id: "<id>", useful: true })` (or `false`). Records whether a read record was useful; it feeds the ranking tie-break. Give it on records you actually used or that misled you.
- **`forget`** — `core_memory({ op: "forget", id: "<id>" })` retires a record without deleting it: it leaves recall, its text stays on disk. Also accepts `query` to retire everything at/above the match threshold.
- **`episode` / `timeline` / `promote`** — the dated diary: `episode` appends one dated record of *what happened*; `timeline` reads the diary (searchable by meaning); `promote` derives a memory from an episode. Episodes are history; memories are what is known.
- **`who`** — `core_memory({ op: "who" })` reports your policy when you need to know your access.

## The Learning Protocol

- **Correction** — store the correction immediately. Corrections outrank your prior assumptions.
- **Preference** ("always use X", "never do Y") — store it.
- **Convention or pattern discovered** — store it.
- **Decision** — store it with the reason and the condition that would reopen it.
- **Session wrap-up** — follow the `core-brain-session-end` skill to extract what the session produced.

## What NOT to Learn

- Trivial facts ("the user said hello")
- Things already in the codebase (file paths, function names — those change)
- Session-specific state ("we're working on X right now")
- Anything you're not confident about

## What to Learn

- Corrections: "The API returns snake_case, not camelCase"
- Preferences: "User prefers TypeScript over JavaScript"
- Patterns: "This codebase uses repository pattern for data access"
- Decisions: "We chose PostgreSQL for ACID compliance"
- Conventions: "Always run lint before committing"

## Check before you write

Core-brain has no automatic duplicate check — a quick `recall` with the statement you are about to store is the check.

- **Genuine duplicate** (same fact) — do not store it again; nothing to do.
- **Same fact, outdated** — `forget` the old record first, then store the new one. Retiring first is the whole recipe; there are no automatic supersede relations.
- **Genuinely distinct** — the write stands.
- **Draft the assertion before you call the tool.** Superseding a record you wrote minutes ago is a redraft, not a correction — fix the wording before storing; do not stack near-identical records.

## The Memory Line

End every reply with one short line, carrying only the parts that happened this turn:

`Memory — recalled N · stored <id> · episode <id>`

or, when nothing happened:

`Memory — none`

Only count/list ids you actually saw this turn; never invent an id. Give details only if the user asks.

## Getting Started

On first use your namespace may be empty — that is expected. Your first sessions are the bootstrap period: **store actively** (corrections, preferences, patterns). After roughly twenty records, recall starts returning useful context.
