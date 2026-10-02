# FIX — align the core-brain MCP with the PLUR MCP (signatures and features)

**Goal:** the `core-brain` MCP now exposes the SAME signatures and features as the `plur` MCP. Anything a client calls on `plur_*` works on `core_*` (or under the `plur_*` name kept for compatibility — decision in §5). No "close enough": same list of tools, same args, same validation, same result.

## 1. Copy guideline (mandatory)

The PLUR code is **open source** and **may and must be copied**. Do not reinvent:

- Copy the `inputSchema`s, the descriptions, the validation rules and the behaviour of each tool from the `@plur-ai/mcp` package (local cache at `/home/gandb/.npm/_npx/386f78daf917651f/node_modules/@plur-ai/mcp/dist/chunk-UINIIUBY.js`, function `getAllToolDefinitions()`).
- Change **only what needs it**: the backend name (the core-brain `store.ts` engine instead of `plur.learnRouted`), the store path (`~/.core-brain` stays), and anything specific to per-agent isolation (`core_memory` stays as the compat layer, see §5).
- If a piece of PLUR solves the problem, the core-brain fix USES that piece. Diverge only with a justification written in this file.

## 2. Files (source → destination)

| Source (PLUR, read-only) | Destination (core-brain, edit) | What to copy |
|---|---|---|
| `.../@plur-ai/mcp/dist/chunk-UINIIUBY.js` — `getAllToolDefinitions()`, `validateToolArgs`, `buildAdminDispatchTool` | `/home/gandb/.config/opencode/plugins/core-brain/mcp/server.js` — array `TOOLS` + `callTool()` | the 45 definitions {name, description, inputSchema, annotations} + dispatcher + -32602 validation |
| `.../@plur-ai/core/dist/` — `learnRouted`, `recall`, `inject(Hybrid)`, `nearDuplicates`, `pinnedQuota`, session/scope/stores/packs/timeline | `/home/gandb/.config/opencode/plugins/core-brain/store.ts` + `types.ts` | the semantics of each operation, mapped onto the core-brain store (same fields: statement, scope, domain, tags, rationale, session_id, etc.) |
| — | `/home/gandb/.config/opencode/plugins/core-brain/index.ts` (`core_memory`) | KEPT as compat: `store({text})` becomes an alias of `learn({statement: text})`; `recall`/`forget`/`feedback`/`who` delegate (see §5) |
| `.../@plur-ai/mcp/dist/tools-export.js` — `getToolSchemas(profile)` | `server.js` — `tools/list` per profile (`lean`/`full`) | same partitioning: 14 direct + the rest via `core_admin` (which now accepts any action, like `plur_admin`) |

## 3. Current gap (why they are not equal)

- core-brain has 5 tools (`core_recall` global-only without `from`, `core_status`, `core_doctor`, `core_receipt`, `core_admin` with 5 actions). PLUR has 45.
- Write: core-brain `store({text!})` × PLUR `learn({statement! + ~20 fields})`.
- Read: core-brain without `mode/scope/domain/session/budget`; no `inject`; no session (`session_start/scope/end`).
- Everything else (packs, sync, scopes, stores, tensions, provenance, timeline, pins, supersedes, validities, reranker, outbox, report_failure, ingest, profile) does not exist in core-brain.

## 4. What to change (scope of the fix)

1. `server.js`: replace `TOOLS` (5) with the 45 definitions copied from PLUR; `callTool()` validates with the same `validateToolArgs` and returns the same envelope; `tools/list` honours `CORE_BRAIN_TOOL_PROFILE` (lean/full) just like `PLUR_TOOL_PROFILE`.
2. `core_admin` becomes the general gateway (a mirror of `plur_admin`): `{action, args}` with the same validation/result; destructive only direct (same rule as PLUR).
3. `store.ts`/`types.ts`: implement the copied semantics (scopes, sessions, episodes, packs, sync/outbox, tensions, provenance, pins, supersedes, `valid_from/until`, `measured_under`, `attribution`, `claim_class`, `license`, `visibility`).
4. `index.ts`: `core_memory` keeps existing as a thin alias (no logic of its own).
5. Names: by default keep the `plur_*` names side by side with `core_*` aliases (or rename everything to `core_*` with a reverse alias) — ONE decision, documented here before coding, applying to all 45.

## 5. Deliverables — one test per signature (all must pass)

