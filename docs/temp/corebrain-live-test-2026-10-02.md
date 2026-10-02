# core-brain — live test (2026-10-02)

## 1. Direct live use — real plugin, real store (ORACLE session)

`core_memory` was exercised **in a live session** (Code Mode runtime), identity = ORACLE
(absent from config). Tag: `oracle-live-1790924640242`.

| # | Request | Result |
|---|---|---|
| 1 | `who` | `{"agent":"ORACLE","name":"ORACLE","private":false,"hasGlobalAccess":true,"dataDir":"/home/gandb/.core-brain"}` |
| 2 | `store self` | `{"ok":true,"id":"1b92…","scope":"agent","ns":"agent:ORACLE"}` |
| 3 | `recall from self` | echoes `oracle-live-1790924640242-self` |
| 4 | `store global` | `{"ok":true,"id":"3cb9…","scope":"global","ns":"global"}` |
| 5 | `recall from global` | echoes the global marker + prior `cb-alpha-global-*` records |
| 6 | `store agent:CB_BETA` | REFUSED: `agent 'ORACLE' cannot write to 'agent:CB_BETA': target is private — cross-agent write not allowed` |

**Verdict:** the plugin works live. An **unlisted** agent (ORACLE) receives the new default
policy `private:false` + `hasGlobalAccess:true`, can write/read `self` and `global`, and
cross-agent writes are still refused.

## 2. Config resolution (why it works without a config file)

`~/.core-brain/config.json` is absent → `resolveConfigPath()` falls through to the plugin
seed `~/.config/opencode/plugins/core-brain/config.json`, which configures
`CB_ALPHA` (public+global), `CB_BETA` (private+global), `CB_GAMMA` (private+no-global).
Every other agent (e.g. ORACLE) is absent → default policy.

## 3. Test agents (CB_*) — live as subagents (real sessions)

`opencode2 run` (headless) hangs in this environment, so the CB_* agents were launched as
real OpenCode **subagent sessions** instead — a stronger test: the plugin resolves their
real identity from the session.

| Agent | config | `who` | store | recall | refused |
|---|---|---|---|---|---|
| CB_ALPHA | public + global | private:false, hasGlobalAccess:true | global ok | global echoes | — |
| CB_BETA | private + global | private:true, hasGlobalAccess:true | self ok | self echoes | — |
| CB_GAMMA | private + no global | private:true, hasGlobalAccess:false | self ok | self echoes | `store global` → `ERROR: … no global access` |

## 4. Cross-agent read isolation (live, caller = ORACLE)

| `from` | result |
|---|---|
| `agent:CB_BETA` (private) | `{results:[], scanned:[]}` — omitted |
| `agent:CB_GAMMA` (private) | `{results:[], scanned:[]}` — omitted |
| `agent:CB_ALPHA` (public) | scanned `[agent:CB_ALPHA]` — allowed |
| default union | scanned `[agent:ORACLE, global, agent:CB_ALPHA]` — private namespaces excluded |

**Verdict:** the whole matrix holds **live**. Identity reaches the agents, they write/read in the
correct situations, and the refusals are correct.
