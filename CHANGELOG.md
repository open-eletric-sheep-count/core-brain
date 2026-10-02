# Changelog — oesc/core-brain

All notable changes to this repository are documented here.
Newest on top.

## [Unreleased]

### Added

- **New plugin `core-brain` v0.1.0 — per-agent memory isolation for OpenCode V2**
  (`global/opencode/plugins/core-brain/`: `index.ts`, `store.ts`, `types.ts`,
  `package.json`, `tsconfig.json`, `shims.d.ts`, `config.json` seed, `LICENSE`,
  `README.md`, `INSTALACAO.md`, `check.sh`, `test/`; plus the four dedicated test
  agents `global/opencode/agent/CB_{ALPHA,BETA,GAMMA,DELTA}.md` with `mode: all`
  and an inherited model): one `core_memory` tool (`who` / `store` / `recall`)
  and the access matrix of `docs/core_brain_specification.md` §4 implemented
  exactly — a private namespace per agent, an optional shared `global` namespace,
  cross-agent writes always refused, unlisted agents fail-closed, and
  `InvalidConfigurationError` at init for a `private:false` +
  `hasGlobalAccess:false` row. Real per-namespace vectors with an in-process
  cosine top-k, atomic JSON persistence under `~/.core-brain/` (override
  `CORE_BRAIN_HOME`), and a **declared** offline stub embedder
  (`hash-ngram-v1`, 256 dims; a production semantic embedder is a follow-up).
  **Non-destructive:** nothing pre-existing was modified — the plugin is
  auto-discovered from the `plugins/` directory (no `opencode.json` entry), the
  `prompt` hook is inert (it never edits the user's prompt nor injects into the
  system block), and it is a fork/substitute of PLUR Memory (MIT, with the PLUR
  acknowledgment) sharing no dependency, data directory, env var, port, cache or
  tool namespace with PLUR. Evidence, **executed 2026-10-01** (Node v24.15.0):
  `opencode2 plugin list` → **8 plugins** including `core-brain`;
  `opencode2 debug agents` **23 → 27**, none removed, the 23 pre-existing agents
  byte-identical; `bash global/opencode/plugins/core-brain/check.sh` → **8/8
  matrix lines PASS**, exit code `0`; three real headless smokes (`CB_BETA`,
  `CB_GAMMA`, `CB_ALPHA`) returned the expected JSON and the expected refusals
  (`no global access`; `target is private — cross-agent write not allowed`);
  `~/.plur/` untouched and the `plur` MCP still `connected`. Activation: mirror
  via `bash global/opencode/install-global.sh` (USER) plus `opencode2 reload`.
  Docs: the plugin's `README.md` and `INSTALACAO.md`.
- **O `bot-forum` chega aos ficheiros de config — o helper do Tico&Teco migrou e todos os helpers das metodologias referenciam o fórum** (`helpers/METHODOLOGY_TICO_AND_TECO_THINK_HELPERS.md`, `helpers/METHODOLOGY_BATMAN_E_ROBIN_HELPERS.md`, `helpers/METHODOLOGY_SCRUM_TEAM_HELPERS.md`, `helpers/METHODOLOGY_ORACLE_DOES_IT_ALL_HELPERS.md`, `agent/ARCHITECT.md`; USER, 2026-09-30, decisão D7 do grill do bot-forum): o canal partilhado de uma task passa a viver no skill `bot-forum` (repo project-generator) e **cada helper aponta para lá**. O Tico&Teco deixa de abrir `docs/forum.md` e abre `.bot-forum/forum-<session id>.md` — **um ficheiro por sessão** (o id do launcher), **sem arquivo** (o id já separa as tasks), o caminho a viajar em cada brief e o correio `[REQ]`/`[ANS]` por cima do formato append-only; o `agent/ARCHITECT.md` leva a mesma referência na sua regra "Authority over the DEVELOPER". O Batman e Robin ganha a regra do fórum (o Robin não tem shell nem subagentes — o `[REQ]` é como alcança o que não consegue correr), o scrum-team o mesmo, o `ORACLE does it all` abre no arranque (só registo); o A New Brain Storm mantém o fórum dele (exceção explícita no skill). Ativação: espelho via `./src/install-global.sh` do project-generator (USER, feito 2026-09-30). Evidência executada: o skill `batman-e-robin` recarregado **do espelho** traz a secção nova do fórum, e uma run real de Batman e Robin (sessão `ses_f1d182d30ffenzF1Cdr8cvXBtd`) produziu um par `[REQ]`/`[ANS]` verdadeiro em disco (`orchestrator/.bot-forum/`).
- **`DEVELOPER` gains Mode B (Batman e Robin) with precedence over the Scrum mode — the
  low autonomy was not only the flow skill's fault** (`global/opencode/agent/DEVELOPER.md`,
  `global/opencode/helpers/METHODOLOGY_BATMAN_E_ROBIN_HELPERS.md`,
  `global/opencode/agent/ORACLE.md` item 5; USER, 2026-09-30, after the `batman-e-robin` v2
  rewrite): the agent prompt carried Scrum absolutes that **contradicted** Batman e Robin
  (*"Never contact the ORACLE directly"*, a TESTER that does not exist in this flow, a handoff
  to the USER) — while the flow forbids all three. `DEVELOPER` now resolves its **operating
  mode BEFORE anything else** (unknown mode → STOP and report, never guess): **Mode A = Scrum
  (default)** with the pre-existing rules now explicitly scoped `(Mode A)`, and **Mode B =
  Batman e Robin**, which **takes precedence and REPLACES** them — the brief is a contract from
  the ORACLE/Batman; the ORACLE is the only interlocutor (the "never contact the ORACLE" rule is
  **Mode A ONLY**); there is no TESTER and no ARCHITECT ("start by validating that tests fail"
  does not apply); the developer never hands off to the USER; he **owns the HOW** and stops
  **only** to cross the WHAT, on an ambiguous/impossible criterion, or on an unpredicted
  destructive action — any other HOW doubt he decides and records; the report carries files
  touched · HOW decisions · commands + digest · self-check per criterion · the visual line; he
  loads the `batman-e-robin` skill and states `SKILL LOADED: batman-e-robin`. Governance in
  Mode B reads only the generic `SUBAGENT-HELPER.md` (the SCRUM helper does not apply). The
  persona keeps arguing with evidence, now with ARCHITECT → Batman. `DEVELOPER_EXTENDED`
  inherits automatically (it is a pointer to the canonical file). The helper states the WHAT/HOW
  split, serial dispatch, Batman's re-execution of the acceptance criteria and the closed
  takeover. The ORACLE menu line dropped *"executes the precise mechanical brief"* for **"owns
  the WHAT … does NOT implement; the DEVELOPER (Robin, Mode B) owns the HOW"**. Executed
  evidence: none — config/prompt change; proof is the mirror apply (below) plus a real run of
  the flow. Activation: mirror via `./src/install-global.sh` (USER).
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