Each item is an executable test against the running `core-brain` MCP (same runner on both sides). Format: `Tnn — <tool> — what it proves`.

**Write:**
- T01 — `learn` — writes the minimal `{statement}` and returns an id; `text` is rejected as in PLUR.
- T02 — `learn` full — all optional fields accepted and persisted (type/scope/domain/tags/rationale/source/pinned/commitment/valid_from/valid_until/supersedes/session_id/measured_under/attribution/claim_class/license/visibility).
- T03 — `learn_batch` — a batch writes N and returns N ids.
- T04 — `ingest` — imports text and generates engrams.
- T05 — `capture` — attaches an episode to the timeline.
- T06 — `episode_to_engram` — promotes an episode to an engram.

**Read/injection:**
- T07 — `recall` — hybrid `{query!}` returns what T01 wrote; `mode: keyword` works without embeddings.
- T08 — `recall_hybrid` — the deprecated alias answers the same as T07 + deprecated flag.
- T09 — `inject` — `{task!}` returns directives/consider/count/tokens_used/injected_ids within the budget.
- T10 — `inject_hybrid` — same as T09 with `mode: hybrid`.
- T11 — `similarity_search` — similarity search returns T01's neighbour.
- T12 — `history` — retrieval events appear.
- T13 — `timeline` — T05's episodes listed.
- T14 — `provenance` — by id and by search term; `not_recorded` reported as in PLUR.
- T15 — `meta_engrams` — meta-engrams listed.

**Sessions:**
- T16 — `session_start` — opens a session and returns the id.
- T17 — `session_scope` — changes the default scope mid-session.
- T18 — `session_end` — closes and extracts learnings.
- T19 — `learn` with T16's `session_id` honours the session's default scope.
- T20 — `recall` with `session_id` uses the session's remote context.

**Health/counters:**
- T21 — `status` — `{domain?, created_after?}`; engram/episode/pack counts + storage_root.
- T22 — `doctor` — `{retry?, rerank_eval?}`; store/embedder/hybrid checks as in PLUR.
- T23 — `receipt` — `{days?}`; same fields (stored/retrieved/top/dormant/coverage).

**Feedback/maintenance:**
- T24 — `feedback` — single `{id, signal}` and batch `{signals[]}` train relevance.
- T25 — `pin` — pin/unpin/list respecting the quota.
- T26 — `forget` — retires by id and by term (without deleting history).
- T27 — `rescope` — moves an engram's scope.
- T28 — `promote` — promotes scope/visibility.
- T29 — `tensions` — detects a contradiction between two opposing engrams (and skips `supersedes` pairs).
- T30 — `tensions_purge` — clears false positives.
- T31 — `validate_meta` — validates metadata.
- T32 — `extract_meta` — meta-engrams pipeline.

**Packs:**
- T33 — `packs_list` — lists packs.
- T34 — `packs_discover` — discovers packs.
- T35 — `packs_preview` — preview before installing.
- T36 — `packs_install` / T37 — `packs_export` / T38 — `packs_uninstall` — full cycle with T02's `visibility: public` engram.

**Sync/scopes/stores:**
- T39 — `sync` + T40 — `sync_status` + T41 — `outbox` — queue and delivery.
- T42 — `stores_add` + T43 — `stores_list`.
- T44 — `scopes_discover` + T45 — `suggest_scope`.
- T46 — `report_failure` — records a failure.
- T47 — `profile` — correct lean/full profile.

**Gateway:**
- T48 — `admin {action: recall, args}` — same result as the direct call.
- T49 — `admin {action: help}` — lists the 45 with description + args_schema.
- T50 — `admin` refuses a destructive (e.g. `tensions_purge`) with the same message as PLUR.

**Legacy core-brain compatibility (must not break):**
- C01 — `core_recall` keeps answering (alias of the new recall restricted to global).
- C02 — `core_status` / C03 — `core_doctor` / C04 — `core_receipt` answer as before.
- C05 — `core_memory store({text})` is equivalent to `learn({statement: text})`; `recall/forget/feedback/who` delegate.
- C06 — `core_admin {action: purge|reindex|export|import|compact}` keeps working.

**End to end:**
- E01 — the parity script runs the same battery against `plur` and against `core-brain` and the diff is empty (same tools, same schemas, same results for T01–T50).

**Ready =** T01–T50 + C01–C06 + E01 green, with no `verified by reading`: each one with its executed command and digest attached.
