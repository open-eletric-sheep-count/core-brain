# core-brain — Test Contract (Layer A: executable isolation matrix)

- **Author:** TESTER
- **Date:** 2026-10-01
- **Spec:** `docs/specs/core-brain-plugin.md` §2 (criteria), §6 (access matrix), §7 (API), §9.2 (test plan)
- **Artifacts:** `test/matrix.selftest.mjs`, `check.sh`
- **STATUS: EXECUTED (2026-10-01).** The plugin implementation exists
  (`store.ts` + `types.ts` + `index.ts`, installed and loaded) and this matrix has
  been run by the ORACLE: **8/8 lines PASS, exit code 0** (Node v24.15.0). This
  file remains the contract the implementation satisfies; the expectations below
  are now measured results for rules 7–14.

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
`7 PASS … 14 PASS`, removes the temp root (rule 21) and exits non-zero if any
line fails. Node type-stripping is feature-detected (`--experimental-strip-types`
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

Lines 7–11 and 13–14 run on `config.valid.json`. Line 12 runs on the
`check.sh`-written `config.json` whose `CB_DELTA` entry must fail the whole init.
Markers are unique per run (`cb-selftest-<nonce>-<tag>`) to prevent cross-line
contamination in the shared `global` namespace.

---

## 4. The 8 matrix lines — setup, observation, literal expectation

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

---

## 5. Pass / fail semantics

- The selftest prints one line per matrix row: `7 PASS … 14 PASS` (or `FAIL` with
  the literal mismatch as detail) and a `n/8 lines PASS` summary.
- `check.sh` exits `0` only when all 8 rows PASS; any FAIL → non-zero.
- A row that does not discriminate (e.g. passes while the authorizer is bypassed)
  is a **defect in the test**, not a pass: the assertions above name the forbidden
  namespace / required message, so a no-op authorizer fails lines 7, 8 and 14.
- **Precondition:** `who("CB_BETA")` must resolve to `private:true`,
  `hasGlobalAccess:true`; if it fails the run aborts with exit code `2`.
- Missing implementation / missing exports → exit code `2` with an explicit
  message (not silently green).

---

## 6. Scope — what these artifacts do NOT cover / assert

- **Execution (Layer A):** executed 2026-10-01 — `check.sh` printed the
  `7 PASS … 14 PASS` table (8/8 lines PASS) and exited `0` (Node v24.15.0).
- **Layer B (headless `opencode2 run --agent CB_X`):** out of scope of these
  artifacts (§9.3) — no `opencode2` invocation is declared here. It was executed
  separately by the ORACLE (2026-10-01): `CB_BETA`, `CB_GAMMA` and `CB_ALPHA` ran
  headless and returned the expected results and refusals.
- **Criteria 1–6 and 15–16** (README/INSTALACAO/zero-collision/non-regression/
  persistence/V2 shape): out of scope of Layer A; the matrix covers 7–14 only
  (criterion 12 is the configuration rule, proven by line 12).
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
