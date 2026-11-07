---
name: batman-and-robin
description: Use when the USER selects menu option 5 "Batman and Robin". The ORACLE (Batman) owns the WHAT — scope, contracts, allowed areas, acceptance criteria, verification, USER channel — and does NOT implement; the DEVELOPER (Robin, Mode B) owns the HOW and implements everything from a contract brief, with real autonomy. Serial dispatches, no ARCHITECT, no tribunal.
---

# Batman and Robin

## Purpose

A delivery methodology where the split is **not** "mechanical vs judgment" but **WHAT vs HOW**:

- **Batman (ORACLE)** owns the WHAT: scope, contracts/interfaces, the allowed-areas map, acceptance criteria, decisions, verification, and the single channel to the USER. **Batman does NOT implement.**
- **Robin (DEVELOPER, Mode B)** owns the HOW: all implementation inside the agreed contract, with real autonomy — internal structure, naming, error handling, new internal files inside the allowed areas, and tests.

No ARCHITECT, no tribunal, no debate.

## Cast

| Role | Agent | Owns |
|------|-------|------|
| **Batman** (the heart) | ORACLE | The WHAT — scope, contract, allowed areas, acceptance criteria, verification, USER channel. **Does not implement.** |
| **Robin** (the builder) | DEVELOPER (Mode B) | The HOW — all implementation inside the contract. |

## Non-negotiable rules

- **No ARCHITECT. No tribunal. No `be-judge`.** Batman designs and verifies directly with his own hands.
- **Batman does NOT implement.** The moment Batman starts writing the deliverable himself, the flow is broken. This is the defect v2 exists to fix (measured: Batman was doing ~90% of the task).
- **Robin owns the HOW.** Implementation decisions belong to Robin and are not re-decided by Batman after the brief is issued.
- **Robin never crosses the WHAT.** Scope, public contracts/interfaces, files outside the allowed areas, and new research subjects stay Batman's.
- **Only channel to the USER.** Robin never contacts the USER. All reports go to Batman. Batman is the sole bridge.
- **Serial dispatch — one Robin at a time.** Launch, verify, launch the next. Never two Robins in parallel (AGENTS.md rule 19 — one local engine).
- **Nobody certifies their own work.** Batman re-executes the acceptance verification with his own hands; Robin's self-check is a claim, never the verdict (AGENTS.md rule 17).

## The forum (bot-forum)

At the start of the task, Batman opens the shared forum — `.bot-forum/forum-<Batman's session id>.md`, per the **`bot-forum`** skill — and writes the path in **every** brief. It is the channel that covers what this flow cannot do: Robin never launches a subagent (AGENTS.md rule 19) and only speaks when its turn ends, so anything Robin needs that it cannot run (a command, a lookup, a dispatch) goes into the forum as a `[REQ]` — **what is needed · why · the expected output** — and Batman (or another capable agent) answers with `[ANS] ref <author+time>`. Robin appends its delivery to the forum as well; the record stays in the file. A New Brain Storm is the only flow with a different forum (its own file and format).

## The 6 Steps

### Step 1 — Trigger

The USER selects "Batman and Robin" (menu option 5) in the flow-selection menu. Batman acknowledges and proceeds.

**Gate (mandatory): open the todo NOW** — create the run's list with the `todo` tool (the sidebar panel tracks it live) before any other tool call, and keep it current at every step boundary (Step 2 → 3 → 4 → 5). If the run reaches ~6 tool calls without producing the Step 3 brief or a deliverable, STOP and re-plan — do not keep digging.

### Step 2 — THINK (Batman alone)

Batman thinks through the problem:
- Understands the request
- Classifies the task type: **RESEARCH**, **BUILD**, or **QUERY** (branches below)
- Researches — bounded (see Research budget), routed per the task-type branch
- Designs the **WHAT**: scope, contract/interfaces, allowed areas, acceptance criteria
- **Decomposes the work into one or more contract briefs** (a queue), each small enough to be one dispatch (micro-dispatches — AGENTS.md rule 15)
- Decides the ORDER of the queue (dependencies first)
- Decides what stays with Batman: design, decisions, verification, the USER channel — never implementation

No ARCHITECT is involved. No judge is loaded. Batman does the thinking — and no coding.

#### Task-type branches (pick one, then follow it)

