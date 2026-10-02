# core-brain — Test Contract (Layer A: executable isolation matrix)

- **Author:** TESTER
- **Date:** 2026-10-01
- **Spec:** `docs/specs/core-brain-plugin.md` §2 (criteria), §6 (access matrix), §7 (API), §9.2 (test plan);
  lines 15–19 pin `docs/specs/core-brain-default-policy-spec.md` §7 (default policy for absent/incomplete rows)
- **Artifacts:** `test/matrix.selftest.mjs`, `check.sh`
- **STATUS: EXECUTED (2026-10-01) for lines 7–14; EXTENDED (2026-10-02) and
  IMPLEMENTED for lines 15–19.** The plugin implementation exists (`store.ts` +
  `types.ts` + `index.ts`, installed and loaded). All lines were run by the ORACLE:
  **13/13 lines PASS, exit code 0** (Node v24.15.0), including lines 15–19, which
  pin `docs/specs/core-brain-default-policy-spec.md` §7 (absent/incomplete config
  rows default to `private:false` + `hasGlobalAccess:true`).

> This file is the law for Layer A. The DEVELOPER implements production code to
> satisfy it; the ORACLE judges the delivery against it. Any divergence between
> the spec and this file is resolved by the ORACLE, not silently by either side.

---

## 1. How to run

```bash
bash global/opencode/plugins/core-brain/check.sh
```

`check.sh` creates a disposable `CORE_BRAIN_HOME="$(mktemp -d)"`, writes the
4-agent `config.json`, runs `test/matrix.selftest.mjs`, prints the table
`7 PASS … 19 PASS` (13 rows), removes the temp root (rule 21) and exits non-zero
if any line fails. The selftest also writes the default-policy fixtures (§3). Node type-stripping is feature-detected (`--experimental-strip-types`
on Node ≥ 22.6; plain `node` on ≥ 23.6).

---

## 2. Test-facing contract (the seam the DEVELOPER must expose)

The spec pins the `core_memory` **tool JSON** (§7) but not the TypeScript export
names. §9.2 requires this layer to *instantiate the real store + authorizer*, so
the seam is pinned to the internal module §2 names (`store.ts`). Required named
exports:

```ts
// store.ts
export class InvalidConfigurationError extends Error {
  code: "INVALID_CONFIGURATION"; // §6.4
}

export function createEngine(options?: {
  home?: string;        // data root; defaults to CORE_BRAIN_HOME ?? ~/.core-brain
  configPath?: string;  // explicit config file (spec Q3 precedence)
}): Engine;

interface Engine {
  // `agentName` is TRUSTED infrastructure identity (session agent), injected by
  // the tool layer from the hook — NOT a `core_memory` input field (§7.1).
  // `invoke(agent, req)` is exactly `core_memory(req)` with that identity supplied.
  invoke(agentName: string, request: CoreMemoryRequest): CoreMemoryResult;
}

type CoreMemoryRequest =
  | { op: "who" }
  | { op: "store"; text: string; target?: "self" | "global" | `agent:${string}`; meta?: object }
  | { op: "recall"; query?: string; limit?: number; from?: "self" | "global" | `agent:${string}` };
```

Result shapes = spec §7.2 exactly:

- `who` → `{ agent, name, private, hasGlobalAccess, dataDir }`.
- `store` → `{ ok: true, id, scope, ns }`; throws on denial.
- `recall` → `{ results: [{ id, text, agent, scope, score, retrievals }], scanned: [ns…] }`.
  A cross-namespace read into a **private** target is **omitted, not errored** (§7.2):
  `results` is empty and `scanned` must not mention the private namespace.

**Why this seam and not the registered tool:** `setup(ctx)` needs the live V2
plugin context, which cannot be instantiated offline; §9.2 explicitly says this
layer drives the real store + authorizer. Driving `store.ts` exercises the SAME
authorizer the tool calls, with zero SDK dependency (spec Q2).

