---
name: clean-code-mode
description: Enforces auditable codebase changes: reproduce faults, fix causes, gate behaviour on failing-then-passing checks, preserve behaviour, and leave a complete reversible record. Use for any modify, fix, refactor, review, or delivery task.
---

## Working

- Append-only dossier: request, pass/fail conditions, constraints, target, baseline, time, scope, decisions, vocabulary, checks, order, deviations, questions, rollback, attempts.
- Mark empties.
- Raw baseline checks and failures.
- Reproduce via the consumer path and input class.
- State cause location and mechanism.
- No cause means no edit and report the block.
- Name tree, suite entry, utilities.
- Missing capability blocks dependants.
- Declare change type.
- Order dependency-first.
- Check each unit before the next.
- Choose the least extensive change, record rejected options.
- Remove behaviour-neutral complexity first.
- One home per policy and constant.
- Fix the cause, not the symptom.
- Change nothing unrelated.
- Keep the original check passing, or record an edit failing pre-fix.
- Never conceal by swallowing errors, hiding defaults, or disabling checks.
- Past the repetition limit (default one) or every run: verify one manual instance, build and compare the mechanism.
- After two shared-assumption failures: record parties and counts, remove the reproducing element before a third.
- Log each action: sequence, UTC or `time unavailable`, targets, purpose and necessity, result, evidence.
- Deletion and large-output location.
- Irreversible actions pending first.
- Primary channel: decisions, progress, summaries, report.
- Large output (above 60 lines, 6,000 characters, 25 records, or raw) to a named secondary area, never inline.
- Quiesce.
- Inventory candidates.
- Prove no use or reference, no acceptance-proof, uncommitted, sole-copy, or protected status, and disposable or approved.
- Doubt retains.
- Leave uncommitted untouched.
- Before altering availability, show location and size and keep, capture, discard-approval, defer; wait, else `awaiting decision`.
- Delete only listed checked candidates.
- Measure and verify absence.

## Checking

- Measure with the suite's tools — `crapper` (complexity and coverage), `dryer`
  (duplication) and `mutator` (mutation), installed under the CLI's `tools/`
  directory; a missing tool blocks the rules that depend on it, never estimates.
- Each behavioural change starts with a check failing for the intended reason on unmodified code.
- No edit after first pass unless another currently fails.
- Checks use consumer paths and observable results.
- Checks are deterministic and independent.
- Checks fail when production callables are emptied; delete or strengthen passes.
- Map every condition to a check or inspection with raw final output.
- Keep prior passes except listed changes.
- Add no suppression.
- Hold in-scope functions to complexity 10 and touched blocks below duplication 0.8.
- Measure before, record highest and removals.
- Preservation wins, reported blocked.
- Run mutation at delivery.
- Add failing-mutant and passing-clean checks for survivors.
- Reach zero survivors.
- Exercise or delete unexercised regions.
- Delete dead code only after recorded unreachability search.
- Retain uncheckable public code.

## Structure

- Convert external input once at the edge.
- Interior takes converted form.
- Validate each rule once.
- Make invalid combinations unconstructible.
- Keep outcome decisions free of I/O, clock, random, and ambient state.
- Parameters.
- Consumers get separate mutable objects unless sharing is required, one enforced mutator.
- No condition-only branch, flag, or parameter.
- Design as if original, deliver independent pieces.
- Leave clear local code unchanged.
- Characterize entry paths before structural edits.
- Preserve public surfaces.
- Edit no expectation.
- Stop and restore on a wrong expectation.
- Separate structure and behaviour.

## Finishing

- Fix target and baseline.
- Create one-concern version entries after each verified increment.
- Dependency order.
- Within 10 files and 400 lines, excluding generated.
- Each message has non-empty `Rationale`, `Scope`, and reproducible `Evidence`.
- No unrelated work.
- Publish only after history is ordered.
- Never rewrite.
- Later changes get a new entry and republish.
- Verify final entry and full history, or record `unverified`.
- Never force a rejection.
- Complete only when result exists, record closed, removal reported, publication or failure reported, decisions resolved or open.
- Report `Complete`, `Complete with open decisions`, `Awaiting decision`, `Blocked`, or `Unpublished`, with outcome and inventories.
- Run Establish, Perform, Quiesce, Release, Publish, Report.
- Stop at a blocked phase, report revision, met and unmet conditions, state, rollback.
- Reruns and resumes must converge.
- State defaults.
