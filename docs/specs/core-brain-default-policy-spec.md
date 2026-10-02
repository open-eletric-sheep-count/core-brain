# core-brain — Active Spec: default policy for absent / incomplete config rows

- **Status:** ACTIVE — awaiting ORACLE acceptance, then handed to TESTER → DEVELOPER
- **Author:** ARCHITECT
- **Date:** 2026-10-02
- **Task (USER decision, confirmed in `.bot-forum/forum-ses_f0628c90affeZpL50jfznffghU.md`, ORACLE 2026-10-02 00:44):**
  (A) an agent **absent** from `config.json` is no longer fail-closed — it receives the default
  policy `private:false` + `hasGlobalAccess:true`;
  (B) a configured row that **omits** `private` and/or `hasGlobalAccess` no longer throws
  `InvalidConfigurationError` — the omitted field(s) take the same defaults.
- **Supersedes (rules only):** `docs/specs/core-brain-plugin.md` Q6, §6.3, §6.4, §7.1, §8, §9 Q9-step-5;
  `docs/adr/0001-core-brain-memory-isolation.md` D5. This file is the law for this slice; the
  superseded documents are updated per §5.
- **Artifacts of this task are in English.**

> The spec is the contract. Every rule below is written to be **executable**: the matrix lines in §7
> are the proof. A green suite that does not exercise the default-write path is not evidence.

---

## 0. Scope & non-goals

**In scope**

1. Remove the fail-closed lookup for an agent absent from `config.json` and replace it with a
   synthesized default policy `{ private: false, hasGlobalAccess: true }` (rule A).
2. Make `private` and `hasGlobalAccess` optional per row; an omitted field resolves to the default
   (`private` → `false`, `hasGlobalAccess` → `true`) instead of throwing (rule B).
3. Keep every other validation rule and **all** matrix lines 7–14 exactly as they are.
4. Update the tests, the executable matrix and every document that states the old rule (§5).

**Non-goals (see §9 for the explicit out-of-scope list)**

- No cross-agent read expansion: an unlisted namespace does **not** join another agent's public
  read union and is not readable via `from:"agent:<X>"`. The union stays over configured policies.
- No new config keys, no `inject`, no hooks, no MCP behaviour change.
- No change to identity resolution or to the trusted-identity contract.

---

## 1. Context — the exact points that change

Verified by the ORACLE (do not re-explore):

- `global/opencode/plugins/core-brain/store.ts` → `createEngine()` → `requirePolicy()` (~line 424)
  throws `agent '<name>' is not configured in core-brain config.json` for an unlisted agent.
- `loadPolicies()` (~213–289) rejects a present non-boolean `hasGlobalAccess` (264–268) and `private`
  (269–273), rejects `private:false && hasGlobalAccess:false` (279–284), and builds `AgentPolicy[]`.
- `authorizeWrite()` (~316) / `authorizeRead()` (~359): READ default = own namespace + global (if
  `hasGlobalAccess`) + every configured `private===false` agent; the union loops only over the
  configured `policies` array.
- `who` shape: `{ agent, name, private, hasGlobalAccess, dataDir }`.

Only `store.ts` changes in production. `types.ts` and `index.ts` are untouched (see §5).

---

## 2. Rule A — an agent absent from `config.json` gets the default policy

**A1.** The engine keeps the policy map built **only** from configured rows. No synthesized policy is
inserted into that map.

**A2.** The single constant (the synthesized default) is:

```ts
const DEFAULT_POLICY = { private: false, hasGlobalAccess: true } as const;
```

**A3.** `requirePolicy(agentName)` resolves as:

```ts
function requirePolicy(agentName: string): AgentPolicy {
  return (
    policyByName.get(agentName) ?? {
      name: agentName,
      private: DEFAULT_POLICY.private,          // false
      hasGlobalAccess: DEFAULT_POLICY.hasGlobalAccess, // true
    }
  );
}
```

- A configured agent → its configured policy (unchanged).
- An absent agent → the synthesized object above; **never throws**.
- A missing or empty config file (`loadPolicies` returns `[]`) → every agent is absent → **every
  agent gets the default**. This is intended and must be documented.

**A4.** The error string `agent '<name>' is not configured in core-brain config.json` is **removed**
from production code. No production path may emit it after this slice.

**A5.** `who` for an absent agent returns exactly
`{ agent: "<name>", name: "<name>", private: false, hasGlobalAccess: true, dataDir: "<root>" }`.

