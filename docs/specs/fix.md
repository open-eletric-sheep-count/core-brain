# FIX — igualar o MCP do core-brain ao MCP do PLUR (assinaturas e funcionalidades)

**Objetivo:** o MCP `core-brain` passa a expor as MESMAS assinaturas e funcionalidades do MCP `plur`. Tudo que um cliente chama em `plur_*` funciona em `core_*` (ou no nome `plur_*` mantido por compatibilidade — decisão no §5). Nada de "parecido": mesma lista de tools, mesmos args, mesma validação, mesmo resultado.

## 1. Diretriz de cópia (obrigatória)

O código do PLUR é **open source** e **pode e deve ser copiado**. Não reinventar:

- Copiar os `inputSchema`, as descrições, as regras de validação e o comportamento de cada tool do pacote `@plur-ai/mcp` (cache local em `/home/gandb/.npm/_npx/386f78daf917651f/node_modules/@plur-ai/mcp/dist/chunk-UINIIUBY.js`, função `getAllToolDefinitions()`).
- Mudar **apenas o que precisa**: nome do backend (engine `store.ts` do core-brain em vez de `plur.learnRouted`), caminho do store (`~/.core-brain` continua), e o que for específico do isolamento por agente (`core_memory` fica como camada compat, ver §5).
- Se um trecho do PLUR resolve o problema, o fix do core-brain USA aquele trecho. Divergência só com justificativa escrita neste arquivo.

## 2. Arquivos (origem → destino)

| Origem (PLUR, só ler) | Destino (core-brain, editar) | O que copiar |
|---|---|---|
| `.../@plur-ai/mcp/dist/chunk-UINIIUBY.js` — `getAllToolDefinitions()`, `validateToolArgs`, `buildAdminDispatchTool` | `/home/gandb/.config/opencode/plugins/core-brain/mcp/server.js` — array `TOOLS` + `callTool()` | as 45 definições {name, description, inputSchema, annotations} + dispatcher + validação -32602 |
| `.../@plur-ai/core/dist/` — `learnRouted`, `recall`, `inject(Hybrid)`, `nearDuplicates`, `pinnedQuota`, session/scope/stores/packs/timeline | `/home/gandb/.config/opencode/plugins/core-brain/store.ts` + `types.ts` | semântica de cada operação, mapeada para o store do core-brain (mesmos campos: statement, scope, domain, tags, rationale, session_id etc.) |
| — | `/home/gandb/.config/opencode/plugins/core-brain/index.ts` (`core_memory`) | MANTIDO como compat: `store({text})` vira alias de `learn({statement: text})`; `recall`/`forget`/`feedback`/`who` delegam (ver §5) |
| `.../@plur-ai/mcp/dist/tools-export.js` — `getToolSchemas(profile)` | `server.js` — `tools/list` por perfil (`lean`/`full`) | mesmo particionamento: 14 diretas + resto via `core_admin` (que passa a aceitar qualquer action, igual ao `plur_admin`) |

## 3. Gap atual (por que não são iguais)

- core-brain tem 5 tools (`core_recall` só-global sem `from`, `core_status`, `core_doctor`, `core_receipt`, `core_admin` com 5 actions). PLUR tem 45.
- Escrita: core-brain `store({text!})` × PLUR `learn({statement! + ~20 campos})`.
- Leitura: core-brain sem `mode/scope/domain/session/budget`; sem `inject`; sem sessão (`session_start/scope/end`).
- Todo o resto (packs, sync, scopes, stores, tensions, provenance, timeline, pins, supersedes, validades, reranker, outbox, report_failure, ingest, profile) não existe no core-brain.

## 4. O que mudar (escopo do fix)

1. `server.js`: substituir `TOOLS` (5) pelas 45 definições copiadas do PLUR; `callTool()` valida com o mesmo `validateToolArgs` e devolve o mesmo envelope; `tools/list` respeita `CORE_BRAIN_TOOL_PROFILE` (lean/full) igual ao `PLUR_TOOL_PROFILE`.
2. `core_admin` vira o gateway geral (espelho do `plur_admin`): `{action, args}` com mesma validação/resultado; destrutivas só diretas (mesma regra do PLUR).
3. `store.ts`/`types.ts`: implementar a semântica copiada (scopes, sessions, episodes, packs, sync/outbox, tensions, provenance, pins, supersedes, `valid_from/until`, `measured_under`, `attribution`, `claim_class`, `license`, `visibility`).
4. `index.ts`: `core_memory` continua existindo como alias fino (sem lógica própria).
5. Nomes: por padrão manter os nomes `plur_*` lado a lado com aliases `core_*` (ou renomear tudo para `core_*` com alias reverso) — UMA decisão, documentada aqui antes de codar, valendo para as 45.

## 5. Entregáveis — um teste por assinatura (todos têm de passar)

