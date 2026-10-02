# USER task — implement the core-brain MCP (verbatim criteria + restrictions)

- **Date:** 2026-10-02
- **Working folder:** `/media/gandb/workspace/oesc/core-brain`
- **Spec of record:** `docs/specs/core-brain-mcp.md`
- **Source:** USER message, verbatim (PT).

## Task

Implemente o mcp no plugin conforme a especificação do Spec escrita: oesc/core-brain/docs/specs/core-brain-mcp.md , o qual atuará como a parte que falta do core brain pra fazer o que o plur faz

Entregáveis e critérios de aceitação:

1-) Atualização README.md criado rigorosamente de acordo com os requisitos descritos na especificação.
2-) Atualização do arquivo INSTALACAO.md detalhando o passo a passo completo para instalação e configuração do plugin e mcp
3-) O mcp deve ser testado pra fazer o mesmo que o mcp do plur faz, isto deve ser quebrado em sub requisitos pelo oraculo antes de começar a tarefa e no final checado
4-) A instalação e a execução do plugin foram devidamente testadas e validadas no ambiente de destino.
5-) Os agentes atualmente existentes no sistema não podem ser afetados ou ter seu funcionamento alterado pela introdução do novo plugin.
6-) Devem ser criados agentes de teste dedicados exclusivamente para validar todas as regras de isolamento e acessos do projeto.
7-) Os agentes de teste devem validar que um agente com private verdadeiro grava uma informação em seu espaço privado e outro agente privado não consegue acessar essa memória.
8-) Os agentes de teste devem validar que um agente com private verdadeiro grava uma informação em seu espaço privado e um agente público não consegue acessar essa memória.
9-) Os agentes de teste devem validar que um agente com private verdadeiro e hasGlobalAccess falso recebe um erro claro ao tentar gravar no espaço global.
10-) Os agentes de teste devem validar que um agente com private verdadeiro e hasGlobalAccess verdadeiro grava uma informação no espaço global e qualquer outro agente com acesso global consegue recuperar essa memória.
11-) Os agentes de teste devem validar que um agente com private verdadeiro grava uma informação em seu espaço privado e ele próprio consegue recuperar essa informação com sucesso.
12-) Os agentes de teste devem validar que um agente com private falso e hasGlobalAccess falso falha na inicialização ou execução, exibindo um erro de configuração bem descritivo explicando que a combinação de private falso com hasGlobalAccess falso é inválida.
13-) Os agentes de teste devem validar que um agente público com hasGlobalAccess verdadeiro grava uma informação no espaço global e consegue recuperar essa informação com sucesso.
14-) Os agentes de teste devem validar que um agente público tenta gravar diretamente em um espaço privado e o sistema impede a ação, retornando um erro explicativo detalhando a impossibilidade de escrita privada por agentes públicos.
15-) Os dados e vetores devem ser persistidos no diretório de perfil do usuário e não na pasta raiz do projeto, garantindo o compartilhamento de memórias entre múltiplos projetos. O diretório de armazenamento deve usar o nome do novo projeto, devendo ficar localizado em .core-brain dentro da pasta do usuário.
16-) O desenvolvimento do plugin deve seguir rigorosamente os padrões de mercado e boas práticas para plugins do OpenCode, utilizando pesquisas e referências via contexto técnico para atender a todos os critérios de aceitação e arquitetura do padrão.
17-) O uso de um agente nao mencionado no config se comporta como um agente private = false, e access global = true
18-) No final o novo mcp faz a mesma limpeza e ações do original

Nota: Excepcionalmente pode mexer tanto no global se houver necessidade, quanto na pasta .config/opencode mas não comite nada pois ai consigo reverter se não gostar

Working folder: /media/gandb/workspace/oesc/core-brain

## RESTRICTIONS (from the task)

1. Do not commit anything to git — in the global tree or in `~/.config/opencode` (the USER wants to be able to revert).
2. Touching `global/` and `~/.config/opencode/` is allowed **exceptionally, only when necessary**.
3. The agents currently existing in the system must not be affected, nor have their behaviour changed, by the introduction of the new plugin.
4. Memory data/vectors must be persisted in the user profile directory (`~/.core-brain`), never in the project root.
5. The plugin must follow OpenCode plugin market standards and best practices.

## ORACLE decomposition of criterion 3 (MCP parity with PLUR's MCP) — checked at the end

- S1 `core-brain` MCP connects over stdio; coexists with `plur` (AC1).
- S2 `tools/list` advertises exactly the `core_*` tools with correct schemas (AC2).
- S3 `core_recall` reads the `global` namespace only; description verbatim per spec §4.3; never a per-agent claim (AC7).
- S4 `core_status`: storageRoot, configPath, embedder, dim, per-namespace {records, retired, retrievals}, totals — counts only, never memory text.
- S5 `core_doctor`: the 5 checks of AC6, each reporting a failing `detail`.
- S6 `core_receipt`: stored, retrieved, hits, byNamespace[].
- S7 `core_admin`: purge / reindex / export / import / compact — one validation path, one error shape; private namespace refused unless named explicitly + force; import never overwrites an existing id.
- S8 `core_timeline`: MCP (admin) view of the episodic timeline — conditional on the scope decision (spec §3 vs §14/§15).
- S9 zero runtime deps; starts under `node --experimental-strip-types` alone (AC9).
- S10 plugin tool additions `core_memory op:"forget"` (soft retire, M8) and `op:"feedback"` (ranking tie-break), with executed evidence (AC4/AC5).
- S11 refusal paths proven, not just the happy path (AC3); plugin `check.sh` 13/13 unchanged (AC8).