**A6.** The default is resolved against the **trusted identity** only. Identity continues to come from
the engine session/hook (`index.ts` → `resolveSessionAgent`), never from a tool input. The existing
behaviour when the agent name **cannot be resolved at all** (no name) is unchanged: it stays refused
by `index.ts` and is out of scope here.

---

## 3. Rule B — a configured row may omit `private` and/or `hasGlobalAccess`

**B1.** In `loadPolicies()`, a field whose key is **absent** (`undefined`) takes the default:

| Field | Absent (`undefined`) | Present |
|---|---|---|
| `hasGlobalAccess` | `true` | must be boolean, else `InvalidConfigurationError` (message unchanged) |
| `private` | `false` | must be boolean, else `InvalidConfigurationError` (message unchanged) |

**B2.** "Absent" means the key is missing in the JSON object. A present `null`, string, number or any
non-boolean **still throws** `InvalidConfigurationError` with the existing message
(`... needs a boolean 'hasGlobalAccess'` / `... needs a boolean 'private'`). The defaults are a
missing-key rule, **not** a coercion rule.

**B3.** After resolution, the **unchanged** invalid-row rule applies to the resolved values:
`private === false && hasGlobalAccess === false` → throw `InvalidConfigurationError` (message
unchanged: `... is a public agent without global access (private:false + hasGlobalAccess:false) —
invalid row, refusing to start`).

Consequences that MUST be pinned by tests:
- `{ "name": "X" }` → `{ private:false, hasGlobalAccess:true }` — valid.
- `{ "name": "X", "private": true }` → `{ private:true, hasGlobalAccess:true }` — valid.
- `{ "name": "X", "hasGlobalAccess": true }` → `{ private:false, hasGlobalAccess:true }` — valid.
- `{ "name": "X", "hasGlobalAccess": false }` → `private` defaults to `false` →
  `private:false + hasGlobalAccess:false` → **throws** (the defaults and the invalid-row rule
  interact; this is the regression most likely to be missed).
- `{ "name": "X", "hasGlobalAccess": false, "private": false }` → **throws** (unchanged).

**B4.** Everything else in `loadPolicies()` is **unchanged**: the non-empty string `name` check, the
filename-safe name check (`/^[A-Za-z0-9][A-Za-z0-9._-]*$/`), the duplicate-name detection, the
`agents` must-be-an-array check, JSON parse errors, and the `InvalidConfigurationError` type/code.

---

## 4. Read and write consequences of the default — and the read-union decision

An absent agent `U` resolves to `{ private:false, hasGlobalAccess:true }` **for its own calls**:

### 4.1 WRITE (`store`)

| Target | Result for `U` |
|---|---|
| `self` | allowed → `agents/U/memories.json` (record `agent:"U"`, `scope:"agent"`) |
| `agent:U` | treated as `self` (unchanged) |
| `global` | **allowed** (`hasGlobalAccess` true) → `global/memories.json` (record `agent:"global"`, `scope:"global"`) |
| `agent:<B>`, `B ≠ U` | **always refused** — cross-agent writes are never allowed (unchanged). The message is the existing one (`target is private ...` / `cross-agent write not allowed (another agent's space is never writable)` / `not configured` when `B` is absent); no new behaviour. |

### 4.2 READ (`recall`)

| `from` | Result for `U` |
|---|---|
| `"self"` | own namespace only (works even before the first write — empty result) |
| `"global"` | **allowed** (default `hasGlobalAccess`) |
| `"agent:U"` | own namespace |
| omitted | own namespace + `global` + every **configured** `private===false` agent's namespace |
| `"agent:<B>"`, `B` configured & public | allowed (unchanged) |
| `"agent:<B>"`, `B` configured & private | omitted, not errored (unchanged) |
| `"agent:<X>"`, `X` absent | **omitted, not errored** — see the union decision below |

### 4.3 Read-union decision (explicit)

**Decision: a synthesized (absent) agent's namespace does NOT participate in the §6.1 public read
union of other agents, and is not readable by others via `from:"agent:<X>"`.**

Rules that follow:
- The default union for **any** caller continues to iterate **only over the configured `policies`
  array**. It is **not** extended to on-disk namespaces.
- `lookup()` used by `authorizeRead`/`authorizeWrite` continues to consult **only** the configured
  policy map. The synthesized default is never registered there (A1).
- Therefore a namespace becomes a read target for others **only** by being a configured row with
  `private:false`. An absent agent's namespace is readable **only by itself**.