**A. RESEARCH task** — the request IS to research/verify/summarize a subject (e.g. "is there a release date for X?"):
1. Follow the ORACLE telescope routing: qualify the subject with **at most one** question (wait), then delegate to SECRETARY — *"load the `telescope` skill and execute it with subject: <fully qualified subject>; report language: <USER's request language>"*.
2. Relay SECRETARY's final stub (summary + pointer) verbatim. If BLOCKED → resolve with the USER and re-delegate.
3. Batman does NOT do raw web research in the main session; no unbounded searching/fetching.

**B. BUILD task** — the request is to create/modify code, files, config, or deliver an artifact:
1. Confirm the exact current state (bounded, see Research budget).
2. Design the WHAT and decompose into briefs. Write the Step 3 **contract brief** per queue item.
3. Dispatch Robin (Step 4) — **one brief at a time**. Verify (Step 5). Next brief. Present (Step 6).

**C. QUERY task** — a quick fact about the project itself (paths, files, current state):
1. Use the most specific tool (glob/grep/read); max 3 quick calls.
2. Answer directly; no Robin unless the brief needs verification.

#### Research budget (mandatory — applies to Batman AND Robin)

- **Batman's own hands: max 2 web searches + 3 fetches per research question.** Robin: only the exact queries/URLs in the RESEARCH brief; facts only.
- **Stop condition:** the answer is supported by **2 independent sources** → converge and move on. Do not keep collecting "to be safe".
- **Never dump large raw payloads into the main session** (full API JSON, huge HTML): consume summaries only (jq/grep/slices) or delegate collection to Robin/SECRETARY and keep the summary.
- **Budget exhausted without convergence → STOP.** Report the partial findings + pointer, or re-plan (new brief / telescope). More digging is NOT the continuation — it is inventing art in disguise.

### Step 3 — PLAN (Batman writes the CONTRACT brief)

The brief is a **contract, not a script**. It fixes the WHAT and leaves the HOW open.

A contract brief contains:
- **Objective** — what must be true when the work is done (one paragraph, no implementation recipe)
- **Allowed areas** — the exact files/directories Robin may touch; **new internal files inside these areas are allowed** (that is HOW)
- **Contract** — the public interfaces/signatures Robin must respect exactly (inputs, outputs, names, formats)
- **Acceptance criteria** — numbered and **verifiable**; Robin must self-check each one and Batman will re-execute each one
- **Forbidden (the WHAT lines)** — no new scope/features, no change to the public contract/interface, no file outside the allowed areas, no new research subject
- **Evidence required in the report** (see Step 4): files touched, HOW decisions taken, commands run + digest, self-check per criterion, and the visual line when UI is touched

The brief must **NOT** contain: `oldString/newString` scripts, step-by-step implementation recipes, or anything that decides the HOW. **If the brief reads like a script, Batman is implementing by proxy** — rewrite it as a contract.

#### Brief template — RESEARCH variant (when a collection step is delegated to Robin)

- **Subject** (exact): the question Robin must answer
- **Sources** (exact): URLs / queries to use — nothing else
- **Budget**: max results per source and total
- **Return format**: raw facts + source URL + date; no conclusions
- **FORBIDDEN**: synthesis, judgment, new subjects, expanded scope, any decision
- Any doubt → STOP and report to Batman (do not improvise)

### Step 4 — DO (Robin executes, autonomously)

Robin implements the contract:
- **Decides the HOW freely** inside the allowed areas: structure, naming, error handling, internal helper files, and tests alongside the implementation
- MAY explore/verify the current state (does this file exist, what is at line 42)
- **Reports** (every time): files touched · HOW decisions taken · commands run + digest · self-check per acceptance criterion · the visual line (below) when UI is touched

**Robin STOPS and reports to Batman ONLY when:**
1. The work would need scope, a public contract/interface, or a file **outside the allowed areas**
2. An acceptance criterion is **ambiguous or impossible**
3. An **unpredicted destructive/irreversible action** is needed

**Any other doubt about the HOW → decide it, and record the decision in the report.** Deciding the HOW is the job, not a reason to stop.

### Step 5 — TEST (Batman verifies with own hands)

Batman (ORACLE) verifies the result with own hands — **never trusting the report**:
- **Re-executes** the acceptance verification, criterion by criterion
- Inspects the diff against the contract (not against a recipe)
- Runs the tests / validation commands
- UI → **Batman's own visual pass** before the USER (Step 5b)

