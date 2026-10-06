# CORE-BRAIN — HOW TO (the session close)

This session has the core-brain memory layer: `core_memory`, reachable ONLY
inside `execute` as `tools.core_memory(...)`. The V2 plugin hooks have no
session-end member (A4 is UNKNOWN), so this file is the reminder that makes the
close happen: **a session close is a ritual — never a silent exit.**

## When the session closes

The user says "wrap up" / "end session" / "we're done"; signals satisfaction
("ok", "thanks", "we're good"); or a task completes and the conversation winds
down. Close the session the same way every time.

## The close — three steps

1. **Write the episode** — one per session close (not one per learning): the
   dated *what happened*, one or two factual sentences.
   `core_memory({ op: "episode", summary: "…", tags: [ ... ] })`
2. **Store the durable learnings** — corrections, stated preferences, discovered
   conventions, decisions, gotchas; one record per learning, phrased as an
   assertion that reads well with no session context.
   `core_memory({ op: "store", text: "<assertion>", target: "self", meta: { type, domain, scope, tags } })`
   Nothing ephemeral, nothing sensitive — and prefer no record over a vague one.
3. **Report what was learned** — always close with the short user-facing summary
   of what was saved; never close silently. When nothing durable was learned,
   say exactly that.

## Where the detail lives

- the `core-brain-session-end` skill — the full extraction, filtering and
  formatting procedure (candidates, quality bar, the good wrap-up example);
- the `core-brain-memory` skill — the continuous layer (recall before acting,
  store as you learn, feedback, forget, the per-reply `Memory — …` line).

This file is only the closing reminder; the skills remain the manual.
