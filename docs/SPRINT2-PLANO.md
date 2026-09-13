# SPRINT2-PLANO.md — Plano Técnico do Sprint 2 (Piloto Jurídico)

> **Status deste documento:** plano preparado após a homologação da D1 (`docs/DECISIONS.md`, seção 1.1).
> **FASE 1 IMPLEMENTADA** (`originType`, enum de `status`, regra de reabertura, atraso derivado).
> **FASE 2 IMPLEMENTADA** — correção de `dashboard-service.js` (widgets jurídicos de prazo consomem
> exclusivamente `legalDeadlines`/`isLegalDeadlineOverdue()`, nunca mais DATA/CITAÇÃO/PROTOCOLO/
> `processDate()` do Monday), listagem/filtro (`GET /api/entities/legalDeadlines?paginated=1`) e
> detalhe/histórico (`GET /api/entities/legalDeadlines/:id/detail`).
> **FASE 3 IMPLEMENTADA** — slice mínimo de Agenda (`GET /api/agenda-items`) e Atenção
> (`GET /api/attention`), combinando Legal Deadline (fonte canônica exclusiva de prazo) com os eventos
> manuais pré-existentes de `store.agenda`, sem duplicar nem persistir cópia do prazo — ver seção
> "Fase 3" abaixo.
> **FASE 4A (documental) HOMOLOGADA** — Google Calendar (Opção B, leitura apenas), responsável do Legal
> Deadline (`responsibleUserId` opcional), "Minha Semana" (semana civil `America/Sao_Paulo`), labels de
> `originType`/`status`, e visibilidade de `cumprido`/`cancelado`/`suspenso` na Agenda operacional foram
> **homologados pela Cristiane em 12/09/2026** — `docs/DECISIONS.md`, seção 1.2 (`D4.1`–`D4.15`).
> **FASE 4B (implementação funcional) NÃO INICIADA** — esta rodada continua **estritamente documental**:
> **nenhum código foi alterado** (`server.js`, `dashboard-service.js`, `dashboard-model.js`, frontend e
> persistência permanecem exatamente como consolidados ao final da Fase 3, commit `a425c2e`). A matriz
> GO/NO-GO (`docs/DECISIONS.md`, D4.13) resulta em **GO DOCUMENTAL** — as decisões de negócio necessárias
> estão fechadas, mas isso não autoriza deploy, produção, escrita externa, nem marca a Fase 4B como
> implementada; a implementação funcional deve ocorrer em PR(s) separado(s). Escopo estritamente limitado
> ao que já está previsto em `docs/MASTER_HANDOFF.md` §24 (Sprint 2 — piloto). Nenhuma alteração foi
> feita no MASTER_HANDOFF.

## Escopo autorizado (MASTER_HANDOFF §24, §23)

Legal Process + Legal Deadline com listagem, filtros, detalhe e histórico · responsável, prazo com
origem, próxima ação · leitura do Monday · Documento referenciado (somente se já disponível, sem expandir
escopo) · slice mínimo de Agenda/Atenção consumindo o mesmo Legal Deadline · Google Calendar opcional
apenas como visualização de compromissos autorizados, nunca como fonte do prazo · testes de permissão ·
correção do uso de coluna bruta de data do Monday nos widgets jurídicos (risco identificado na análise
da D1).

## Explicitamente fora de escopo do Sprint 2 (não iniciar sem nova autorização)

Cálculo processual automático · IA · automações críticas · escrita no Monday · escrita em Google Calendar
· Sienge · CV · Clicksign · VELKOR · views 360 completas · event bus · workflow engine · novos módulos
além do já previsto acima.

---

## Plano técnico

