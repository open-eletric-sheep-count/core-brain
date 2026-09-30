# METHODOLOGY_TICO_AND_TECO_THINK_HELPERS

Helper for menu option 1 (`Tico and Teco Think Methodology`). Loaded by the ORACLE when the USER chooses this flow. Complements the `be-judge` skill.

## What it is

A minimal fixed-scope delivery flow to create a feature from a task or something the USER said (a feature to create). It is the DEFAULT menu option.

## Steps

1. **Trigger** — the USER brings a task or something said (a feature to create).
2. The ORACLE loads the `be-judge` skill via the skill tool and becomes the judge of this flow.
3. The ARCHITECT plans the feature and hands the plan to the ORACLE, which launches the DEVELOPER with
   that plan, one agent at a time.
   **O fórum (`bot-forum`) é aberto no arranque de TODA a task** — pelo ORACLE, antes do primeiro
   dispatch: `.bot-forum/forum-<session id>.md`, com o id do ORACLE lido de `OPENCODE_SESSION_ID`
   (skill `bot-forum`):
   (a) um ficheiro por sessão — **sem arquivo nem rotação** (o id da sessão já separa as tasks; entradas
       de duas tasks no mesmo ficheiro são impossíveis);
   (b) cabeçalho a identificar ESTA task (título, data, metodologia, participantes, launcher session);
   (c) daí em diante **append-only**: uma entrada por agente, `## <AGENT> — <YYYY-MM-DD HH:MM>`. Ninguém
       edita nem apaga entradas existentes.
   O caminho do fórum vai em **cada** brief. Esse ficheiro é o canal: o ARCHITECT apensa o brief e todos
   os vereditos, o DEVELOPER apensa a entrega e as respostas, e o ORACLE relata só o **caminho**, nunca
   texto colado (AGENTS.md regras 13/14). O que um agente não conseguir correr entra como `[REQ]`
   (**o quê · porque · output esperado**) e quem puder responde `[ANS] ref <autor+hora>`. O ARCHITECT
   mantém a **autoridade** sobre o DEVELOPER (comanda, revê e rejeita); o DEVELOPER nunca argumenta com o
   ORACLE — todo conflito volta pelo fórum e pelo ARCHITECT.
   On a **remote provider** the depth/serial restriction does not apply and the ARCHITECT may call the
   DEVELOPER directly, as before; the forum stays as the record either way.
4. The two argue until the feature is ready: the ARCHITECT commands; the DEVELOPER contests only the ARCHITECT with conclusive proof; the ARCHITECT invokes the ORACLE (judge) only when in doubt. The chain is strict — ORACLE → ARCHITECT → DEVELOPER: the judge never speaks to the DEVELOPER and the DEVELOPER never speaks to the judge. The ORACLE rules each conflict applying the `be-judge` mechanism — judge leans toward the ARCHITECT, the judge is the ONLY channel to the USER — and the communication-language protocol (EN default, PT, or Other; documentation and artifacts always in English unless the USER says otherwise).
5. **Result** — the feature is implemented and READY. The originating task is closed (✅) via the `finish-task` skill ONLY after everything is done and accepted by the USER.

## Scope

Fixed: ARCHITECT × DEVELOPER (no scope question needed). The `be-judge` mechanism (judging rules, chain of command, tie-break, only channel, language protocol, vision — justice is not blind) is defined in the `be-judge` skill; this helper references it, it does not duplicate it.
