# Tool swap: `opencode-mem` → PLUR (Memory Engine)

> Status: written 2026-09-10. Companion note to [README.md](../README.md) and [TASKS.md](../TASKS.md).
> **Disclaimer:** README §3.1/§4 and TASKS.md Phase 1 still reference `opencode-mem` as the
> substrate. Those references are now STALE — do not edit them without the USER's explicit OK
> (instruction/config-file zone, per `project-generator` AGENTS.md rule 7). This file is the
> interim source of truth for the swap.

---

## 1. What changed

The memory tool in actual use **swapped from `opencode-mem` to PLUR**
([plur.ai](https://plur.ai) · [repo](https://github.com/plur-ai/plur) · [engram spec v2.1](https://plur.ai/spec.html)).
OESC's design (tiers / dreams / mental map) is unchanged as an *intent*; what changes is the
substrate it must be built on.

| Aspect | `opencode-mem` (old) | PLUR (new) |
|---|---|---|
| Storage | Vector store + user profile | Plain-text **engrams** (YAML) in `~/.plur/` — human-readable, editable, git-able |
| Search | Vectorized semantic search (nomic-embed-text, 768 dims) | **Hybrid**: BM25 + local embeddings (**BGE-small-en-v1.5**, cached locally) + RRF fusion |
| Write path | Auto-capture; dashboard cleanup ops | Explicit tools: `plur_learn` / `plur_learn_batch` / `plur_ingest` / `plur_capture`; exact-duplicate writes are NOOP, near-duplicates are *reported* (cosine) not merged |
| Lifecycle | Compaction (`userProfileAnalysisInterval`) | **ACT-R activation**: `retrieval_strength` (decays, strengthens on use), `storage_strength` (only grows), status thresholds >0.5 active / 0.3–0.5 fading / 0.1–0.3 dormant / <0.1 retirement candidate |
| Conflict handling | — | `supersedes` relations (intentional update ≠ contradiction), tension scanner (`plur_tensions`, false positives purged via `plur_tensions_purge`) |
| Injection | Built-in injection + hooks | **None for OpenCode** (tools-only tier). "Injection" = `plur_session_start` / `plur_recall` called explicitly — see §4 C1 |
| Extras | Dashboard | Feedback signals, episodes, packs (export/install), meta-engrams, provenance (`derived_from` / `abstract` / `derivation_count`), associations (semantic/temporal/causal/co_accessed), entities (v2.1), sync via git, `plur_receipt` (what memory actually retrieved) |
| Integration | — | Installed in OpenCode **global** config: `npx -y @plur-ai/mcp` (bin `plur-mcp`); lean profile = 12 tools directly + 32 more via `plur_admin` |

Install facts (verified 2026-09-09/10, session `project-generator`):

- Source of truth: `project-generator/global/opencode/opencode.json` → `mcp.servers.plur`;
  mirror `~/.config/opencode/` is generated (USER runs `./src/install-global.sh`).
- Storage auto-created at `~/.plur/`; embedder downloaded on first write and cached inside the
  npx package dir (`~/.npm/_npx/<hash>/node_modules/@huggingface/transformers/.cache/Xenova/bge-small-en-v1.5`).
  A new npx hash (cache cleanup / package upgrade) re-downloads it once, automatically.
- Governance already landed: `project-generator` AGENTS.md **rule 7** — two zones: editing
  instruction/config files ALWAYS needs explicit USER OK; **using `plur_*` NEVER asks permission**.
- Orchestration rule (plur#281): the **parent session owns plur writes**; subagents return
  findings as text for the parent to persist.

---

## 2. Mapping OESC concepts → PLUR primitives

### 2.1 Tiers (was §3.1)

| OESC tier | PLUR mechanic |
|---|---|
| Short-term (session) | Context window — nothing to persist (optionally `plur_episode` records) |
| Medium-term (project) | `scope: project:<name>` on engrams |
| Long-term (cross-project) | `scope: global` (and remote/team scopes if configured) |

- **Promotion by reused evidence** is *already measurable*: PLUR tracks `frequency`,
  `retrieval_strength`, `usage.hits/misses` and `last_accessed`. The OESC rule
  ("retrieved ≥ N times across ≥ M sessions → promote") becomes concrete thresholds over these
  fields — then applied with **`plur_promote` / `plur_rescope`** (project → global).
- **Decay/demotion** is native (ACT-R; faster for low `emotional_weight`). Demotion = leaving it
  to decay, or re-scoping. Retirement candidates (<0.1) are the `plur_forget` queue.
- The **user profile** analog = `plur_profile` + global-scope engrams.

### 2.2 Dreams (was §3.2)

PLUR does **not** ship a batch "dream" pass — by design its consolidation is *continuous*
(activation, feedback, decay, co-access associations). A **`sleep` pass still needs to be built**
on top; PLUR supplies better primitives than `opencode-mem` did:

1. **Dedupe & merge** — find clusters via `plur_similarity_search` / `plur_recall_hybrid`;
   merge by learning the canonical engram with `supersedes: [old ids]` (kills tension false
   positives), then `plur_forget` the retired ones (decays → eventually pruned; history kept).
2. **Synthesize** — write higher-level insights via `plur_learn_batch`; PLUR has first-class
   provenance for this: `derived_from`, `abstract`, `derivation_count`, meta-engrams
   (`plur_meta_engrams`), and the `consolidated` flag.
3. **Promote / demote** — apply the tier rules with `plur_promote` / `plur_rescope` /
   `plur_forget`.
4. **Reconcile the map** — export refreshed associations/entities to the mental map (see 2.3).

Guards OESC already demanded, restated for PLUR:

- **Idempotent** — re-running the pass changes ~nothing. PLUR helps: identical `plur_learn`
  content-hash = NOOP; association strengths cap at 0.95 (decay floor 0.02); activation
  saturates (diminishing returns), so repeated reinforcement does not keep "moving".
- **Converges** — engram count must stabilize or shrink (no re-synthesis of synthesized engrams).
- **Anti-pollution** — synthesized engrams flagged; low injection weight; A/B gate before
  enabling (unchanged from README §6).

### 2.3 Mental map (was §3.3)

- PLUR already forms a **typed weighted graph**: `associations` (semantic / temporal / causal /
  co_accessed, max 5 co-access edges, +0.05 per co-access, decay λ=0.01 floor=0.02) + `entities`
  (v2.1: person/organization/technology/...). "Related-but-not-similar" resurfacing is native
  spirit; **spreading activation with decay factor + visited set + threshold remains OESC work**
  (Cut 2) — built on the map store chosen in the spec, fed by a regular export from `~/.plur/` (YAML is readable).

---

## 3. What was intentionally NOT delivered by the swap

- No OpenCode adapter/hooks for PLUR (it supports Claude Code/Codex/Cursor hooks, not OpenCode).
  Consequences: no automatic injection, no auto-close of sessions, writes/reads depend on a
  trigger or discipline.
- No scheduled/idle process. Decay is lazy (computed on access), not a background cron.
- No scope file per project yet. Decision (2026-09-10, USER): **no `.plur.yaml` for now** —
  project knowledge must be written with explicit `scope: project:<name>` per engram;
  cross-project facts only in `global`.

---

## 4. Challenges to create

### C1 — Triggers (the missing "motor") **[highest priority]**

Asymmetry found in practice: **writes are event-triggered** (user correction/preference →
salient moment → rule works), **reads are preventive** (nothing forces a recall check; without
hooks, agents skip it). Options, in cost order:

1. **Reuse the existing injection substrate** — OESC README §4 lists `taulukko-inject`
   ("plugin with hooks to inject content at session start / after compaction"). Extend it to call
   PLUR (`plur_session_start` → inject the returned engram block; after compaction, re-run) —
   this restores the "injection" behavior `opencode-mem` provided, mechanically.
2. **Discipline only** — AGENTS.md rule (already written in `project-generator`): `session_start`
   early + `plur_recall` before factual answers. Works, but is a habit, not a guarantee.
3. **Per-harness hooks** — only where PLUR has adapters (not OpenCode).

Open design questions for C1: what to inject (top-N engrams? budget), when (session start,
post-compact, per-prompt?), scope resolution, subagent behavior (read allowed / writes stay with
parent per plur#281), and embedder cold-start races (first call after boot may miss — retry).

### C2 — The `sleep` skill (dreams over PLUR)

The consolidation pass from §2.2, as an OpenCode skill: read `~/.plur/` → cluster → merge
(`supersedes`) → synthesize (flagged) → promote/demote → reconcile map → emit a *dream report*
(what merged, what was forgotten, what got pinned). Include: dry-run mode, USER approval gate
for destructive steps, `plur_packs_export` snapshot before any batch operation, and optional
`plur_sync` (git) so every dream is diffable.

### C3 — Tier thresholds (concrete numbers)

Turn §3.1's N/M/X into real numbers wired to PLUR fields (`frequency`, `retrieval_strength`,
`usage`, `last_accessed`), plus the curve for demotion. Decide where the promotion check runs
(sleep pass vs. per-session).

### C4 — Mental map pipeline

PLUR → map-store exporter (associations + entities as nodes/edges) + the Cut 2 spreading
activation tool (Go, deterministic BFS, decay `d`, visited set, threshold ε) + "wake-up"
injection of activated memories (feeds C1).

### C5 — OpenCode integration gaps

- No hooks (see C1) — decide plugin vs discipline vs per-harness.
- Embedder cache per npx hash (re-download on cache churn) — acceptable; document.
- Default scope — `.plur.yaml` decision pending; until then, explicit `scope` per write.
- Lean profile — keep 12 direct tools; use `plur_admin` for the other 32 (avoids prompt bloat).

### C6 — Quality & hygiene loop

Periodic: `plur_doctor` (embedder/hybrid health), tension scan false positives
(`plur_tensions scan:true` → purge), feedback on used engrams (`plur_feedback`),
retire <0.1 candidates (`plur_forget`), verify supersedes chains.

### C7 — Documentation sync (needs USER OK)

Update README §3.1/§4 and TASKS.md (Cut 1 targets "the sleep skill over PLUR", not
`opencode-mem`); this file should be promoted into the Phase 0 spec when it is written.

---

## 5. References

- PLUR: <https://plur.ai> · spec: <https://plur.ai/spec.html> · repo: <https://github.com/plur-ai/plur>
  (orchestration note: issue #281 — parent owns writes).
- Install: `project-generator/global/opencode/opencode.json` (`mcp.servers.plur`),
  AGENTS.md rule 7 (memory zones), CHANGELOG `[1.5.7]`/`[1.5.8]`.
- Local state: `~/.plur/` (engrams), embedder cache under `~/.npm/_npx/<hash>/...`.
- Session learnings (2026-09-09/10): activation thresholds, caps/saturation, supersedes vs
  tensions, dream absence (continuous consolidation instead), tools-only tier for OpenCode.
