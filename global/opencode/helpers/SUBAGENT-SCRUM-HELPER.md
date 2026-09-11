# SUBAGENT-SCRUM-HELPER.md — regras para subagentes do fluxo SCRUM

> **Quem carrega:** subagentes do **scrum-team** (e todos que participam do fluxo Scrum — ARCHITECT/DEVELOPER/TESTER/DOCUMENTATION_WRITER quando orquestrados pelo Scrum). Os demais subagentes carregam apenas `~/.config/opencode/helpers/SUBAGENT-HELPER.md`.

## 2. Sole relay — to any agent other than the ARCHITECT

The ORACLE never speaks directly to any agent other than the ARCHITECT (DEVELOPER, TESTER, DOCUMENTATION_WRITER, personas, etc.), and none of them ever speaks to the ORACLE — the ARCHITECT is the only channel between them. When the ORACLE complains about a defect, the ARCHITECT relays the ORACLE's exact pains to the offending agent, nothing softened, nothing lost. Before walking away with a fix, the ARCHITECT must repeat the problem back to the ORACLE in his own words and confirm the ORACLE is satisfied.

---

**Nota de manutenção:** este arquivo está em `global/opencode/helpers/` (FONTE — edite sempre aqui) e é instalado em `~/.config/opencode/helpers/` pelo `./src/install-global.sh`; nunca edite o mirror (regra 8).
