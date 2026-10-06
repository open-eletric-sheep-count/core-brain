# Changelog — oesc/core-brain

All notable changes to this repository are documented here.
Newest on top.

## [Unreleased]

### Removed
- **PLUR references swept from the plugin docs and task list** (USER, 2026-10-04): `docs/troca-ferramenta.md` deleted (it documented the retired `opencode-mem` → PLUR swap — both tools are now removed from the system); the plugin `README.md` lost the "Coexistence with PLUR" and "Zero collision with PLUR" sections (written for the dual-run transition) and its acknowledgment paragraph now states the plugin is fully standalone; `INSTALACAO.md` §8 became "Standalone memory" and §12 no longer require `plur` next to `core-brain`; `TASKS.md` item 0.0 closed. Kept on purpose: the fork acknowledgment (README), the ported-code attribution (`engine/*` headers, `NOTICE`, `LICENSE-APACHE`) and historical specs/CHANGELOG entries.

### Changed
- **core-brain store default moved to `~/.config/core-brain/`** (USER decision, 2026-10-04): without an override the store now resolves to `~/.config/core-brain/` — records and vectors at the root, engine runtime at `~/.config/core-brain/runtime`, model weights at `~/.config/core-brain/models`, policy at `~/.config/core-brain/config.json` — instead of `~/.core-brain/`. Why: the USER wants the store under the OpenCode config directory. What changed: the code defaults (`index.ts`, `store.ts`, `engine/embedder.ts`) and the scripts `install-runtime.sh` / `prune-runtime.sh`; the live docs (`README.md`, `INSTALACAO.md`, `test/CONTRACT.md`, `TASKS.md`) now read the new path; ADR `docs/adr/0004-core-brain-store-moves-to-config-dir.md` records the decision and ADR 0001 carries the `Superseded by ADR 0004` pointer (data root only). Evidence: `check.sh` exit 0 (matrix 13/13 + timeline 8/8); `mcp/check.sh` exit 0 (Layer-A 19/19 + Layer-B 27/27); the existing store was copied `~/.core-brain/` → `~/.config/core-brain/` and verified `diff -r` = 0 differences over 3213 files with identical MD5 on the 22 store files. **Pending activation:** the `CORE_BRAIN_HOME` entry in project-generator's `global/opencode/opencode.json` still points at `/home/gandb/.core-brain`, so the running MCP keeps using the old store until the USER updates that entry and restarts OpenCode; the old directory is deliberately **not** deleted until then.
- **EN consistency sweep — repo prose to English** (USER request 2026-10-02, plan `docs/temp/pt-to-en-translation-plan.md`): translated the remaining in-scope pt-BR prose to English across docs markdown, agent/helper markdown, plugin markdown, shell-script comments + user-facing messages, code comments, and `package.json` `description` fields. The only user-visible behavior change: the TUI sidebar label `Todos (n)` renamed to **`All (n)`** (`global/opencode/plugins/todo-list/tui.tsx`). Preserved verbatim (not prose): the five evidence fixtures in `docs/temp/`, `.bot-forum/*`, file/identifier names (`INSTALACAO.md`, `troca-ferramenta.md`, `rca-metodologia-pergunta-3x.md`), the quoted USER triggers in `core-brain-mcp.md` / `core-brain-migration-plan.md`, the quoted USER rulings/choices in `core-brain-v2.md`, the quoted PT counter-example labels in `ORACLE.md` (incl. `PARAR SIMULAÇÃO` and `"com a skill <id>"`), and `docs/temp/core-brain-mcp-user-criteria.md` (verbatim PT USER task). Evidence executed 2026-10-02: accent-set + wide word-net `rg` scans → zero in-scope hits (all residual hits classified as the intentional preserve set or English identifier/URL false positives — `todo` inside `todo-list` identifiers, `.com` inside URLs); `bash -n` clean on all modified `.sh`; JSON parse clean on all `package.json`; `bash global/opencode/plugins/todo-list/check.sh` → import smoke check + `tsc` typecheck OK ("All checks passed for: todo-list").
- **Removed the personal injection path from `context-inject/config.json` — the public repo no longer ships user-specific configuration** (`global/opencode/plugins/context-inject/config.json`; USER request 2026-10-02): the reserved `ALL` key carried the absolute personal path `/home/gandb/.config/opencode/PERSONAL_RULES.md` (added in commit `cf30642`), which does not belong in an opensource repository. The personal injection now lives in the private **project-generator** repository at the same relative path, which is copied **over** this tree at install time (that repo's `src/install-global.sh` installs core-brain first and project-generator last). This file keeps only the generic `ORACLE` HOWTO injections (`TODO_TOOL_HOWTO.md`, `LAUNCH_LEDGER_HOWTO.md`), which resolve relative to the plugin directory. **Exposure note:** the personal path remains in this repository's git history (`cf30642`, already pushed to `origin/main`) — rewriting it is a git write and was NOT performed; that is the USER's decision. Evidence executed 2026-10-02: `python3 -c json.load(...)` on both copies → valid JSON; `grep PERSONAL_RULES` over the tree → zero hits outside journal/temp files; the overlay test in the project-generator repo → 10/10 PASS.

### Added

- **Learnings digest restored in the memory skills + session-end triggers widened** (USER, 2026-10-05 — "quero o mesmo comportamento"): PLUR's end-of-reply `--- I learned:` digest is back in `core-brain-memory` (the agent shows the digest and stores each bullet explicitly — core-brain does not harvest the block yet); `core-brain-session-end` now triggers on plain satisfaction/closing ("ok", "thanks") and always closes with the visible summary; the stale "no automatic injection" note in the skills and in this file was corrected (the automatic layer A1–A3 landed 2026-10-04). Plugin-side parity (reading the block automatically + the closing ritual) registered as **Fatia 2b** in `TASKS.md`.
- **Memory skills added to the suite — `core-brain-memory`, `core-brain-create-memories`, `core-brain-session-end`** (`global/opencode/skills/`; USER, 2026-10-05) — the three skills were adapted from the PLUR project's skills (`plur-memory`, `plur-create-engrams`, `plur-session-end`) to the live `core_memory` contract (ops `who`/`store`/`recall`/`forget`/`feedback`/`episode`/`timeline`/`promote`): tool names remapped (`plur_learn`→`store`, `plur_feedback`→`feedback`, `plur_forget`→`forget`, `plur_similarity_search`→`recall`, `plur_session_end`→episode + stores); mechanics the store does not have yet are stated instead of taught (pin/dedup/supersedes are not built — recall-before-store + a `meta.supersedes` convention; unprompted behavioural rules belong in the always-loaded instructions); the session-end skill gains the episode step (`op: "episode"`). The files were first written into the personal project-generator repo by mistake; **moved here the same day** (USER correction — core-brain content lives in the core-brain repo). PLUR-format-specific subfiles were not ported (the target format is the core-brain record). Evidence: YAML frontmatter 3/3 parse OK; all three load via the `skill` tool (ORACLE session + a fresh session); trigger mapping verified (wrap-up → session-end; preference → memory; extraction → create-memories; recall → memory); functional dry-run (store + episode + recall) against the live store; reference sweep → zero `plur`/`engram` hits; move verified byte-identical with recorded sha256 (`fd362d1a…` create-memories, `122dd918…` memory, `165f2819…` session-end). Activation: the next `install-global.sh` run carries `skills/` to the mirror — the running `~/.config/opencode/skills/` still holds the pre-move copies until then.
- **core-brain gains the real retrieval engine — real semantic embedder, hybrid
  BM25+vector fusion by RRF, a stamped index and an optional reranker**
  (`global/opencode/plugins/core-brain/engine/`: `embedder.ts`, `fts.ts`,
  `fusion.ts`, `reranker.ts`, plus the plugin wiring; spec
  `docs/specs/fatia1-engine-plan.md`; USER, 2026-10-03): the retrieval path is
  no longer the `hash-ngram-v1` stub — the active embedder is the real
  sentence-transformer **`Xenova/bge-small-en-v1.5`** (`dim 384`, pooling
  **`cls`**, `dtype fp32`, loaded through `@huggingface/transformers@4.3.0` from
  a runtime provisioned outside the plugin tree). `recall` with a query is
  **hybrid**: a **BM25** leg (`k1 = 1.2`, `b = 0.75`, tokenizer v4) and a
  **vector** leg (cosine) fused by **Reciprocal Rank Fusion** (`k = 60`), with
  two core-brain refinements the PLUR original does not have — a vector-leg
  admission floor **`MIN_VECTOR_SIMILARITY = 0.05`** and a deterministic cosine
  tie-break (absent-from-vector leg is worst, then `id` ascending); `mode`
  (`hybrid` | `hybrid-degraded` | `bm25-only`), `reranked` and per-hit raw
  `legs` are reported. An optional cross-encoder reranker
  (`Xenova/ms-marco-MiniLM-L-6-v2`, **off by default**,
  `CORE_BRAIN_RERANKER=ms-marco`) is wired; a reranker failure degrades to the
  RRF order, never reorders silently. Every `vectors/<ns>/index.json` is
  **stamped** (`{ embedder, dim, revision, vectors }`, `revision` = the
  model-artifact fingerprint) and a namespace built by a different engine is
  **refused** with `STALE_INDEX` naming `reindex`; `core_admin reindex` rebuilds
  it and is idempotent. The engine seam became **asynchronous** — `invoke`
  returns a `Promise`, awaited by `store`/`recall`. **License:** the four ported
  `engine/` files derive from `@plur-ai/core@0.21.0` (Apache-2.0) alongside
  core-brain's own MIT files, so the package is now declared **`(MIT AND
  Apache-2.0)`** (`LICENSE`, `LICENSE-APACHE`, `NOTICE`). **Non-destructive:**
  the isolation matrix stays **13/13 PASS, exit 0**, the **7/7** offline search
  probes PASS, and the MCP check passes **19/19 Layer-A + 27/27 Layer-B**;
  `tsc` on the plugin sources reports **0 errors**; the `hash-ngram-v1` double
  is kept but only ever selected **explicitly** (offline fixture / v1 indexes),
  never chosen implicitly by the real path. **What did NOT land (pending, not
  claimed):** the engine runtime (`@huggingface/transformers@4.3.0` in
  `~/.core-brain/runtime`) is **not provisioned** in this environment, so the
  **E1** live run with the real model, the **AC8** offline verification and the
  measured **E8** runtime/weights cost remain **PENDENTE** (the README E8 table
  marks the two runtime lines `PENDENTE — not provisioned`; `install-runtime.sh`
  is the USER-run step). Docs: the plugin's `README.md` (Engine section) and
  `INSTALACAO.md` (§2).
- **The `core-brain` MCP server — the administration surface, zero runtime dependencies**
  (`global/opencode/plugins/core-brain/mcp/server.js`, `mcp/jsonrpc.js`,
  `mcp/check.sh`, `mcp/test/transport.selftest.mjs`; spec
  `docs/specs/core-brain-mcp.md`, slice G1+G3): a newline-delimited JSON-RPC 2.0
  server over **stdio** (no port, no daemon, no PID file) exposing **five**
  tools — `core_recall` (**global namespace only**, explicitly not an agent
  view), `core_status`, `core_doctor`, `core_receipt`, `core_admin`
  (`purge`/`reindex`/`export`/`import`/`compact`). The transport is implemented
  in the repo: **no `@modelcontextprotocol/*`, no `zod`, no runtime dependency**
  at all. The plugin tool `core_memory` gains two operations — `forget` (soft
  retire: recall excludes the record, its text stays on disk) and `feedback`
  (feeds the ranking tie-break `score → feedback.useful → retrievals →
  updatedAt`); the store format is extended **additively** (two optional record
  fields), so a store written by v0.1.0 opens unchanged. The MCP carries no
  per-agent identity by construction — measured: a local MCP process receives no
  `OPENCODE_SESSION_ID` and no agent key — so every identity-needing operation
  stays on the session-scoped `core_memory` tool and impersonation is impossible.
  **Non-destructive:** the plugin's isolation matrix stays **13/13 PASS, exit 0**;
  the 23 pre-existing agents and the four `CB_*` test agents are byte-identical;
  `~/.plur/` is untouched and the `plur` MCP stays connected alongside
  `core-brain`. Evidence, **executed 2026-10-02** (Node v24.15.0):
  `bash global/opencode/plugins/core-brain/check.sh` → **13/13 lines PASS**;
  `bash global/opencode/plugins/core-brain/mcp/check.sh` → **18/18 lines PASS**;
  `opencode2 mcp list` → `core-brain` **connected** AND `plur` **connected**;
  live probes by the dedicated agents `CB_ALPHA`/`CB_BETA`/`CB_GAMMA`/`CB_DELTA`
  returning the expected JSON and the expected refusals (`agent 'CB_GAMMA' cannot
  write to 'global': no global access`; `agent 'CB_ALPHA' cannot write to
  'agent:CB_BETA': target is private — cross-agent write not allowed`); an
  unlisted agent resolves to the default policy `{ private:false,
  hasGlobalAccess:true }`. Docs: the plugin's `README.md` (MCP section) and
  `INSTALACAO.md` §11. **Note for the operator:** the `opencode.json` key for a
  local server's environment is **`environment`**, not `env` — an `env` block is
  silently ignored (measured).
- **New plugin `core-brain` v0.1.0 — per-agent memory isolation for OpenCode V2**
  (`global/opencode/plugins/core-brain/`: `index.ts`, `store.ts`, `types.ts`,
  `package.json`, `tsconfig.json`, `shims.d.ts`, `config.json` seed, `LICENSE`,
  `README.md`, `INSTALACAO.md`, `check.sh`, `test/`; plus the four dedicated test
  agents `global/opencode/agent/CB_{ALPHA,BETA,GAMMA,DELTA}.md` with `mode: all`
  and an inherited model): one `core_memory` tool (`who` / `store` / `recall`)
  and the access matrix of `docs/core_brain_specification.md` §4 implemented
  exactly — a private namespace per agent, an optional shared `global` namespace,
  cross-agent writes always refused, unlisted agents fail-closed, and
  `InvalidConfigurationError` at init for a `private:false` +
  `hasGlobalAccess:false` row. Real per-namespace vectors with an in-process
  cosine top-k, atomic JSON persistence under `~/.core-brain/` (override
  `CORE_BRAIN_HOME`), and a **declared** offline stub embedder
  (`hash-ngram-v1`, 256 dims; a production semantic embedder is a follow-up).
  **Non-destructive:** nothing pre-existing was modified — the plugin is
  auto-discovered from the `plugins/` directory (no `opencode.json` entry), the
  `prompt` hook is inert (it never edits the user's prompt nor injects into the
  system block), and it is a fork/substitute of PLUR Memory (MIT, with the PLUR
  acknowledgment) sharing no dependency, data directory, env var, port, cache or
  tool namespace with PLUR. Evidence, **executed 2026-10-01** (Node v24.15.0):
  `opencode2 plugin list` → **8 plugins** including `core-brain`;
  `opencode2 debug agents` **23 → 27**, none removed, the 23 pre-existing agents
  byte-identical; `bash global/opencode/plugins/core-brain/check.sh` → **8/8
  matrix lines PASS**, exit code `0`; three real headless smokes (`CB_BETA`,
  `CB_GAMMA`, `CB_ALPHA`) returned the expected JSON and the expected refusals
  (`no global access`; `target is private — cross-agent write not allowed`);
  `~/.plur/` untouched and the `plur` MCP still `connected`. Activation: mirror
  via `bash global/opencode/install-global.sh` (USER) plus `opencode2 reload`.
  Docs: the plugin's `README.md` and `INSTALACAO.md`.
- **`bot-forum` reaches the config files — the Tico&Teco helper migrated and all the methodology helpers reference the forum** (`helpers/METHODOLOGY_TICO_AND_TECO_THINK_HELPERS.md`, `helpers/METHODOLOGY_BATMAN_E_ROBIN_HELPERS.md`, `helpers/METHODOLOGY_SCRUM_TEAM_HELPERS.md`, `helpers/METHODOLOGY_ORACLE_DOES_IT_ALL_HELPERS.md`, `agent/ARCHITECT.md`; USER, 2026-09-30, decision D7 of the bot-forum grill): the shared channel of a task now lives in the `bot-forum` skill (project-generator repo) and **each helper points there**. Tico&Teco stops opening `docs/forum.md` and opens `.bot-forum/forum-<session id>.md` — **one file per session** (the launcher's id), **no archive** (the id already separates the tasks), the path travels in every brief and the `[REQ]`/`[ANS]` mail rides on top of the append-only format; `agent/ARCHITECT.md` carries the same reference in its "Authority over the DEVELOPER" rule. Batman e Robin gains the forum rule (Robin has no shell nor subagents — `[REQ]` is how it reaches what it cannot run), scrum-team the same, `ORACLE does it all` opens at startup (record only); A New Brain Storm keeps its own forum (explicit exception in the skill). Activation: mirror via the project-generator `./src/install-global.sh` (USER, done 2026-09-30). Executed evidence: the `batman-e-robin` skill reloaded **from the mirror** carries the new forum section, and a real run of Batman e Robin (session `ses_f1d182d30ffenzF1Cdr8cvXBtd`) produced a true `[REQ]`/`[ANS]` pair on disk (`orchestrator/.bot-forum/`).
- **`DEVELOPER` gains Mode B (Batman e Robin) with precedence over the Scrum mode — the
  low autonomy was not only the flow skill's fault** (`global/opencode/agent/DEVELOPER.md`,
  `global/opencode/helpers/METHODOLOGY_BATMAN_E_ROBIN_HELPERS.md`,
  `global/opencode/agent/ORACLE.md` item 5; USER, 2026-09-30, after the `batman-e-robin` v2
  rewrite): the agent prompt carried Scrum absolutes that **contradicted** Batman e Robin
  (*"Never contact the ORACLE directly"*, a TESTER that does not exist in this flow, a handoff
  to the USER) — while the flow forbids all three. `DEVELOPER` now resolves its **operating
  mode BEFORE anything else** (unknown mode → STOP and report, never guess): **Mode A = Scrum
  (default)** with the pre-existing rules now explicitly scoped `(Mode A)`, and **Mode B =
  Batman e Robin**, which **takes precedence and REPLACES** them — the brief is a contract from
  the ORACLE/Batman; the ORACLE is the only interlocutor (the "never contact the ORACLE" rule is
  **Mode A ONLY**); there is no TESTER and no ARCHITECT ("start by validating that tests fail"
  does not apply); the developer never hands off to the USER; he **owns the HOW** and stops
  **only** to cross the WHAT, on an ambiguous/impossible criterion, or on an unpredicted
  destructive action — any other HOW doubt he decides and records; the report carries files
  touched · HOW decisions · commands + digest · self-check per criterion · the visual line; he
  loads the `batman-e-robin` skill and states `SKILL LOADED: batman-e-robin`. Governance in
  Mode B reads only the generic `SUBAGENT-HELPER.md` (the SCRUM helper does not apply). The
  persona keeps arguing with evidence, now with ARCHITECT → Batman. `DEVELOPER_EXTENDED`
  inherits automatically (it is a pointer to the canonical file). The helper states the WHAT/HOW
  split, serial dispatch, Batman's re-execution of the acceptance criteria and the closed
  takeover. The ORACLE menu line dropped *"executes the precise mechanical brief"* for **"owns
  the WHAT … does NOT implement; the DEVELOPER (Robin, Mode B) owns the HOW"**. Executed
  evidence: none — config/prompt change; proof is the mirror apply (below) plus a real run of
  the flow. Activation: mirror via `./src/install-global.sh` (USER).
- **ORACLE: "Skill duty" — a skill named by the USER is mandatory, and it is loaded
  before any other work** (`global/opencode/agent/ORACLE.md`, the `<IMPORTANT>` block
  at the **top** of the prompt + a bullet in `Rules`; USER, 2026-09-20): in
  OpenCode V2 an `@name` written in the prompt is **plain text** (the API does not
  expand it into a link), so the one who must honour it is the agent. The block is the
  first thing the agent reads and locks in: (1) scan the request BEFORE the
  methodology gate, in the explicit forms (`@<id>`, "use a skill <id>", "with a skill
  <id>", bare ID — the `@` is never part of the ID) and in the **indirect forms**
  ("the skill from job #36", "the skill we used in job N"), resolved from history
  (the orchestrator base / the OpenCode base), never by guessing — without certainty,
  the USER is asked; (2) load the skill with the `skill` tool right AFTER the gate and
  BEFORE reading files, planning, answering or delegating; (3) say out loud
  `SKILL LOADED: <id>` (or `SKILL NOT FOUND: <name>` + a question to the USER — never
  proceed in silence); (4) the fallback of reading `~/.config/opencode/skills/<id>/SKILL.md`
  when the `skill` tool does not list the name; (5) passing the duty to whoever is
  delegated to — a brief to a subagent that names a skill carries, verbatim, the order
  to load it and to declare the load; (6) "I already used it in another job" is never
  a load, and declaring a skill applied without the `skill` tool call in this session
  is false.
  Measured reason: in Jobs #24, #27, #34, #36 (`use a skill @run-meter`) and **#42** the
  prompt named the skill and it was **never loaded** (2026-09-20).
  Verified after the fix: (a) a fresh headless session in the shape of Job #36
  (`opencode run --agent ORACLE --model deepseek/deepseek-v4-flash-vision-exp`) —
  the `skill` tool was the **only and first** call, with `{"id":"run-meter"}`, and the
  line said was `SKILL LOADED: run-meter` (ses_f4083d6c9ffeZB8sMRjFl4Ts51); (b) the
  very session of Job #47, whose request names the skill **by indirect reference**
  ("the skill from job 36"), loaded `run-meter` and `be-a-master-developer` right after
  the methodology gate. The `~/.config/opencode` mirror was refreshed by the alias
  `octu` (`src/install-global.sh`) and confirmed identical to the source.
- **Orchestrator subproject — spec accepted, construction deferred**
  (`docs/specs/orchestrator.md`, `orchestrator/CONTEXT.md`,
  `orchestrator/docs/adr/0001-pause-aborts-the-engine.md` (superseded) and
  `0002-pause-is-light-and-never-aborts.md`,
  `orchestrator/docs/gpu-measurement.md`, backlog entry in `TASKS.md`): the
  platform that queues the USER's demands and drives them through the OpenCode
  HTTP API — strictly one job at a time, light pause (interrupt only, confirmed
  by the engine's own GPU usage), `RESPIRO` between jobs, decisions taken by the
  Oracle while a job was blocked shown as a table at the end. Locked decisions
  D1-D14, criteria AC1-AC13. Also records two measured findings: the OpenCode
  2.0.6 client-side bug that hides an API-created session from the TUI list, and
  the SGLang abort semantics (no session scope; an abort returns an empty body,
  so it confirms nothing).

### Fixed

- **`@oesc/context-inject` 0.1.1 — the HOWTOs are no longer prepended to the USER's message**
  (USER, 2026-09-23; `global/opencode/plugins/context-inject/index.ts`, `package.json`):
  the plugin delivered the content of `TODO_TOOL_HOWTO.md` + `LAUNCH_LEDGER_HOWTO.md`
  (agent ORACLE, events `session.created` and `session.compacted`) by writing into the
  mutable draft `event.prompt.text` — which the host documentation describes as the USER's
  canonical input — and the content appeared **glued in front of the USER's message** in a
  new session and, again, after each compaction. Delivery now goes through a **durable
  `synthetic` message** (`ctx.session.synthetic({ sessionID, text })`, the same mechanism
  as `opencode-anti-loop` 0.3.6): outside the USER's voice, persisted in the log and
  surviving compaction. The prepend stays as a **legacy fallback** for a runtime without
  that surface (logged as `prompt prepend fallback`), and the stateless step is kept —
  `synthetic` does not count as user activity in the post-compaction window scan, so the
  two rules (`isFirstPrompt`, `pendingCompactionWindow`) do not change. Verification:
  `bash check.sh` (native TS import smoke + `tsc` typecheck) → **All checks passed for: context-inject**.
- **`@oesc/todo-list` 0.2.2 — the `TODO: …` reminder no longer speaks in the USER's voice**
  (USER, 2026-09-23; `global/opencode/plugins/todo-list/index.ts`, `todo-list-spec.md`
  Q6/§5.1/§7/Q15, `README.md`): the plugin delivered the reminder by editing
  `event.prompt.text` in the `prompt` hook — and the host documentation says, verbatim,
  that edits of that hook **"become the canonical persisted user input"**. Measured result
  in real sessions: the line `TODO: 12 items — update it if something changed.` stayed
  **glued to the USER's message**, and the transcript read as if the USER had written it.
  Delivery now is **system context**: `ctx.session.hook("context")`
  → `event.system.push({type:"text", text: line})` (the `system` block is rebuilt by the
  host on every request to the model, so it **never accumulates** in history). The line
  that fires the reminder is kept intact (a single one, only with a non-empty list; guards
  `Array.isArray(event?.system)` for degraded runtimes, and the hook still never breaks
  prompt admission). It is the same defect family as `opencode-anti-loop` 0.3.6 (which
  used `ctx.session.prompt`) — fixed the same day. **Activation in the mirror is still
  pending** (`./src/install-global.sh` + `opencode service restart`), which is the USER's step.

### Changed

- **core-brain: an agent absent from `config.json` is no longer fail-closed — it gets the default
  policy `private:false` + `hasGlobalAccess:true`, and a configured row that omits `private` and/or
  `hasGlobalAccess` takes the same defaults** (`global/opencode/plugins/core-brain/store.ts`; USER,
  2026-10-02): `requirePolicy()` now returns the configured policy or a synthesized
  `{ name, private:false, hasGlobalAccess:true }` instead of throwing `agent '<name>' is not
  configured in core-brain config.json` (that string is removed from production); in
  `loadPolicies()`, a field whose key is **absent** (`undefined`) resolves to its default
  (`hasGlobalAccess` → `true`, `private` → `false`), while a **present non-boolean still throws**
  `InvalidConfigurationError` (the defaults are a missing-key rule, not coercion) and the
  **unchanged** invalid-row rule still throws for `private:false` + `hasGlobalAccess:false`. This is
  a **deliberate reversal of fail-closed** (spec §10): an unlisted agent — and, if `config.json` is
  missing or empty, every agent — now participates in the shared `global` namespace; its namespace
  does **not** join another agent's public read union and is not readable via `from:"agent:<X>"`
  (spec §4.3; rejected alternative: disk namespace discovery). The isolation matrix grew from 8 to
  **13 lines**; `bash global/opencode/plugins/core-brain/check.sh` → **13/13 matrix lines PASS**,
  exit code `0`.
- **Tico&Teco: the ARCHITECT hands the plan to the ORACLE, and the debate now lives in `docs/forum.md`** (USER, 2026-09-20; `helpers/METHODOLOGY_TICO_AND_TECO_THINK_HELPERS.md`, step 3): on the local engine (SGLang) the ARCHITECT can no longer launch the DEVELOPER — depth <= 1, enforced by the `sglang-guard` plugin —, so the ORACLE launches the DEVELOPER with the ARCHITECT's plan, **one agent at a time**, and the ARCHITECT ↔ DEVELOPER conversation travels through **`docs/forum.md`**: opened FRESH at the start of **each task** (the previous one is archived as `docs/forum-<AAAAMMDD-HHMM>.md`), with a header identifying the task, *append-only* from then on, one entry per agent with `## <AGENT> — <YYYY-MM-DD HH:MM>`, and **entries of two tasks in the same file are a defect**. The ORACLE relays only the path (never glued text — rules 13/14) and the ARCHITECT keeps the authority (directs, reviews, rejects). On a remote provider the direct ARCHITECT → DEVELOPER call stays as it was; the forum remains the record.
- **`agent/ARCHITECT.md`: "sole relay" becomes authority without launch** (USER, 2026-09-20; GOLDEN RULES): the bullet now says that the ARCHITECT is the sole authority over the DEVELOPER but **never launches it** — a level-1 subagent launches nothing (AGENTS.md rule 19) —, that the ORACLE launches and carries, that the brief and the verdicts travel as file paths, and that the DEVELOPER never argues with the ORACLE (conflicts come back through the ARCHITECT).
- **Agent take-over rule: 3 informed attempts + USER permission**
  (`global/opencode/agent/ORACLE.md`, "Orchestrator Responsibilities"): a
  stalled/failed agent is now redispatched up to **3 attempts**, each retry
  carrying the context of what the previous attempt had done (informed
  redispatch; a blind resend is forbidden); even after the 3rd failure the
  ORACLE does **not** take over on its own — it reports to the USER and asks
  for permission first. Replaces the former immediate
  "no response → take over the work" behavior. Aligns the agent team with the
  flow skills kept in the taulukko/project-generator repo (`be-judge`,
  `batman-e-robin`, `scrum-team`, `spec-to-real-world`).
- **Source-of-truth split during migration** (taulukko/project-generator
  `global/opencode/AGENTS.md` §9): agents + helpers live in this repo
  (`core-brain/global/opencode/`), skills still live in
  taulukko/project-generator (`global/opencode/skills/`); the legacy copies of
  `agent/` and `helpers/` in the project-generator repo are deleted leftovers.
  To be collapsed back to a single source when the migration completes.

## [0.3.0] — 2026-09-11

### Changed

- Plugin layout is now **single-folder**: each plugin lives entirely at
  `global/opencode/plugins/<name>/` — source, distribution artifact and npm
  package root in one folder; `check.sh` (import smoke check + typecheck)
  replaces the old `build.sh` copy step. Applies to `todo-list` and
  `context-inject`; the former top-level project folders are removed.

### Added

- `global/opencode/plugins/context-inject/` — `@oesc/context-inject` OpenCode
  V2 plugin: injects
  configured files into sessions at the true start (first admitted prompt) and
  after a completed compaction, per agent (`injections.agents.<AGENT>`,
  reserved `ALL` key); stateless semantics derived from the durable session
  log; config via `options.configPath` or `<pluginDir>/config.json`.
  Migrated from the internal `taulukko-inject-context` plugin (renamed;
  site-specific defaults removed: neutral default log path, cleaned identity
  strings, V1 legacy files dropped); npm-ready manifest
  (`@oesc/context-inject`, `publishConfig` public, `files`).
- `global/opencode/agent/` + `global/opencode/helpers/` — the OESC **agent
  team** (ORACLE, ARCHITECT, DEVELOPER, TESTER, DOCUMENTATION_WRITER, the four
  Brain Storm personas, plus the `_EXTENDED` pointer variants) and the
  flow/subagent helpers, migrated from the internal taulukko config; README §4
  documents each role.

## [0.2.1] — 2026-09-11

### Changed

- Guidance (tool description + injected how-to): before adding an item, check
  the existing list for a fitting **parent** and nest sub-steps
  (`after: <parent id>` + `depth: <parent depth + 1>`) instead of defaulting
  everything to the root.

## [0.2.0] — 2026-09-11

### Changed

- `todo-list` 0.2.0 — structured list: items carry an optional `depth`
  (0 = root). The hierarchical numbering (`1)`, `1.1)`) is **derived from
  order + depth** at display time (tool dump + sidebar panel) — never stored
  and never written by the agent; legacy text prefixes are stripped on input
  and display. `add` accepts `after: <id>` to insert right after an item;
  level jumps are clamped and reported (`issues`). Spec updated (Q8, §5.2,
  §6).

## [0.1.0] — 2026-09-11

### Added

- `todo-list/` — `@oesc/todo-list` OpenCode V2 plugin (contract:
  `todo-list/todo-list-spec.md`):
  - Server entry (`src/index.ts`): single `todo` tool (ops `read` / `write` /
    `add` / `update` / `remove` / `clear`; stable integer ids; statuses
    `pending` / `in_progress` / `completed` / `cancelled`; priorities
    `high` / `medium` / `low`) and a prompt hook that injects **at most one
    line per round**, only when the session's list is non-empty.
  - TUI entry (`src/tui.tsx`): live sidebar panel
    (`append: "sidebar.content"`, below the MCP block) with glyphs
    `[ ]` `[~]` `[x]` `[!]` and strikethrough for `completed` / `cancelled`
    items; hidden when the list is empty.
  - Storage: per-session JSON at `~/.local/share/opencode-todo/<sessionID>.json`
    with atomic writes (tmp + rename). OpenCode's DB is never touched.
  - Tooling: `build.sh` (import smoke check + optional typecheck + copy into
    `global/opencode/plugins/todo-list/`), `README.md`.
- `global/opencode/install-global.sh` — mirrors `global/opencode/.` into
  `~/.config/opencode/` (same interface as the taulukko installer:
  `-s` / `-d`; aborts when the source is missing).
- `global/opencode/install-vars.sh` — writes `OESC_CORE_BRAIN_HOME` into the
  user environment (`/etc/environment` when writable, plus a marker block in
  `~/.bashrc`; idempotent re-runs).

### Integration (host repo: taulukko/project-generator)

- `global/opencode/opencode.json`: `todo` permission — global deny + ORACLE
  allow (same pattern as `journal-log`).
- `src/install-global.sh`: calls this repository's installer when
  `OESC_CORE_BRAIN_HOME` is set (spec §10 wiring).