| Fase | Tarefa | Responsável | Dependência | Critério de Aceite | Status |
|---|---|---|---|---|---|
| 1 | Adicionar `originType` (enum `JUDICIAL_PROCESSUAL` \| `INTERNAL_CONTROL`) como campo obrigatório de `legalDeadlines`, validado na criação e revalidado no PATCH (mesmo padrão de `processId`/`origin`/`date`) | Engenharia | D1.3 homologada (`docs/DECISIONS.md`) | `POST`/`PATCH` sem `originType` ou com valor fora do enum → `422`; PATCH que remove `originType` do estado candidato também rejeitado | ✅ **Implementado** — `validateLegalDeadline()` em `server.js`; testes unitários e HTTP |
| 1 | Implementar o enum **já homologado** de `status` de Legal Deadline (`ativo`/`suspenso`/`cumprido`/`cancelado`) | Engenharia | D1 homologada; enum/reabertura/atraso derivado aprovados em 12/09/2026 | `POST`/`PATCH` com `status` fora do enum → `422`; nenhum valor livre aceito; transições auditadas (`before`/`after`) | ✅ **Implementado** — enum `LEGAL_DEADLINE_STATUSES`; default server-side `ativo` na criação quando ausente |
| 1 | Implementar a regra de reabertura homologada: mesmo `id`, `status` volta para `ativo`, ciclo anterior preservado no histórico — nunca criar `status:'reaberto'` | Engenharia | Enum de status implementado (tarefa acima) | Reabertura preserva `id`; histórico mostra o ciclo suspenso/cancelado anterior; nenhuma API aceita `reaberto` como valor de `status`; reabertura sem `reason` explícito é rejeitada (`422`), sem alterar nada | ✅ **Implementado** — é um `PATCH` comum, restrito a `legalDeadlines`; `reason` do input alimenta `audit()` em `/api/entities/:type` (extraído antes de sanitizar, nunca persistido no registro); reabertura (status não-`ativo` → `ativo`) exige `reason` textual não vazio, senão `422` sem gravação |
| 1 | Implementar a regra de atraso derivado homologada: função central calcula "vencido/em atraso" apenas quando `status = ativo` **e** `date` anterior à data atual — nunca gravar isso como `status` | Engenharia | Enum de status implementado (tarefa acima) | `suspenso`/`cumprido`/`cancelado` nunca exibidos como atraso, independentemente de `date`; testes unitários dedicados | ✅ **Implementado** — `isLegalDeadlineOverdue()` em `server.js`, pura e testada; agora consumida por `dashboard-service.js` e pela listagem/detalhe (Fase 2) |
| 2 | Corrigir `dashboard-service.js`: widgets de prazo do dashboard `legal` (`legal-deadlines`, `legal-risk`) devem consultar `legalDeadlines`, não `processDate()`/coluna bruta do board `processos` | Engenharia | Nenhuma (correção de integridade, independente de `originType`) | Teste de integração confirmando que o widget não usa `processDate()`; nenhuma lógica paralela de cálculo de prazo em `dashboard-service.js` | ✅ **Implementado** — `processDate()` removida; `legal-risk`/`legal-deadlines` consomem `legalDeadlines` + `isLegalDeadlineOverdue()` (injetados por `server.js`, não duplicados) |
| 2 | Endpoint de listagem/filtro de Legal Deadline por processo, com filtro por `originType` e por `status` | Engenharia | Fase 1 concluída | Listagem filtra corretamente por `originType`/`status`; respeita `scoped()`/RBAC já vigentes | ✅ **Implementado** — `GET /api/entities/legalDeadlines?paginated=1` (`filterLegalDeadlines()`): `processId`/`originType`/`status`/`overdue`/`dateFrom`/`dateTo`, paginação no mesmo padrão de `filterProcesses()`/`filterHonorariums()` |
| 2 | Tela de detalhe de Legal Deadline (histórico via auditoria existente — `store.audit` por `entityId`/`correlationId`) | Engenharia + UX | Fase 1 concluída | Histórico exibido em ordem cronológica, sem sobrescrever estado anterior; nenhuma entidade nova de histórico criada (reaproveita auditoria existente, conforme instruído) | ✅ **Implementado (API)** — `GET /api/entities/legalDeadlines/:id/detail`: processo relacionado, atraso derivado, histórico via `store.audit` + `sanitizeAuditEventForUser()`. Sem tela nova de UI nesta rodada — o piloto consome via API/widgets genéricos existentes |
| 2 | Semântica de tela/copy: "Confirmado pelo Jurídico" onde hoje poderia haver ambiguidade; garantir que nenhuma tela sugira "comprovação documental validada" sem `evidenceReference` (D1.4) | UX + Jurídico (revisão de copy) | D1.4 homologada | Revisão de copy aprovada pelo Jurídico; nenhuma string de UI viola a regra de linguagem da D1.4 | ⏳ Não iniciada — nenhuma tela nova foi criada nesta rodada; segue pendente quando houver UI dedicada |
| 3 | Slice mínimo de Agenda/Atenção consumindo o mesmo registro de `legalDeadlines` (sem criar cópia) | Engenharia | Fases 1–2 concluídas | Agenda/Atenção exibem o mesmo `id` de Legal Deadline, nunca uma cópia; QA §30 casos 2 e 6 tornam-se exercitáveis | ✅ **Implementado** — `GET /api/agenda-items` (Agenda) e `GET /api/attention` (Atenção), ambos view-only, reaproveitando `scopedLegalDeadlineRows()`/`isLegalDeadlineOverdue()`/`civilDateAfterDays()` |
| 3 | Google Calendar (se ativado no piloto) como visualização de leitura apenas | Engenharia + TI | Fase 3 (Agenda/Atenção) | Nenhuma escrita no Calendar; nenhuma leitura do Calendar cria/altera Legal Deadline | ⏳ Não implementada — **decisão HOMOLOGADA em `docs/DECISIONS.md`, D4.1: Opção B (leitura apenas)**; implementação fica para a Fase 4B, em PR separado |
| 4 | Testes de permissão específicos de Legal Deadline com `originType` (TI vs. Jurídico; administrador técnico vs. conteúdo) | Engenharia (QA) | Fases 1–2 concluídas | Casos 8 e 9 da seção QA (abaixo) passam via HTTP real, reaproveitando `allowedInDepartment()`/`allowedContent()` já existentes — nenhum mecanismo de autorização novo | ✅ **Implementado** — Fase 1 já cobria TI/administrador para CRUD; Fase 2 estende a mesma cobertura para dashboard/listagem/detalhe |
| 4A | Rodada documental: fechar decisões de negócio/UX antes da Fase 4B (Calendar, Minha Semana, responsável, copy, homologação) | Negócio + Jurídico + Engenharia | Fases 1–3 concluídas | `docs/DECISIONS.md` seção 1.2 (D4.1–D4.15) registrada, com cada decisão marcada HOMOLOGADO/PENDENTE/FORA DE ESCOPO — nenhuma homologação fingida | ✅ **Implementada e homologada** — D4.1, D4.2, D4.3, D4.5, D4.6, D4.10, D4.11, D4.15 homologadas pela Cristiane em 12/09/2026; puramente documental, nenhum código alterado |
| 4B | Implementação funcional da Fase 4 (Google Calendar Opção B, `responsibleUserId`, Minha Semana) | Engenharia | Fase 4A homologada (✅ concluída) | Matriz GO/NO-GO de `docs/DECISIONS.md` (D4.13) em GO para os itens implementados; testes correspondentes | ⏳ **Não iniciada** — matriz GO/NO-GO em **GO DOCUMENTAL** (D4.13); implementação a ser feita em PR(s) separado(s), sem deploy/produção/escrita externa autorizados por esta homologação |
| 4 | Homologação formal com Gestora + Jurídico (MASTER_HANDOFF §32) | Negócio + Jurídico | Fases 1–3 concluídas, CI verde | Checklist de homologação do piloto jurídico aprovado (`docs/DECISIONS.md`, D4.12) | ⏳ Não iniciada — checklist técnico proposto (D4.12); itens 1–23 já satisfeitos/homologados, mas a homologação formal do piloto (ato de negócio, §32) em si continua não realizada nesta rodada |