**Why (justification):**
1. **Correct semantics of the union.** The union is defined over *registered* agents (the config is
   the registry). An absent agent is, by definition, not registered; giving it a caller fallback
   does not register its namespace as a source.
2. **No filesystem-driven authorization.** Including absent namespaces would require the authorizer
   to enumerate `<root>/agents/*/` (or `vectors/*/`) at read time. That injects disk state into an
   authorization decision, makes reads depend on unrelated agents' write history, and turns any
   stray directory into a world-readable namespace — a new leak surface for zero requested benefit.
3. **Fail-safe direction.** Read denial is silent omission (§7.2), never an error, so leaving absent
   namespaces unreadable is the conservative side.
4. **Scope containment.** The USER's confirmed scope is (A) absent → default policy and (B) omitted
   fields → default. Cross-agent read expansion (namespace discovery) was not requested and is a
   separate slice (§9).

**Rejected alternative:** extend the union (and explicit `from:"agent:<X>"`) to include namespaces
found on disk, treating them as public because the default is `private:false`. Rejected for reasons
2–4 above.

**Consequence stated honestly:** an absent agent's `who` reports `private:false`, yet its namespace is
not readable by other agents (it is "public" only in the sense that it was never declared private).
If the USER later wants absent namespaces to be readable by others, that is a **new** decision
requiring namespace discovery — it is not silently implied by (A)/(B).

---

## 5. File-by-file change list

### 5.1 Production (the only code change)

| File | Change |
|---|---|
| `global/opencode/plugins/core-brain/store.ts` | (1) add `DEFAULT_POLICY = { private:false, hasGlobalAccess:true }`; (2) `loadPolicies()`: resolve absent `hasGlobalAccess`→`true` and absent `private`→`false`, keep present-non-boolean throws + duplicate + invalid-row (B1–B4); (3) `requirePolicy()` returns the configured policy or the synthesized default, never throws (A3); (4) update the JSDoc of `loadPolicies`/`requirePolicy` to state the new rule. **No change** to `authorizeRead`/`authorizeWrite`. |
| `global/opencode/plugins/core-brain/types.ts` | **No change.** `AgentPolicy` shape is unchanged. |
| `global/opencode/plugins/core-brain/index.ts` | **No change.** Identity resolution and error formatting stay; nothing there blocks on the config lookup. |
| `global/opencode/plugins/core-brain/config.json` (seed) | **No change** (all rows already carry explicit booleans). |

### 5.2 Tests (the executable proof)

| File | Change |
|---|---|
| `global/opencode/plugins/core-brain/test/matrix.selftest.mjs` | Add matrix lines **15, 16, 17, 18, 19** (exact bodies in §7) and the fixtures they need: `config.omitted.json` (`{ agents: [{ name: "CB_OMITTED" }] }`), `config.partial-invalid.json` (`{ agents: [{ name: "CB_HALF", hasGlobalAccess: false }] }`), `config.badtype.json` (a row with a present non-boolean). Existing lines 7–14 and the `CB_BETA` precondition stay **byte-identical**. |
| `global/opencode/plugins/core-brain/test/CONTRACT.md` | Update the "8 matrix lines" contract: §1 (`7 PASS … 19 PASS` / `13/13`), §3 fixtures table (new files), §4 add lines 15–19 with the same setup/observe/literal style, §5 (`n/13`), §6 scope note (no longer "unlisted → refused"). |
| `global/opencode/plugins/core-brain/check.sh` | Header comment: `7 PASS … 19 PASS`, `13/13 lines PASS`; STATUS note. The 4-agent `config.json` fixture is unchanged. No pass/fail logic change. |

### 5.3 Documentation that states the old rule (must be reconciled)

