# METHODOLOGY_TICO_AND_TECO_THINK_HELPERS

Helper for menu option 1 (`Tico and Teco Think Methodology`). Loaded by the ORACLE when the USER chooses this flow. Complements the `be-judge` skill.

## What it is

A minimal fixed-scope delivery flow to create a feature from a task or something the USER said (a feature to create). It is the DEFAULT menu option.

## Steps

1. **Trigger** — the USER brings a task or something said (a feature to create).
2. The ORACLE loads the `be-judge` skill via the skill tool and becomes the judge of this flow.
3. The ARCHITECT plans the feature and hands the plan to the ORACLE, which launches the DEVELOPER with
   that plan, one agent at a time.
   **The forum (`bot-forum`) is opened at the start of EVERY task** — by the ORACLE, before the first
   dispatch: `.bot-forum/forum-<session id>.md`, with the ORACLE's id read from `OPENCODE_SESSION_ID`
   (skill `bot-forum`):
   (a) one file per session — **no archive, no rotation** (the session id already separates the tasks; entries
       from two tasks in the same file are impossible);
   (b) a header identifying THIS task (title, date, methodology, participants, launcher session);
   (c) from then on **append-only**: one entry per agent, `## <AGENT> — <YYYY-MM-DD HH:MM>`. No one
       edits or deletes existing entries.
   The forum path goes in **every** brief. That file is the channel: the ARCHITECT appends the brief and all
   the verdicts, the DEVELOPER appends the delivery and the answers, and the ORACLE reports only the **path**, never
   pasted text (AGENTS.md rules 13/14). What an agent cannot run goes in as `[REQ]`
   (**what · why · expected output**) and whoever can answers `[ANS] ref <author+time>`. The ARCHITECT
   keeps **authority** over the DEVELOPER (commands, reviews and rejects); the DEVELOPER never argues with the
   ORACLE — every conflict comes back through the forum and through the ARCHITECT.
   On a **remote provider** the depth/serial restriction does not apply and the ARCHITECT may call the
   DEVELOPER directly, as before; the forum stays as the record either way.
4. The two argue until the feature is ready: the ARCHITECT commands; the DEVELOPER contests only the ARCHITECT with conclusive proof; the ARCHITECT invokes the ORACLE (judge) only when in doubt. The chain is strict — ORACLE → ARCHITECT → DEVELOPER: the judge never speaks to the DEVELOPER and the DEVELOPER never speaks to the judge. The ORACLE rules each conflict applying the `be-judge` mechanism — judge leans toward the ARCHITECT, the judge is the ONLY channel to the USER — and the communication-language protocol (EN default, PT, or Other; documentation and artifacts always in English unless the USER says otherwise).
5. **Result** — the feature is implemented and READY. The originating task is closed (✅) via the `finish-task` skill ONLY after everything is done and accepted by the USER.

## Scope

Fixed: ARCHITECT × DEVELOPER (no scope question needed). The `be-judge` mechanism (judging rules, chain of command, tie-break, only channel, language protocol, vision — justice is not blind) is defined in the `be-judge` skill; this helper references it, it does not duplicate it.
