# OESC — Open Electric Sheep Count

> **Name.** OESC = **O**pen **E**lectric **S**heep **C**ount. "Open" = open source;
> "Electric Sheep" = the Philip K. Dick reference (*Do Androids Dream of Electric
> Sheep?*) — the agent/artificial-mind imagery; "Count" = counting sheep to fall
> asleep, i.e. the **sleep/consolidation ("dreams")** at the heart of the project.

**OESC** aims to provide an **open-source AI framework for OpenCode**: a growing
set of **agents**, **skills**, **plugins**, and an **enhanced memory** for LLM
agents — shipped as a complete suite and **prepared for OpenCode V2**
([`opencode2`](https://opencode.ai/v2/docs/)).

Today the suite ships the two plugins below — **todo** (§1) and
**context-inject** (§2) — plus the **agent team** that runs the flows (§4); the
**memory system** (§3) is the next chapter.

---

## Getting started

1. **Install OpenCode V2** — it runs as `opencode2`, side by side with V1's
   `opencode` binary:
   
   ```bash
   curl -fsSL https://opencode.ai/v2/install | bash
   # or: npm install -g @opencode/cli@beta
   ```
   
   Full instructions: <https://opencode.ai/v2/docs/>.

2. **Install the OESC suite** (brings the whole set):
   
   ```bash
   git clone https://github.com/open-eletric-sheep-count/core-brain.git
   bash core-brain/global/opencode/install-global.sh
   ```
   
   The script copies the suite into `~/.config/opencode/` — no config-file
   editing needed: plugins are **auto-discovered** from `plugins/`. Re-run it
   anytime to update. Then restart OpenCode and confirm:
   
   ```bash
   opencode2 plugin list
   ```

Each plugin is **self-contained** — `global/opencode/plugins/<name>/` holds the
whole thing (source, docs, npm manifest); the installer ships it as-is.
Optional configuration lives in each plugin's README.

**Single plugin via npm** (publication pending — until then, use the installer above):

```bash
opencode2 plugin add @oesc/todo-list
opencode2 plugin add @oesc/context-inject
```

---

## 1. Todo List — `@oesc/todo-list`

A **session todo list** the assistant maintains and the user watches live:

- the `todo` tool — one tool, granular ops (`read` / `write` / `add` / `update` /
  `remove` / `clear`), stable ids, hierarchical items;
- a **live sidebar panel** showing the current session's list (hidden when the
  list is empty);
- one list per session, stored locally at `~/.local/share/opencode-todo/` —
  OpenCode's DB is never touched.

Contract, details and configuration: [`global/opencode/plugins/todo-list/`](global/opencode/plugins/todo-list/).

---

## 2. Context Inject — `@oesc/context-inject`

Injects **configured files into sessions**, per agent:

- at the **true start** of a session (its first admitted prompt), and
- **after a completed compaction** (re-injection).

Config-driven (`injections.agents.<AGENT>`, with the reserved `ALL` key for
every session); **stateless** — both decisions derive from the durable session
log, so behavior survives service restarts. Relative file paths resolve against
the plugin directory.

Contract, details and configuration: [`global/opencode/plugins/context-inject/`](global/opencode/plugins/context-inject/).

---

## 3. Memory — the OESC memory system

The original core of OESC: a **hierarchical memory system for LLM agents** —
short/medium/long-term memory, **consolidation ("dreams")**, and a **mental
map** (spreading activation). It reuses substrates that already exist in the
Taulukko OpenCode Config instead of building new storage from scratch.

> Status: **Draft — spec not yet written.** See [TASKS.md](TASKS.md).

### 3.1 Intent

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
substrate already exists (see §3.4).

---

### 3.2 Problem

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

### 3.3 Core concepts (the three pieces)

#### Tiers — promotion by evidence of reuse, not recency

| Tier                          | What it is                                   | Where it lives today                          |
| ----------------------------- | -------------------------------------------- | --------------------------------------------- |
| **Short-term** (working)      | The current session's working memory         | The context window (not persisted)            |
| **Medium-term** (project)     | Facts/decisions for *this* project           | `opencode-mem`, scope `project`               |
| **Long-term** (cross-project) | Stable preferences, rules, durable knowledge | `opencode-mem`, scope `global` + user profile |

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

### 3.4 Existing substrate (what we using for now — maybe we need remake something better)

| Substrate                                     | Role in this project                                                                                            | Status            |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------- |
| `opencode-mem`                                | Archival memory: vector store + auto-capture + injection + compaction + user profile                            | ✅ already present |
| `grill-me`                                    | Design validation: relentless interview on plans/decisions until shared understanding is reached                | ✅ already present |
| `grill-with-docs`                             | Decision grounding: challenge against the domain model + update CONTEXT.md/ADRs inline as decisions crystallise | ✅ already present |
| `taulukko-journal`                            | Episodic memory: append-only timestamped log                                                                    | ✅ already present |
| `context-inject`                              | Plugin with hooks to inject content in start session event or after compact session                             | ✅ already present |
| `AGENTS.md` / `CONTEXT.md` / `[MEMORY]` block | Core memory: small, always-in-context rules (injected by inject plugin)                                         | ✅ already present |

`opencode-mem` already does **vectorized semantic search** (nomic-embed-text,
768 dims) and already runs a primitive consolidation (`userProfileAnalysisInterval`).
The point of this project is to **extend** these, not to create them.

---

### 3.5 MVP plan (cuts)

- **Cut 1 (first, low risk, high value)** — tiers by tags/scopes + promotion rule;
  a `sleep` skill that runs dedupe/merge/synthesize on top of `opencode-mem`
  (scripting what the dashboard already does) and updates the mental map. No
  spreading activation yet.
- **Cut 2** — the Go tool: spreading activation with decay + visited set +
  threshold, wired on top of the mental-map store; plus a CLI to access it.
- **Cut 3** — A/B test "with vs. without dreams"; tune thresholds; (then) read the
  LM Studio `persistent-memory` article and fold in anything applicable.

---

### 3.6 Known risks

1. **Dreams can pollute** — a wrong synthesis becomes a false "insight" injected
   into context. Mitigation: synthesized memories carry *low* injection weight +
   the with/without-dreams gate before enabling.
2. **Promotion can cement errors** — a wrong fact reused N times becomes sticky
   long-term memory. Mitigation: decay must be as strong as promotion; long-term
   memories stay editable and agent-correctable.
3. **Activation can explode** — without decay + visited set + threshold it is
   O(n²) or infinite. With them it is bounded.

---

### 3.7 Dictionary of jargon

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

### 3.8 Relationship to project-generator

This is a **parallel** project. It starts standalone, then gets integrated back
into `project-generator`'s OpenCode config (`global/opencode/`) once it is
proven. The origin is `project-generator/docs/TASKS.md` line ~145.

---

## 4. Agents — the OESC team

The suite also ships the **agent definitions** (`global/opencode/agent/`) — the
team that develops this project and runs its delivery flows. `ORACLE` is the
**primary** agent; every other role is a **subagent**:

| Agent | What it is for |
|-------|----------------|
| `ORACLE` | Writing assistant + task orchestrator and delivery coordinator — owns the flow menu, coordinates the delivery, the single channel to the USER |
| `ARCHITECT` | Plans the task, produces the active spec, and validates final adherence |
| `DEVELOPER` | Implements the task from the active spec and approved tests |
| `TESTER` | Defines automated validation for the task from the active spec |
| `DOCUMENTATION_WRITER` | Updates README, changelog, and documentation affected by the delivery |
| `SECRETARY` | Email and scheduling assistant (via the Jarvis MCP tools) |
| `BRAIN_STORM_PERSONA_BAD_GUY` | A New Brain Storm persona — the red-teamer who attacks assumptions and hunts failure modes |
| `BRAIN_STORM_PERSONA_MARKETER` | A New Brain Storm persona — the marketer who sells value and defines the audience |
| `BRAIN_STORM_PERSONA_MINIMALIST` | A New Brain Storm persona — the UX minimalist who strips screens to the essentials |
| `BRAIN_STORM_PERSONA_NAME_MAKER` | A New Brain Storm persona — the identity poet who names and polishes every label |

Most roles have an **`_EXTENDED` twin**: a thin pointer that loads the same
definition at runtime and has **no fixed model** — it inherits the parent
session's model (for environments where the default model is not available).

The **flow helpers** (`global/opencode/helpers/`) carry the protocols: the ORACLE
loads the matching `METHODOLOGY_*` file when a methodology is chosen (Tico and
Teco Think, scrum team, ORACLE does it all, A New Brain Storm, Batman e Robin);
the `SUBAGENT-*` files carry the mandatory subagent rules (e.g. the ORACLE is the
single channel to the USER).
