# TASKS — OESC (Open Electric Sheep Count)

Ordered steps. **Phase 0 is blocking**: the spec must be written (via a
`grill-me` session) before any implementation. Cut 1 → Cut 2 → Cut 3 follow the
MVP plan in [README.md](README.md).

---

## Suite — agents & templates

- [ ] **1 — Template markers + user templates folder** — add a template mechanism for the agent surface: template markers (placeholders) in `AGENTS.md` and in the agent definitions (`agent/*.md`), plus a **templates folder** where the user can change **what gets injected into the agents and into `AGENTS.md`**. Goal: personalizations (e.g. a personalized `SECRETARY`) live in the user's templates — **without editing the git-shipped templates**, surviving reinstalls/updates.

---

## Phase 0 — Spec (blocking, do not implement before this)

- [x] **0.0 — Evaluate `troca-ferramenta.md`** (memory-tool swap: `opencode-mem` → PLUR). — **Closed 2026-10-04 (USER):** both legacy memory tools were removed from the system and the swap doc was deleted.
- [ ] **0.1 — Run a `grill-me` session to produce the spec.**
  - Move Taulukko dependences for OESC tree.
  - Document or recreate external dependences like opencode-mem
  - Decision tree to resolve:
    - **Tiers** — exact short/medium/long boundaries; the scopes/tags used; the
      promotion rule (N retrievals across M sessions) and the decay/demotion rule
      (X days unused, weight curve).
    - **Dreams** — trigger conditions (N sessions / explicit `sleep` / before
      compaction); dedupe similarity threshold; synthesis target (how many
      insights per cluster, max); how synthesized memories are weighted for
      injection.
    - **Mental map** — decay factor `d`, initial activation `A`, activation
      threshold ε; edge weights; how the map is built/updated from memory.
    - **Termination & idempotency guards** — the `synthesized` flag, convergence
      check, visited set.
  - The spec MUST include **acceptance criteria**, listed to the USER *before*
    the full spec is accepted (the USER sees the criteria first, then the file).
- [ ] **0.2 — Read the LM Studio article** (`https://lmstudio.ai/dirty-data/persistent-memory`)
  and fold in anything applicable to the spec.

---

## Phase 1 — Cut 1: Tiers + `sleep` skill (consolidation)

- [ ] **1.1 — Tier convention.** Map short/medium/long to existing scopes/tags in
  `opencode-mem` (short = session, medium = `project` scope, long = `global`
  scope + user profile). Document it.
- [ ] **1.2 — Promotion/demotion rules.** Implement the movement rules from the
  spec (evidence of reuse → promote; stale → decay/demote).
- [ ] **1.3 — `sleep` skill.** Create `sleep` as an OpenCode skill that runs the
  four consolidation operations (dedupe/merge → synthesize → promote/demote →
  reconcile the mental map), with the termination and idempotency guards.
  - Reuse the existing dashboard operations (`Cleanup`, `AI Profile Cleanup`)
    but make them semantic and agent-driven.
- [ ] **1.4 — Tests.** Acceptance criteria from the spec, plus: convergence
  (memory count stabilizes/shrinks), idempotency (run twice = no change),
  no-loop (synthesized memories are not re-synthesized).

---

## Phase 2 — Cut 2: Mental map (spreading activation)

- [ ] **2.1 — Go tool: spreading activation.** Deterministic BFS with decay
  factor, visited set, and activation threshold (no new database — operate on
  top of the chosen map store).
- [ ] **2.2 — Wire the mental map.** Build/update nodes and edges from memory;
  expose `query`/`path`/`explain` for the map.
- [ ] **2.3 — CLI.** A CLI to access the map and the memory from the agent/tools
  in a controlled way (per the `project-generator` TASKS note about a Go tool
  that reads but does not mutate paths it should not know).

---

## Phase 3 — Cut 3: A/B "with vs. without dreams"

- [ ] **3.1 — A/B test.** Measure recall/coherence with dreams enabled vs.
  disabled, on the same inputs.
- [ ] **3.2 — Tune.** Adjust thresholds (dedupe similarity, decay factor, ε,
  injection weight) from the A/B results.
- [ ] **3.3 — Integrate back.** Port the proven pieces into
  `project-generator`'s `global/opencode/` config and update its documentation
  and CHANGELOG.

---

## Plugin — core-brain (memory isolation)