**VERIFIED (2026-10-01):** the export names above are exactly the ones the shipped
implementation exposes (`createEngine` and `InvalidConfigurationError` from
`store.ts`), and the full matrix runs green against them. Any future rename must
update this file and `matrix.selftest.mjs` together — the test is the contract,
so it changes first or not at all.

### Namespace labels
`scanned` entries are matched by **substring** (`"CB_BETA"`), so the exact label
format (`agent:CB_BETA` vs `CB_BETA`) is not over-pinned. A namespace that the
agent may not read must not appear in `scanned`.

---

## 3. Fixtures

| File | Written by | Content |
|------|-----------|---------|
| `$CORE_BRAIN_HOME/config.json` | `check.sh` | the 4 agents, **including** the invalid `CB_DELTA` row |
| `$CORE_BRAIN_HOME/config.valid.json` | `matrix.selftest.mjs` | `CB_ALPHA`, `CB_BETA`, `CB_GAMMA` only (drops the invalid row) |
| `$CORE_BRAIN_HOME/config.omitted.json` | `matrix.selftest.mjs` | `{ agents: [ { name: "CB_OMITTED" } ] }` — row omits **both** fields |
| `$CORE_BRAIN_HOME/config.partial-invalid.json` | `matrix.selftest.mjs` | `{ agents: [ { name: "CB_HALF", hasGlobalAccess: false } ] }` — omitted `private` defaults to `false`, so the resolved row is invalid |
| `$CORE_BRAIN_HOME/config.badtype.json` | `matrix.selftest.mjs` | `{ agents: [ { name: "CB_BADTYPE", hasGlobalAccess: true, private: "yes" } ] }` — present non-boolean |
| `$CORE_BRAIN_HOME/config.badtype2.json` | `matrix.selftest.mjs` (inside line 18) | `{ agents: [ { name: "CB_BADTYPE2", hasGlobalAccess: "yes" } ] }` — present non-boolean |

Lines 7–11 and 13–14 run on `config.valid.json`. Line 12 runs on the
`check.sh`-written `config.json` whose `CB_DELTA` entry must fail the whole init.
Line 15 runs on `config.valid.json` (the caller `CB_UNLISTED` is simply absent
from it). Line 16 runs on `config.omitted.json`; line 17 on
`config.partial-invalid.json`; line 18 on `config.badtype.json` plus the
`config.badtype2.json` it writes; line 19 runs on `config.valid.json` after line
15 wrote `CB_UNLISTED`'s self namespace.
Markers are unique per run (`cb-selftest-<nonce>-<tag>`) to prevent cross-line
contamination in the shared `global` namespace.

---

## 4. The 13 matrix lines — setup, observation, literal expectation

Every line asserts the **observable value**, never a bare boolean. Literal
asserted substrings are written `"…"`.

### Line 7 — private cannot be read by another private
- **Setup:** `CB_BETA` `store self` (marker) → `CB_GAMMA` `recall from:"agent:CB_BETA"`.
- **Observe:** `results` is an empty array; `scanned` is an array that does **not**
  contain the substring `"CB_BETA"`.
- **Covers:** USER criterion 7.

### Line 8 — private cannot be read by a public agent
- **Setup:** `CB_BETA` wrote its private record in line 7 → `CB_ALPHA` `recall from:"agent:CB_BETA"`.
- **Observe:** `results` empty; `scanned` does not contain `"CB_BETA"`.
- **Covers:** USER criterion 8.

### Line 9 — private without global access cannot write global
- **Setup:** `CB_GAMMA` `store target:"global"`.
- **Observe:** it **throws** an `Error` whose `message` contains `"CB_GAMMA"` **and**
  the reason `"no global access"` (§6.4). Nothing is written.
- **Covers:** USER criterion 9.

### Line 10 — private with global access writes global; a global agent reads it
- **Setup:** `CB_BETA` `store target:"global"` (marker `M10`) → `CB_ALPHA` `recall from:"global"`.
- **Observe:** `results` contains a record whose `text === M10` (the **echo** of the
  stored text, not a boolean).