## Status do Legal Deadline — HOMOLOGADO e IMPLEMENTADO (Fase 1)

**Aprovado pela Cristiane em 12/09/2026** (`docs/DECISIONS.md`, seção 1.1, "Status do Legal Deadline") e
**implementado nesta Fase 1** do Sprint 2.

- **Enum fechado:** `ativo`, `suspenso`, `cumprido`, `cancelado`. Nenhum outro valor é aceito —
  `LEGAL_DEADLINE_STATUSES` em `server.js`, validado por `validateLegalDeadline()`.
- **Reabertura:** um `PATCH` comum para `status:'ativo'` — mesmo `id`, `version` incrementada,
  `updatedAt`/`updatedBy` atualizados, e o motivo (`reason` do input) preservado no histórico de
  auditoria (`before`/`after`), nunca em um quinto status `reaberto`. **`reason` é obrigatório na
  reabertura** (status diferente de `ativo` → `ativo`): sem `reason` textual não vazio, `422` e nada é
  alterado. Este tratamento de `reason` é exclusivo de `legalDeadlines` — nenhuma outra entidade genérica
  foi afetada por esta correção.
- **Atraso é condição derivada:** `isLegalDeadlineOverdue(deadline, today)` — `true` somente quando
  `status === 'ativo'` **e** `date` é anterior a `today` (comparação de string determinística, fuso
  `America/Sao_Paulo` por padrão). `suspenso`/`cumprido`/`cancelado` nunca são atraso.

Detalhe completo do que foi implementado em `docs/DATA_MODEL.md`, seção "Sprint 2, Fase 1 — implementada".

## Fase 3 — implementada (Agenda/Atenção mínima)

