---
name: core-brain-create-memories
description: Create or improve core-brain memory records from conversations, documents, decisions, observations, and explicit preferences. Use for memory extraction, record authoring, or reviewing proposed memories, including self and global targets. Ordinary recall of existing memories does not require this skill.
---

# Create Core-Brain Memories

A memory earns its place by changing a future answer, action, or interpretation. Two failures cost more than a missing memory: one that is **too long to be read**, and one that is **never retrieved when it applies**. Most of this skill is about those two.

## The fields do different jobs

Core-brain stores one `text` (the assertion) plus free-form `meta` (stored verbatim). Use the meta slots deliberately:

| Slot | Job | Test |
| --- | --- | --- |
| `text` | The assertion. What to do or what is true. | Could someone act on this alone? |
| `meta.rationale` | The **mechanism** that makes it true — and therefore when it stops being true. | Does it name a condition that could fail? |
| `meta.source` | Where it came from: incident, date, speaker, document. | Is this a citation rather than a reason? |
| `meta.tags` / `meta.domain` | Where it should surface. | See *Findability* below. |

`meta.rationale` is not "more explanation". "Because the user said so on 12 March" is a citation and belongs in `meta.source`. A real rationale is falsifiable: if its mechanism stopped holding, the rule should be retired.

**Worked example.** A real incident record running 1,454 characters carried eleven claims: the instruction, its justification, its supporting evidence, and the incident narrative. The instruction appeared in sentence one and again at character 1,180; everything between was justification written to pre-empt disagreement. Rewritten to 198 characters of `text` plus its meta:

```
text: >-
  When a tool result is spilled to a file, read the whole file before acting —
  you do not have the full result yet. Head-and-tail reading skips the middle,
  where the constraints on what you must not say live.
meta:
  rationale: >-
    A pointer to a spilled payload reads exactly like a result you already have,
    so this fails silently.
  source: >-
    2026-09-07 — 115,052-char result, 4% read; four redaction rules sat in the
    unread 96%.
  tags: [injection, truncation, redaction, spilled-output]
```

Nothing was lost. Each part moved to the slot whose job it is. The long version was also **worse for retrieval** — its embedding is the centroid of five topics, so it ranked mediocre for all of them, and its term density was diluted fourfold.

Length is a symptom, not the rule. Aim for 100–300 characters of `text`; past ~600 you are almost certainly carrying another slot's content. Exceed it when a dependent procedure genuinely needs the steps together.

## Findability: write the situation, not the subject

A memory that never surfaces is worth nothing, and relevance is not automatic. Three things decide whether yours floats up.

**1. Discriminating words.** BM25 ranks by term *rarity*. In a store about one product, that product's vocabulary is worthless: measured on a real store, the product's own name appeared in 62% of the corpus, and generic terms like "enterprise" and "session" in 31% and 27%. Terms that common cannot rank anything, so retrieval degenerates toward whichever records are longest and most keyword-dense.

Write the words a future *task* will contain, not the words your topic belongs to. A rule about demos must contain *demo, screen-share, recording, audience, presentation* — those are its handles.

**2. One topic per record.** An embedding is a centroid. Two claims in one record produce a vector between them that matches neither well. Splitting raises the score of both.

