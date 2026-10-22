# Installation verification — 2026-10-22

The repository now uses `global/opencode` for its original suite and
`global/codex` for the working Codex memory and file-injection adaptations,
role prompts and helpers. All installation test
destinations and test memory stores were disposable; the existing user
configuration and production memory were not reinstalled.

| Executed check | Result |
|---|---|
| `python3 tests/test_install.py` with `OESC_TEST_RUNTIME` and `OESC_TEST_MODELS` | 17 scenarios passed, including the actual cached-model hook integration |
| `node --test tests/codex-context-inject.mjs` | Six contracts passed on Linux/WSL and again on native Windows Node |
| `node tests/codex-compaction.mjs` | 13 original adaptation contract scenarios passed |
| Fresh Windows Codex app-server with the newly installed temporary home | Started; installed WSL MCP connected and exposed `core_memory` |
| Memory calls through that real Codex process | `who`, store and semantic recall succeeded in the isolated store |
| Native skill discovery | All three newly installed project skill paths recognized |
| Native hook discovery | Four installed command definitions recognized; native trust review remained required |
| Installed role/helper files | 24 role prompts and seven helpers present in the temporary Codex home |
| Installed Windows memory hook command executed directly | Passed through Windows shell and WSL, learned the complete prompt and supplied recalled context |
| Installed Windows file-injection hook command executed directly | Startup and compaction each returned the complete installed project ORACLE through WSL |
| Installed OpenCode file injector | Loaded all three sibling HOWTOs at startup and compaction, using the original engine and a simulated host API |
| Original `context-inject/check.sh` | Module import and TypeScript check passed |
| Original `core-brain/check.sh` | 13 isolation rows, seven search probes, 11 automatic-layer checks and eight timeline checks passed; two original explicit skips |

The installer scenarios also verify no-write dry-run (including runtime
provisioning preview), existing settings/MCPs/hooks/identity permissions, backups,
idempotent reinstall, invalid-configuration preflight, the legacy `-s`/`-d`
interface, paths containing spaces and unchanged original engine bytes. Fresh
Codex profiles load the ORACLE supplied by full installation. Role upgrades back
up changed files and preserve unmanaged roles; OpenCode installs the documented
`agents/` directory alongside its legacy `agent/` copy. Global helpers match the
repository sources. Injector-only updates preserve existing role files and
custom file lists.

The fresh native test used Codex **0.163.0**, Windows Node **24.22.0** and WSL Node
**24.20.0**. It made no model turns and copied no credentials. Codex's optional
unauthenticated model-connection warmup is separate from the verified local MCP
tool calls. Embedding operations used the already cached real model and runtime.

The 13 adaptation scenarios exercise discarded/retained message reconstruction,
successive checkpoints, same-turn context deduplication, restart/resume delivery,
Windows extended transcript paths and rejected unsupported checkpoint shapes.
They use synthetic native transcripts, not a new model-driven compaction run.

The new hook definitions were not auto-approved or run by the native lifecycle
dispatcher in the disposable Codex profile. The direct hook command checks and
real-model installer scenario verify the command and original algorithm;
end-user activation still requires review in `/hooks`. A new OpenCode service or
interactive session, macOS installation and native Windows embedding runtime
were not exercised. The validated Windows runtime arrangement was WSL.

Successful test runs removed their temporary stores and no native-test Node
processes remained. Cleanup of one earlier failed-run directory was rejected by
the execution policy (`blocked by policy`); it was left in the source machine's
user Temp directory. It contains the disposable test installation, not copied
credentials or production memory.

## Reproduce

```bash
export OESC_TEST_RUNTIME=/absolute/path/to/core-brain/runtime
export OESC_TEST_MODELS=/absolute/path/to/core-brain/models
python3 tests/test_install.py
node tests/codex-compaction.mjs
node --test tests/codex-context-inject.mjs
```

For the actual Windows Codex + WSL check, use PowerShell with a real cached WSL
runtime and replace all example user paths:

```powershell
$env:OESC_WSL_DISTRO = 'Ubuntu'
$env:OESC_WSL_USER = 'YOUR_LINUX_USER'
$env:OESC_WSL_NODE = '/absolute/path/to/linux/node'
$env:OESC_TEST_RUNTIME = '/absolute/path/to/core-brain/runtime'
$env:OESC_TEST_MODELS = '/absolute/path/to/core-brain/models'
node tests/codex-native-install.mjs
```

Set `OESC_CODEX_EXE` if the Windows CLI is not at the test's default npm vendor
path. The test creates its own Codex home, project skills and memory store and
closes the app-server before cleanup. Model/runtime caches remain external.