- **Covers:** USER criterion 10.

### Line 11 — an agent reads its own private memory
- **Setup:** `CB_GAMMA` `store self` (marker `M11`) → `CB_GAMMA` `recall from:"self"`.
- **Observe:** `results` contains a record whose `text === M11`.
- **Covers:** USER criterion 11.

### Line 12 — invalid config fails at init (criteria 12 = configuration)
- **Setup:** `createEngine({ configPath: "$CORE_BRAIN_HOME/config.json" })`, whose
  `CB_DELTA` entry is `private:false` + `hasGlobalAccess:false`.
- **Observe:** it **throws** `InvalidConfigurationError` with
  `.code === "INVALID_CONFIGURATION"` and a `message` containing `"CB_DELTA"` **and**
  the rule `"public agent without global access"` (§6.4). Thrown at init — before
  any read/write.
- **Covers:** USER criterion 12.

### Line 13 — public with global access writes and reads global
- **Setup:** `CB_ALPHA` `store target:"global"` (marker `M13`) → `CB_ALPHA` `recall from:"global"`.
- **Observe:** `results` contains a record whose `text === M13`.
- **Covers:** USER criterion 13.

### Line 14 — public cannot write into another agent's private space
- **Setup:** `CB_ALPHA` `store target:"agent:CB_BETA"`.
- **Observe:** it **throws** an `Error` whose `message` contains `"CB_BETA"` **and**
  the reason `"private"` (§6.4). Nothing is written.
- **Covers:** USER criterion 14.

### Line 15 — an agent absent from `config.json` gets the default policy and can use it
- **Setup:** `CB_UNLISTED` is **absent** from `config.valid.json` → `who`; then
  `store target:"global"` (marker `M15g`) → `recall from:"global"`; then
  `store target:"self"` (marker `M15s`) → `recall from:"self"`.
- **Observe:** `who` reports `agent`/`name` `"CB_UNLISTED"`, `private === false`,
  `hasGlobalAccess === true`; the global store returns `{ ok:true, ns:"global" }`;
  the global recall echoes `M15g`; the self recall echoes `M15s`.
- **Covers:** spec §2 rule A, §4.1/§4.2, AC2. Never throws for the absent agent.

### Line 16 — a row omitting both fields loads and resolves to the defaults
- **Setup:** `createEngine({ configPath: "config.omitted.json" })` (row `CB_OMITTED`
  omits `private` **and** `hasGlobalAccess`) — must **not** throw → `who("CB_OMITTED")`;
  then `who("CB_ALSO_ABSENT")` (a name absent even from that config).
- **Observe:** both report `private === false`, `hasGlobalAccess === true`.
- **Covers:** spec §3 B1, AC3.

### Line 17 — omitted `private` + `hasGlobalAccess:false` is still an invalid row
- **Setup:** `createEngine({ configPath: "config.partial-invalid.json" })`
  (`{ name:"CB_HALF", hasGlobalAccess:false }`; `private` is omitted).
- **Observe:** it **throws** `InvalidConfigurationError` with
  `.code === "INVALID_CONFIGURATION"` and a `message` containing `"CB_HALF"` **and**
  `"public agent without global access"` — the omitted `private` resolves to `false`
  first, then the unchanged invalid-row rule fires.
- **Covers:** spec §3 B1–B3, AC4 (the interaction most likely to be missed).

### Line 18 — a present non-boolean is still rejected (defaults are not coercion)
- **Setup:** `createEngine({ configPath: "config.badtype.json" })`
  (`private:"yes"`), then line 18 writes `config.badtype2.json`
  (`hasGlobalAccess:"yes"`) and calls `createEngine` on it.
- **Observe:** each call **throws** `InvalidConfigurationError` whose `message`
  names the agent (`"CB_BADTYPE"` / `"CB_BADTYPE2"`) **and** contains `"boolean"`.
- **Covers:** spec §3 B2, AC6.

