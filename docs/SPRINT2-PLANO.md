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

---

**Fases 1, 2 e 3 implementadas. Fase 4A (documental) implementada e HOMOLOGADA** — decisões de negócio
registradas em `docs/DECISIONS.md`, seção 1.2 (D4.1–D4.15), homologadas pela Cristiane em 12/09/2026;
matriz GO/NO-GO em GO DOCUMENTAL (D4.13). **Fase 4B (implementação funcional) continua não iniciada** —
exige nova autorização explícita para começar a implementação, em PR(s) separado(s); GO DOCUMENTAL não
autoriza deploy, produção nem escrita externa.
