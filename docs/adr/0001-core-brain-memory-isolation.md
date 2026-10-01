# ADR 0001 — core-brain: per-agent memory isolation for OpenCode V2

- **Status:** Accepted
- **Date:** 2026-10-01
- **Deciders:** ARCHITECT (spec + code), ORACLE (judge), USER (acceptance with reservations)
- **Source spec:** `docs/specs/core-brain-plugin.md` (revision 2) — the authority for every decision below
- **Upstream contract:** `docs/core_brain_specification.md` (§2 config, §3 storage, §4 access matrix)
- **Delivery:** `global/opencode/plugins/core-brain/` + `global/opencode/agent/CB_{ALPHA,BETA,GAMMA,DELTA}.md`

## Context

The USER asked for a **per-agent memory** capability for OpenCode V2: each agent gets its
own private memory, an agent can share to an optional common global namespace, and **no agent
can read or write another agent's private memory**. The USER also asked, explicitly, that the
result **coexist with the existing PLUR Memory** without collision, and that the whole thing
run **offline with zero runtime dependencies**.

The slice was designed, implemented, installed, and then run through the two-layer test plan
(Layer A in-process matrix + Layer B live headless smokes) and an adversarial judge pass. This
ADR records the architecture decisions made so they do not get lost in the next conversation.
Each decision states **what was decided, why, and the cost**.

The core-brain plugin exposes one tool — `core_memory` (`who` | `store` | `recall`) — over an
in-process store with a real authorization layer. There is no server, no port, no database
engine, and no runtime dependency.

## Decision

Core-brain is delivered as a **V2 OpenCode plugin** that gives each configured agent an
isolated vector namespace plus an optional shared `global` namespace, driven entirely by a
small `config.json`, with a real in-process access-authorization layer, real per-namespace
vector storage, and a declared **stub-grade** deterministic embedder. The decisions that make
that shape:

### D1 — core-brain is a fork/substitute of PLUR, not a destructive successor

