# core-brain — Deliverables & the complete PLUR → core-brain migration

- **Status:** DRAFT for USER review — a plan, nothing implemented.
- **Date:** 2026-10-01
- **Author:** ORACLE (flow: `ORACLE does it all`)
- **Repo:** `oesc/core-brain` — file at `docs/specs/core-brain-migration-plan.md`
- **Governed by:** `docs/specs/core-brain-v2.md` (the engine + the timeline), `docs/specs/core-brain-mcp.md` (the surface), `docs/specs/core-brain-plugin.md` (the delivered v0.1.0), `docs/adr/0001-core-brain-memory-isolation.md`.
- **Trigger:** USER, 2026-10-01 — *"gere pra mim uma lista de entregáveis, incluindo a migração completa do PLUR pro core-brain."*

---

## 0. Baseline — measured 2026-10-01, on this machine

| | PLUR (live) | core-brain (installed) |
|---|---|---|
| Memory | **1028 engrams** (`~/.plur/engrams.yaml`) | 2 test namespaces (`CB_BETA`, `CB_GAMMA`) |
| Episodes | **34** (`episodes.yaml`; 2 carry an agent) | — (no episode concept) |
| Packs | **0** | — |
| Store size | 2,9 MB (mirrored) / 4,1 MB embeddings cache | 64 KB (mirrored) |
| Runtime deps | ≈ **921 MB** on disk | **0** (the engine is a stub) |
| MCP | `plur` — connected | — |
| Plugin | `plur-memory` — loaded, injecting | `core-brain` — loaded, **refusing every real agent** |
| Real-agent config | store-level trust (`plur.yaml`) | **absent** — `~/.core-brain/config.json` does not exist |
| Git | backup mirrored (`bkps/.plur`) | backup mirrored (`bkps/.core-brain`) since today |
| Commits | — | **zero** (USER instruction) |

**The one sentence that defines the work:** today core-brain can isolate but cannot *understand*; PLUR can understand but cannot *isolate*. The plan below closes both, in that order.

---

## 1. Decisions that block the start

| id | Decision | Why it blocks | How it closes |
|---|---|---|---|
| **B1** | Default embedding model | the engine cannot be written without it | measure the PLUR candidates (dimension, download size, latency) and pick one |
| **B2** | Depend on `@plur-ai/core@0.20.1` **or** vendor its source | decides the repo layout and the licence work | decide with B3's numbers in hand |
| **B3** | How much of the ≈ 921 MB is actually reachable | R7 demands a measured, bounded cost | trim (`onnxruntime-web`, `@img/sharp`) and measure |
| **B4** | Offline/test strategy | the isolation tests must stay reproducible | pin a small model **or** commit a vector fixture for the test path |
| **B5** | Which real agents enter core-brain, and with what policy (`private` / `hasGlobalAccess`) | with no `config.json`, **every** real agent is refused | produce `~/.core-brain/config.json` |

---

## 2. Slice 1 — the engine (`core-brain-v2.md`)

