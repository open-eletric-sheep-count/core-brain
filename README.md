# OESC — Open Electric Sheep Count

> **Name.** OESC = **O**pen **E**lectric **S**heep **C**ount. "Open" = open source;
> "Electric Sheep" = the Philip K. Dick reference (*Do Androids Dream of Electric
> Sheep?*) — the agent/artificial-mind imagery; "Count" = counting sheep to fall
> asleep, i.e. the **sleep/consolidation ("dreams")** at the heart of the project.

A parallel project implementing a **hierarchical memory system for LLM agents** —
short/medium/long-term memory, **consolidation ("dreams")**, and a **mental map**
(spreading activation). It reuses substrates that already exist in the Taulukko OpenCode
Config instead of building new storage from scratch.

> Status: **Draft — spec not yet written.** See [TASKS.md](TASKS.md).

---

## 1. Intent

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
substrate already exists (see §4).

---

## 2. Problem

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

## 3. Core concepts (the three pieces)

### 3.1 Tiers — promotion by evidence of reuse, not recency

| Tier | What it is | Where it lives today |
|------|-----------|----------------------|
| **Short-term** (working) | The current session's working memory | The context window (not persisted) |
| **Medium-term** (project) | Facts/decisions for *this* project | `opencode-mem`, scope `project` |
| **Long-term** (cross-project) | Stable preferences, rules, durable knowledge | `opencode-mem`, scope `global` + user profile |

Movement rules:

- **Promotion** — a memory retrieved ≥ N times across ≥ M distinct sessions is
  promoted to long-term (global scope / profile).
- **Decay / demotion** — a memory never retrieved for X days loses weight; below a
  threshold it is pruned or demoted.

### 3.2 Dreams — consolidation

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

### 3.3 Mental map — spreading activation

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

## 4. Existing substrate (what we using for now — maybe we need remake something better)

| Substrate | Role in this project | Status |
|-----------|----------------------|--------|
| `opencode-mem` | Archival memory: vector store + auto-capture + injection + compaction + user profile | ✅ already present |
| `grill-me` | Design validation: relentless interview on plans/decisions until shared understanding is reached | ✅ already present |
| `grill-with-docs` | Decision grounding: challenge against the domain model + update CONTEXT.md/ADRs inline as decisions crystallise | ✅ already present |
| `graphify` | The mental-map graph: persistent nodes/edges + communities + `query`/`path`/`explain` | ✅ already present |
| `taulukko-journal` | Episodic memory: append-only timestamped log | ✅ already present |
| `taulukko-inject` | Plugin with hooks to inject content in start session event or after compact session | ✅ already present |
| `AGENTS.md` / `CONTEXT.md` / `[MEMORY]` block | Core memory: small, always-in-context rules (injected by inject plugin) | ✅ already present |

`opencode-mem` already does **vectorized semantic search** (nomic-embed-text,
768 dims) and already runs a primitive consolidation (`userProfileAnalysisInterval`).
The point of this project is to **extend** these, not to create them.

---

## 5. MVP plan (cuts)

- **Cut 1 (first, low risk, high value)** — tiers by tags/scopes + promotion rule;
  a `sleep` skill that runs dedupe/merge/synthesize on top of `opencode-mem`
  (scripting what the dashboard already does) and updates `graphify`. No
  spreading activation yet.
- **Cut 2** — the Go tool: spreading activation with decay + visited set +
  threshold, wired on top of `graphify`; plus a CLI to access it.
- **Cut 3** — A/B test "with vs. without dreams"; tune thresholds; (then) read the
  LM Studio `persistent-memory` article and fold in anything applicable.

---

## 6. Known risks

1. **Dreams can pollute** — a wrong synthesis becomes a false "insight" injected
   into context. Mitigation: synthesized memories carry *low* injection weight +
   the with/without-dreams gate before enabling.
2. **Promotion can cement errors** — a wrong fact reused N times becomes sticky
   long-term memory. Mitigation: decay must be as strong as promotion; long-term
   memories stay editable and agent-correctable.
3. **Activation can explode** — without decay + visited set + threshold it is
   O(n²) or infinite. With them it is bounded.

---

## 7. Dictionary of jargon

Assumes no prior knowledge. Terms are grouped by theme.

### Memory fundamentals

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

### Tiers and movement

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

### Vector search

- **Embedding** — a vector (list of numbers) that represents the *meaning* of a
  piece of text.
- **Vector search / semantic search** — finding items by comparing their
  embeddings (cosine similarity), so *similar meaning* matches even without
  shared words.
- **Cosine similarity** — a measure of how alike two vectors are (1 = same
  direction, 0 = orthogonal). Used to rank "how similar".

### Consolidation ("dreams")

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

### Mental map

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

## 8. Relationship to project-generator

This is a **parallel** project. It starts standalone, then gets integrated back
into `project-generator`'s OpenCode config (`global/opencode/`) once it is
proven. The origin is `project-generator/docs/TASKS.md` line ~145.