| File | Sections to update |
|---|---|
| `docs/specs/core-brain-default-policy-spec.md` | **This spec** (the new law). |
| `docs/specs/core-brain-plugin.md` | Q3 (line 39: `hasGlobalAccess`/`private` are no longer "required"); Q6 (line 42: absent → default, not fail-closed); §6.3 table (add the absent/incomplete row); §6.4 (line 171: remove "unlisted agent = deny"); §7.1 (lines 177–180: replace the "not found → fail-closed" bullet); §8 (line 209: "unlisted agents … zero behavioural change" — now they get the default *if they call `core_memory`*; the hook stays inert); §9.2 (add matrix rows 15–19); §9 Q9 step 5 (line 271: the inert-hook proof stays, but not because the agent is refused). |
| `docs/core_brain_specification.md` | §2 schema: mark `hasGlobalAccess` and `private` as **optional with defaults** (`true` / `false`); §2 rules: add the default rule and the absent-agent default; §4 matrix: add the absent / omitted row. |
| `docs/specs/core-brain-mcp.md` | Lines 26–28, 87, 135, 141, 213, 223 and 260 attribute the fail-closed rule to the plugin. Update the text so it no longer attributes a removed plugin rule. **The future MCP server's own behaviour for an unlisted agent is out of scope** (§9): it is a separate surface with no implementation, and the USER's decision covers the **plugin**. |
| `docs/specs/core-brain-v2.md` | Lines 40, 77, 160 state "fail-closed stays / is untouched". Add the superseded note (isolation stays; the absent-agent default changes). |
| `docs/specs/core-brain-migration-plan.md` | Lines 64, 101 ("an unlisted one is still refused"). Update to the new default. |
| `docs/adr/0001-core-brain-memory-isolation.md` | D5 ("Fail-closed: unlisted agents get nothing") is **superseded**. ADRs are immutable: append a one-line `Superseded by ADR-0003` marker to D5 (and to the line-231 / line-260 alternatives text) and record the reversal in a **new** `docs/adr/0003-default-policy-for-unlisted-agents.md`. Do not silently rewrite D5's prose. |
| `global/opencode/plugins/core-brain/README.md` | Line 49 (identity section), lines 63–67 (Fields table: `Required` column), lines 78–93 (validation rules + the "record for an agent not listed is refused" paragraph), lines 99–104 (access matrix: add the default row), line 233 ("an agent that is not listed sees no change"). Update all of them. |
| `global/opencode/plugins/core-brain/INSTALACAO.md` | Troubleshooting row line 123 (`ERROR: agent '<name>' is not configured …`) — remove/replace with the new default behaviour note. |
| `CHANGELOG.md` | New `### Changed` entry under `[Unreleased]`: permanent behaviour change — absent/incomplete config rows now default to `private:false` + `hasGlobalAccess:true`; the invalid-row rule is unchanged; matrix extended to 13 lines. |
| `TASKS.md` | The backlog item at ~line 93 states "unlisted agents fail-closed" — update its wording to match. |

---

## 6. Acceptance criteria (each executable)

| # | Criterion | Executable evidence |
|---|---|---|
| AC1 | The full matrix is green | `bash global/opencode/plugins/core-brain/check.sh` prints `7 PASS … 19 PASS`, a `13/13 lines PASS` summary, exits `0`. |
| AC2 | Absent agent gets the default and can use it | Line 15: `who("CB_UNLISTED")` → `private:false`, `hasGlobalAccess:true`; `store target:"global"` succeeds with `ns:"global"`; `recall from:"global"` returns that exact text; `store self` + `recall from:"self"` returns the exact text. |
| AC3 | A row omitting both fields no longer throws | Line 16: `createEngine({ configPath: config.omitted.json })` does **not** throw; `who("CB_OMITTED")` → `private:false`, `hasGlobalAccess:true`. |
| AC4 | Omitted `private` + `hasGlobalAccess:false` is still invalid | Line 17: `createEngine({ configPath: config.partial-invalid.json })` **throws** `InvalidConfigurationError` with `.code === "INVALID_CONFIGURATION"`, message names `CB_HALF` and `public agent without global access`. |
| AC5 | The explicit invalid row still throws | Line 12 (unchanged) with `CB_DELTA` `{private:false,hasGlobalAccess:false}`. |
| AC6 | A present non-boolean still throws | Line 18: rows with `private:"yes"` and with `hasGlobalAccess:"yes"` each throw `InvalidConfigurationError` naming the agent and the boolean rule. |
| AC7 | The union decision is pinned | Line 19: `CB_ALPHA recall from:"agent:CB_UNLISTED"` → empty `results`, `scanned` excludes `CB_UNLISTED`; `CB_ALPHA recall` (default union) → `scanned` excludes `CB_UNLISTED`. |
| AC8 | No production path keeps the fail-closed string | `grep -n "is not configured in core-brain config.json" global/opencode/plugins/core-brain/store.ts` → **no match**. |
| AC9 | Docs + changelog updated | §5.3 files updated; `CHANGELOG.md` has the `### Changed` entry. |
| AC10 | Non-regression | Lines 7–14 still PASS with their existing literal expectations (see §8). |

**Layer B note.** The matrix (Layer A) drives the real `store.ts` + authorizer with the trusted
identity injected directly — that is the declared contract (§9.2 of the plugin spec). Identity
*wiring* in a live session is already covered by the existing Layer B smoke and is not re-opened by
this slice. The recommended (non-blocking) confirmation is one headless run of an unlisted agent
calling `core_memory who` and seeing the default policy.

