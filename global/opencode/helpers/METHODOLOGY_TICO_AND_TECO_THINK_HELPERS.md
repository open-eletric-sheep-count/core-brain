# METHODOLOGY_TICO_AND_TECO_THINK_HELPERS

Helper for menu option 1 (`Tico and Teco Think Methodology`). Loaded by the ORACLE when the USER chooses this flow. Complements the `be-judge` skill.

## What it is

A minimal fixed-scope delivery flow to create a feature from a task or something the USER said (a feature to create). It is the DEFAULT menu option.

## Steps

1. **Trigger** — the USER brings a task or something said (a feature to create).
2. The ORACLE loads the `be-judge` skill via the skill tool and becomes the judge of this flow.
3. The ARCHITECT plans the feature and asks the DEVELOPER to implement it.
4. The two argue until the feature is ready: the ARCHITECT commands; the DEVELOPER contests only the ARCHITECT with conclusive proof; the ARCHITECT invokes the ORACLE (judge) only when in doubt. The chain is strict — ORACLE → ARCHITECT → DEVELOPER: the judge never speaks to the DEVELOPER and the DEVELOPER never speaks to the judge. The ORACLE rules each conflict applying the `be-judge` mechanism — judge leans toward the ARCHITECT, the judge is the ONLY channel to the USER — and the communication-language protocol (EN default, PT, or Other; documentation and artifacts always in English unless the USER says otherwise).
5. **Result** — the feature is implemented and READY. The originating task is closed (✅) via the `finish-task` skill ONLY after everything is done and accepted by the USER.

## Scope

Fixed: ARCHITECT × DEVELOPER (no scope question needed). The `be-judge` mechanism (judging rules, chain of command, tie-break, only channel, language protocol, vision — justice is not blind) is defined in the `be-judge` skill; this helper references it, it does not duplicate it.
