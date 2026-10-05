# ADR 0004 — core-brain: the store default moves to `~/.config/core-brain/`

- **Status:** Accepted
- **Date:** 2026-10-04
- **Deciders:** USER (decision, 2026-10-04), ORACLE (design and verification)
- **Supersedes (data root only):** ADR 0001 §D7 — the data-root path only; every other rule of ADR 0001 stands
- **Delivery:** `global/opencode/plugins/core-brain/index.ts`, `store.ts`, `engine/embedder.ts`, `install-runtime.sh`, `prune-runtime.sh`; live docs `README.md`, `INSTALACAO.md`, `test/CONTRACT.md`, `TASKS.md`

## Context

ADR 0001 §D7 put the store in the **user-profile** directory `~/.core-brain/` — records and
vectors at the root, engine runtime under `runtime/`, model weights under `models/` — overridable
with `CORE_BRAIN_HOME`. The root was chosen **cwd-independent** so every project on the machine
shares one memory store, and nothing is written into a project tree.

On 2026-10-04 the USER decided the store should instead live under the OpenCode **config**
directory: `~/.config/core-brain/`. It stays a single, cwd-independent, per-user store; it simply
moves beside the rest of the user's OpenCode configuration.

The store is real, already-live data (3213 files, ~902 MB), so the change is split deliberately:
the data is copied and verified first, the code defaults and the live documentation are updated,
and the old directory is left in place until activation.

## Decision

The core-brain store default moves from `~/.core-brain/` to `~/.config/core-brain/`:

- data root `~/.config/core-brain/`
- engine runtime `~/.config/core-brain/runtime`
- model weights `~/.config/core-brain/models`
- policy file `~/.config/core-brain/config.json`

The environment-variable names (`CORE_BRAIN_HOME`, `CORE_BRAIN_RUNTIME_DIR`,
`CORE_BRAIN_MODELS_DIR` / alias `CORE_BRAIN_MODELS`) and their precedence are **unchanged**; only
the built-in default changes.

### D1 — Why the store moves under the config directory

**Decision.** The default data root becomes `~/.config/core-brain/`.

**Why.** The USER wants the store under the OpenCode config directory. It remains a single,
cwd-independent, per-user store shared by every project — the property ADR 0001 §D7 was protecting
is preserved; only its location changes.

**Cost.** The override env vars still exist for tests and throwaway runs, so scripts that pin
`CORE_BRAIN_HOME` explicitly are unaffected; anything relying on the bare default now must read the
new path.

### D2 — What changed

**Code defaults** (`global/opencode/plugins/core-brain/`):

- `index.ts` — `DEFAULT_DATA_DIR_NAME` → `.config/core-brain` (resolved with `path.join(os.homedir(), …)`), plus the resolver comment.
- `store.ts` — the `resolveDataRoot()` fallback → `join(homedir(), ".config", "core-brain")`, the config-file candidate `<home>/.config/core-brain/config.json`, and the precedence comment.
- `engine/embedder.ts` — `resolveRuntimeDir()` → `join(homedir(), ".config", "core-brain", "runtime")`; `resolveModelsDir()` → `join(homedir(), ".config", "core-brain", "models")`; the related comments and the runtime error message.

**Scripts:**

- `install-runtime.sh` — destination default (and the help/comment lines) → the new runtime root.
- `prune-runtime.sh` — source default (and the comment) → the new runtime root.

**Live docs:** `README.md`, `INSTALACAO.md`, `test/CONTRACT.md` (the `createEngine` `home` default line) and `TASKS.md` (the persistence and runtime lines) now read the new path. This ADR records the decision; ADR 0001 keeps the history and carries a `Superseded by ADR 0004` pointer for the data root only.

**Deliberately NOT changed:** the memo file name `.core-brain-model.json` (a file name, not a path), the backup-mirror directory name `bkps/.core-brain/` (a distinct git backup mirror), and the MCP server id `core-brain`.

### D3 — The data move (executed and verified)

The existing store was copied `~/.core-brain/` → `~/.config/core-brain/` and verified: **`diff -r`
= 0 differences over 3213 files**, with **identical MD5 on the 22 store files** (the
`agents/`+`vectors/`+`global/`+`config.json` payload).

### D4 — Status: not active yet (honest state)

The `CORE_BRAIN_HOME` entry installed in the running `opencode.json` still points at
`/home/gandb/.core-brain`. The running MCP therefore keeps reading and writing the **old** store
until the USER updates that entry and restarts OpenCode. **Until then, the old directory is NOT
deleted.** The new default is exercised by the code and the suites, but is not yet the store the
live service uses.

### D5 — Supersedes the ADR 0001 data-root decision

This ADR supersedes **ADR 0001 §D7** for the data root (the path) only. Every other decision of
ADR 0001 (and the default-policy reversal of ADR 0003) stands.

## Acceptance evidence (measured 2026-10-04)

- **Code defaults** (ORACLE-verified with a clean env): without override, `createEngine({})`
  resolves `dataDir = <HOME>/.config/core-brain`; `resolveRuntimeDir()` / `resolveModelsDir()`
  resolve `<HOME>/.config/core-brain/runtime` and `<HOME>/.config/core-brain/models`; with
  `CORE_BRAIN_RUNTIME_DIR` / `CORE_BRAIN_MODELS_DIR` set, the env values still win (precedence
  intact).
- **Suites re-run, exit 0:** `check.sh` → matrix **13/13** + timeline **8/8**; `mcp/check.sh` →
  Layer-A **19/19** + Layer-B **27/27**.
- **Scripts:** `bash -n` clean on `install-runtime.sh` and `prune-runtime.sh`; their defaults print
  the new runtime path.
- **Data:** `diff -r` = 0 differences over 3213 files; identical MD5 on the 22 store files.
- **Docs:** the live docs have **no** remaining `~/.core-brain` store reference.

## Consequences — open risks / follow-ups

1. **Activation pending (D4).** Until the installed `CORE_BRAIN_HOME` in `opencode.json` is updated
   and OpenCode restarted, the running service still uses `~/.core-brain/`. The old directory must
   **not** be deleted before activation.
2. **Divergence window.** If a session resolves the new default while the live MCP still uses the
   old directory, the two roots diverge; the activation step is the single action that closes the
   window.
3. **Supersede is narrow (D5).** Only the ADR 0001 §D7 path is superseded — the isolation rules,
   the default-policy reversal (ADR 0003) and the access matrix are untouched.

## Alternatives considered

- **Keep `~/.core-brain/`** — rejected: the USER decided the store belongs under the config
  directory.
- **Delete the old directory now** — rejected: the running MCP still points there; deleting it
  would recreate it on the next write and diverge from the new store.
- **Rename the env vars / the memo file** — rejected: the env contract is public and stable, and
  `.core-brain-model.json` is a file name, not a path.