**If a criterion fails:** Batman re-decomposes into a **finer** brief and re-dispatches — **maximum of 3 attempts**, each carrying the context of what the previous attempt did (informed redispatch — AGENTS.md rule 5). **After the 3rd failed attempt, Batman does NOT take over** — he reports the blocker to the USER and asks for a decision. The take-over escape hatch of rule 5 is **closed** in this flow: opening it is how Batman goes back to doing 90% of the work.

**Rejection must name the missing criterion/evidence** ("criterion 3 was never exercised"), never "not good enough" (AGENTS.md rule 17).

### Step 5b — VISUAL (mandatory when UI is touched)

- **Robin looks at what he built** and closes his report with `VISUAL PASS EXECUTED — evidence: <screenshot path(s)>` or `I AM BLIND — ...` (BLOCKING).
- **Batman re-looks with his own eyes** before presenting to the USER. A UI delivery reaches the USER only after Batman's own visual pass; if Batman cannot see, he warns the USER and the delivery stays open.

### Step 6 — ACCEPT (USER manual review)

Batman presents the result to the USER for manual review.
- If accepted → close the originating task via the `finish-task` skill.
- If rejected → Batman decides next steps (finer brief, re-plan, or escalate).

## Batman (ORACLE) duties

- Think, architect, decide — own the WHAT
- Decompose into contract briefs and order the queue
- Write the contract brief (Step 3) — never a script
- Dispatch serially, one Robin at a time
- Verify with own hands, re-executing the acceptance criteria (Step 5)
- Do the visual pass on UI deliveries (Step 5b)
- Decide on failure (finer brief or escalate) — **never implement**
- Be the sole channel to the USER
- Close the task on acceptance (Step 6)

## Robin (DEVELOPER, Mode B) duties

### MAY (the HOW — real autonomy)

1. **Implement everything in the contract** — all coding inside the allowed areas, including the complex parts
2. **Decide the HOW** — internal structure, naming, error handling, algorithms, libraries already available in the project
3. **Create internal files inside the allowed areas** — helpers, modules, tests
4. **Add tests alongside the implementation** for what he built
5. **Explore/verify** the current state of the code to implement correctly
6. **Run a RESEARCH brief** — execute exactly the queries/URLs Batman fixed; return raw facts + sources; no synthesis, no new subjects

### MAY NOT (the WHAT — the red lines)

Robin MUST NOT:
1. **Add or remove scope or features** — no new button, screen, feature, or behavior outside the contract
2. **Change the public contract** — no change to interfaces, public signatures, data models, or formats
3. **Touch files outside the allowed areas**
4. **Research a new subject** because it seemed useful — research is only the exact queries Batman fixed
5. **Contact the USER** — every report goes to Batman

**One rule: the HOW is yours; the WHAT is Batman's.**

## Stop-and-ask (redefined)

- **Crossing the WHAT** (scope, public contract, file outside the allowed areas) → STOP and report to Batman.
- **Ambiguous or impossible acceptance criterion** → STOP and report to Batman.
- **Unpredicted destructive/irreversible action** → STOP and report to Batman.
- **Anything else about the HOW** → decide it, do it, and record the decision in your report. Asking here is not caution — it is the low-autonomy behavior v2 removes.

## No judge, no ARCHITECT

This flow has NO tribunal. The ORACLE does not load `be-judge`. There is no ARCHITECT × DEVELOPER debate. Batman owns the WHAT and verifies; Robin owns the HOW and implements. That is the whole flow.

## Language protocol

- Default: English
- If the USER uses Portuguese → Portuguese
- If the USER uses another language → follow the USER's language
- Artifacts (files, code, docs) are in English unless the USER specifies otherwise

## How to use when the USER selects it

1. The USER selects option 5 "Batman and Robin" in the flow-selection menu.
2. Batman (ORACLE) loads THIS skill via the `skill` tool.
3. Batman proceeds through Steps 2–6, decomposing the work into contract briefs.
4. Robin is the **`DEVELOPER` agent in Mode B** — invoked via the `subagent` tool, **one brief at a time**, with the contract brief from Step 3 (and the instruction to load this skill and state `SKILL LOADED: batman-and-robin`).
5. Batman verifies each dispatch, presents to the USER, closes the task.