Slice mínimo de Agenda/Atenção, consumindo exclusivamente entidades canônicas já existentes — nenhuma
cópia de Legal Deadline é criada ou persistida.

- **`GET /api/agenda-items`** — Agenda combinada: itens de `legalDeadlines` (via `scopedLegalDeadlineRows()`,
  a mesma defesa em profundidade da Fase 2 — escopo sobre o prazo **e** sobre o processo relacionado) +
  itens do `store.agenda` pré-existente (compromissos manuais, entidade independente, já com seu próprio
  `GET`/`POST /api/agenda`). Cada fonte só entra se o usuário tiver o módulo correspondente
  (`allowedInDepartment(user,'juridico','read')` / `allowed(user,'agenda','read')`). Ordenação
  determinística: `date` → `entityType` → `entityId` (comparação lexicográfica de string, sem UTC).
  Cada item traz `entityType`/`entityId`/`target` (link para o detalhe canônico já existente da Fase 2)
  — nenhum campo `date`/`status`/`origin`/`originType` é gravado em uma segunda entidade.
- **`GET /api/attention`** — só Legal Deadline. Três categorias de **apresentação** (nunca persistidas,
  nunca um quinto valor de `status`): `OVERDUE` (via `isLegalDeadlineOverdue()`, reutilizada sem
  recálculo), `UPCOMING` (`status==='ativo'` e `date` dentro da janela de `civilDateAfterDays(30)`, a
  mesma janela já usada no dashboard da Fase 2) e `REQUIRES_REVIEW` (via `legalDeadlineIntegrityFlag()`
  da Fase 2, para registros legados sem `originType`/`status`).
- **JUDICIAL_PROCESSUAL × INTERNAL_CONTROL:** ambos aparecem na Agenda/Atenção com o `originType`
  preservado tal como está — a distinção de rótulo ("prazo processual" vs. "controle interno") é
  decisão da camada de apresentação; a API nunca converte um no outro.
- **"Minha Semana":** não implementada nesta rodada — não há hoje um campo confiável de
  responsável/atribuição por usuário em Legal Deadline (`responsible` não existe no modelo), então uma
  visão "meus itens da semana" exigiria inventar esse campo, fora do slice mínimo autorizado. Fica
  documentada como pendente para quando essa base existir.

## Fase 4A — implementada e HOMOLOGADA (rodada documental de decisões)

