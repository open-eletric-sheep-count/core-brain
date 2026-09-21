# METHODOLOGY_TICO_AND_TECO_THINK_HELPERS

Helper for menu option 1 (`Tico and Teco Think Methodology`). Loaded by the ORACLE when the USER chooses this flow. Complements the `be-judge` skill.

## What it is

A minimal fixed-scope delivery flow to create a feature from a task or something the USER said (a feature to create). It is the DEFAULT menu option.

## Steps

1. **Trigger** — the USER brings a task or something said (a feature to create).
2. The ORACLE loads the `be-judge` skill via the skill tool and becomes the judge of this flow.
3. The ARCHITECT plans the feature and hands the plan to the ORACLE, which launches the DEVELOPER with
   that plan, one agent at a time.
   **`docs/forum.md` is opened FRESH at the start of EVERY task** — before the first launch, never reused
   from an earlier task:
   (a) if a `docs/forum.md` left by a previous task exists, archive it first
       (`mv docs/forum.md docs/forum-<YYYYMMDD-HHmm>.md`) — nothing from a previous task is appended to;
   (b) write a header identifying THIS task (title, date, methodology, participants);
   (c) from then on the file is **append-only** for the duration of the task: one entry per agent, headed
       `## <AGENT> — <YYYY-MM-DD HH:MM>`. Nobody edits or deletes an existing entry.
   Entries of two tasks in one file are a DEFECT. That file is the channel: the ARCHITECT appends its
   brief and every verdict, the DEVELOPER appends its delivery and its answers, and the ORACLE relays only
   the **path**, never pasted text (AGENTS.md rules 13/14). The ARCHITECT keeps the **authority** over the
   DEVELOPER (it commands, reviews and rejects); the DEVELOPER never argues with the ORACLE — every
   conflict returns through the forum file and the ARCHITECT.
   On a **remote provider** the depth/serial restriction does not apply and the ARCHITECT may call the
   DEVELOPER directly, as before; `docs/forum.md` stays as the record either way.
4. The two argue until the feature is ready: the ARCHITECT commands; the DEVELOPER contests only the ARCHITECT with conclusive proof; the ARCHITECT invokes the ORACLE (judge) only when in doubt. The chain is strict — ORACLE → ARCHITECT → DEVELOPER: the judge never speaks to the DEVELOPER and the DEVELOPER never speaks to the judge. The ORACLE rules each conflict applying the `be-judge` mechanism — judge leans toward the ARCHITECT, the judge is the ONLY channel to the USER — and the communication-language protocol (EN default, PT, or Other; documentation and artifacts always in English unless the USER says otherwise).
5. **Result** — the feature is implemented and READY. The originating task is closed (✅) via the `finish-task` skill ONLY after everything is done and accepted by the USER.

## Scope

Fixed: ARCHITECT × DEVELOPER (no scope question needed). The `be-judge` mechanism (judging rules, chain of command, tie-break, only channel, language protocol, vision — justice is not blind) is defined in the `be-judge` skill; this helper references it, it does not duplicate it.
