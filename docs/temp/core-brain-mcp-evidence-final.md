# core-brain MCP — executed evidence (ORACLE's own record)

Judge: ORACLE. Date: 2026-10-02. Machine: this host, Node **v24.15.0**, opencode **2.0.21**.
Working folder: `/media/gandb/workspace/oesc/core-brain`.

Every line below was **executed by the ORACLE in this session** and the value shown is the literal
observed output (not a summary and not a claim from another agent).

## 1. Plugin isolation matrix (AC8 — must not regress)

```
$ bash global/opencode/plugins/core-brain/check.sh
13/13 lines PASS
core-brain check.sh: all matrix lines PASS (CORE_BRAIN_HOME cleaned up)
exit=0
```

Version-agnostic against the baseline: `check.sh` + `test/matrix.selftest.mjs` sha256 are
**identical** to the pre-change baseline (`docs/temp/core-brain-mcp-baseline.sha256`).

## 2. MCP transport suite (AC2, AC3, AC7, S1–S7 shapes)

```
$ bash global/opencode/plugins/core-brain/mcp/check.sh
18/18 lines PASS
exit=0
```

Asserted: `initialize` echo + `serverInfo` + `capabilities.tools`; a notification produces no
response; `tools/list` = exactly {core_admin, core_doctor, core_recall, core_receipt, core_status};
every `inputSchema` closed; the §4.3 recall sentence present; `core_recall` scans `["global"]` only;
`core_recall` refuses `from` with `-32602`; `core_doctor` = the 5 checks in order; `core_status` and
`core_receipt` shapes; `core_admin export` writes the file; unknown admin action `-32602`; unknown
tool `-32602`; unknown method `-32601`; unparsable line `-32700`.

## 3. Type safety (strict)

```
$ npx -y -p typescript@5 tsc -p .        # strict: true, noEmit, types: []
exit=0, no output
```

## 4. Zero runtime dependencies (AC9)

```
$ ls node_modules mcp/node_modules   -> No such file or directory (both)
$ node -e "require('./package.json').dependencies" -> undefined
$ echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}' | node mcp/server.js
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-11-25","serverInfo":{"name":"core-brain","version":"0.1.0"},"capabilities":{"tools":{}}}}
$ …same… | node --experimental-strip-types mcp/server.js
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-11-25","serverInfo":{"name":"core-brain","version":"0.1.0"},"capabilities":{"tools":{}}}}
```

Starts under **plain `node`** and with the flag (Node 24 strips types itself).

## 5. Destination environment (AC1 — coexistence with PLUR)

```
$ opencode2 mcp list
✓ core-brain              connected
✓ plur                    connected
✗ voicebox                failed: Unable to connect…      (pre-existing, unrelated)
```

Live config entry installed in `~/.config/opencode/opencode.json` →
`mcp.servers["core-brain"] = { type:"local", command:["node", "/home/gandb/.config/opencode/plugins/core-brain/mcp/server.js"], environment:{ CORE_BRAIN_HOME:"/home/gandb/.core-brain" } }`.
Backup taken first: `/tmp/opencode/opencode.json.bak-152851`.

## 6. Live MCP calls, inside this session (AC2 shapes on the real store)

```
core-brain.core_status  -> {"storageRoot":"/home/gandb/.core-brain","configPath":"/home/gandb/.config/opencode/plugins/core-brain/config.json","embedder":"hash-ngram-v1","dim":256,
                            "namespaces":[{"ns":"global","records":5,"retired":0,"retrievals":26},{"ns":"agent:CB_BETA",…},{"ns":"agent:CB_GAMMA",…},{"ns":"agent:ORACLE",…}],"totals":{…}}
core-brain.core_doctor  -> {"ok":true,"checks":[{"id":"config-rows","ok":true,"detail":"3 agent row(s) valid"},
                            {"id":"embedder-dim","ok":true,…},{"id":"store-writable","ok":true,"detail":"data root '/home/gandb/.core-brain' is writable"},
                            {"id":"vector-record-pairing","ok":true,…},{"id":"vector-dimension","ok":true,…}]}
core-brain.core_receipt -> {"stored":10,"retrieved":34,"hits":10,"byNamespace":[{"ns":"global","stored":5,…},…]}
core-brain.core_recall  -> results from scope "global" only (no memory text of any private namespace)
```

## 7. Engine-level live probe of the new ops (AC4, AC5, S7)

`/tmp/opencode/cb-admin-probe.mjs` on a disposable `CORE_BRAIN_HOME` → **15 PASS / 0 FAIL**:

```
PASS  AC5 feedback moves ranking — first=f1fad1f3 feedbacked=f1fad1f3 usefulness={"useful":1,"useless":0}
PASS  feedback on unreadable record refused — core_memory feedback: agent 'CB_ALPHA' cannot give feedback on record '…': the record is not readable by 'CB_ALPHA' (private namespace or unknown id)
PASS  AC4 forget retires without deleting — retired=1 inRecall=false textOnDisk=true status.retired=1
PASS  status carries no memory text
PASS  status shape
PASS  receipt shape — {"stored":5,"retrieved":6,"hits":5}
PASS  doctor 5 checks all ok — config-rows,embedder-dim,store-writable,vector-record-pairing,vector-dimension
PASS  admin export writes the file — "wrote …/export.json (3 namespace(s), 5 record(s))"
PASS  admin import never overwrites existing ids — before=3 after=3 detail=imported 0 record(s), skipped 5 existing
PASS  admin reindex idempotent — 3 namespace(s) processed, 5 vector(s) written
PASS  admin compact drops retired vectors — 1 vector(s) dropped
PASS  purge private ns refused without force — core-brain admin purge: namespace 'agent:CB_BETA' is private — pass { ns, force: true } to purge it
PASS  purge private ns works with force — removed namespace 'agent:CB_BETA'
PASS  unknown admin action throws single shape — core-brain admin: unknown action 'nope' (expected purge|reindex|export|import|compact)
PASS  criterion 17 unlisted agent default policy — {"private":false,"hasGlobalAccess":true} ns=agent:MYSTERY_AGENT
```

