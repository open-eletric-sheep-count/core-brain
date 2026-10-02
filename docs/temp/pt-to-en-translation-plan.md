# pt→en Translation — Plan & Acceptance (core-brain)

## Goal
Every in-scope file in this repo is in English. No pt-br prose remains in-scope.

## Scope (confirmed with USER 2026-10-02)
- IN: docs markdown, agent/helpers markdown, plugin `*.md`, shell-script comments + user-facing messages, code comments, `package.json` `description`, and the TUI label `Todos`→`All`.
- OUT (preserve verbatim):
  - evidence fixtures: `docs/temp/agents-before.txt`, `agents-after.txt`, `agent-ids-before.txt`, `plugins-before.txt`, `core-brain-mcp-baseline.sha256`
  - `.bot-forum/*` artifacts
  - file/identifier names
  - deliberately-quoted PT examples: `Outro`/`Nenhuma delas`/`Outro ajuste` counter-examples (ORACLE.md) and the quoted USER triggers in `core-brain-mcp.md` / `core-brain-migration-plan.md`.

## Traps
- `tui.tsx`: header already EN; translate only the two `0.2.1` comment blocks + `Todos (n)` → `All (n)`.
- `ORACLE.md`: keep the quoted PT counter-example labels.
- specs `core-brain-mcp.md` / `core-brain-migration-plan.md`: keep the quoted USER trigger in PT.
- `package.json`: translate `description` only, never `name`.
- scripts: keep all bash logic identical; translate comments + echo strings only.

## Acceptance criteria
1. Broad pt scan (accent set + wide word net) returns ZERO hits across in-scope files.
2. Each in-scope file read-verified: no pt-br prose remains.
3. Preserved items unchanged (fixtures byte-identical; quoted examples intact).
4. Integrity: `bash -n` clean on all `.sh`; JSON parse clean on all `package.json`; tsx/ts logic unchanged.

## Verification method
- re-run the broad `rg` scan on the in-scope set
- read-verify changed code files + a sample of docs
- `bash -n`, `node`/`jq` JSON checks
- `git status` (read-only) to confirm only intended files changed
