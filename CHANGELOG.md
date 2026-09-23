# Changelog — oesc/core-brain

All notable changes to this repository are documented here.
Newest on top.

## [Unreleased]

### Added

- **ORACLE: "Skill duty" — uma skill nomeada pelo USER é obrigatória, e é carregada
  antes de qualquer outro trabalho** (`global/opencode/agent/ORACLE.md`, bloco
  `<IMPORTANT>` no **topo** do prompt + bullet nas `Rules`; USER, 2026-09-20): em
  OpenCode V2 um `@nome` escrito no prompt é **texto simples** (a API não o expande
  em link), por isso quem tem de o honrar é o agente. O bloco é a primeira coisa que
  o agente lê e fixa: (1) varrer o pedido ANTES do portão de metodologia, nas formas
  explícitas (`@<id>`, "use a skill <id>", "com a skill <id>", ID nu — o `@` nunca
  faz parte do ID) e nas **formas indirectas** ("a skill do job #36", "a skill que
  usámos no job N"), resolvidas pelo histórico (base do orchestrator / base do
  OpenCode), nunca por adivinhação — sem certeza, pergunta-se ao USER; (2) carregar
  a skill com o `skill` tool logo APÓS o portão e ANTES de ler ficheiros, planear,
  responder ou delegar; (3) dizer em voz alta `SKILL LOADED: <id>` (ou
  `SKILL NOT FOUND: <nome>` + pergunta ao USER — nunca seguir em silêncio); (4) o
  fallback de ler `~/.config/opencode/skills/<id>/SKILL.md` quando o `skill` tool
  não lista o nome; (5) passar o dever a quem se delega — o briefing a um subagente
  que nomeia uma skill leva, textualmente, a ordem de a carregar e de declarar o
  carregamento; (6) "já a usei noutro job" nunca é um carregamento, e declarar uma
  skill aplicada sem a chamada ao `skill` tool nesta sessão é falso.
  Motivo medido: nos Jobs #24, #27, #34, #36 (`use a skill @run-meter`) e **#42** o
  prompt nomeava a skill e ela **nunca foi carregada** (2026-09-20).
  Verificado depois da correcção: (a) sessão headless nova no formato do Job #36
  (`opencode run --agent ORACLE --model deepseek/deepseek-v4-flash-vision-exp`) —
  o `skill` tool foi a **única e primeira** chamada, com `{"id":"run-meter"}`, e a
  linha dita foi `SKILL LOADED: run-meter` (ses_f4083d6c9ffeZB8sMRjFl4Ts51); (b) a
  própria sessão do Job #47, cujo pedido nomeia a skill **por referência indirecta**
  ("a skill do job 36"), carregou `run-meter` e `be-a-master-developer` logo após o
  portão de metodologia. O espelho `~/.config/opencode` foi refrescado pelo alias
  `octu` (`src/install-global.sh`) e conferido idêntico à fonte.
