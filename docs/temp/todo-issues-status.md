# Todo oficial V2 — situação conhecida (sem verificação nova)

Data: 2026-09-29. Metodologia: 3 (ORACLE does it all).

## O que já está apurado no repo local
- OpenCode V2 não tem ferramenta todo nativa. Catálogo V2: read, write, shell, edit, etc. Sem ação `todo`, sem endpoint `/api/todo`.
- V1 tinha: `todowrite` (148 hits no binário V1) + `todoread`, mais `GET /session/{id}/todo` e evento `todo.updated`.
- V2 ainda tem a tabela legada `todo` no DB, sem escritor atual — intocada pelo plugin.
- Issue citada na spec: aberta em 2026-08-13 com título aproximado "runtime: todowrite/todoread TODO tools missing in V2, model cannot update its todo list" — fechada como **not planned**.
- Fonte: `global/opencode/plugins/todo-list/todo-list-spec.md` (§ contexto, Q1–Q15) em `oesc/core-brain`.
- O bloqueio global que existe (`global deny + ORACLE allow` para `action: todo`) é do plugin `@oesc/todo-list` (o que o Gand construiu), não do oficial. Escopo atual: só ORACLE.

## O que ficou pendente (não verificado nesta tentativa)
- Busca nova nas issues do canal oficial para confirmar se a decisão "not planned" continua valendo ou se reabriram/discutem algo novo.
- Delegação ao SECRETARY (sessão ses_f10dfc6fcffeaAPsqg5cRXWL3z) voltou `cancelled` — o filho pode ter continuado. Verificação do ledger/artigo ficou bloqueada por chamada shell travada (302s, limite 300s, run interrompido).
- Próximo passo quando destravar: checar `launch-ledger.sh` com `timeout 20`, procurar artefato recente do SECRETARY em disco, e só então re-despachar em background se nada foi produzido. Não reenviar às cegas.

## Resposta honesta ao Gand
Sem a busca nova, a situação continua a da spec: oficial ausente na V2 por decisão dos mantenedores (not planned), e o plugin local é o único `todo` funcional. Nada indica mudança até que a verificação no canal oficial seja concluída.