**Estritamente documental — nenhum código foi alterado, em nenhuma das duas passagens desta Fase 4A.**
Fecha as decisões de produto/negócio/UX necessárias antes de qualquer implementação funcional da Fase
4B. Todas as decisões estão registradas em `docs/DECISIONS.md`, seção 1.2 ("Sprint 2 — Fase 4 —
Decisões de Negócio"), com IDs `D4.1` a `D4.15`.

Resumo do que já estava **implicitamente fechado** (reafirmado, não decidido nesta rodada):
- Google Calendar nunca é fonte de prazo jurídico (D1, MASTER_HANDOFF §10) — D4.1 decidiu apenas **se e
  como** a integração de visualização é ativada, não se ela pode virar fonte.
- "Confirmado pelo Jurídico" já tem semântica homologada pela D1.4 — D4.4 apenas formaliza os casos de
  borda (legado, INTERNAL_CONTROL, suspenso/cumprido/cancelado/reaberto) explicitamente pedidos.
- Nenhuma automação jurídica na Fase 4, mesmo na implementação futura (D4.9) — já é regra vigente (D1,
  MASTER_HANDOFF §13/§14, Anexo A).
- Fallback de indisponibilidade do Calendar (D4.8) — herda a regra global já homologada de "falha de
  fonte preserva o último dado válido, nunca zero" (Anexo A, regras 3 e 14), já aplicada ao Monday.

**Decisões HOMOLOGADAS pela Cristiane em 12/09/2026** (segunda passagem desta Fase 4A): D4.1 (Google
Calendar — **Opção B, leitura apenas**; Opção C fica registrada como possibilidade futura, sujeita a
nova decisão formal), D4.2/D4.3 (`responsibleUserId` opcional, referenciando usuário existente e ativo,
1 responsável principal, sem herança automática), D4.5 (label "Prazo processual"/"Controle interno"),
D4.6 (labels de status/derivados em português), D4.10 ("Minha Semana" = semana civil, segunda a domingo,
`America/Sao_Paulo`), D4.11 (usuário inativo como responsável → "Responsável inativo", histórico nunca
apagado), D4.15 (`cumprido`/`cancelado`/`suspenso` não aparecem por padrão na Agenda operacional,
permanecem em histórico/filtro/detalhe). D4.7 fica **fora de escopo funcional do piloto atual** (Opção B
não escreve eventos no Calendar).

**Matriz GO/NO-GO (D4.13): GO DOCUMENTAL para a Fase 4B.** Isso significa apenas que as decisões de
negócio necessárias foram fechadas — não autoriza deploy, produção, escrita externa (a Opção B homologada
é leitura apenas), nem marca a Fase 4B como implementada. A implementação funcional deve ser feita em
PR(s) separado(s).

## QA — Fases 1, 2 e 3 implementadas; Fase 4A (documental) fechada; Fase 4B segue planejada

Ver `docs/QA.md`, seção "QA do Sprint 2 — Legal Deadline com D1 homologada": os casos que dependiam
apenas do modelo de dados (originType/status/reabertura/atraso, isolamento Jurídico×TI, administrador
técnico, múltiplos prazos, novo fato gerador, mass assignment, processo manual/fora de escopo) foram
implementados como testes reais na Fase 1. Na Fase 2, os casos de dashboard/listagem/detalhe/histórico
(correção dos widgets, filtros, detalhe com histórico, regressão DATA/CITAÇÃO sem Legal Deadline) também
passaram a ser testes reais. Na Fase 3, os casos de Agenda/Atenção (item aparece na agenda/atenção
correta, não duplicidade, reflexo de alteração canônica, reabertura refletindo overdue, escopo por
companyId/SPE) também passaram a ser testes reais (`tests/core.test.js`,
`tests/security-integration.test.js`). Nesta Fase 4A, nenhum teste de código foi adicionado (rodada
documental) — ver `docs/QA.md`, seção "QA planejado — Fase 4", para os cenários de aceite futuros da
Fase 4B, ainda não executados.

## Dependências entre fases

Fase 1 (modelo de dados: `originType` + `status`) — **concluída** — desbloqueou a Fase 2. Fase 2
(dashboard, listagem/filtro, detalhe/histórico) — **concluída**. Fase 3 (Agenda/Atenção) dependia de
Fases 1 e 2 estarem concluídas, pois consome o mesmo `legalDeadlines` já filtrável/exibível —
**concluída**. Fase 4A (decisões/homologação documental) — **concluída e homologada** (D4.1, D4.2, D4.3,
D4.5, D4.6, D4.10, D4.11, D4.15 — Cristiane, 12/09/2026), desbloqueando a Fase 4B (Google Calendar Opção
B, `responsibleUserId`, Minha Semana) — **ainda não iniciada**; matriz GO/NO-GO em **GO DOCUMENTAL**
(D4.13), aguardando implementação em PR(s) separado(s).

## Riscos e bloqueios conhecidos antes de iniciar a Fase 4B

- Nenhum bloqueio **técnico nem de decisão de negócio** identificado para iniciar a Fase 4B — o modelo
  de dados (Fase 1), o consumo canônico via dashboard/listagem/detalhe/Agenda/Atenção (Fases 2–3) estão
  implementados e testados (196 testes, todos passando), e as decisões de negócio necessárias (D4.1,
  D4.2, D4.3, D4.5, D4.6, D4.10, D4.11, D4.15) foram homologadas (Fase 4A). O que falta é exclusivamente
  a **implementação funcional** (código, testes, CI), a ser feita em PR(s) separado(s) — GO DOCUMENTAL
  não é deploy nem produção autorizados.
- O levantamento de código não conseguiu confirmar, para os boards além de `processos`, se existe
  qualquer coluna de data relevante — isso não bloqueia o Sprint 2 (D1.2 já restringe o piloto a
  `processos`), mas deve ser revisitado se o Jurídico identificar necessidade de expandir o escopo de
  boards no futuro (rito descrito em `docs/DECISIONS.md`, seção 1.1, D1.2).
- `evidenceReference` permanece fora de escopo (D1.4) — nenhuma Fase do Sprint 2 depende dela; nenhuma
  tela desta Fase 2 usa linguagem de "comprovação documental" sem esse campo.
- Nenhuma tela nova de UI foi criada na Fase 2 (listagem/detalhe ficaram como API); a semântica de copy
  "Confirmado pelo Jurídico" (D1.4) segue pendente para quando houver UI dedicada.

## Fase 4B — implementada (responsável, Minha Semana, Agenda D4.15, Calendar read-only)

Implementação funcional exata do que a Fase 4A homologou, sem alterar nenhuma decisão de negócio:

- `legalDeadlines.responsibleUserId` (opcional): validado em `validateLegalDeadline()`; nova atribuição
  exige usuário existente e não-inativo (`deletedAt`, mesma convenção de soft-delete já usada em toda a
  plataforma — nenhum campo novo de "usuário ativo" foi inventado). "Desatribuir" (`responsibleUserId:
  null` com valor anterior não-nulo) não foi homologado e é rejeitado (422) em vez de implementado por
  suposição.
- D4.11: usuário responsável que se torna inativo depois nunca tem o campo apagado; view sinaliza
  `responsibleInactive: true` (Agenda/Atenção/detalhe/Minha Semana).
- `GET /api/my-week` ("Minha Semana", D4.10): view pura sobre `legalDeadlines` (semana civil corrente,
  segunda a domingo, `America/Sao_Paulo`, via `civilWeekWindow()`) combinada com a leitura (adapter) do
  Google Calendar. **Gap conhecido:** eventos manuais de `store.agenda` não entram em Minha Semana —
  `owner` é texto livre, sem `user.id` canônico; inferir por nome seria a mesma "substituição textual"
  vedada para `responsibleUserId` (ver `docs/DATA_MODEL.md`, seção "Fase 4B").
- D4.15: Agenda operacional (`GET /api/agenda-items`) não mostra `cumprido`/`cancelado`/`suspenso` por
  padrão; `?includeInactive=1` devolve todos, reaproveitando o padrão de parâmetro explícito já usado no
  Sprint 2. Nenhum registro é apagado ou tem status alterado.
- Google Calendar (D4.1, Opção B): implementado como adapter somente leitura (`GET /api/calendar/status`,
  `GET /api/calendar/events`). **Blocker técnico:** sem credenciais reais de OAuth do Google neste
  ambiente, a ativação real fica bloqueada por design (`not_configured`/`events: []`), nunca simulada.
  Nenhum método de escrita da API do Calendar existe no código (verificado por teste de código-fonte).

Testes: `npm test` cobre as novas regras (unitários em `tests/core.test.js`, HTTP em
`tests/security-integration.test.js`), sem remover nenhum teste anterior. Nenhuma automação, notificação,
criação automática de Task, escrita no Calendar, deploy ou produção foi introduzida — permanece
estritamente dentro do escopo homologado na Fase 4A.

---

**Fases 1, 2, 3 e 4A implementadas. Fase 4B (implementação funcional) implementada** — `responsibleUserId`,
"Minha Semana", D4.15 na Agenda operacional e adapter somente leitura do Google Calendar, conforme
homologado em `docs/DECISIONS.md` (D4.1–D4.15). Nenhum deploy, produção ou escrita externa foi realizado
por esta implementação; aguarda revisão antes de qualquer merge/deploy.

---

## Encerramento do Sprint 2

**Data:** 13/09/2026
**SHA base (master consolidada):** `3eff813a6e5a9996a10164b33f10d00c087161c2` (squash do PR #8, head
aprovado `d2f7ac8afc3c9a38b809bc5d6215942a33d47e1e`)
**Decisão de encerramento:** `docs/DECISIONS.md`, seção 1.3, D2-CLOSE (HOMOLOGADO)

### PRs / fases consolidadas

| Fase | PR | Status |
|---|---|---|
| Fase 1 — modelagem e integridade do Legal Deadline | (consolidada antes deste ciclo de PRs numerados) | CONCLUÍDA |
| Fase 2 — consumo canônico, listagem, detalhe, filtros, histórico, dashboard | PR #5 | CONCLUÍDA |
| Fase 3 — Agenda/Atenção sobre Legal Deadline canônico | PR #6 | CONCLUÍDA |
| Fase 4A — decisões e homologação documental | PR #7 | CONCLUÍDA |
| Fase 4B — responsável, Minha Semana, D4.15, labels/copy, Calendar adapter read-only | PR #8 | CONCLUÍDA NO ESCOPO HOMOLOGADO |

### Status final do Sprint 2

**SPRINT 2: CONCLUÍDO NO ESCOPO HOMOLOGADO** — não simplesmente "concluído", porque há gaps
deliberadamente aceitos e um blocker de dependência externa (ver abaixo). Nenhum desses pontos é uma
falha de execução: cada um foi identificado, decidido e registrado explicitamente, nunca resolvido por
suposição.

### O que foi entregue (síntese; detalhe em cada Fase acima e em `docs/DATA_MODEL.md`)

- Legal Deadline como entidade canônica; Legal Process 1:N Legal Deadlines.
- `originType` obrigatório (enum fechado: `JUDICIAL_PROCESSUAL`/`INTERNAL_CONTROL`).
- `status` fechado: `ativo`/`suspenso`/`cumprido`/`cancelado`.
- Atraso (`overdue`) derivado, nunca persistido; reabertura preserva o mesmo `id` e exige `reason`.
- Auditoria `before`/`after` em toda alteração de Legal Deadline, incluindo reatribuição de responsável.
- Monday permanece somente leitura/transitório — nunca cria Legal Deadline; `DATA`/`CITAÇÃO` do board
  nunca são tratados como prazo jurídico.
- Agenda e Atenção são views — nunca duplicam Legal Deadline em uma coleção paralela.
- `responsibleUserId` opcional, validado por existência + elegibilidade (`canBeResponsibleForLegalDeadline()`
  — RBAC (`allowedContent('juridico','read')`) + `scoped()` sobre o Legal Deadline e o processo relacionado).
- `technical admin != content superuser`; TI segregado do conteúdo jurídico; `companyId`/`speId`
  preservados como defesa em profundidade.
- Usuário com `deletedAt` não autentica (sessão existente e novo login, ambos negados); histórico de
  responsável nunca é apagado quando o usuário se torna inativo (D4.11 — `responsibleInactive: true`).
- "Minha Semana" (`GET /api/my-week`) como view pura; semana civil segunda-domingo, `America/Sao_Paulo`.
- D4.15 aplicado: `cumprido`/`cancelado`/`suspenso` fora da Agenda operacional por padrão, acessíveis via
  `includeInactive=1`/listagem/detalhe.
- Labels de apresentação (D4.5/D4.6) e "Confirmado pelo Jurídico" (D4.4) aplicados conforme regra —
  nunca para `requires_review`.
- Google Calendar: adapter somente leitura; sem escrita; sem mirroring de Legal Deadline; não cria Legal
  Deadline/Task; não altera a Agenda canônica; eventos filtrados pela mesma janela civil de Minha Semana.
- **254 testes passando** (101 unitários em `tests/core.test.js` + 153 HTTP/integração em
  `tests/security-integration.test.js`), 0 falhando, CI verde em Node 20.x e Node 22.x antes do merge
  final do PR #8.

### Gaps aceitos ao encerrar o Sprint 2

| Gap | Motivo | Classificação |
|---|---|---|
| A. Agenda Events manuais não entram em "Minha Semana" | `store.agenda.owner` é texto livre, sem `user.id` canônico — inferir por nome seria a mesma "substituição textual" vedada para `responsibleUserId` | DIFERIDO / DEPENDE DE DECISÃO DE MODELO |
| B. Desatribuição de `responsibleUserId` por `null` | Comportamento não homologado (D4.2/D4.3 só cobrem atribuição/reatribuição) | DIFERIDO / DEPENDE DE DECISÃO DE NEGÓCIO |
| C. Google Calendar real (leitura efetiva de compromissos) | Ausência de credenciais OAuth do Google e de mecanismo seguro de armazenamento de token por usuário neste ambiente | BLOQUEADO POR DEPENDÊNCIA EXTERNA/TÉCNICA |

### O que NÃO é gap do Sprint 2 (fora de escopo / gate de produção futuro)

Os itens abaixo nunca foram prometidos pelo escopo homologado do Sprint 2 e não devem ser lidos como
falha de entrega — são pré-condições de um eventual gate de produção, tratadas separadamente:

- Deploy e produção;
- Migração para PostgreSQL / persistência production-grade;
- Hardening amplo de produção (rate limiting global, CSP completa, CSRF amplo);
- Incident response formal;
- Retenção/legal hold;
- Vulnerabilidade conhecida de `pptxgenjs` (dependência de terceiros, não código deste Sprint);
- Revogação imediata de sessão (fora do soft-delete de usuário implementado nesta Fase 4B).

### Riscos residuais

| Risco | Severidade | Status | Mitigação | Próximo passo |
|---|---|---|---|---|
| Google Calendar sem OAuth real | Média (funcionalidade incompleta, não segurança) | Bloqueado por dependência externa | Adapter/contrato read-only já implementado e testado; nenhuma simulação insegura | Provisionar credenciais OAuth + mecanismo seguro de token por usuário |
| Agenda Event com `owner` textual | Baixa (gap de UX/produto, não de segurança) | Diferido | Minha Semana cobre apenas Legal Deadline por ora | Decisão de modelo: campo canônico de atribuição em `store.agenda` |
| `responsibleUserId` sem operação de desatribuição | Baixa | Diferido | PATCH rejeita explicitamente em vez de inventar comportamento | Homologação de negócio sobre semântica de "remover responsável" |
| JSON store (`data/store.json`) não é production-grade | Alta para produção, aceitável para piloto | Fora de escopo do Sprint 2 | Isolamento por `COEVO_DATA_DIR` em testes; nenhuma mudança de persistência nesta rodada | Migração PostgreSQL (ADR-001, já preparado como caminho) — gate de produção |
| Gestão de sessão/revogação imediata | Média para produção | Fora de escopo do Sprint 2 (soft-delete de usuário cobre inatividade, não revogação de token específico) | `getUser()`/login negam usuário `deletedAt` | Mecanismo de revogação de sessão ativa — gate de produção |
| Hardening HTTP/security headers amplo | Média para produção | Fora de escopo do Sprint 2 | — | Gate de produção |
| Retenção/legal hold | Média para produção | Fora de escopo do Sprint 2 | — | Gate de produção |
| Dependência futura de produção (todos os itens acima combinados) | — | Bloqueado até gate de produção | Nenhuma declaração de "pronto para produção" foi feita | Gate de produção separado, com autorização própria |

### Testes e evidências

- **Total: 254 testes** — 101 unitários (`tests/core.test.js`) + 153 HTTP/integração
  (`tests/security-integration.test.js`).
- CI verde (Node 20.x e Node 22.x) confirmado antes do merge final do PR #8 (head
  `d2f7ac8afc3c9a38b809bc5d6215942a33d47e1e`, squash `3eff813a6e5a9996a10164b33f10d00c087161c2`).