- **Orchestrator subproject — spec accepted, construction deferred**
  (`docs/specs/orchestrator.md`, `orchestrator/CONTEXT.md`,
  `orchestrator/docs/adr/0001-pause-aborts-the-engine.md` (superseded) and
  `0002-pause-is-light-and-never-aborts.md`,
  `orchestrator/docs/gpu-measurement.md`, backlog entry in `TASKS.md`): the
  platform that queues the USER's demands and drives them through the OpenCode
  HTTP API — strictly one job at a time, light pause (interrupt only, confirmed
  by the engine's own GPU usage), `RESPIRO` between jobs, decisions taken by the
  Oracle while a job was blocked shown as a table at the end. Locked decisions
  D1-D14, criteria AC1-AC13. Also records two measured findings: the OpenCode
  2.0.6 client-side bug that hides an API-created session from the TUI list, and
  the SGLang abort semantics (no session scope; an abort returns an empty body,
  so it confirms nothing).

### Fixed

- **`@oesc/todo-list` 0.2.2 — o lembrete `TODO: …` deixa de falar na voz do USER**
  (USER, 2026-09-23; `global/opencode/plugins/todo-list/index.ts`, `todo-list-spec.md`
  Q6/§5.1/§7/Q15, `README.md`): o plugin entregava o lembrete editando
  `event.prompt.text` no hook `prompt` — e a documentação do host diz, textualmente,
  que as edições desse hook **"become the canonical persisted user input"**. Resultado
  medido nas sessões reais: a linha `TODO: 12 items — update it if something changed.`
  ficava **colada à mensagem do USER**, e o transcript lia-se como se o USER a tivesse
  escrito. A entrega passa a ser **contexto de sistema**: `ctx.session.hook("context")`
  → `event.system.push({type:"text", text: linha})` (o bloco `system` é reconstruído
  pelo host a cada pedido ao modelo, portanto **nunca acumula** no histórico). A linha
  que dispara o aviso mantém-se intacta (uma só, apenas com lista não vazia; guarda
  `Array.isArray(event?.system)` para runtimes degradados, e o hook continua a nunca
  quebrar a admissão do prompt). É o mesmo defeito de família do
  `opencode-anti-loop` 0.3.6 (que usava `ctx.session.prompt`) — corrigido no mesmo dia.
  **Falta a activação no espelho** (`./src/install-global.sh` + `opencode service restart`),
  que é passo do USER.

### Changed

- **Tico&Teco: o ARCHITECT entrega o plano ao ORACLE, e o debate passa a viver em `docs/forum.md`** (USER, 2026-09-20; `helpers/METHODOLOGY_TICO_AND_TECO_THINK_HELPERS.md`, passo 3): no motor local (SGLang) o ARCHITECT já não pode lançar o DEVELOPER — profundidade <= 1, imposta pelo plugin `sglang-guard` —, então o ORACLE lança o DEVELOPER com o plano do ARCHITECT, **um agente de cada vez**, e a conversa ARCHITECT ↔ DEVELOPER viaja por **`docs/forum.md`**: aberto NOVO no início de **cada tarefa** (o anterior é arquivado como `docs/forum-<AAAAMMDD-HHMM>.md`), com cabeçalho que identifica a tarefa, *append-only* daí em diante, uma entrada por agente com `## <AGENTE> — <AAAA-MM-DD HH:MM>`, e **entradas de duas tarefas no mesmo arquivo são um defeito**. O ORACLE relay só o caminho (nunca texto colado — regras 13/14) e o ARCHITECT mantém a autoridade (comanda, revê, reprova). Em provider remoto a chamada direta ARCHITECT → DEVELOPER mantém-se como estava; o forum continua a ser o registo.
- **`agent/ARCHITECT.md`: "sole relay" passa a autoridade sem launch** (USER, 2026-09-20; GOLDEN RULES): o bullet agora diz que o ARCHITECT é a única autoridade sobre o DEVELOPER mas **nunca o lança** — um subagente de nível 1 não lança nada (AGENTS.md regra 19) —, que o ORACLE lança e transporta, que o brief e os veredictos viajam como caminhos de arquivo, e que o DEVELOPER nunca discute com o ORACLE (os conflitos voltam pelo ARCHITECT).
- **Agent take-over rule: 3 informed attempts + USER permission**
  (`global/opencode/agent/ORACLE.md`, "Orchestrator Responsibilities"): a
  stalled/failed agent is now redispatched up to **3 attempts**, each retry
  carrying the context of what the previous attempt had done (informed
  redispatch; a blind resend is forbidden); even after the 3rd failure the
  ORACLE does **not** take over on its own — it reports to the USER and asks
  for permission first. Replaces the former immediate
  "no response → take over the work" behavior. Aligns the agent team with the
  flow skills kept in the taulukko/project-generator repo (`be-judge`,
  `batman-e-robin`, `scrum-team`, `spec-to-real-world`).
- **Source-of-truth split during migration** (taulukko/project-generator
  `global/opencode/AGENTS.md` §9): agents + helpers live in this repo
  (`core-brain/global/opencode/`), skills still live in
  taulukko/project-generator (`global/opencode/skills/`); the legacy copies of
  `agent/` and `helpers/` in the project-generator repo are deleted leftovers.
  To be collapsed back to a single source when the migration completes.

## [0.3.0] — 2026-09-11

### Changed

- Plugin layout is now **single-folder**: each plugin lives entirely at
  `global/opencode/plugins/<name>/` — source, distribution artifact and npm
  package root in one folder; `check.sh` (import smoke check + typecheck)
  replaces the old `build.sh` copy step. Applies to `todo-list` and
  `context-inject`; the former top-level project folders are removed.

### Added

- `global/opencode/plugins/context-inject/` — `@oesc/context-inject` OpenCode
  V2 plugin: injects
  configured files into sessions at the true start (first admitted prompt) and
  after a completed compaction, per agent (`injections.agents.<AGENT>`,
  reserved `ALL` key); stateless semantics derived from the durable session
  log; config via `options.configPath` or `<pluginDir>/config.json`.
  Migrated from the internal `taulukko-inject-context` plugin (renamed;
  site-specific defaults removed: neutral default log path, cleaned identity
  strings, V1 legacy files dropped); npm-ready manifest
  (`@oesc/context-inject`, `publishConfig` public, `files`).
- `global/opencode/agent/` + `global/opencode/helpers/` — the OESC **agent
  team** (ORACLE, ARCHITECT, DEVELOPER, TESTER, DOCUMENTATION_WRITER, the four
  Brain Storm personas, plus the `_EXTENDED` pointer variants) and the
  flow/subagent helpers, migrated from the internal taulukko config; README §4
  documents each role.

## [0.2.1] — 2026-09-11

### Changed

- Guidance (tool description + injected how-to): before adding an item, check
  the existing list for a fitting **parent** and nest sub-steps
  (`after: <parent id>` + `depth: <parent depth + 1>`) instead of defaulting
  everything to the root.

## [0.2.0] — 2026-09-11

### Changed

- `todo-list` 0.2.0 — structured list: items carry an optional `depth`
  (0 = root). The hierarchical numbering (`1)`, `1.1)`) is **derived from
  order + depth** at display time (tool dump + sidebar panel) — never stored
  and never written by the agent; legacy text prefixes are stripped on input
  and display. `add` accepts `after: <id>` to insert right after an item;
  level jumps are clamped and reported (`issues`). Spec updated (Q8, §5.2,
  §6).

## [0.1.0] — 2026-09-11

### Added

- `todo-list/` — `@oesc/todo-list` OpenCode V2 plugin (contract:
  `todo-list/todo-list-spec.md`):
  - Server entry (`src/index.ts`): single `todo` tool (ops `read` / `write` /
    `add` / `update` / `remove` / `clear`; stable integer ids; statuses
    `pending` / `in_progress` / `completed` / `cancelled`; priorities
    `high` / `medium` / `low`) and a prompt hook that injects **at most one
    line per round**, only when the session's list is non-empty.
  - TUI entry (`src/tui.tsx`): live sidebar panel
    (`append: "sidebar.content"`, below the MCP block) with glyphs
    `[ ]` `[~]` `[x]` `[!]` and strikethrough for `completed` / `cancelled`
    items; hidden when the list is empty.
  - Storage: per-session JSON at `~/.local/share/opencode-todo/<sessionID>.json`
    with atomic writes (tmp + rename). OpenCode's DB is never touched.
  - Tooling: `build.sh` (import smoke check + optional typecheck + copy into
    `global/opencode/plugins/todo-list/`), `README.md`.
- `global/opencode/install-global.sh` — mirrors `global/opencode/.` into
  `~/.config/opencode/` (same interface as the taulukko installer:
  `-s` / `-d`; aborts when the source is missing).
- `global/opencode/install-vars.sh` — writes `OESC_CORE_BRAIN_HOME` into the
  user environment (`/etc/environment` when writable, plus a marker block in
  `~/.bashrc`; idempotent re-runs).

### Integration (host repo: taulukko/project-generator)

- `global/opencode/opencode.json`: `todo` permission — global deny + ORACLE
  allow (same pattern as `journal-log`).
- `src/install-global.sh`: calls this repository's installer when
  `OESC_CORE_BRAIN_HOME` is set (spec §10 wiring).