| id | Deliverable | Where | Proof |
|---|---|---|---|
| **E1** | Real embeddings (the same model family as PLUR) | `store.ts` + deps | a semantic probe with **no shared words** returns the right record |
| **E2** | Hybrid retrieval: keyword (BM25) + vector, fused (RRF), over the permitted namespaces only | `store.ts` | a keyword-only and a vector-only match both surface; the fused order matches RRF |
| **E3** | Reranker (PLUR's cross-encoder), configurable | `store.ts` | order changes when on, not when off |
| **E4** | Model weights in a shared cache, never inside the plugin tree | `~/.core-brain/models` | a second install duplicates no weights |
| **E5** | Index stamped `embedder` + `dim` + revision; **refuse** a stale index; `reindex` | `store.ts`, `core_admin` | the 256-dim index is refused with the reindex message; reindex is idempotent |
| **E6** | Apache-2.0 compliance for every copied file | `LICENSE`, `NOTICE`, per-file headers, `README.md` | `grep` shows the provenance; README declares the mixed licence |
| **E7** | The isolation proof survives the engine | `check.sh` | **8/8, exit 0**, with the real embedder |
| **E8** | The measured cost, written down | `README.md` | the trimmed closure's size, measured |

---

## 3. Slice 2 — the automatic layer (G2) — *the one that makes the swap safe*

Without this, an agent that switches **silently stops receiving memory**. It is the reason the swap cannot be done on the engine alone.

| id | Deliverable | Proof |
|---|---|---|
| **A1** | `context` hook: render the memory block into the outgoing `system[]` (opt-in per agent — **switched ON at the swap**) | a live session shows the block; an unlisted agent shows nothing |
| **A2** | `prompt` hook: recall once per user turn + learn from the user's own text | a token taught in one turn is recalled in the next session |
| **A3** | `compaction` hook: carry memory across the cut, learn from what is dropped | a fact stated before a compaction survives it |
| **A4** | Session-closing ritual (extract learnings → memory, and the episode) | a session ends and both a memory and an episode appear |

---

## 4. Slice 3 — the episodic timeline (`core-brain-v2.md` §12)

| id | Deliverable | Proof |
|---|---|---|
| **T1** | `Episode` object + per-namespace storage (`agents/<A>/episodes.json`, `global/episodes.json`) | AC-TL1 |
| **T2** | Ops `episode` / `timeline` / `promote` on the same `core_memory` tool | AC-TL1/AC-TL5 |
| **T3** | Timeline searchable **by meaning** (the v2 engine) | AC-TL4 — *"SGLang"* finds the `timeout 9999` episode |
| **T4** | Migration of the 34, idempotent, owners preserved (no owner → `global`) | AC-TL3 |
| **T5** | The diary obeys the **same** isolation matrix as memories | AC-TL2 |

---

## 5. Slice 4 — the surface (plugin + MCP)

| id | Deliverable | Proof |
|---|---|---|
| **S1** | `core_memory` gains `forget` (soft retire) and `feedback` (ranking signal) | AC4/AC5 of `core-brain-mcp.md` |
| **S2** | The MCP server: stdio, **zero runtime deps**, tools `core_recall`/`status`/`doctor`/`receipt`/`timeline`/`admin` | `opencode2 mcp list` shows `core-brain` connected |
| **S3** | Spikes 1–5 measured (env of a local MCP, `env`/`cwd` support, spawn unit, per-agent tool scoping, minimum JSON-RPC) | recorded digests |
| **S4** | `README.md` + `INSTALACAO.md` for the MCP; `CHANGELOG.md` entry | documents exist and are consistent with the code |
| **S5** | `core_admin` `import`/`export`/`reindex`/`purge`/`compact` | AC6's `doctor` checks + an import round-trip |

---

## 6. The complete migration — the swap, step by step

Order is binding: each step names its **proof** and its **rollback**. Nothing is deleted before it is proven.

| id | Step | Proof | Rollback |
|---|---|---|---|
| **M1** | **Create `~/.core-brain/config.json`** with the real agents and their policy (closes B5) | `core_memory who` answers for each agent; an unlisted one is still refused | delete the file → back to fail-closed |
| **M2** | **Import the memory**: 1028 engrams → their namespaces; 34 episodes → §12 namespaces (`core_admin import`); reindex | counts before/after; a re-run changes nothing (idempotent) | the import writes new files; `~/.plur` is untouched |
| **M3** | **Verify the imported memory**: count parity, a random read-back sample, and one semantic probe per namespace | the sample matches `engrams.yaml` verbatim; the probe passes | — |
| **M4** | **Coexistence window**: PLUR keeps running (plugin + MCP); both stores stay mirrored in `bkps/` | `opencode2 mcp list` shows both; both backups advance | nothing to roll back |
| **M5** | **Switch the injection ON** for the real agents (A1) — this is the moment the swap becomes visible | a fresh session shows the memory block sourced from `~/.core-brain` | turn A1 off → back to the old behaviour |
| **M6** | **Add `mcp.servers.core-brain`** to `opencode.json` (mirror updated by the USER) | `core-brain` connected next to `plur` | remove the entry |
| **M7** | **Rewrite `AGENTS.md` rule 8b** (`plur_learn`/`plur_recall`/`plur_session_*` → their core-brain counterparts) — **requires explicit USER OK; the mirror is the USER's** | the rule names tools that exist | restore the previous text |
| **M8** | **A/B verification window**: the same prompt on both systems; record what each recalls about the same subject | both transcripts, side by side, with the recalled items named | extend the window |
| **M9** | **Switch PLUR off**: remove `mcp.servers.plur` and `plugins/plur-memory`; stop its server (`~/.plur/server.pid`) | `mcp list` without `plur`; the core-brain path still answers | re-add the two entries |
| **M10** | **Freeze `~/.plur/` as an archive — do NOT delete it**; the backup keeps mirroring it | the store is intact and mirrored after N weeks | restore from `bkps/.plur` |
| **M11** | **Only after M10's window**: drop the PLUR mirror from `install-global.sh` and remove `bkps/.plur` | the script mirrors only core-brain | re-add the call (one line — the function is generic) |
| **M12** | **Close**: `CHANGELOG.md`, `TASKS.md`, and a written declaration of what was **not** migrated | the documents exist; §8 below is quoted in the closing entry | — |

**Hard rules carried through the swap**

- No commit to this repo (USER instruction, 2026-09-30).
- Nothing under `~/.config/opencode/` is written by an agent — the mirror is the USER's (`./src/install-global.sh`).
- `~/.plur/` is never deleted by a step of this plan.
- Every step that writes memory is **idempotent** or has a named rollback.

---

## 7. Proof & closing — the USER's own first five minutes

A green suite is not acceptance. Before the swap is called done, these three are demonstrated in the running product:

- **P1 — teach and recall.** In one session, teach something ("lembra-te que o servidor X usa a porta Y"). In a **new** session, ask for it without naming it. It must come back.
- **P2 — count parity.** 1028 engrams before → at least 1028 after; 34 episodes before → 34 after; nothing silently dropped.
- **P3 — the honest gap list.** Everything not migrated is named out loud (§8), not discovered later.

---

## 8. Not in this plan (declared, so nobody promises them by accident)

PLUR packs · `sync`/`outbox`/remote stores · scopes/provenance/profiles · tensions · `report_failure` (procedure evolution) · meta-engrams · the cognitive profile · a published npm package.

They are **not** blockers: measured today, the install has **0 packs**, and none of these is used by any flow. They can be sliced later on request.

---

## 9. What already exists (so the plan starts from facts)

- `global/opencode/plugins/core-brain/` — the plugin v0.1.0 (isolation matrix proven, `check.sh` 8/8).
- `docs/specs/core-brain-plugin.md`, `docs/specs/core-brain-mcp.md`, `docs/specs/core-brain-v2.md`, `docs/adr/0001-core-brain-memory-isolation.md`.
- Four requirement changes already accepted: real engine (v2 §0), timeline first-class (v2 §12), one-tool identity rule (MCP §4), two-host surface (MCP §3).
- `project-generator/src/install-global.sh` — now mirrors **both** stores (`bkps/.plur` + `bkps/.core-brain`), so the transition cannot lose either.
