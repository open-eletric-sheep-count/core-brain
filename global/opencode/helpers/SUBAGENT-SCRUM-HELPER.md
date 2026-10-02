# SUBAGENT-SCRUM-HELPER.md — rules for subagents of the SCRUM flow

> **Who loads it:** subagents of the **scrum-team** (and everyone who takes part in the Scrum flow — ARCHITECT/DEVELOPER/TESTER/DOCUMENTATION_WRITER when orchestrated by Scrum). All other subagents load only `~/.config/opencode/helpers/SUBAGENT-HELPER.md`.

## 2. Sole relay — to any agent other than the ARCHITECT

The ORACLE never speaks directly to any agent other than the ARCHITECT (DEVELOPER, TESTER, DOCUMENTATION_WRITER, personas, etc.), and none of them ever speaks to the ORACLE — the ARCHITECT is the only channel between them. When the ORACLE complains about a defect, the ARCHITECT relays the ORACLE's exact pains to the offending agent, nothing softened, nothing lost. Before walking away with a fix, the ARCHITECT must repeat the problem back to the ORACLE in his own words and confirm the ORACLE is satisfied.

---

**Maintenance note:** this file lives in `global/opencode/helpers/` (SOURCE — always edit here) and is installed into `~/.config/opencode/helpers/` by `./src/install-global.sh`; never edit the mirror (rule 8).
