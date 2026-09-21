# DISPATCHES — read this BEFORE re-sending any agent work

A dispatch (`subagent` / `task` tool) can come back `cancelled` / `interrupted`
while the CHILD session keeps running. **That is not a failure.** Measured
2026-09-20: one research task was dispatched **3 times** while the child had
already written its report to disk — the work was done, the call had died.

## Why the call dies
- The anti-loop plugin interrupts the **WHOLE session** when any call exceeds its
  limit (`maxCommandDurationMinutes: 5` for shell commands without an explicit
  `timeout NN`; `maxToolCallDurationMinutes: 60` for other tools) — and the
  interrupt aborts **every in-flight call**, the dispatch included.
- A server restart aborts in-flight calls the same way.
- The CHILD session is separate: it survives and usually finishes.

## Before you re-dispatch (mandatory)
1. `bash ~/.config/opencode/plugins/sglang-guard/launch-ledger.sh` — shows the
   last launches: target, caller, and how the CALL ended
   (`status: error` = the call died, not the child).
2. Look for the artifact — the child usually writes a file:
   `find <likely dirs> -newermt '-40 minutes' -type f`.
3. Only if nothing was produced, dispatch again — and say it out loud
   ("dispatch 2; the first left no artifact").

## How to dispatch (so the call cannot die under you)
- Long work → **background** (`background: true`): the call returns at once and
  there is nothing in flight to interrupt.
- **One dispatch at a time** (AGENTS.md rule 19).
- Never run a heavy shell command without an explicit `timeout NN` while a
  dispatch is in flight.

## Where the state lives
`~/.local/state/opencode/launches.jsonl` (written by the `sglang-guard` plugin):
`launch_evaluated` (seen) · `returned` (`status`) · `stale` (never came back).
Raw log next to it: `~/.local/state/opencode/sglang-guard.log`.
