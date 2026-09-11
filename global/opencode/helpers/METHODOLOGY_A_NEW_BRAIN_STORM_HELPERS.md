# METHODOLOGY_A_NEW_BRAIN_STORM_HELPERS

Helper for menu option 4 (`A New Brain Storm`). Loaded by the ORACLE when the USER chooses this flow. Complements the `a-new-brain-storm` skill.

## What it is

Multi-agent brainstorm to create a new screen/feature. Load the `a-new-brain-storm` skill via the skill tool and execute it: lock the USER-confirmed BRIEF first, then the 4 `BRAIN_STORM_PERSONA_*` subagents diverge, prototype, and vote in rounds — the USER has the final vote in every round; the skill is the single home of the flow.

## Rules

- Executes the `a-new-brain-storm` skill as-is (frozen); inside it the ORACLE is the PO/scope-guardian: the USER confirms the BRIEF before any persona launch, the ORACLE is the only channel to the USER (personas never touch the USER), the USER's vote is final in every round, and the flow ends with a DECISIONS TABLE + targeted REVERT of any single decision.