Cada item é um teste executável contra o MCP `core-brain` rodando (mesmo runner dos dois lados). Formato: `Tnn — <tool> — o que prova`.

**Escrita:**
- T01 — `learn` — escreve `{statement}` mínimo e retorna id; `text` é rejeitado como no PLUR.
- T02 — `learn` full — todos os campos opcionais aceitos e persistidos (type/scope/domain/tags/rationale/source/pinned/commitment/valid_from/valid_until/supersedes/session_id/measured_under/attribution/claim_class/license/visibility).
- T03 — `learn_batch` — lote escreve N e retorna N ids.
- T04 — `ingest` — importa texto e gera engrams.
- T05 — `capture` — anexa episode à timeline.
- T06 — `episode_to_engram` — promove episode a engram.

**Leitura/injeção:**
- T07 — `recall` — `{query!}` híbrido retorna o que T01 escreveu; `mode: keyword` funciona sem embeddings.
- T08 — `recall_hybrid` — alias depreciado responde igual a T07 + flag deprecated.
- T09 — `inject` — `{task!}` retorna directives/consider/count/tokens_used/injected_ids dentro do budget.
- T10 — `inject_hybrid` — igual a T09 com `mode: hybrid`.
- T11 — `similarity_search` — busca por similaridade retorna o vizinho de T01.
- T12 — `history` — eventos de retrieval aparecem.
- T13 — `timeline` — episodes de T05 listados.
- T14 — `provenance` — por id e por search term; `not_recorded` relatado como no PLUR.
- T15 — `meta_engrams` — meta-engrams listados.

**Sessões:**
- T16 — `session_start` — abre sessão e devolve id.
- T17 — `session_scope` — troca o scope default no meio da sessão.
- T18 — `session_end` — encerra e extrai learnings.
- T19 — `learn` com `session_id` de T16 respeita o scope default da sessão.
- T20 — `recall` com `session_id` usa o contexto remoto da sessão.

**Saúde/contadores:**
- T21 — `status` — `{domain?, created_after?}`; engram/episode/pack counts + storage_root.
- T22 — `doctor` — `{retry?, rerank_eval?}`; checks de store/embedder/hybrid como no PLUR.
- T23 — `receipt` — `{days?}`; mesmos campos (stored/retrieved/top/dormant/coverage).

**Feedback/manutencão:**
- T24 — `feedback` — single `{id, signal}` e batch `{signals[]}` treinam relevância.
- T25 — `pin` — pin/unpin/list respeitando quota.
- T26 — `forget` — aposenta por id e por termo (sem apagar histórico).
- T27 — `rescope` — move engram de scope.
- T28 — `promote` — promove escopo/visibilidade.
- T29 — `tensions` — detecta contradição entre dois engrams opostos (e pula pares `supersedes`).
- T30 — `tensions_purge` — limpa falsos positivos.
- T31 — `validate_meta` — valida metadados.
- T32 — `extract_meta` — pipeline de meta-engrams.

**Packs:**
- T33 — `packs_list` — lista packs.
- T34 — `packs_discover` — descobre packs.
- T35 — `packs_preview` — preview antes de instalar.
- T36 — `packs_install` / T37 — `packs_export` / T38 — `packs_uninstall` — ciclo completo com engram `visibility: public` de T02.

**Sync/scopes/stores:**
- T39 — `sync` + T40 — `sync_status` + T41 — `outbox` — fila e entrega.
- T42 — `stores_add` + T43 — `stores_list`.
- T44 — `scopes_discover` + T45 — `suggest_scope`.
- T46 — `report_failure` — registra falha.
- T47 — `profile` — perfil lean/full correto.

**Gateway:**
- T48 — `admin {action: recall, args}` — mesmo resultado da chamada direta.
- T49 — `admin {action: help}` — lista as 45 com description + args_schema.
- T50 — `admin` recusa destrutiva (ex.: `tensions_purge`) com a mesma mensagem do PLUR.

**Compatibilidade core-brain antiga (não pode quebrar):**
- C01 — `core_recall` continua respondendo (alias do novo recall restrito ao global).
- C02 — `core_status` / C03 — `core_doctor` / C04 — `core_receipt` respondem como antes.
- C05 — `core_memory store({text})` equivale a `learn({statement: text})`; `recall/forget/feedback/who` delegam.
- C06 — `core_admin {action: purge|reindex|export|import|compact}` continua funcionando.

**Ponta a ponta:**
- E01 — o script de paridade roda a mesma bateria contra `plur` e contra `core-brain` e o diff é vazio (mesmas tools, mesmos schemas, mesmos resultados por T01–T50).

**Pronto =** T01–T50 + C01–C06 + E01 verdes, sem `verified by reading`: cada um com comando executado e digest anexado.
