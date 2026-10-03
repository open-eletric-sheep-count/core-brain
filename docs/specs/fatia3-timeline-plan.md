# Slice 3 — Timeline (episodes, timeline, promote) — Implementation Plan

Status: DRAFT (ARCHITECT_EXTENDED, attempt 2)
Scope owner: ORACLE (ses_efecb20b5ffehMHiwoZWdOCdl8)
Source spec: `docs/specs/core-brain-v2.md` §12 (lines 166-224)

## 1. Objective and scope

Deliver the memory/episode timeline of core-brain v2: a single tool (`core_memory`)
gaining three ops — `episode`, `timeline`, `promote` — plus the storage of episodes
(`agents/<A>/episodes.json`, `global/episodes.json`), the MCP surface (`core_timeline`,
admin, read-only over the global space), and the import path for existing PLUR episodes
(`~/.plur/episodes.yaml`).

Episodes are **first-class objects** (USER decision, 2026-10-01): episodic memory — *what
happened*, with a date — distinct from short-term memory (the conversation window) and from
the engrams (*what is known*, undated) (`core-brain-v2.md:166-168`).

In scope:
- episode capture (op `episode`) written into the session agent's namespace;
- timeline read (op `timeline`), with the contract of §2;
- promote (op `promote`) from an episode to a memory;
- per-namespace storage + atomic write model mirroring `memories.json`;
- `core_admin import` extended with an episodes section (new document shape);
- migration of `~/.plur/episodes.yaml` (numbers measured in §4).

Out of scope (declared): see §7.

## 2. Tool contract

- One tool, no second identity path (`core-brain-v2.md:198`): `episode` / `timeline` /
  `promote` are **ops of `core_memory`**, not separate tools.
- Agent identity is the **SESSION identity**, never a tool argument (`core-brain-v2.md:176`);
  resolved via `resolveSessionAgent` (`index.ts:180`).
- Surface anchors: single tool `index.ts:223`, `index.ts:602-603`; `mcp/server.js:25`
  (`ACTIONS`), `:29-96` (5 tools), `:198`.

Ops (`core-brain-v2.md:190-194`):

| op | host | input | output | isolation |
|---|---|---|---|---|
| `core_episode` | plugin (**P**) | `{ summary, tags?, sessionId? }` | `{ ok, id, ns }` | write matrix §6.2 — own namespace always; `global` iff `hasGlobalAccess` |
| `core_timeline` | **P** (own view) · **M** (global view, admin) | `{ query?, since?, until?, tags?, limit? }` | `{ results: Episode[], scanned[] }` | read matrix §6.1 — identical to recall; the MCP view reads `global` only |
| `core_promote` | **P** | `{ episodeId, text, tags? }` | `{ ok, episodeId, memoryId }` | the episode must be readable by the caller; the memory follows the write matrix; the episode gains the id in `engramIds` |

- On the **plugin host** the three are **ops of the existing tool `core_memory`**
  (`op: "episode" | "timeline" | "promote"`) — exactly one tool registered, no second
  tool, no second identity path (`core-brain-v2.md:198`).
- On the **MCP host** `core_timeline` is its own tool, admin, **read over `global` only**
  (`:193`, `:198`; `core-brain-mcp.md` §3).
- `core_promote` is PLUR's `plur_episode_to_engram`: nothing is copied — it writes a normal
  memory record carrying `meta.derivedFrom = <episode id>` and appends the memory id to the
  episode's `engramIds` (`:194`, `:196`).
- Retrieval is **by meaning, not by spelling** (`:200-202`): `core_timeline { query }` ranks
  with the v2 engine (same embeddings + hybrid) — hence the engine (v2 spec §2–§5) must land
  first, otherwise the op only matches spelling.

## 3. Data model and storage

Episode record (`core-brain-v2.md:170-183`):

```ts
interface Episode {
  id: string;            // EP-<epoch ms>-<4 chars> — readable, sortable, the PLUR shape
  at: string;            // ISO timestamp of the event
  agent: string;         // who wrote it — the caller's SESSION identity, never a tool argument
  summary: string;       // the narrative: what happened
  sessionId?: string;
  channel?: string;
  tags?: string[];
  engramIds?: string[];  // set by `core_promote` — the memories that came out of this episode
}
```

- **Storage:** the **same namespace model as memories** — `~/.core-brain/agents/<A>/episodes.json`
  and `~/.core-brain/global/episodes.json`, atomic writes, same file policy as `memories.json`
  (`:185`).
- **Why not PLUR's single global `episodes.yaml`:** PLUR episodes are store-global (the
  measured ownership problem is in §4), so a private agent's diary would be readable by
  everyone. In core-brain the diary obeys the **same isolation matrix as everything else** —
  one isolation model, one authorizer, no exception (`:186`).
