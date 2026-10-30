# Developer guide

Architecture, the memory design, known risks, the glossary and the SonarQube setup.
If you only want to install and use OESC, you do not need this file.

---

### The full version of Core Brain Memory — our goal.

Give an LLM agent a memory that is closer to a human's:

1. **Tiered memory** — short, medium, and long-term, with rules for moving a
   memory *between* tiers (promotion when reused, decay/demotion when ignored).
2. **Consolidation ("dreams")** — a periodic, offline pass that deduplicates,
   merges, and *synthesizes* raw memories into fewer, higher-level insights, so
   memory gets *more* useful over time instead of just *bigger*.
3. **A mental map** — a graph of interconnected topics where activating one topic
   spreads activation to related topics with a decaying score, "waking up"
   associated memories. The spread is guaranteed to terminate.

The whole thing is designed to be **quick to implement** because the heavy
substrate already exists.

---

### 1. Problem

An LLM's **context window** is finite and volatile — it is the agent's *RAM*.
Real agents need *long-term* memory (facts, decisions, history) that does not fit
in the window and that survives between sessions. The research lineage that
motivates this project:

- **MemGPT / Letta** — treats the LLM as an operating system: a small *core
  memory* always in context, a large *archival memory* outside it, with
  self-editing and paging; plus a "sleep-time agent" that reorganizes memory
  while idle.
- **Generative Agents** — a memory stream retrieved by recency/importance/
  relevance, plus *reflection* that turns low-level observations into high-level
  insights.
- **Reflexion** — episodic memory of verbal self-reflections.

This project is the working embodiment of the `Brain` task in
`project-generator/docs/TASKS.md` (line ~145): *"Brain, project with short,
medium and long term memory, with dreams."*

---



### 2. Core concepts (the three pieces)

#### Tiers — promotion by evidence of reuse, not recency

| Tier                          | What it is                                   | Where it lives today                          |
| ----------------------------- | -------------------------------------------- | --------------------------------------------- |
| **Short-term** (working)      | The current session's working memory         | The context window (not persisted)            |
| **Medium-term** (project)     | Facts/decisions for *this* project           | `core_memory`, agent namespace (`self`)       |
| **Long-term** (cross-project) | Stable preferences, rules, durable knowledge | `core_memory`, `global` space                 |

Movement rules:

- **Promotion** — a memory retrieved ≥ N times across ≥ M distinct sessions is
  promoted to long-term (global scope / profile).
- **Decay / demotion** — a memory never retrieved for X days loses weight; below a
  threshold it is pruned or demoted.

#### Dreams — consolidation

A periodic pass (trigger: N sessions elapsed, an explicit `sleep` command, or
right before compaction fires). Four operations, in order:

1. **Dedupe & merge** — memories above a cosine-similarity threshold collapse into
   one *canonical* memory (union of facts).
