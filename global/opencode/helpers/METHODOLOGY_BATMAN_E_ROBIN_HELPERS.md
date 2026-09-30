# METHODOLOGY_BATMAN_E_ROBIN_HELPERS

Helper for menu option 5 (`Batman e Robin`). Loaded by the ORACLE when the USER chooses this flow. Complements the `batman-e-robin` skill.

## What it is

Batman (ORACLE) owns the **WHAT** — scope, contracts, allowed areas, acceptance criteria, verification, the USER channel — and **does NOT implement**. Robin (DEVELOPER, **Mode B**) owns the **HOW** and implements everything from a **contract brief**, with real autonomy inside the allowed areas. Serial dispatch, no ARCHITECT, no tribunal. Load the `batman-e-robin` skill via the skill tool and execute it (6 steps: Trigger → THINK → PLAN → DO → TEST → ACCEPT).

## Rules

- Executes the `batman-e-robin` skill as-is (frozen); inside it no ARCHITECT, no tribunal, no `be-judge`.
- **The split is WHAT vs HOW (v2).** Batman never implements; Robin never crosses the WHAT. The old axis ("mechanical vs judgment") is gone — it made Batman do ~90% of the task.
- Robin never contacts the USER (ORACLE is the sole channel); Robin reports the HOW decisions he took and stops only to cross the WHAT (scope, public contract, file outside the allowed areas), on an ambiguous/impossible criterion, or on an unpredicted destructive action.
- **One Robin at a time** (AGENTS.md rule 19 — serial dispatch, never fan-out).
- Batman **re-executes** the acceptance verification with his own hands (AGENTS.md rule 17 — nobody certifies their own work).
- On 3 failed attempts Batman **escalates to the USER** and does **not** take over — the take-over hatch of rule 5 is closed in this flow.
- In this flow Robin is the **`DEVELOPER` agent in Mode B** — see the "Two operating modes" block in `agent/DEVELOPER.md`.

**Nota de manutenção:** este arquivo está em `global/opencode/helpers/` (FONTE — edite sempre aqui) e é instalado em `~/.config/opencode/helpers/` pelo `./src/install-global.sh`; nunca edite o mirror (regra 8).
