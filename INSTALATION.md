# Installation: OpenCode V2, Codex and other CLIs

Reference date: 2026-10-22. Run these commands from the repository root.
For guided installation, give an agent the prompt in [README.md](README.md#getting-started).

## 1. Choose the host

| Host | Source | Installed components |
|---|---|---|
| OpenCode V2 | `global/opencode` | Original plugins, agents, helpers and memory skills |
| Codex | `global/codex` | Original core-brain engine, MCP adapter, native hooks and three memory skills |
| Other CLI | Adapter required | Reuse the engine; map that host's MCP, instructions and lifecycle contracts |

`context-inject` is the current name of the former Taulukko file injector. The
public OpenCode defaults remain generic. Keep personal Taulukko overrides in
your own configuration source; this repository does not distribute personal
rules, credentials or live memory records.

## 2. Requirements and download

Install Git, Bash, Python **3.11+**, Node.js **24+** and npm. Install the chosen
CLI using its official instructions. The current OpenCode V2 website documents
`npm install -g @opencode/cli`; some older installations expose V2 as `opencode2`.
Confirm the actual executable and version before continuing. The Codex adapter
was originally validated against CLI **0.163.0**; native checkpoint formats and
hook support must be checked when using another version.

```bash
git clone https://github.com/open-eletric-sheep-count/core-brain.git
cd core-brain
bash install.sh --help
```

If a checkout already exists, inspect its branch and local changes and reuse it.
Do not discard changes to obtain a fresh copy.

## 3. Install OpenCode V2

```bash
bash install.sh --host opencode --dry-run
bash install.sh --host opencode --install-runtime
```

The default destination is `~/.config/opencode`. V2 discovers plugin packages
under `plugins/` and skills under `skills/`. Do not register the same package
again through an additional `plugins` configuration entry.

The installer also merges memory policy into `~/.config/core-brain/config.json`.
The `ORACLE` identity opts into the original automatic memory hooks by default;
choose other identities with repeated `--agent NAME` options. Existing identity
permissions are retained. File injection follows the original per-agent
configuration in `plugins/context-inject/config.json`; relative paths resolve
from that plugin directory. Install only references that exist on the target.
The included launch-ledger HOWTO describes a separate integration, whose backend
is not supplied by the memory or injector plugin.

Restart OpenCode V2, run `opencode plugin list` (or the verified V2 executable),
and open a new session. Verify the configured file injection, a controlled
memory store/recall, and reinjection after an actual compaction.

The existing Taulukko entry point continues to work and accepts either host:

```bash
bash global/opencode/install-global.sh
bash global/opencode/install-global.sh --host codex
```

### 3.1 Optional administration MCP

The OpenCode plugin supplies the session-scoped `core_memory` tool. Its separate
administration server is also copied, but is not registered automatically. If
you need `core_recall`, `core_status`, `core_doctor`, `core_receipt` and
`core_admin`, merge this entry into the existing OpenCode V2 configuration:

```json
{
  "mcp": {
    "servers": {
      "core-brain": {
        "type": "local",
        "command": ["/absolute/path/to/node", "/absolute/path/to/.config/opencode/plugins/core-brain/mcp/server.js"],
        "environment": {"CORE_BRAIN_HOME": "/absolute/path/to/.config/core-brain"}
      }
    }
  }
}
```

Use V2's `mcp.servers` and `environment` keys. Include custom runtime/model
environment values when applicable. Restart OpenCode and verify with
`opencode mcp list`. `core_recall` is a global administration view; agent-scoped
recall continues to use the plugin's `core_memory`. The Codex adapter registers
its own `core_memory` MCP and does not install this administration surface.

## 4. Install Codex on Linux, macOS or native Windows

On Linux or macOS:

```bash
bash install.sh --host codex --dry-run
bash install.sh --host codex --install-runtime
```

The installer copies `global/codex/adapters/core-brain` into
`${CODEX_HOME:-~/.codex}/adapters/core-brain`, copies the three memory skill
directories into `~/.agents/skills`, merges only the `core-brain` MCP section in
`config.toml`, and merges `SessionStart` and `UserPromptSubmit` in `hooks.json`.
Other MCPs, hooks, settings and memory identities are preserved. Existing
`codex` permissions are retained and its `inject` flag is enabled. All Codex
roles use this fixed identity; there is no per-role private isolation.

`runtime-config.json` in the installed adapter contains the selected memory,
runtime and model paths. `launch.mjs` supplies these same values to both the MCP
and hooks, then starts the unchanged original adapter entry point. Installation
does not rely on an MCP environment table configuring independent hook processes.

On native Windows, the Python entry point works without Bash for the file and
configuration installation:

```powershell
python scripts/install_global.py --host codex --dry-run
python scripts/install_global.py --host codex
```

Resolve a real Python 3.11+ executable if `python` is a Windows Store alias. Use
a matching native Windows Node/runtime/model installation. Provisioning with
`--install-runtime` requires Bash and npm; the Windows-with-WSL arrangement below
is also supported and is the arrangement exercised on the source machine.

### 4.1 Windows Codex with a WSL runtime

Run the installer **inside the selected WSL distribution as the selected user**.
Point it to the Windows Codex configuration and Windows user skills directories.
For example, customize every user and profile path in this example:

```bash
cd /mnt/s/core-brain
bash install.sh --host codex \
  --target /mnt/c/Users/YOUR_WINDOWS_USER/.codex \
  --skills-dir /mnt/c/Users/YOUR_WINDOWS_USER/.agents/skills \
  --memory-home /home/YOUR_LINUX_USER/.config/core-brain \
  --wsl-distro Ubuntu --wsl-user YOUR_LINUX_USER \
  --install-runtime
```

Add `--dry-run` to preview first. The installer registers `wsl.exe` with separate
arguments, the detected Linux Node executable, explicit Linux environment values
and the installed adapter path as visible from WSL. The adapter may execute from
the Windows-mounted directory; a second WSL copy is not required. MCP and hooks
share the chosen existing Linux memory home. Another WSL distro, Linux user or
Windows profile requires adjusted paths and access.

Checkout locations vary by machine; `S:\core-brain` is only a source-machine
example, not an installer default. A WSL Codex client itself uses the normal
Linux installation without `--wsl-distro`.

### 4.2 Activate and verify

Restart Codex, open `/mcp` and confirm `core-brain` exposes `core_memory`. Open
`/hooks`, review the installed commands and trust the two handlers through the
native Codex flow. The installer does not alter trust records or bypass review.
Already disabled Codex hooks are reported before configuration is written.

Use a fresh session to store and recall an isolated test memory. Then verify
automatic prompt learning and an actual `/compact` continuation, including
restart/resume. Remove test records afterwards. File installation alone is not
proof that the model, hooks or the running session's tool catalog are working.

## 5. Options, runtime, updates and rollback

| Option | Meaning |
|---|---|
| `--host opencode\|codex` | Select installation; default `opencode` for existing callers |
| `-d, --target PATH` | Host configuration directory |
| `-s, --source PATH` | Override that host's source tree; retains the legacy overlay interface |
| `--memory-home PATH` | Live memory policy and records; defaults to `CORE_BRAIN_HOME` or `~/.config/core-brain` |
| `--skills-dir PATH` | Codex user skill directory; default `~/.agents/skills` |
| `--agent NAME` | OpenCode automatic-memory identity; repeatable; default `ORACLE` |
| `--node PATH` | Node executable for Codex; default resolved from `PATH` |
| `--runtime-dir PATH` | Runtime location; environment override or `<memory-home>/runtime` |
| `--models-dir PATH` | Model cache location; environment override or `<memory-home>/models` |
| `--install-runtime` | Run the original pinned npm runtime provisioning script |
| `--dry-run` | Validate and report the plan without installing files or runtime packages |

Without `--install-runtime`, an existing real runtime is required for embedding
operations. The runtime is `@huggingface/transformers@4.3.0`; the model is
`Xenova/bge-small-en-v1.5`. The first real embedding operation downloads model
weights; use `CORE_BRAIN_OFFLINE=1` only after caching them. There is no automatic
production fallback to a test embedder. Runtime packages, model weights and live
memory remain outside this Git checkout.

For OpenCode with custom memory/runtime/model paths, launch OpenCode with the
matching `CORE_BRAIN_HOME`, `CORE_BRAIN_RUNTIME_DIR` and `CORE_BRAIN_MODELS_DIR`
environment variables. The file installer does not change your shell profile or
the environment of an already running OpenCode process.

Re-run the same command to update. Identical files are left untouched. Every
changed existing file receives an adjacent `.oesc-backup-TIMESTAMP-ID` copy;
configuration is validated before writing. File-write errors restore the
previous written files; a separately requested npm runtime installation is not
part of that file transaction. Backups may contain your existing configuration;
keep them private. The installer preserves live records and does not uninstall
unrelated components or delete obsolete files automatically.

To roll back, close the host, restore the relevant backup files and remove only
new files belonging to this installation. Preserve the chosen memory home and
other user settings. Re-review changed native hooks when required by Codex.

## 6. Adapting another CLI

Use the README agent prompt and verify the target's current official contracts.
The required adaptation points are:

1. MCP stdio registration and tool naming. `codex-mcp.mjs` fixes identity to
   `codex`; a different identity needs an explicit host adapter and policy.
2. Startup/context and user-prompt lifecycle events, with that CLI's supported
   trusted hook mechanism. Map them to the original plugin callbacks.
3. Compaction: provide the actual discarded and retained textual message parts
   for the named session, then deliver recalled context through a supported
   instruction channel. Native summaries stay owned by the host.
4. Skill discovery, resource paths and always-loaded instructions. OpenCode's
   `context-inject` plugin is not a portable Codex or third-party plugin.
5. Shared memory/runtime/model paths, permissions, restart/resume behavior and
   concrete integration tests. Unsupported hooks or transcript formats must be
   reported as limitations rather than claimed to work.

Keep the original learning and retrieval logic unchanged: whole textual parts,
original cues, trimming, metadata, opt-in, recall-before-learning and duplicate
check. The Codex adapter delivers developer context instead of OpenCode's full
system array. Legacy checkpoints without `replacement_history` and histories
containing rollback still require host reconstruction. Automatic arbitrary file
injection and OpenCode per-role identity are not supplied by this Codex adapter.

## 7. Verification and references

| Symptom | Action |
|---|---|
| `ENGINE_UNAVAILABLE` | Provision the real runtime and verify the selected runtime/model paths |
| `STALE_INDEX` | Use the original administration `reindex` action for the named namespace; see the [plugin reference](global/opencode/plugins/core-brain/README.md) |
| Invalid public identity without global access | Correct the policy: `private:false` and `hasGlobalAccess:false` is an invalid combination |
| No automatic memory context | Check the identity's `inject` setting, actual host tool catalog and native hook review/state |
| Wrong data location | Compare the plugin/MCP/hook memory home and all runtime environment values |

```bash
python3 tests/test_install.py
node tests/codex-compaction.mjs
bash global/opencode/plugins/context-inject/check.sh
bash global/opencode/plugins/core-brain/check.sh
```

Set `OESC_TEST_RUNTIME` and `OESC_TEST_MODELS` to cached real directories to
include the installer suite's real-model hook integration. Otherwise that case
is explicitly skipped. Existing source suites distinguish fixtures, real-model
checks and their original unsupported cases. See [installation verification](docs/installation-verification.md)
for executed evidence and paths actually exercised.

- [OpenCode V2 installation](https://opencode.ai/v2/docs/)
- [OpenCode V2 plugins](https://opencode.ai/v2/docs/plugins/)
- [OpenCode V2 skills](https://opencode.ai/v2/docs/skills/)
- [OpenCode V2 MCP registration](https://opencode.ai/v2/docs/mcp-servers/)
- [Codex customization and MCP](https://learn.chatgpt.com/docs/customization/overview)
- [Codex skills](https://learn.chatgpt.com/docs/build-skills)
- [Codex native hooks and trust](https://learn.chatgpt.com/docs/hooks)