- Nenhuma regressão conhecida; nenhum P0/P1 aberto no encerramento.
- Google Calendar real **não foi executado end-to-end** por ausência de OAuth real — o adapter e o
  contrato read-only (status, ausência de escrita, ausência de token exposto, filtro de janela civil)
  foram testados.

### Critérios de aceite do Sprint 2

- [x] Legal Deadline canônico
- [x] `originType`
- [x] `status`
- [x] Atraso derivado
- [x] Reabertura (mesmo `id`, `reason` obrigatório)
- [x] Auditoria (`before`/`after`)
- [x] Listagem/filtro
- [x] Detalhe/histórico
- [x] Dashboard sem raw Monday date como prazo
- [x] Agenda
- [x] Atenção
- [x] `responsibleUserId`
- [x] Minha Semana
- [x] D4.15
- [x] Labels/copy
- [x] `companyId`/`speId`
- [x] TI segregado
- [x] Administrador técnico segregado
- [x] Calendar read-only
- [x] Calendar sem escrita
- [x] Calendar não cria prazo
- [x] 254 testes
- [x] CI verde
- [x] Documentação consolidada
- [x] Nenhum P0/P1 aberto

### GO / NO-GO do Sprint

**GO PARA ENCERRAMENTO DO SPRINT 2.**