---

## 7. Exact matrix lines to add (`test/matrix.selftest.mjs`)

Fixtures written by the selftest next to `VALID_CONFIG`:

```js
const OMITTED_CONFIG       = join(HOME, "config.omitted.json");
const PARTIAL_INVALID_CONFIG = join(HOME, "config.partial-invalid.json");
const BADTYPE_CONFIG       = join(HOME, "config.badtype.json");
```

1. `config.omitted.json`  → `{ "agents": [ { "name": "CB_OMITTED" } ] }`
2. `config.partial-invalid.json` → `{ "agents": [ { "name": "CB_HALF", "hasGlobalAccess": false } ] }`
3. `config.badtype.json` → `{ "agents": [ { "name": "CB_BADTYPE", "hasGlobalAccess": true, "private": "yes" } ] }`

```js
// 15 — an agent absent from config.json gets the default policy and can use it.
row(15, "CB_UNLISTED who -> private:false+hasGlobalAccess:true; store/recall global round-trips", () => {
  const w = engine.invoke("CB_UNLISTED", { op: "who" });
  assert((w.agent || w.name) === "CB_UNLISTED", `who identity mismatch: ${JSON.stringify(w)}`);
  assert(w.private === false && w.hasGlobalAccess === true, `default policy mismatch: ${JSON.stringify(w)}`);
  const mg = marker("l15-unlisted-global");
  const sg = engine.invoke("CB_UNLISTED", { op: "store", text: mg, target: "global" });
  assert(sg.ok === true && sg.ns === "global", `global store mismatch: ${JSON.stringify(sg)}`);
  const rg = engine.invoke("CB_UNLISTED", { op: "recall", from: "global" });
  assert(rg.results.some((r) => r.text === mg), `global recall must echo ${JSON.stringify(mg)}`);
  const ms = marker("l15-unlisted-self");
  engine.invoke("CB_UNLISTED", { op: "store", text: ms, target: "self" });
  const rs = engine.invoke("CB_UNLISTED", { op: "recall", from: "self" });
  assert(rs.results.some((r) => r.text === ms), `self recall must echo ${JSON.stringify(ms)}`);
});

// 16 — a row omitting BOTH fields no longer throws and resolves to the defaults.
row(16, "config row omitting private+hasGlobalAccess -> loads; who -> false/true", () => {
  const e2 = createEngine({ home: HOME, configPath: OMITTED_CONFIG }); // must not throw
  const w = e2.invoke("CB_OMITTED", { op: "who" });
  assert(w.private === false && w.hasGlobalAccess === true, `omitted-row defaults mismatch: ${JSON.stringify(w)}`);
  const absent = e2.invoke("CB_ALSO_ABSENT", { op: "who" });
  assert(absent.private === false && absent.hasGlobalAccess === true, `absent on partial config mismatch: ${JSON.stringify(absent)}`);
});

// 17 — omitting `private` (-> false) with hasGlobalAccess:false is STILL an invalid row.
row(17, "row omitting private + hasGlobalAccess:false -> InvalidConfigurationError", () => {
  assertThrows(
    () => createEngine({ home: HOME, configPath: PARTIAL_INVALID_CONFIG }),
    (e) => e instanceof InvalidConfigurationError && e.code === "INVALID_CONFIGURATION" &&
           /CB_HALF/.test(e.message) && /public agent without global access/i.test(e.message),
    "omitted-private invalid row",
  );
});

// 18 — a present but non-boolean field is still rejected (defaults are not coercion).
row(18, "present non-boolean private/hasGlobalAccess -> InvalidConfigurationError", () => {
  assertThrows(
    () => createEngine({ home: HOME, configPath: BADTYPE_CONFIG }),
    (e) => e instanceof InvalidConfigurationError && /CB_BADTYPE/.test(e.message) && /boolean/i.test(e.message),
    "non-boolean private",
  );
  const bad2 = join(HOME, "config.badtype2.json");
  writeFileSync(bad2, `${JSON.stringify({ agents: [{ name: "CB_BADTYPE2", hasGlobalAccess: "yes" }] })}\n`);
  assertThrows(
    () => createEngine({ home: HOME, configPath: bad2 }),
    (e) => e instanceof InvalidConfigurationError && /CB_BADTYPE2/.test(e.message) && /boolean/i.test(e.message),
    "non-boolean hasGlobalAccess",
  );
});

// 19 — union decision: an absent agent's namespace is NOT a read target for others.
row(19, "unlisted namespace not in another agent's read union / from:agent:<X>", () => {
  const m = marker("l19-unlisted-self");
  engine.invoke("CB_UNLISTED", { op: "store", text: m, target: "self" });
  const direct = engine.invoke("CB_ALPHA", { op: "recall", from: "agent:CB_UNLISTED" });
  assert(direct.results.length === 0, `direct read must be empty, got ${direct.results.length}`);
  assert(!scannedMentions(direct.scanned, "CB_UNLISTED"), `scanned must exclude CB_UNLISTED: ${JSON.stringify(direct.scanned)}`);
  const union = engine.invoke("CB_ALPHA", { op: "recall" });
  assert(!scannedMentions(union.scanned, "CB_UNLISTED"), `default union must exclude CB_UNLISTED: ${JSON.stringify(union.scanned)}`);
});
```

