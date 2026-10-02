# ADR 0003 — core-brain: default policy for unlisted agents

- **Status:** Accepted
- **Date:** 2026-10-02
- **Deciders:** ARCHITECT (spec), ORACLE (judge), USER (scope decision confirmed in `.bot-forum/forum-ses_f0628c90affeZpL50jfznffghU.md`, 2026-10-02 00:44)
- **Source spec:** `docs/specs/core-brain-default-policy-spec.md` — the authority for every decision below
- **Supersedes (rules only):** ADR 0001 §D5; `docs/specs/core-brain-plugin.md` Q6, §6.3, §6.4, §7.1, §8, §9 Q9-step-5
- **Delivery:** `global/opencode/plugins/core-brain/store.ts` + matrix lines 15–19 in `test/matrix.selftest.mjs`

## Context

ADR 0001 D5 made the plugin **fail-closed**: an agent not present in `config.json` received no
namespace and no access, and `requirePolicy()` threw `agent '<name>' is not configured in
core-brain config.json`. That was the safe default for a memory surface nobody had exercised.

The USER reversed that default on 2026-10-02, in two coupled rules (forum, 00:44):
(A) an agent **absent** from `config.json` gets the default policy `private:false` +
`hasGlobalAccess:true`; (B) a configured row that **omits** `private` and/or `hasGlobalAccess` also
takes the same defaults instead of throwing `InvalidConfigurationError`. The invalid-row rule
(`private:false` + `hasGlobalAccess:false` → throw) is kept, as are all cross-agent write refusals.

ADRs are immutable, so D5 is not rewritten: it carries a `Superseded by ADR-0003 (2026-10-02).`
marker and the reversal is recorded here. Why the change: operators running a fresh or partial
`config.json` had agents silently refused; the USER wanted an unconfigured agent to participate in
shared memory by default, accepting the larger blast radius deliberately (spec §10).

## Decision

An agent absent from `config.json` resolves to a synthesized default policy
`{ private:false, hasGlobalAccess:true }`, and a configured row that omits a field resolves that
field to the same default. Every other isolation rule stands. The decisions that make that shape:

### D1 — An agent absent from `config.json` gets the default policy (no throw)

**Decision.** `requirePolicy(name)` returns `policyByName.get(name) ?? { name, private:false,
hasGlobalAccess:true }`. It never throws for an absent agent. The constant is `DEFAULT_POLICY =
{ private:false, hasGlobalAccess:true }`. The synthesized policy is **not** inserted into the
configured policy map. The error string `agent '<name>' is not configured in core-brain config.json`
is removed from production. A missing or empty config file makes **every** agent absent, so every
agent gets the default. `who` for an absent agent returns `{ agent, name, private:false,
hasGlobalAccess:true, dataDir }`.

**Why.** The USER chose an open default over fail-closed for an unconfigured agent (spec §10). The
default is resolved against the trusted identity only (ADR 0001 D6 unchanged); a name that cannot be
resolved at all is still refused by `index.ts`.

**Cost.** The blast radius grows from "a misconfigured agent is refused" to "an unconfigured agent
participates in shared memory" — every unlisted agent can read and write the shared `global`
namespace. Accepted deliberately.

### D2 — A configured row that omits `private`/`hasGlobalAccess` takes the default (missing key, not coercion)

**Decision.** In `loadPolicies()`, a key that is **absent** (`undefined`) resolves to its default
(`hasGlobalAccess` → `true`, `private` → `false`). A **present** non-boolean still throws
`InvalidConfigurationError` with the existing message — the defaults are a missing-key rule, not a
coercion rule. The resolved values then face the unchanged invalid-row rule (D3).

**Why.** A partial row is a configuration the USER wants to work; a wrong-typed field is still an
operator error that must fail loudly at init.

**Cost.** The most subtle interaction is `{ name, hasGlobalAccess:false }`: `private` defaults to
`false`, so the resolved row is `private:false + hasGlobalAccess:false` and **throws** — pinned as
matrix line 17.

### D3 — The invalid-row rule and cross-agent write refusals are unchanged