**NO-GO PARA PRODUÇÃO** — o Sprint está concluído funcionalmente no escopo homologado, mas produção
depende de um gate técnico/de negócio separado (persistência production-grade, hardening de segurança,
gestão de sessão, retenção/legal hold, OAuth real do Calendar, entre outros listados acima). Nenhuma
declaração deste documento autoriza deploy ou produção.

### Transição para o próximo Sprint (proposta de priorização — não há prioridade formal pré-existente)

**P0/P1 antes de produção (proposta de priorização):**
- Persistência production-grade (migração PostgreSQL, ADR-001);
- Autenticação/gestão de sessão (revogação ativa, para além do soft-delete de usuário);
- Security headers / hardening HTTP;
- Rate limiting global;
- Incident response;
- Retenção/legal hold;
- Vulnerabilidade conhecida de `pptxgenjs`.

**Produto (proposta de priorização):**
- Modelo canônico de atribuição para Agenda Event (destrava o gap A);
- Desatribuição de `responsibleUserId` (destrava o gap B, sujeito a homologação de negócio);
- OAuth real do Google Calendar (destrava o gap C);
- Armazenamento seguro de token por usuário (pré-requisito do item anterior).

**Sprint 3 NÃO foi iniciado por este documento** — nenhum código, branch funcional ou arquitetura nova foi
criada; as frentes acima são apenas propostas de priorização para autorização futura e separada.

---

**Sprint 2: CONCLUÍDO NO ESCOPO HOMOLOGADO.** Fases 1–4B entregues e mergeadas na master. Gaps aceitos e
blocker externo (Google Calendar real) permanecem registrados. Produção não está autorizada por este
documento — depende de gate separado. Sprint 3 não foi iniciado.