- **`@oesc/context-inject` 0.1.1 — os HOWTOs deixam de ser prependidos à mensagem do USER**
  (USER, 2026-09-23; `global/opencode/plugins/context-inject/index.ts`, `package.json`):
  o plugin entregava o conteúdo de `TODO_TOOL_HOWTO.md` + `LAUNCH_LEDGER_HOWTO.md` (agente
  ORACLE, eventos `session.created` e `session.compacted`) escrevendo no draft mutável
  `event.prompt.text` — que a documentação do host descreve como o input canónico do USER —
  e o conteúdo aparecia **colado à frente da mensagem do USER** numa sessão nova e, de novo,
  após cada compactação. A entrega passa por **mensagem durável `synthetic`**
  (`ctx.session.synthetic({ sessionID, text })`, o mesmo mecanismo do `opencode-anti-loop`
  0.3.6): fora da voz do USER, persistida no log e sobrevivente à compactação. O prepend
  fica como **fallback legado** para um runtime sem essa superfície (logado como
  `prompt prepend fallback`), e o passo stateless mantém-se — `synthetic` não conta como
  user activity no scan da janela pós-compactação, logo as duas regras (`isFirstPrompt`,
  `pendingCompactionWindow`) não mudam. Verificação: `bash check.sh` (import smoke nativo
  TS + typecheck `tsc`) → **All checks passed for: context-inject**.
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

- **core-brain: an agent absent from `config.json` is no longer fail-closed — it gets the default
  policy `private:false` + `hasGlobalAccess:true`, and a configured row that omits `private` and/or
  `hasGlobalAccess` takes the same defaults** (`global/opencode/plugins/core-brain/store.ts`; USER,
  2026-10-02): `requirePolicy()` now returns the configured policy or a synthesized
  `{ name, private:false, hasGlobalAccess:true }` instead of throwing `agent '<name>' is not
  configured in core-brain config.json` (that string is removed from production); in
  `loadPolicies()`, a field whose key is **absent** (`undefined`) resolves to its default
  (`hasGlobalAccess` → `true`, `private` → `false`), while a **present non-boolean still throws**
  `InvalidConfigurationError` (the defaults are a missing-key rule, not coercion) and the
  **unchanged** invalid-row rule still throws for `private:false` + `hasGlobalAccess:false`. This is
  a **deliberate reversal of fail-closed** (spec §10): an unlisted agent — and, if `config.json` is
  missing or empty, every agent — now participates in the shared `global` namespace; its namespace
  does **not** join another agent's public read union and is not readable via `from:"agent:<X>"`
  (spec §4.3; rejected alternative: disk namespace discovery). The isolation matrix grew from 8 to
  **13 lines**; `bash global/opencode/plugins/core-brain/check.sh` → **13/13 matrix lines PASS**,
  exit code `0`.
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