**Decision.** core-brain is built **on top of / in place of** PLUR as an alternative, and the two
**coexist**. Zero collision of: plugin id (`core-brain` vs PLUR), npm name (`@oesc/core-brain`),
data directory (`~/.core-brain/` vs PLUR's store), env vars (`CORE_BRAIN_HOME`), tool namespace
(`core_memory` vs `plur_*`), dependencies, and port (core-brain runs in-process, no port; PLUR
runs a server). `README.md` carries the required PLUR acknowledgment.

**Why.** The USER wants a path for PLUR users to try core-brain **without breaking their
existing PLUR install**. A destructive "successor" would force a choice and lose the working
setup.

**Cost.** Two memory systems live in the same environment; the USER must know which they are
talking to. Accepted: coexistence is verified (PLUR `connected` while core-brain ran, zero
collision).

### D2 — Isolation by per-agent namespace, not a monolithic store

**Decision.** One private namespace per agent (`agents/<name>/memories.json` +
`vectors/<name>/index.json`) plus one shared `global` namespace. Isolation is a **property of
the path**, enforced by the authorizer.

**Why.** The whole point is a private namespace per agent with opt-in sharing. A single
monolithic store would force one ACL over everything and make a private/public distinction
impossible.

**Cost.** More files on disk (a memories + an index per namespace) and more bookkeeping.
Accepted: the cost is bounded by the number of agents.

### D3 — Access policy driven by `config.json`

**Decision.** `config.json` holds `agents[]` with `{ name, hasGlobalAccess, private }`.
Precedence for the config file:
`options.configPath` > `CORE_BRAIN_HOME/config.json` > `~/.core-brain/config.json` >
`<dataRoot>/config.json` > the plugin's shipped **seed** (last resort).

**Why.** Operators control who can read/write what **without a code change or a release**. The
shipped seed makes the plugin usable out of the box, but the USER's config always wins.

**Cost.** A second config source of truth to keep in mind; the precedence order is itself a
behavior that must stay tested. No resolved config → **fail-closed** (no agents, no access).

### D4 — The invalid row `private:false` + `hasGlobalAccess:false` throws at init

**Decision.** A config row where the agent is public but has no global access is self-contradictory
and **throws `InvalidConfigurationError` at engine init** — the whole engine refuses to start.

**Why.** Fail early, not at runtime. A broken config must never serve; catching it at init keeps
the failure loud and at the boundary instead of as a silent per-call surprise.

**Cost.** One malformed row aborts the entire engine (blast radius = startup, not a single call).
Accepted deliberately: the engine is only as good as its config, so a bad config = no engine.

### D5 — Fail-closed: unlisted agents get nothing; cross-agent write is always denied

**Decision.** An agent **not** present in `config.json` receives no namespace and no access
(never a default-allow). A write to **another agent's** namespace (`agent:OTHER`) is always
denied, regardless of that agent's privacy.

**Why.** The safe default is **deny**. An unlisted agent must not read or write anything, and
cross-agent writes are the classic leak vector. Default-allow would silently grant memory to
every unlisted agent.

**Cost.** Every agent that wants memory must be explicitly listed; forgetting one means a silent
no-op (no memory) — which is the intended safe behavior, not a bug.

### D6 — Agent identity comes from the session, never from the tool input

**Decision.** The calling agent's identity is resolved from the **trusted engine session/hook**,
never from a parameter the model supplies. The tool schema therefore has **no identity field** and
is `additionalProperties: false`.

**Why.** If the model could declare its own identity, it could impersonate another agent and break
isolation at the source. Trust must come from the engine, not from the model.

**Cost.** The tool is less flexible (no "act as" parameter) and depends on the engine reliably
resolving the session's agent name.

### D7 — Persistence in the user profile, shared across projects, atomic writes

**Decision.** Data root is `~/.core-brain/` (override with `CORE_BRAIN_HOME` for tests). Files are
JSON; every write is **atomic** (write a `tmp` file, then `rename`). The data root is
**cwd-independent**, so all projects share the same memories.

**Why.** Memories should follow the **user**, not the repository. Atomic `tmp`+`rename` prevents a
torn JSON file on crash. A cwd-independent root is what makes "shared across projects" true.

**Cost.** A single data root is shared by every project (by design); there is no per-project data
separation at the root level (separation comes from the namespace). Concurrent writers can still
race — see Consequences.

### D8 — Deterministic embedder `hash-ngram-v1` (256 dims), declared a stub

**Decision.** v1 embeds text with a **deterministic, offline** hash/n-gram embedder
(`hash-ngram-v1`, 256 dims, L2-normalised). The vectors and the in-process cosine **top-k are
real**; the **semantic quality is not**. The embedder id is stamped into every
`vectors/<ns>/index.json`; a change of embedder drops the old vectors on read. A production
embedder is a **registered follow-up**.

**Why.** v1 must run fully offline with zero deps and zero network. A deterministic hash embedder
delivers real vectors + a real ranking with none of that. Declaring it a **stub** stops anyone
from mistaking it for semantic search.

**Cost.** Recall quality is lexical/n-gram, not semantic. Accepted by the USER (D6/R4 in the
spec). The stamped embedder id makes a future swap safe and explicit.

### D9 — v1 is TOOLS-ONLY

**Decision.** The plugin registers **one tool** plus an **inert** `prompt` hook. Context
auto-injection is **opt-in and off by default**; there is no compaction hook. This is what
guarantees existing agents are unaffected.

**Why.** The safest integration is to add a tool and **touch nothing else**. Default-on injection
would mutate every agent's prompt and is a regression risk. Making it opt-in keeps the default
zero-change.

**Cost.** Agents must call `core_memory` themselves; they get no automatic context. Accepted:
verified unlisted agents are byte-identical after install.

### D10 — Plugin auto-discovery via the `plugins/` directory

**Decision.** core-brain is discovered by the V2 engine **from the global mirror's `plugins/`
directory**. There is **no** entry in the `opencode.json` `plugins` array.

**Why.** V2 auto-discovers plugins in `plugins/`; an explicit array entry would be a redundant
second source of truth. Precedent already proven in this environment with the `todo-list` and
`context-inject` plugins.

**Cost.** Relies on the engine's discovery behavior. Verified: `opencode2 plugin list` shows
`core-brain` with no `opencode.json` entry.

### D11 — Dedicated test agents `CB_{ALPHA,BETA,GAMMA,DELTA}`

**Decision.** Four test agents, one per row of the `(private, public) × (global, no-global)`
matrix: CB_ALPHA (public+global), CB_BETA (private+global), CB_GAMMA (private, no global),
CB_DELTA (public, no global — **the invalid row**). All use `mode: all` (so each can run as a
subagent **and** as the primary of a headless `run`) and inherit the model (no `model` field).

**Why.** You cannot test the access matrix without agents that actually occupy each of the four
rows. `mode: all` lets each headless smoke run as primary; inheriting the model keeps the test
agents environment-agnostic.

**Cost.** Four extra agent files in the shipped surface; CB_DELTA refuses to initialize **by
design** (it is the config-gate tripwire).

### D12 — Error contract

**Decision.** Two error shapes: `InvalidConfigurationError` with `.code === "INVALID_CONFIGURATION"`
(for config problems, thrown at init), and access **denials** whose message **names the target and
the reason** (e.g. `cross-agent write not allowed`, `no global access`, `agent 'X' is not
configured`).

**Why.** A stable machine-readable code lets an engine distinguish "bad config" from "denied
access". A denial that names the target + reason is actionable and auditable — it is not a
generic "forbidden".

**Cost.** The error string carries an agent name. Accepted: these are operator-facing diagnostics,
not user-facing secrets.

### D13 — Two-layer test plan (in-process matrix + live headless)

**Decision.** **Layer A** (`check.sh` → `test/matrix.selftest.mjs`) proves the access rules
**in-process against the real store + authorizer** on a disposable `CORE_BRAIN_HOME` — not a mock.
**Layer B** proves the same rules **in the live engine** via headless smokes of the CB_* agents.

**Why.** A mock-backed unit test does not prove the live wiring (identity resolution, tool
routing, discovery). Layer A is the proof of the **rules**; Layer B is the proof that the **engine
actually routes to them**.

**Cost.** Two layers to keep in sync; Layer B needs a real engine + a headless runner.

### D14 — Zero runtime dependencies (Node builtins only)

**Decision.** The plugin imports only `node:fs`, `node:path`, `node:os`, `node:crypto`,
`node:url`. **No** npm runtime dependency.

**Why.** A memory plugin that depends on a transitive tree or phones home is a supply-chain and
offline risk. Builtins keep it fully auditable, offline, and installable as a plain file copy.

**Cost.** Limited to what Node builtins offer — which is exactly why v1's embedder is a
deterministic stub (D8) rather than a neural one.

## Acceptance evidence (measured at acceptance, 2026-10-01)

Executed by the ORACLE; cross-checked line-by-line against the delivered source by the ARCHITECT.

- **Layer A:** `check.sh` → **8/8 PASS**, exit 0, against the real store + authorizer on a
  disposable `CORE_BRAIN_HOME`.
- **Auto-discovery (D10/D13-B):** `opencode2 plugin list` → **8 plugins** including `core-brain`,
  with **no** `opencode.json` entry.
- **Agent discovery + non-regression (D9/D11):** `opencode2 debug agents` **23 → 27** (+4 CB_*),
  **0 removed**, the 23 pre-existing agents **byte-identical (SHA-256)**.
- **Layer B smokes (D11/D13-B):** headless runs of **CB_BETA, CB_GAMMA, CB_ALPHA** — access matrix
  live (`who`/`store`/`recall`), identity resolved from the session.
- **Adversarial judge pass:** `recall` **without `from`** (union of permitted namespaces) →
  CB_ALPHA sees only public+global; CB_BETA own+global+public-alpha; CB_GAMMA own+public-alpha
  (no global, no others' private); unlisted agent → `not configured`; cross-agent
  `target:"agent:../CB_BETA"` → **denied**. Zero private leakage on the default path.
- **Storage (D7/D8):** `~/.core-brain/` populated; `vectors/<ns>/index.json` stamped
  `embedder: hash-ngram-v1`, `dim: 256`.
- **Coexistence (D1):** PLUR **`connected`** (its server up) with **zero collision** alongside
  core-brain.

## Consequences — open risks / follow-ups

1. **Embedder is a declared stub (D8).** Real vectors + real top-k, **not** semantic quality.
   Follow-up: a production embedder (registered in the spec's roadmap). Until then, "search" is
   lexical.
2. **No multi-process file lock.** Two agents writing the **same** namespace concurrently can
   race. `tmp`+`rename` makes each individual write atomic but does **not** serialize concurrent
   writers. Follow-up: a locking strategy if/when concurrent writers become realistic.
3. **Write-on-read.** `recallOp` increments `retrievals` and rewrites the namespace file on every
   hit. Correct, but every recall is a disk write — I/O amplifies under load, and it is another
   reason the missing lock (item 2) matters.

**Post-acceptance note (state of the environment, 2026-10-01).** The USER requested that the
**test artifacts be cleared from the environment**: `~/.core-brain/` and the four `CB_*.md` files
were removed **from the mirror** (`~/.config/opencode/agent/`). The **repository** deliverables
(the plugin, `global/opencode/agent/CB_*.md`, this spec, the tests) **remain** — they are the
delivery. The evidence above was measured at acceptance, before that cleanup.

## Alternatives considered

- **Monolithic single store with one ACL** — rejected (D2): cannot express per-agent private vs
  shared; a leak-by-default.
- **Default-allow for unlisted agents** — rejected (D5): silently grants memory to every agent;
  the safe default is deny.
- **Identity from the tool input** — rejected (D6): impersonation / isolation break at the source;
  identity must come from the trusted session.
- **Neural embedder in v1** — rejected (D8/D14): requires a dependency tree and/or network,
  violating the offline + zero-deps mandate; registered as a follow-up.
- **Default-on context injection** — rejected (D9): mutates every agent's prompt; a regression
  risk. Tools-only + opt-in injection keeps the default zero-change.
- **Explicit `opencode.json` `plugins` entry** — rejected (D10): redundant second source of truth;
  V2 auto-discovers the `plugins/` directory (proven by `todo-list`/`context-inject`).
- **Access rules hardcoded in the engine** — rejected (D3): operators could not control access
  without a release; a data-driven `config.json` is the only shape that scales.