**3. A behavioural rule usually cannot be retrieved at all — do not rely on recall alone.** This is a measured limit, not a theoretical one. Twelve rewritten rules were probed with the situation each one governs, phrased as a real task would phrase it: **R@1 was 2/12 and R@5 was 3/12.** The failure is structural: for *"publish the new version to npm"*, the top results were all about npm publishing mechanics — they repeat "npm" and "publish", while a governance rule about sign-off does not. The words that describe a situation are the words that describe its topic, and the topic always has more records. Core-brain has no pinning yet — a rule that must be obeyed *unprompted* must live in the always-loaded instructions (AGENTS.md / the agent prompt), not only in the store. Write the situation words anyway — they are what buys you the distinctive cases (*"ssh into the client VPS"* ranked #1; *"investor deck, can we mention the pilots"* ranked #5) — but do not rely on retrieval for a rule you need obeyed unprompted.

All string values in `meta` (arrays included) join the keyword index alongside `text`, while the vector is built from `text`. So the assertion must stand on its own, and a concrete mechanism sentence in `meta.rationale` still adds keyword (BM25) surface at no cost to the assertion's length.

## Identify the knowledge worth keeping

Extract one coherent unit that can be retrieved, revised, and retired independently. It may be a fact, preference, value, definition, decision, procedure, episode, measurement, hypothesis, lesson, or unfinished intention. Keep a procedure together when its steps depend on each other; split unrelated triggers and independently changing claims.

Ask what a future agent would do differently. Retain user-selected defaults, local meanings, and decision premises even when simple. Do not require novelty or a surprising lesson. Omit generic advice; link substantial source material rather than compressing a manual into one record.

Use the supplied evidence. Identify speaker or document, context, date when material, and whether the content is a preference, observation, decision, or inference. A statement about what a source says is not confirmation of its claim. Repeated copies of one source are not independent support.

Do not invent source events, acceptance, verification, benchmark results, confidence scores, usage, signatures, or timestamps. When evidence is incomplete, narrow the claim, keep it as a labelled hypothesis, or stage the record with the gap identified. Do not stall the useful part over an omittable field.

Choose a form that matches the knowledge:

| Knowledge | Form |
| --- | --- |
| Behavioural rule | When X, do Y, because Z, unless W. |
| Preference | Prefer X in context Y; keep the exception. |
| Fact or definition | X is Y within scope S, as of T if time matters. |
| Decision | Chose X because Z; reopen when C changes. |
| Episode | In context C, actor A did B, outcome O. Keep inferred motive separate. |
| Measurement | R measured V under conditions M; preserve the comparison's limits. |
| Hypothesis | Evidence E suggests H; uncertainty U; check T could distinguish. |
| Procedure | At trigger C, follow the sequence; link the detailed source. |

Avoid vague pronouns, "always obey", and urgency manufactured to imply authority. Never phrase a remedy as a disjunction whose second branch is cheaper — the cheap branch gets taken and the rule becomes a licence.

## Before you write: check, and write once

Inspect the existing bank first — a `recall` with the statement you are about to store. Core-brain has no automatic dedup, so the recall IS the check; high similarity is a reason to look, not a verdict.

Write the assertion before you call the tool. Superseding a memory you wrote minutes ago is a redraft, not a correction — it leaves a chain of near-identical records, and no similarity check catches it because each link genuinely differs. If the earlier one was simply wrong, retire it rather than stacking another near-copy.

For changes, compare the same entity, scope, version and measurement conditions before declaring a contradiction. Retire the outdated record with `forget` and store the new one; when it matters, record the retired id in `meta.supersedes` so the history survives. Differing measurement conditions can justify parallel records. Give temporary priorities a completion or expiry condition inside the statement; do not invent expiry dates for stable knowledge.

## Scope and target

Choose the broadest target the source justifies: `target: "global"` for standing knowledge that belongs to every agent, `"self"` (the default) otherwise. A project incident does not become global because its wording sounds general. Put the scope you actually mean in `meta.scope` (e.g. `project:acme`), and set `meta.domain` on every record — it is the routing signal you control.

Keep epistemic standing and lifecycle separate. An observed event is not its explanation; an approved experiment is not a proven hypothesis. Do not inflate a candidate into a fact.

## Specify without manufacturing evidence

Use the native fields (`text`, `meta`) fully for what is relevant; do not populate every optional slot or attach impressive-looking counters. Most good records use a handful of meta slots.

Cite resolvable evidence with its real origin. Never import fixtures as facts about the user. `createdAt` / `updatedAt` are set by the store — never fabricate provenance by hand.

## Review and deliver

For each proposed memory, name one task where it should fire and one plausible near-match where it should not. Check that it contributes information or a decision criterion, stays inside its evidence, and survives on its own. A simple fact does not need a manufactured test suite.

Deliver readable statements plus the requested records, with assumptions and unresolved evidence identified. Prefer the smallest useful set; explain significant merges or scope decisions. Apply store changes when the request or workflow authorises it — creating illustrative examples does not authorise installing them as live memories — and do not add an approval step where the action is already authorised.