**Honest limitation (ARCHITECT gap 2/3):** this probe lives in `/tmp`, not in the repo; AC4/AC5/S7
are therefore **executed but not pinned**. AC6's **detection** path (a seeded defect making each
`core_doctor` check fail with its named `detail`) is **NOT executed anywhere** — only the clean
"5 checks ok" path. That gap is returned to the DEVELOPER.

## 8. Live isolation probes with the dedicated test agents (USER criteria 7–14, 17)

Raw JSON reported by each agent's own session (identity resolved by the plugin from the session):

| Criterion | Agent | Observed (raw) |
|---|---|---|
| 11 own-private read-back | CB_BETA | stored `BETAPRIV-83031` → recall self returned it, score `0.735767`, `scanned:["agent:CB_BETA"]` |
| 10 global write readable by another global agent | CB_BETA→CB_ALPHA | CB_BETA stored `BETAGLOB-83031` in `global` (`ok:true`); CB_ALPHA's `recall from:"global"` returned it **first**, score `0.748777` |
| 9 no-global write refused | CB_GAMMA | `ERROR: core_memory store: agent 'CB_GAMMA' cannot write to 'global': no global access` |
| 7 private ⟂ private | CB_GAMMA→CB_BETA | `{"results":[],"scanned":[]}`; CB_GAMMA's full read union was `["agent:CB_GAMMA","agent:CB_ALPHA"]` |
| 11 own-private read-back | CB_GAMMA | stored `GAMMAPRIV-83031` → recall self returned it, score `0.781597` |
| 8 private ⟂ public | CB_ALPHA→CB_BETA | `{"results":[],"scanned":[]}` |
| 13 public global round-trip | CB_ALPHA | stored `ALPHAGLOB-83031` → recall global returned it first, score `0.752403` |
| 14 public → private write refused | CB_ALPHA→CB_BETA | `ERROR: core_memory store: agent 'CB_ALPHA' cannot write to 'agent:CB_BETA': target is private — cross-agent write not allowed` |
| 17 unlisted agent = default policy | CB_DELTA | `{"agent":"CB_DELTA","private":false,"hasGlobalAccess":true,…}`; store self + store global both `ok:true` |

**Criterion 12** (invalid `private:false` + `hasGlobalAccess:false` row fails at init with a
descriptive error) is proven by the matrix: `check.sh` lines 17 and 18 PASS
(`row omitting private + hasGlobalAccess:false -> InvalidConfigurationError`).

**Criterion 6** (dedicated test agents): `CB_ALPHA`/`CB_BETA`/`CB_GAMMA`/`CB_DELTA` exist in
`~/.config/opencode/agent/` (mirror) and are the dedicated isolation agents; they are byte-identical
to the pre-change baseline and the slice creates no new agent.

## 9. Non-regression

```
20 pre-existing agent files (mirror, excluding CB_*) : byte-identical to the baseline
4 CB_* agent files                                   : byte-identical to the baseline
check.sh + matrix.selftest.mjs                        : byte-identical to the baseline
git HEAD                                             : f6582f5 -> cf30642
```

**`cf30642` was NOT created by this task.** It was produced by a *different* opencode session
("auditoria default policy", flow ORACLE does it all, `ses_f06055d18ffetklacrOTycxMjZ8g`) that
committed, reverted and reset the same repository while this task was running (`git reflog`). This
task's session executed **no git write command**; its file changes remain uncommitted in the working
tree (`git status` shows only the expected modified/new files). Reported to the USER at the time.

`~/.plur/` was not touched by this plugin; PLUR's own files change because PLUR itself is in use in
this session. The plugin reads no PLUR path.

## 10. Correction — a read is not side-effect free

`recallOp` increments `MemoryRecord.retrievals` and rewrites `memories.json` for every namespace
that produced a hit. `core_memory op:"recall"` and the MCP `core_recall` therefore **do** write.
Only `core_status`, `core_doctor` and `core_receipt` are pure reads.

## 11. Open gaps returned to the DEVELOPER (ARCHITECT verdict, accepted by the judge)

1. `mcp/check.sh` is a transport runner only — it does **not** seed the Layer-A fixtures the
   §10/D8 plan requires.
2. AC4/AC5/S7 are executed (see §7) but **not pinned** in the repo suite.
3. **AC6 detection is unexecuted** — no seeded defect proves each `core_doctor` check reports a
   failing `detail`.
4. The §4.3 sentence is not byte-verbatim in `server.js`/the test (backticks around `core_memory`).
5. Two error shapes coexist in `core_admin` (JSON-RPC `-32602` vs `isError:true`) where §3 says one.
6. `README.md` lines 15/135/165/198 + "What it is" still describe 3 ops and the old tie-break.
