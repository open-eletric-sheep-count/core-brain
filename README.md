# OESC — Open Electric Sheep Count

> **Name.** OESC = **O**pen **E**lectric **S**heep **C**ount. "Open" = open source;
> "Electric Sheep" = the Philip K. Dick reference (*Do Androids Dream of Electric
> Sheep?*) — the agent/artificial-mind imagery; "Count" = counting sheep to fall
> asleep, i.e. the **sleep/consolidation ("dreams")** at the heart of the project.

**OESC** provides an **open-source AI framework for OpenCode V2 and a core-brain adaptation for Codex**: a growing
set of **agents**, **skills**, **plugins**, and an **enhanced memory** for LLM
agents — shipped as a complete suite and **prepared for OpenCode V2**
([OpenCode V2 documentation](https://opencode.ai/v2/docs/)).

The suite ships **todo** (§1), **context-inject** (§2), the original core-brain
memory engine, and the **agent team** (§4). `global/codex` contains the working
memory MCP/hook adaptation, native file injector, role prompts, global helpers
and memory skills. The broader tiered-memory, dreams and
mental-map design in §3 remains a roadmap, beyond the implemented memory store.

---

## Getting started

**Install by giving your coding agent the prompt below.** 



```plantext
Visit https://github.com/open-eletric-sheep-count/core-brain and folow the "Agent Instalation Instructions"
```

#

## Agent Instalation Instructions



Set the target CLI to `opencode`, `codex`, or the name of another CLI that needs an explicit adaptation. The agent should inspect your machine and existing configuration,
then execute and verify the installation. The complete manual is
[INSTALATION.md](INSTALATION.md) at the repository root.



```text
Install OESC core-brain from
https://github.com/open-eletric-sheep-count/core-brain.git.
Target CLI: <opencode | codex | another CLI name>.
Checkout location: <choose a suitable local workspace or reuse my checkout>.

1. Inspect the OS, shell, target CLI/version, Node, Python, existing skills,
   MCPs, hooks and memory paths. Read applicable local AGENTS.md instructions.
   Reuse an existing checkout after inspecting its branch and local changes;
   otherwise clone the Git repository to the selected directory. Preserve work.
2. Read README.md, the root INSTALATION.md and install.sh --help. Check the
   target CLI's current official plugin/skill/MCP/hook documentation. Plan the
   steps and define focused tests before changing installation behavior.
3. For OpenCode V2, run bash install.sh --host opencode --dry-run, then
   bash install.sh --host opencode --install-runtime with the correct paths.
   For Codex, use the same commands with --host codex. Reuse an already
   provisioned real runtime instead of reinstalling it unnecessarily. Select
   --memory-home, --runtime-dir, --models-dir and --skills-dir as needed.
   Full installation also installs global helpers and role prompts. For Codex,
   source global/codex/rules maps to CODEX_HOME/roles, and helpers maps to
   CODEX_HOME/helpers. Check injector file paths in the installed layout as
   explained in INSTALATION.md; keep custom installed configuration when updating.
   For Windows Codex using WSL, run the installer in the selected distro/user,
   target the Windows Codex and skills directories, and use --wsl-distro and
   --wsl-user. Read the manual's concrete example before running that command.
4. Preserve unrelated settings, MCPs, hooks, identities, existing memory and
   credentials. Review the dry-run, use the installer's backups and never put
   runtime packages, model weights or personal records in the Git repository.
   Register each plugin only once. Follow native hook review/trust requirements.
5. For another CLI, do not pretend the installer already supports it. Verify
   its MCP stdio registration, skills/instruction discovery, fixed or per-role
   identity, startup/prompt hooks and compaction transcript contracts. Reuse
   the original engine and map those host events through a small host adapter.
   Pass actual discarded/retained message parts for the named session, inject
   recalled context through that CLI's supported channel, and leave the native
   compaction summary under host control. Preserve the original learning and
   retrieval logic without added filters, cuts or summaries. Document missing
   lifecycle support, context-inject portability and isolation differences.
6. Run appropriate isolated tests. Start a fresh real target CLI, confirm its
   actual tool/skill catalog and a controlled memory store/recall, then exercise
   trusted automatic hooks, compaction and restart/resume where supported.
   Clean up test resources. Do not call the task complete until the installed
   CLI is running and the promised behavior has been verified; report any
   unavailable capability or remaining user trust step explicitly.
```

The shared entry point is `bash install.sh --host opencode` or
`bash install.sh --host codex`; the default host remains OpenCode for existing
installations. Native Windows can invoke `python scripts/install_global.py`.
Each OpenCode plugin remains self-contained under `global/opencode/plugins/`.
Codex uses `global/codex/adapters` and `global/codex/skills` rather
than loading the OpenCode plugin contract directly. See the manual for runtime
provisioning, policy merging, backups, compatibility and rollback.

---

## Framework Components

### 1. Todo List — `@oesc/todo-list`

A **session todo list** the assistant maintains and the user watches live:

- the `todo` tool — one tool, granular ops (`read` / `write` / `add` / `update` /
  `remove` / `clear`), stable ids, hierarchical items;
- a **live sidebar panel** showing the current session's list (hidden when the
  list is empty);
- one list per session, stored locally at `~/.local/share/opencode-todo/` —
  OpenCode's DB is never touched.

Contract, details and configuration: [`global/opencode/plugins/todo-list/`](global/opencode/plugins/todo-list/).

---

### 2. Context Inject — `@oesc/context-inject`

Injects **configured files into sessions**, per agent:

- at the **true start** of a session (its first admitted prompt), and
- **after a completed compaction** (re-injection).

Config-driven (`injections.agents.<AGENT>`, with the reserved `ALL` key for
every session); **stateless** — both decisions derive from the durable session
log, so behavior survives service restarts. Relative file paths resolve against
the plugin directory.

Contract, details and configuration: [`global/opencode/plugins/context-inject/`](global/opencode/plugins/context-inject/).

The [Codex adapter](global/codex/adapters/context-inject/README.md) uses native
`SessionStart` and `SubagentStart` hooks with the original file-loading engine.
Install it independently with `bash install.sh --host codex --context-inject-only`.
By default it reads `roles/ORACLE.md` in the selected Codex home on root startup
and after compaction, with complete context delivery. Full suite installation
supplies the project-edited ORACLE and global helpers; injector-only installation
requires that role file to exist separately. Its
README documents native event timing, trust review and compatibility limits.

Codex's methodology menu also supports **option 4 — A New Brain Storm** again.
Its native adaptation retains the four serial personas, original grading,
rejection limits and optional backup helpers. It is included in the complete
Codex installation with `bash install.sh --host codex`; see the installation
manual for runtime and platform-specific paths.

---

### 3. Memory — the OESC memory system (Not fully implemented yet.)

The original core of OESC: a **hierarchical memory system for LLM agents** —
short/medium/long-term memory, **consolidation ("dreams")**, and a **mental
map** (spreading activation). It builds on the memory engine and OpenCode
integrations shipped in this repository.

> Status: **Draft — spec not yet written.** See [TASKS.md](TASKS.md).

### 4. Agents — the OESC team

The suite also ships the **agent definitions** (`global/opencode/agent/`) — the
team that develops this project and runs its delivery flows. `ORACLE` is the
**primary** agent; every other role is a **subagent**:

| Agent                            | What it is for                                                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `ORACLE`                         | Writing assistant + task orchestrator and delivery coordinator — owns the flow menu, coordinates the delivery, the single channel to the USER |
| `ARCHITECT`                      | Plans the task, produces the active spec, and validates final adherence                                                                       |
| `DEVELOPER`                      | Implements the task from the active spec and approved tests                                                                                   |
| `TESTER`                         | Defines automated validation for the task from the active spec                                                                                |
| `DOCUMENTATION_WRITER`           | Updates README, changelog, and documentation affected by the delivery                                                                         |
| `BRAIN_STORM_PERSONA_BAD_GUY`    | A New Brain Storm persona — the red-teamer who attacks assumptions and hunts failure modes                                                    |
| `BRAIN_STORM_PERSONA_MARKETER`   | A New Brain Storm persona — the marketer who sells value and defines the audience                                                             |
| `BRAIN_STORM_PERSONA_MINIMALIST` | A New Brain Storm persona — the UX minimalist who strips screens to the essentials                                                            |
| `BRAIN_STORM_PERSONA_NAME_MAKER` | A New Brain Storm persona — the identity poet who names and polishes every label                                                              |

Most roles have an **`_EXTENDED` twin**: a thin pointer that loads the same
definition at runtime and has **no fixed model** — it inherits the parent
session's model (for environments where the default model is not available).

The **flow helpers** (`global/opencode/helpers/`) carry the protocols: the ORACLE
loads the matching `METHODOLOGY_*` file when a methodology is chosen (Tico and
Teco Think, scrum team, ORACLE does it all, A New Brain Storm, Batman e Robin);
the `SUBAGENT-*` files carry the mandatory subagent rules (e.g. the ORACLE is the
single channel to the USER).



---

## For developers



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
substrate already exists (see §3.4).

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

### 3. Existing substrate (what we using for now — maybe we need remake something better)

| Substrate                                     | Role in this project                                                                 | Status        |
| --------------------------------------------- | ------------------------------------------------------------------------------------ | ------------- |
| `opencode-mem`                                | Archival memory: vector store + auto-capture + injection + compaction + user profile | ✅ implemented |
| `core_memory` (`episode` / `timeline`)        | Episodic memory: dated records and searchable history                                | ✅ implemented |
| `context-inject`                              | Plugin with hooks to inject content in start session event or after compact session  | ✅ implemented |
| `AGENTS.md` / `CONTEXT.md` / `[MEMORY]` block | Core memory: small, always-in-context rules (injected by inject plugin)              | ✅ implemented |

`opencode-mem` already does **vectorized semantic search** (nomic-embed-text) and already runs a primitive consolidation (`userProfileAnalysisInterval`).
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

 
