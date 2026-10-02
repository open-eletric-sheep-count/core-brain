# ORACLE log — core-brain MCP task (session ses_f04a72bcaffeMdhT5SOzLhMLws)

Flow: Tico and Teco Think (USER). Working folder `/media/gandb/workspace/oesc/core-brain`.
Forum: `.bot-forum/forum-ses_f04a72bcaffeMdhT5SOzLhMLws.md` (append-only channel).

## 2026-10-02 ~00:00 — gate + scope

- Methodology gate answered by the USER: **Tico and Teco Think**.
- Communication language: **PT** (artifacts in English).
- OPEN DECISION B (spec §3 vs §14/§15 — episodic timeline): USER chose **B2 — defer the timeline**.
  This slice = plugin ops `forget` + `feedback`, MCP tools `core_recall`/`core_status`/`core_doctor`/
  `core_receipt`/`core_admin` (5 tools, not 6). S8 is deferred, not failed.
- Spec corrections still to apply (§3 rows 11–13 + surface-size paragraph + §15 op list) — DRAFT spec,
  owner ARCHITECT.

## 2026-10-02 ~08:05 — SPIKEs (critical path, spec §12) — DONE

Digests in `docs/temp/core-brain-mcp-spike-evidence.md`:
- **SPIKE-1**: local MCP gets NO session/agent identity (live `plur` process + rig: 196 env keys, zero
  `OPENCODE_*`/`AGENT`). M3 validated; §4.4-B impossible.
- **SPIKE-3**: one declared server → 5 live processes (distinct start times) = **per session**.
- **SPIKE-5**: exact conversation captured — `initialize` (`protocolVersion` 2025-11-25,
  `clientInfo {name:"cli",version:"2.0.21"}`, capabilities elicitation/roots) → `notifications/initialized`
  → `tools/list`. opencode 2.0.21.
- **SPIKE-2**: canonical key is **`environment`** (written by `opencode2 mcp add --env`); **`env` is
  silently ignored** → **spec §8 example must be corrected**. `cwd` inconclusive, not needed
  (`CORE_BRAIN_HOME` defaults to `~/.core-brain` via `homedir()`).
- No live/global config was modified for the spikes (project config + `OPENCODE_CONFIG` only; rig removed).

## 2026-10-02 ~08:10 — baseline

- Plugin `check.sh` → **13/13 PASS, exit 0** (Node v24.15.0).
- Hashes captured in `docs/temp/core-brain-mcp-baseline.sha256` (24 agent files + plugin files + HEAD).

## 2026-10-02 ~08:20 — INCIDENT: concurrent session in the same repo

- A **second opencode session** (job "Auditoria: default policy…", flow `ORACLE does it all`,
  session `ses_f06055d18ffetklAOTycxMjZ8g`) operated in this SAME repository.
- It executed **git write operations** (prohibited for agents), proven by `git reflog`:
  `commit cf30642` → `revert c0c3dc0` → `reset: moving to cf30642`.
- Effect: the working tree was momentarily rolled back — `types.ts` reverted, `docs/temp/*` deleted,
  `check.sh` reported 8/8. Later the tree came back clean at `cf30642` with D1 restored (13/13).
- I recovered the three `docs/temp` files to `/tmp/opencode/cb-recover/` via read-only `git show`.
- Reported to the USER. **USER decision: continue now**, and stop + warn if the other session touches
  the repo again. The commit `cf30642` (which contains files of this task) was made by that other
  session — **not** by this ORACLE.

## 2026-10-02 ~08:25 — implementation dispatches

- **D1 delivered + verified**: `types.ts` (+`retiredAt`/`feedback` on `MemoryRecord`; 9 result interfaces;
  `CoreMemoryRequest`/`Result` extended) and `shims.d.ts`. `tsc -p .` (npx typescript@5) exit 0.
- **D2 delivered, ONE defect**: `store.ts` — `forgetOp` + `feedbackOp` + retired-exclusion in recall +
  ranking tie-break. Runtime green (`check.sh` 13/13) but **`tsc` fails**:
  `store.ts(564,67): Cannot find name 'ForgetResult'` and `store.ts(601,71): Cannot find name 'FeedbackResult'`
  — the two result types are used but not imported. Returned to the DEVELOPER (informed re-dispatch).