### Line 19 — an absent agent's namespace is NOT a read target for others
- **Setup:** `CB_UNLISTED` `store self` (marker) → `CB_ALPHA`
  `recall from:"agent:CB_UNLISTED"`; then `CB_ALPHA recall` (default union).
- **Observe:** the direct read returns an empty `results` **and** `scanned` does not
  contain `"CB_UNLISTED"`; the default union's `scanned` also does not contain
  `"CB_UNLISTED"`.
- **Covers:** spec §4.3 union decision, AC7.

---

## 5. Pass / fail semantics

- The selftest prints one line per matrix row: `7 PASS … 19 PASS` (or `FAIL` with
  the literal mismatch as detail) and a `n/13 lines PASS` summary.
- `check.sh` exits `0` only when all 13 rows PASS; any FAIL → non-zero.
- A row that does not discriminate (e.g. passes while the authorizer is bypassed)
  is a **defect in the test**, not a pass: the assertions above name the forbidden
  namespace / required message, so a no-op authorizer fails lines 7, 8, 14 and 19.
- Lines 15–19 pin
  `docs/specs/core-brain-default-policy-spec.md` §2/§3, now implemented: they PASS
  against the shipped `store.ts`. Their RED run (before implementation) was the
  evidence that they discriminate. Line 18 (present non-boolean) passes both before
  and after, because it pins unchanged behaviour.
- **Precondition:** `who("CB_BETA")` must resolve to `private:true`,
  `hasGlobalAccess:true`; if it fails the run aborts with exit code `2`.
- Missing implementation / missing exports → exit code `2` with an explicit
  message (not silently green).

---

## 6. Scope — what these artifacts do NOT cover / assert

- **Execution (Layer A):** all 13 lines were executed 2026-10-02 — `check.sh`
  printed the `7 PASS … 19 PASS` table (13/13 lines PASS) and exited `0` (Node
  v24.15.0). Lines 7–14 were first executed 2026-10-01; lines 15–19 were pinned
  2026-10-02 and are now GREEN after `store.ts` implemented the default-policy spec.
- **Default policy for absent/incomplete rows:** the old fail-closed rule is gone
  by design — an unlisted agent is **no longer refused**; it gets
  `private:false` + `hasGlobalAccess:true` (line 15), and a row that omits those
  keys gets the same defaults (line 16). The only remaining config refusal is the
  explicit invalid row `private:false + hasGlobalAccess:false`, which now also
  catches a row that omits `private` while declaring `hasGlobalAccess:false`
  (line 17). An absent agent's namespace is **not** part of other agents' read
  union (line 19, spec §4.3).
- **Layer B (headless `opencode2 run --agent CB_X`):** out of scope of these
  artifacts (§9.3) — no `opencode2` invocation is declared here. It was executed
  separately by the ORACLE (2026-10-01): `CB_BETA`, `CB_GAMMA` and `CB_ALPHA` ran
  headless and returned the expected results and refusals.
- **Criteria 1–6 and 15–16 of the plugin spec** (README/INSTALACAO/zero-collision/
  non-regression/persistence/V2 shape): out of scope of Layer A; the matrix covers
  lines 7–19 (criterion 12 is the configuration rule, proven by line 12).
- **Embedder quality / persistence layout:** not asserted here.
- The `chmod +x` bit on `check.sh` was not applied by TESTER (no shell at
  authoring); run it as `bash check.sh`.
- The test-facing export names (§2) are the ones the shipped implementation
  exposes — **verified** against it (2026-10-01).

---

## 7. Non-negotiables (repo rules)

- This is test code, never production code; the DEVELOPER owns `index.ts`,
  `store.ts`, `types.ts`, `package.json`, `tsconfig.json`, `shims.d.ts`.
- No `git commit` / `git add` / `git stash`; no writes under `~/.config/opencode/`.
- No resource left open: `check.sh` removes its `CORE_BRAIN_HOME` on exit (rule 21).