2. **Synthesize** — cluster related raw memories and generate a *small* number of
   higher-level *insights* that compress the cluster (five facts about "opencode
   config path confusion" → one insight "source of truth is `global/opencode/`,
   the mirror is generated").
3. **Promote / demote** — apply the tier movement rules.
4. **Reconcile the map** — update the mental map so it reflects consolidated
   memory, not raw noise.

Anti-loop / convergence guarantees (mandatory):

- Every synthesized memory is flagged `synthesized` — a future dream never
  re-synthesizes an already-synthesized memory (prevents infinite abstraction).
- A dream must **converge**: total memory count stabilizes or shrinks, never
  grows. If it grows, something is wrong.
- A dream is **idempotent**: running it twice changes almost nothing.

#### Mental map — spreading activation

- **Nodes** = topics/memories; **edges** = association strength.
- An activated topic fires with activation `A`; it spreads to neighbors, each hop
  multiplied by a **decay factor** `d` (0 < d < 1) — a node at distance `k`
  receives `A·dᵏ`.
- **Termination** — spreading stops when accumulated activation < threshold ε.
  Geometric decay guarantees termination.
- **Loop guard** — a node already visited in the *current* propagation is skipped
  (the visited set is the critical guard).
- **Wake up** — nodes whose accumulated activation exceeds a threshold have their
  memory injected into context.

This surfaces *related-but-not-similar* memories (via edges), which plain
top-k cosine search misses, and it terminates by construction.

---

### 3. Existing substrate

| Substrate                                     | Role in this project                                                                 | Status        |
| --------------------------------------------- | ------------------------------------------------------------------------------------ | ------------- |
| `core_memory` (`episode` / `timeline`)        | Episodic memory: dated records and searchable history                                | ✅ implemented |
| `context-inject`                              | Plugin with hooks to inject content in start session event or after compact session  | ✅ implemented |
| `AGENTS.md` / `CONTEXT.md` / `[MEMORY]` block | Core memory: small, always-in-context rules (injected by inject plugin)              | ✅ implemented |

The `core_memory` engine already provides storage, hybrid recall and episodic history.
The point of this project is to **extend** these, not to create them.

---

### 4. Known risks

1. **Dreams can pollute** — a wrong synthesis becomes a false "insight" injected
   into context. Mitigation: synthesized memories carry *low* injection weight +
   the with/without-dreams gate before enabling.
2. **Promotion can cement errors** — a wrong fact reused N times becomes sticky
   long-term memory. Mitigation: decay must be as strong as promotion; long-term
   memories stay editable and agent-correctable.
3. **Activation can explode** — without decay + visited set + threshold it is
   O(n²) or infinite. With them it is bounded.

---

### 5. Dictionary of jargon

Assumes no prior knowledge. Terms are grouped by theme.

#### Memory fundamentals

- **Context window** — the fixed amount of text a model can attend to at once.
  Analogous to RAM: finite, expensive, volatile.
- **Memory (agent context)** — persistent information an agent carries *across*
  sessions, beyond the context window.
- **Core memory** — a small memory always kept in context (identity, the current
  task, key rules). Never paged out.
- **Archival memory** — a large memory kept *outside* the context, searched on
  demand. Analogous to disk.
- **Recall / retrieval** — fetching relevant memories back into context when they
  are needed.
- **Semantic memory** — facts and general knowledge ("what is true").
- **Episodic memory** — an append-only log of events and what happened ("what I
  did"), e.g. the journal.
- **Procedural memory** — "how to do things", e.g. skills.

#### Tiers and movement

- **Tier** — a level in the memory hierarchy (short / medium / long).
- **Short-term memory** — the current session's working memory; lives in the
  context window; ephemeral.
- **Medium-term memory** — facts/decisions scoped to one project, persisted across
  sessions of that project.
- **Long-term memory** — stable, cross-project facts: user preferences, rules,
  durable knowledge.
- **Promotion** — moving a memory to a *more durable* tier because it keeps being
  reused.
- **Demotion** — moving a memory to a *less durable* tier.
- **Decay** — a memory's weight decreasing over time when it is not retrieved.

#### Vector search

- **Embedding** — a vector (list of numbers) that represents the *meaning* of a
  piece of text.
- **Vector search / semantic search** — finding items by comparing their
  embeddings (cosine similarity), so *similar meaning* matches even without
  shared words.
- **Cosine similarity** — a measure of how alike two vectors are (1 = same
  direction, 0 = orthogonal). Used to rank "how similar".

#### Consolidation ("dreams")

- **Consolidation** — the process of reorganizing memory: deduplicate, merge, and
  abstract. Turns raw memory into *more useful* memory.
- **Dream / sleep** — a periodic, offline pass that runs consolidation. Named
  after the idea that the agent "processes" memory while idle (the
  "sleep-time agent").
- **Sleep-time agent** — (from Letta) a background pass that reorganizes memory
  when the main agent is idle.
- **Auto-capture** — passively recording facts/decisions from a session, without
  being explicitly asked.
- **Compaction** — pruning memories when a limit is reached. Crude (limit-based),
  unlike consolidation (meaning-based).
- **Dedupe & merge** — combining near-duplicate memories into a single canonical
  entry.
- **Canonical memory** — the single authoritative version of a memory after
  dedupe.
- **Synthesized memory** — a memory *produced by consolidation* (not captured
  directly). Flagged so it is never re-synthesized.
- **Insight** — a higher-level memory abstracted from several raw memories.
- **Idempotent** — an operation that gives the same result when run twice (a dream
  must be idempotent).

#### Mental map

- **Mental map** — a graph of interconnected topics used to navigate and activate
  memory.
- **Node** — a vertex in the graph (a topic or a memory).
- **Edge** — a connection between two nodes (an association).
- **Spreading activation** — energy propagating from an activated node to its
  neighbors, decaying at each hop.
- **Decay factor** — the multiplier (< 1) applied at each hop; guarantees the
  spread terminates.
- **Visited set / loop guard** — the set of nodes already visited in the current
  propagation; each is skipped so the spread never loops forever.
- **Activation threshold** — the minimum accumulated activation below which
  spreading stops (ε) and below which a memory is *not* woken up.
- **Wake up (from memory)** — injecting into context the memories whose
  accumulated activation crossed the threshold.

---

### Sonarqube Analyses

Two scripts send this checkout for analysis to SonarQube (same evaluation as a
manual `npx @sonar/scan` run; needs Node >= 22.12):

- `run-sonar-scan.sh` — plain analysis (no coverage).
- `run-sonar-cover.sh` — analysis **plus** the LCOV coverage report, so the
  dashboard shows real coverage instead of 0.0%. Fails fast with guidance if
  the report file is missing.

Both read their config from `./.env`, which is **gitignored and never
committed** (it holds the analysis token):

```bash
cp .env.example .env
# edit .env: set SONAR_TOKEN (SonarQube → My Account → Security →
# Generate Token, with Execute Analysis permission on the project)
bash run-sonar-scan.sh
# dashboard: http://localhost:9000/dashboard?id=core-brain
```

Notes:

- The project key (`SONAR_PROJECT_KEY`, default `core-brain`) must already
  exist on the server, and the token needs **Execute Analysis** on it —
  without that the scan dies with `401` on `/api/v2/analysis/version`.
- This repo has **no test suite yet**, so there is no test step in the
  scripts; when a runner with coverage exists (jest/vitest), point
  `SONAR_LCOV_PATHS` in `.env` at its `lcov.info` and use
  `run-sonar-cover.sh`.

 
