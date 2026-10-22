# context-inject for Codex

Native Codex hooks deliver the OESC file injector as additional developer
context. No new MCP, service, npm dependency or model call is required. Node.js
24+ runs the original TypeScript engine directly.

`index.ts` and `LICENSE` are byte-for-byte copies from
`global/opencode/plugins/context-inject`. `codex-hook.mjs` only translates the
native lifecycle and transports the engine's output. Original file loading,
ALL-first ordering, resolved-path deduplication, per-agent lists, logging,
missing-file handling and whitespace behavior remain in the original engine.
There are no added filters, summaries or content limits. The handler sets
`additionalContextLimit: 0` so Codex receives the full block.

## Install

From the repository root, install just this component:

```bash
bash install.sh --host codex --context-inject-only --dry-run
bash install.sh --host codex --context-inject-only
```

The normal `--host codex` suite installation also includes it. Existing MCPs,
memory, other hooks and customized injector configuration are preserved by
`--context-inject-only`. The suite installer retains its existing behavior.

For Windows Codex with a WSL Node runtime, run inside WSL:

```bash
bash install.sh --host codex --context-inject-only \
  --target /mnt/c/Users/YOUR_WINDOWS_USER/.codex \
  --node /absolute/path/to/linux/node \
  --wsl-distro Ubuntu --wsl-user YOUR_LINUX_USER
```

Restart Codex, then review the installed commands through `/hooks`. Installation
does not write trust records or bypass native hook review. Existing running
sessions may require restart before the new definitions are discovered.

## File configuration

The installed directory is `${CODEX_HOME:-~/.codex}/adapters/context-inject`.
Its `config.json` uses the original configuration shape. Relative file entries
resolve from that adapter directory, independently of the current workspace.
Absolute entries are also supported. An optional command-line argument selects
another JSON configuration file; relative entries still resolve from the adapter.

The default `codex` lists contain `../../roles/ORACLE.md`, resolving to the
existing `ORACLE.md` under the selected Codex home's `roles` directory. This
does not distribute or overwrite personal ORACLE instructions. Install or
configure that file separately if the home does not already contain it.

## Lifecycle compatibility

| Codex event | Original injector selection |
|---|---|
| `SessionStart`, source `startup` or `clear` | `codex` + `ALL`, `session.created` |
| `SessionStart`, source `compact` | `codex` + `ALL`, `session.compacted` |
| `SessionStart`, source `resume` or `fork` | No creation replay |
| `SubagentStart` | Native `agent_type` + `ALL`, `session.created` |

Compatibility differences are explicit: Codex owns lifecycle admission rather
than exposing OpenCode's durable session-info API. Root creation injects at
native session start, before the first model request; compaction injects before
the immediate continuation, including mid-turn automatic compaction, rather
than waiting for another user prompt. This adapter does not parse unstable
transcript formats or emulate recovery of an undelivered OpenCode compaction
window after an interrupted process. Resume/fork retain history and do not
replay creation files. The runtime does not provide a corresponding native
post-compaction `SessionStart` for subagents; this adapter does not claim child
compaction reinjection. Per-agent selection uses actual native labels, not
private memory identities or inferred ORACLE roles. User prompt text is never
rewritten; context goes through native `hookSpecificOutput.additionalContext`.

Contract: [official Codex hooks documentation](https://learn.chatgpt.com/docs/hooks).

## Verify

```bash
node --test tests/codex-context-inject.mjs
python3 tests/test_install.py
```

Tests use disposable directories. They exercise actual file reads, complete
large ORACLE content, native command execution, startup/compaction delivery,
resume/fork exclusion, subagent labels, and preservation of unrelated settings.
