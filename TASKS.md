# TASKS — OESC (Open Electric Sheep Count)

Ordered steps. **Phase 0 is blocking**: the spec must be written (via a
`grill-me` session) before any implementation. Cut 1 → Cut 2 → Cut 3 follow the
MVP plan in [README.md](README.md).

---

## Phase 0 — Spec (blocking, do not implement before this)

- [ ] **0.1 — Run a `grill-me` session to produce the spec.**
  - Move Taulukko dependences for OESC tree
  - Document or recreate external dependences like graphfy or opencode-mem
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
  reconcile `graphify`), with the termination and idempotency guards.
  - Reuse the existing dashboard operations (`Cleanup`, `AI Profile Cleanup`)
    but make them semantic and agent-driven.
- [ ] **1.4 — Tests.** Acceptance criteria from the spec, plus: convergence
  (memory count stabilizes/shrinks), idempotency (run twice = no change),
  no-loop (synthesized memories are not re-synthesized).

---

## Phase 2 — Cut 2: Mental map (spreading activation)

- [ ] **2.1 — Go tool: spreading activation.** Deterministic BFS with decay
  factor, visited set, and activation threshold (no new database — operate on
  top of `graphify`).
- [ ] **2.2 — Wire to `graphify`.** Build/update nodes and edges from memory;
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
