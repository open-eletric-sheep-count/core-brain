# METHODOLOGY_SCRUM_TEAM_HELPERS

Helper for menu option 2 (`scrum team`). Loaded by the ORACLE when the USER chooses this flow. Complements the `scrum-team` skill.

## What it is

The Scrum flow: flow steps, role glossary (COOPERATOR/FIRED/ORCHESTRATOR), agent model, flow rules, forward-after routing — all live in the `scrum-team` skill. Load that skill via the skill tool and execute it.

## Rules

- Executes the `scrum-team` skill as-is (frozen); its internal protocol applies only inside that flow.
- **O fórum (`bot-forum`):** o agente de nível 0 abre `.bot-forum/forum-<session id>.md` no arranque (skill `bot-forum`) e escreve o caminho em cada brief; é o canal para o que nenhum dispatch carrega (um subagente não lança outro — regra 19 — e só fala ao encerrar o turno): `[REQ]`/`[ANS]` no fórum.

## Forward After (grill concluded, USER confirmed) — routing in the `scrum-team` skill

- Documentation-only tasks → DOCUMENTATION_WRITER or ARCHITECT; implementation tasks → TESTER (tests first) and then the selected flow. Full routing: see the `scrum-team` skill (Forward After section).