**Decision.** `private:false` + `hasGlobalAccess:false` still throws `InvalidConfigurationError` at
init (applied to the resolved values). A write to another agent's namespace (`agent:<OTHER>`) is
still always refused, as are all other denial rules of ADR 0001 D4/D5.

**Why.** The reversal is narrow: only the absent/incomplete default changes. The one remaining config
refusal and the cross-agent write boundary are the guarantees that keep the default from becoming a
leak vector.

**Cost.** None new; the invalid row aborting the whole engine remains the accepted cost of ADR 0001
D4.

### D4 — An absent agent's namespace does NOT join the public read union

**Decision.** A synthesized (absent) agent's namespace does **not** participate in the §6.1 public
read union of other agents and is not readable by others via `from:"agent:<X>"`. The default union
for any caller keeps iterating **only over the configured `policies` array**; `lookup()` keeps
consulting only the configured policy map; the synthesized default is never registered there. A
namespace becomes a read target for others **only** by being a configured row with `private:false`.

**Why.** The union is defined over *registered* agents (the config is the registry). Including absent
namespaces would require the authorizer to enumerate `<root>/agents/*/` at read time — injecting disk
state into an authorization decision, making reads depend on unrelated agents' write history, and
turning any stray directory into a world-readable namespace (a new leak surface for zero requested
benefit). Read denial is silent omission, so leaving absent namespaces unreadable is the conservative
side; cross-agent read expansion was not requested.

**Rejected alternative.** Extend the union (and explicit `from:"agent:<X>"`) to namespaces found on
disk, treating them as public because the default is `private:false`. Rejected for the reason above.

**Cost / consequence stated honestly.** An absent agent's `who` reports `private:false`, yet its
namespace is not readable by other agents — "public" only in the sense that it was never declared
private. If the USER later wants absent namespaces readable by others, that is a **new** decision
requiring namespace discovery; it is not silently implied by D1/D2.

## Acceptance evidence (measured 2026-10-02)

Executed by the ORACLE against the real store + authorizer on a disposable `CORE_BRAIN_HOME`:

- `bash global/opencode/plugins/core-brain/check.sh` → **13/13 matrix lines PASS**, exit `0`.
  Lines 7–14 unchanged; lines 15–19 added: absent agent default + `global`/`self` round-trip (15);
  omitted-both-fields row loads and resolves to `false/true` (16); omitted `private` +
  `hasGlobalAccess:false` still throws (17); present non-boolean still throws (18); absent namespace
  excluded from the union and `from:"agent:<X>"` (19).
- `grep -n "is not configured in core-brain config.json" global/opencode/plugins/core-brain/store.ts`
  → no match (AC8).

Note: the 0001 acceptance bullet that read "unlisted agent → `not configured`" is superseded by this
ADR (marker added there).

## Consequences — open risks / follow-ups

1. **Fail-closed is gone (spec §10).** Any agent absent from `config.json` — and, if the config is
   missing or empty, **every** agent — reads and writes the shared `global` namespace. Mitigations
   kept: trusted identity (ADR 0001 D6), cross-agent writes refused, invalid-row refusal. This is the
   deliberate reversal the USER accepted.
2. **Read/write asymmetry for absent agents.** `who` reports `private:false` while other agents cannot
   read the namespace (D4). Declared and accepted; a future decision may revisit it.
3. **Name-pattern gate for synthesized policies.** The default is applied to any name the trusted
   layer resolves; a stricter pattern gate for unlisted names is a possible future hardening item,
   not added here (spec §9.4).

## Alternatives considered

- **Keep fail-closed (ADR 0001 D5)** — rejected: the USER reversed it deliberately (spec §10).
- **Default-allow plus disk namespace discovery** — rejected (D4): disk state deciding authorization;
  a leak surface for zero requested benefit.
- **Coerce present non-boolean values to the default** — rejected (D2): hides an operator error;
  present non-boolean must keep throwing at init.
- **Synthesize the default agent into the configured policy map** — rejected (D1/D4): it would
  register absent namespaces as union members and contradict the union decision. The default is a
  caller fallback only.