---

## 8. Non-regression — lines 7–14

Every line 7–14 keeps its exact current label and literal expectation (see
`global/opencode/plugins/core-brain/test/CONTRACT.md` §4). They must pass **without edits**:

| Line | What must not change |
|---|---|
| 7 | `CB_GAMMA recall from:"agent:CB_BETA"` → empty results, `scanned` excludes `CB_BETA`. |
| 8 | `CB_ALPHA recall from:"agent:CB_BETA"` → empty results, `scanned` excludes `CB_BETA`. |
| 9 | `CB_GAMMA store target:"global"` → throws, message names `CB_GAMMA` + `no global access`. |
| 10 | `CB_BETA store global` → `CB_ALPHA recall from:"global"` echoes the text. |
| 11 | `CB_GAMMA store self` → `CB_GAMMA recall from:"self"` returns its record. |
| 12 | `createEngine(config.json with CB_DELTA {private:false,hasGlobalAccess:false})` → `InvalidConfigurationError`, names `CB_DELTA` + `public agent without global access`. |
| 13 | `CB_ALPHA store global` → `CB_ALPHA recall from:"global"` returns it. |
| 14 | `CB_ALPHA store target:"agent:CB_BETA"` → throws, names `CB_BETA` + `private`. |

The `CB_BETA` precondition (`who` → `private:true, hasGlobalAccess:true`) is unchanged.

---

## 9. Explicitly out of scope

1. **Read-union expansion / namespace discovery.** The default union and `from:"agent:<X>"` stay
   over configured policies only. Absent namespaces are never auto-discovered on disk (§4.3).
2. **The future MCP server's own behaviour** (`docs/specs/core-brain-mcp.md`, AC7). `core-brain-mcp`
   has no implementation; its unlisted-agent policy is a separate decision. Only its *claim about the
   plugin* is corrected here.
3. **Identity resolution failure.** `index.ts` refusing when no agent name can be resolved is
   unchanged.
4. **Name-pattern hardening for the synthesized policy.** The default is applied to any name the
   trusted layer resolves. Since namespaces derive paths from that name, a stricter pattern gate for
   unlisted names could be a future hardening item; it is not added here (it would partially
   re-introduce a refusal and contradict (A) as confirmed).
5. **Any config key beyond `name`/`private`/`hasGlobalAccess`** (e.g. `inject`), hooks, compaction,
   embedder, persistence format.
6. **Non-boolean coercion** — a present non-boolean is not a default; it stays an error.

---

## 10. Risk note for the USER (deliberate reversal of fail-closed)

This change **removes the fail-closed default**: any agent not present in `config.json` — and, if
`config.json` is missing or empty, **every** agent — now resolves to `private:false` +
`hasGlobalAccess:true`. Concretely, every such agent can now write to and read the shared `global`
namespace, and its own namespace is created on first use. The blast radius grows from "a misconfigured
agent is refused" to "an unconfigured agent participates in shared memory". The invalid-row rule
(`private:false + hasGlobalAccess:false`) is the only remaining config refusal. Mitigation: the
trusted-identity contract is unchanged (no impersonation), and cross-agent writes remain refused.
If this is not the intended reach, the USER should say so before implementation.

---

## 11. Handoff

- **To:** TESTER (pin §7 lines 15–19 in `test/CONTRACT.md`), then DEVELOPER (implement §2, §3, §5).
- **Gate for READY:** AC1–AC10 with executed evidence; lines 7–14 green unchanged; `CHANGELOG.md`
  updated. No `git add`/`commit`; no writes under `~/.config/opencode/`.
