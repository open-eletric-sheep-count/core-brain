---
name: core-brain-session-end
description: Extract durable learnings at the end of a session and save them as core-brain memories — corrections, preferences, and codebase patterns; nothing ephemeral, nothing sensitive. Use when the user says "wrap up", "end session", "we're done", or signals the session is closing (including plain satisfaction — "ok", "thanks", "we're good"), or when a conversation winds down after completing a task and you want to record what you learned before the context window closes.
---

# Core-Brain Session End

Run this at the end of a conversation to extract what is worth remembering.

Core-brain stores durable knowledge — corrections, conventions, preferences, decisions. It does not store session logs, one-off status, or anything that will be irrelevant next week. This skill enforces that discipline.

## When to Use

- The user says "wrap up", "end session", "we're done", or similar
- The user signals the session is closing — including plain satisfaction ("ok", "thanks", "we're good")
- The conversation is winding down after completing a task
- You want to record what you learned before the context window closes

## Procedure

### Step 1 — Identify learning candidates

Scan the conversation for:

| Category | Examples |
|----------|---------|
| **Corrections** | "No, the API returns snake_case" / "Don't use X, use Y" |
| **Preferences** | "Always run lint before committing" / "User prefers concise explanations" |
| **Codebase conventions** | "This project uses repository pattern" / "Tests live in `__tests__/`" |
| **Decisions** | "We chose PostgreSQL for ACID compliance" |
| **Gotchas** | "The staging env needs `NODE_ENV=staging`, not `production`" |
| **Terminology** | "They call it a 'slot' not a 'channel'" |

### Step 2 — Filter ruthlessly

Skip:

- Anything already obvious from reading the codebase
- Session-specific state ("we're working on the login page right now")
- One-off status ("the build was red this morning")
- Anything you are not confident about
- Secrets, credentials, API keys — never

### Step 3 — Write each learning as a durable assertion

Format: a single clear statement that will make sense to a future agent with no session context.

Good: `"The publish script requires npm 2FA — always run 'npm publish' interactively, never from CI."`

Bad: `"We talked about the publish issue."`

### Step 4 — Assign metadata

For each learning, determine:

- `type`: `correction` | `preference` | `convention` | `decision` | `gotcha` | `fact`
- `domain`: the project, library, or topic area (e.g., `"core-brain"`, `"typescript"`, `"project:acme"`)
- `scope`: the scope of applicability (e.g., `"global"`, `"project:acme"`)
- `tags`: 2–5 descriptive tags

### Step 5 — Save

If the `core_memory` tool is available:

```
core_memory({ op: "store", text: <statement>, target: "self", meta: { type, domain, scope, tags } })
```

- Call once per learning — do not merge several learnings into a single record.
- Use `target: "global"` only for knowledge that belongs to every agent (cross-project rules); everything else stays in your own namespace (`target: "self"`, the default).

### Step 6 — Record the session episode

An episode is the dated *what happened* of this session — one per session close, not one per learning. If the `core_memory` tool is available:

```
core_memory({ op: "episode", summary: "<one or two sentences: what this session did and produced>", tags: [ ... ] })
```

- Keep the summary factual — what happened, not how it felt.
- Episodes are searchable by meaning later (`op: "timeline"`); a memory can be derived from an episode with `op: "promote"`.

## Quality bar

Fewer, stronger memories beat many weak ones.

- Prefer **no record** over a vague one
- One sentence per record — if you need two sentences, split it into two records
- If you're unsure whether something is reusable, skip it

## What a good wrap-up looks like

```
Session learnings saved (3 records + 1 episode):

1. [correction] The API returns timestamps in Unix seconds, not milliseconds.
   domain: project:acme | tags: api, timestamps

2. [preference] User prefers TypeScript strict mode — always enable in tsconfig.
   domain: typescript | tags: tsconfig, preferences

3. [gotcha] The staging deploy requires a manual cache bust at /admin/cache.
   domain: project:acme | tags: deploy, staging, ops
```

**Always close with the user-facing summary** — show what you saved, even when the user just signals satisfaction; never close silently. Keep it short; do not narrate your reasoning.

## Integration with core-brain-memory

This skill pairs with `core-brain-memory`:

- `core-brain-memory` guides you to store, recall, and maintain memories as you work
- `core-brain-session-end` runs once — it extracts and saves what the session produced

Together they close the memory loop: use memory during the work, learn at the end.