- [x] **core-brain v0.1.0 — per-agent memory isolation plugin (delivered, verified in the real environment).**
  OpenCode V2 plugin at `global/opencode/plugins/core-brain/` (`index.ts` +
  `store.ts` + `types.ts`, zero runtime dependency), one `core_memory` tool
  (`who` / `store` / `recall`), the §4 access matrix of
  `docs/core_brain_specification.md` implemented exactly (a private namespace per
  agent, an optional shared `global` namespace, cross-agent writes refused,
  absent rows defaulted to `private:false` + `hasGlobalAccess:true` instead of
  fail-closed), atomic JSON persistence under `~/.config/core-brain/`
  (override `CORE_BRAIN_HOME`) and a declared offline stub embedder
  (`hash-ngram-v1`, 256 dims).
  - Four dedicated test agents: `global/opencode/agent/CB_{ALPHA,BETA,GAMMA,DELTA}.md`
    (`mode: all`, inherited model).
  - Docs: the plugin's `README.md` and `INSTALACAO.md`; entry in `CHANGELOG.md`.
  - Evidence (measured 2026-10-01, Node v24.15.0): `bash global/opencode/plugins/core-brain/check.sh`
    → **8/8 matrix lines PASS**, exit code `0`; `opencode2 plugin list` → 8 plugins
    including `core-brain`; `opencode2 debug agents` 23 → 27 with the 23
    pre-existing agents byte-identical; three real headless smokes (`CB_BETA`,
    `CB_GAMMA`, `CB_ALPHA`) returned the expected results and refusals;
    `~/.plur/` untouched and the `plur` MCP still `connected`.
  - Follow-ups (declared, non-blocking): opt-in context injection (`inject: true`,
    off by default); a `compaction` hook; optional multi-process file lock;
    automated Layer B smoke in CI.

- [x] **Real retrieval engine — real embedder + hybrid BM25/vector (RRF) + stamped
  index + optional reranker (2026-10-03).**
  `global/opencode/plugins/core-brain/engine/` (`embedder.ts`, `fts.ts`,
  `fusion.ts`, `reranker.ts`): real semantic embedder `Xenova/bge-small-en-v1.5`
  (`dim 384`, pooling `cls`, `fp32`, via `@huggingface/transformers@4.3.0` from a
  runtime outside the plugin tree); hybrid BM25 (`k1 = 1.2`, `b = 0.75`) + vector
  cosine fused by RRF (`k = 60`) with `MIN_VECTOR_SIMILARITY = 0.05` and a
  deterministic cosine tie-break; optional cross-encoder reranker (`ms-marco`,
  off by default); stamped index with the `STALE_INDEX` refusal and an idempotent
  `reindex`; the engine seam is asynchronous (`invoke` returns a `Promise`).
  License is now `(MIT AND Apache-2.0)` — the four `engine/` files are ported
  from `@plur-ai/core@0.21.0`.
  - Evidence (2026-10-03): `check.sh` **13/13** matrix + **7/7** probes, exit 0;
    `mcp/check.sh` **19/19** Layer-A + **27/27** Layer-B, exit 0; `tsc` **0**
    errors.
  - **PENDENTE (not provisioned):** the engine runtime
    (`@huggingface/transformers@4.3.0` in `~/.config/core-brain/runtime`) has not been
    installed in this environment, so the **E1** live run with the real model,
    the **AC8** offline verification and the measured **E8** runtime/weights cost
    remain open (`install-runtime.sh` is the USER-run step).

---

## core-brain plugin — MCP slice

- [x] **MCP server + new plugin ops** (2026-10-02) — `core-brain` MCP server
  (`mcp/server.js` + `mcp/jsonrpc.js`, stdio, zero runtime deps) with the five
  tools `core_recall`/`core_status`/`core_doctor`/`core_receipt`/`core_admin`;
  plugin ops `forget`/`feedback`; additive store fields. Spec:
  `docs/specs/core-brain-mcp.md`. Evidence: `mcp/check.sh` 18/18, `check.sh`
  13/13, `opencode2 mcp list` core-brain + plur connected.

---

## core-brain plugin — Fatia 2b (PLUR parity: self-report + closing ritual)

- [ ] **Fatia 2b — automatic self-report capture + session-closing ritual** (`global/opencode/plugins/core-brain/`; USER request 2026-10-05 — restore the PLUR learned-summary behavior): (1) **self-report capture** — read the assistant's end-of-reply learnings digest (`--- I learned:` block) at turn end and store each item automatically (PLUR's `learnFromTurn` on `session.idle`; today the skills store each bullet explicitly and nothing in the plugin reads the assistant's text); (2) **closing ritual** — on session close, capture the summary + episode (PLUR's `plur_session_end`; fatia 2's A4 remains `UNKNOWN`). First step: a spike for the turn-end/event signal on the V2 plugin API (the PLUR V2 port used an event subscribe — source in the plur repo, `packages/opencode/`). 