- **File model to copy:** `recordsFileFor` (`store.ts:178-183`); `writeFileAtomic`
  (`store.ts:206-210`: mkdir, `.tmp`, `JSON.stringify(…,2)`, rename).

## 4. Import / migration of PLUR episodes

- **Source:** `~/.plur/episodes.yaml`.
- **Measured in the file (2026-10-03): 37 entries `- id: EP-…`.** Declared difference: the
  v2 spec said **34** (`core-brain-v2.md:168,186`) and the ORACLE brief said **36**; the file
  holds **37** today — the count is pinned to the file, never to the earlier numbers.
- **Fields per entry:** `id`, `timestamp`, `summary`, `channel`, `session_id`, `tags`, `agent`.
- **Measured owners:** **3 of 37** carry `agent` (`oracle`, `ORACLE`, `oracle`); the v2 spec
  said "only **2**" (`core-brain-v2.md:186`). Every other entry is ownerless.
- **Namespace mapping** (`:207`): an `agent` present → that agent's namespace; **no owner →
  `global`** (the honest reading of records written store-global).
- **Preserve verbatim, invent nothing** (`:208-209`): `id` kept; `at` from `timestamp`;
  `summary` / `tags` / `sessionId` / `channel` copied as-is — no summarising, no rewriting.
- **Idempotent** (`:209`): a second run dedupes on `id` and changes nothing.
- **Mechanism** (`:210`): the `core_admin { action: "import" }` document gains an **episodes
  section** — no second importer, no second format.

## 5. Authorization and security

Reuse, do not reinvent:
- `authorizeWrite` (`store.ts:441`, self branch `:446`), `authorizeRead` (`:484`).
- `invoke` (`store.ts:1372-1386`); `adminOp` (`store.ts:1162`).
- `import` branch (`store.ts:1248-1331`), dedupe `:1314`, detail `:1331`.

## 6. Acceptance criteria

Timeline acceptance criteria (`core-brain-v2.md:214-219`):

- **AC-TL1** — append + read round-trip; the episode's `agent` comes from the session,
  never from the tool input.
- **AC-TL2** — isolation: `A` (private) writes an episode and `B` **does not** see it in
  `core_timeline`; `A`'s public episodes are visible per the read matrix. Same matrix, no
  exception.
- **AC-TL3** — the episodes import with dates, tags and owners intact, and re-running the
  import changes nothing.
- **AC-TL4** — a query with **no shared words** finds the right episode (the
  *SGLang / `timeout 9999`* pair is the probe).
- **AC-TL5** — `core_promote` produces a memory carrying `derivedFrom`, the episode lists it
  in `engramIds`, and the episode is otherwise unchanged.
- **AC-TL6** — `check.sh` stays **13/13**, and the backup mirrors the episodes
  (`bkps/.core-brain/`).

Slice deliverables (`core-brain-migration-plan.md:73-79`):

| id | Deliverable | Proof |
|---|---|---|
| **T1** | `Episode` object + per-namespace storage (`agents/<A>/episodes.json`, `global/episodes.json`) | AC-TL1 |
| **T2** | Ops `episode` / `timeline` / `promote` on the same `core_memory` tool | AC-TL1 / AC-TL5 |
| **T3** | Timeline searchable **by meaning** (the v2 engine) | AC-TL4 — *"SGLang"* finds the `timeout 9999` episode |
| **T4** | Migration of the episodes, idempotent, owners preserved (no owner → `global`) | AC-TL3 |
| **T5** | The diary obeys the **same** isolation matrix as memories | AC-TL2 |

## 7. Decisions, risks, unknowns

1. **New document shape (TESTER pins it first):** `core_admin import` today only knows
   `namespaces[].records` (memories). The **episodes section is a new shape of the document**;
   the TESTER fixes its structure and its idempotency (AC-TL3) before implementation.
2. **UNKNOWN — declared, not assumed:** the backup mirror lives in **another repo**
   (`project-generator/src/install-global.sh`) → **AC-TL6 depends on a file outside this
   repo**. The plan declares the dependency instead of assuming it; the AC can only be
   demonstrated once that mirror is confirmed to cover `episodes.json`.
3. **MCP `core_timeline` = bonus:** the MCP spec marks rows 11/12/13 as **DEFERRED**
   (`core-brain-mcp.md:93-95`, `:102`). It is raised into this plan as a **bonus**, not a
   hard requirement of the slice.
4. **Engine dependency:** AC-TL4 (search by meaning) only holds after the v2 engine
   (v2 spec §2–§5) is in place; `promote` and `episode` do not depend on it.
5. **Counts are pinned to the file** (§4): 37 entries today, 3 with an owner — the spec's
   34/2 are historical and must not be hardcoded into tests; tests must read the source.
