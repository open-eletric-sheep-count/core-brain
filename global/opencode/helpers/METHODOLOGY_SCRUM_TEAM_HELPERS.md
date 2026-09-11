# METHODOLOGY_SCRUM_TEAM_HELPERS

Helper for menu option 2 (`scrum team`). Loaded by the ORACLE when the USER chooses this flow. Complements the `scrum-team` skill.

## What it is

The Scrum flow: flow steps, role glossary (COOPERATOR/FIRED/ORCHESTRATOR), agent model, flow rules, forward-after routing — all live in the `scrum-team` skill. Load that skill via the skill tool and execute it.

## Rules

- Executes the `scrum-team` skill as-is (frozen); its internal protocol applies only inside that flow.

## Forward After (grill concluded, USER confirmed) — routing in the `scrum-team` skill

- Documentation-only tasks → DOCUMENTATION_WRITER or ARCHITECT; implementation tasks → TESTER (tests first) and then the selected flow. Full routing: see the `scrum-team` skill (Forward After section).
