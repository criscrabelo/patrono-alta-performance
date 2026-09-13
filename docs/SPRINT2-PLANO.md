# SPRINT2-PLANO.md — Plano Técnico do Sprint 2 (Piloto Jurídico)

> **Status deste documento:** plano preparado após a homologação da D1 (`docs/DECISIONS.md`, seção 1.1).
> **FASE 1 IMPLEMENTADA** (`originType`, enum de `status`, regra de reabertura, atraso derivado).
> **FASE 2 IMPLEMENTADA** — correção de `dashboard-service.js` (widgets jurídicos de prazo consomem
> exclusivamente `legalDeadlines`/`isLegalDeadlineOverdue()`, nunca mais DATA/CITAÇÃO/PROTOCOLO/
> `processDate()` do Monday), listagem/filtro (`GET /api/entities/legalDeadlines?paginated=1`) e
> detalhe/histórico (`GET /api/entities/legalDeadlines/:id/detail`).
> **FASE 3 IMPLEMENTADA NESTA RODADA** — slice mínimo de Agenda (`GET /api/agenda-items`) e Atenção
> (`GET /api/attention`), combinando Legal Deadline (fonte canônica exclusiva de prazo) com os eventos
> manuais pré-existentes de `store.agenda`, sem duplicar nem persistir cópia do prazo — ver seção
> "Fase 3" abaixo. **FASE 4 CONTINUA NÃO INICIADA** — Google Calendar, automações, cálculo automático de
> prazo e homologação formal não foram tocados; nenhuma autorização adicional foi dada além da Fase 3.
> Escopo estritamente limitado ao que já está previsto em `docs/MASTER_HANDOFF.md` §24 (Sprint 2 —
> piloto). Nenhuma alteração foi feita no MASTER_HANDOFF.

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
| 3 | Google Calendar (se ativado no piloto) como visualização de leitura apenas | Engenharia + TI | Fase 3 (Agenda/Atenção) | Nenhuma escrita no Calendar; nenhuma leitura do Calendar cria/altera Legal Deadline | ⏳ Não iniciada — fora do escopo desta rodada, aguardando autorização própria |
| 4 | Testes de permissão específicos de Legal Deadline com `originType` (TI vs. Jurídico; administrador técnico vs. conteúdo) | Engenharia (QA) | Fases 1–2 concluídas | Casos 8 e 9 da seção QA (abaixo) passam via HTTP real, reaproveitando `allowedInDepartment()`/`allowedContent()` já existentes — nenhum mecanismo de autorização novo | ✅ **Implementado** — Fase 1 já cobria TI/administrador para CRUD; Fase 2 estende a mesma cobertura para dashboard/listagem/detalhe |
| 4 | Homologação formal com Gestora + Jurídico (MASTER_HANDOFF §32) | Negócio + Jurídico | Fases 1–3 concluídas, CI verde | Checklist de homologação do piloto jurídico aprovado | ⏳ Não iniciada |

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

## QA — Fases 1, 2 e 3 implementadas; Fase 4 segue planejada

Ver `docs/QA.md`, seção "QA do Sprint 2 — Legal Deadline com D1 homologada": os casos que dependiam
apenas do modelo de dados (originType/status/reabertura/atraso, isolamento Jurídico×TI, administrador
técnico, múltiplos prazos, novo fato gerador, mass assignment, processo manual/fora de escopo) foram
implementados como testes reais na Fase 1. Na Fase 2, os casos de dashboard/listagem/detalhe/histórico
(correção dos widgets, filtros, detalhe com histórico, regressão DATA/CITAÇÃO sem Legal Deadline) também
passaram a ser testes reais. Nesta Fase 3, os casos de Agenda/Atenção (item aparece na agenda/atenção
correta, não duplicidade, reflexo de alteração canônica, reabertura refletindo overdue, escopo por
companyId/SPE) também passaram a ser testes reais (`tests/core.test.js`,
`tests/security-integration.test.js`). Os casos que dependem de Google Calendar continuam apenas
planejados, para a Fase 4.

## Dependências entre fases

Fase 1 (modelo de dados: `originType` + `status`) — **concluída** — desbloqueou a Fase 2. Fase 2
(dashboard, listagem/filtro, detalhe/histórico) — **concluída**. Fase 3 (Agenda/Atenção) dependia de
Fases 1 e 2 estarem concluídas, pois consome o mesmo `legalDeadlines` já filtrável/exibível —
**concluída nesta rodada**. Fase 4 (Google Calendar, automações, homologação formal) é sempre a última —
**ainda não iniciada**.

## Riscos e bloqueios conhecidos antes de iniciar a Fase 4

- Nenhum bloqueio técnico identificado para a Fase 4 — o modelo de dados (Fase 1) e o consumo canônico
  via dashboard/listagem/detalhe/Agenda/Atenção (Fases 2–3) estão implementados e testados (196 testes,
  todos passando).
- O levantamento de código não conseguiu confirmar, para os boards além de `processos`, se existe
  qualquer coluna de data relevante — isso não bloqueia o Sprint 2 (D1.2 já restringe o piloto a
  `processos`), mas deve ser revisitado se o Jurídico identificar necessidade de expandir o escopo de
  boards no futuro (rito descrito em `docs/DECISIONS.md`, seção 1.1, D1.2).
- `evidenceReference` permanece fora de escopo (D1.4) — nenhuma Fase do Sprint 2 depende dela; nenhuma
  tela desta Fase 2 usa linguagem de "comprovação documental" sem esse campo.
- Nenhuma tela nova de UI foi criada na Fase 2 (listagem/detalhe ficaram como API); a semântica de copy
  "Confirmado pelo Jurídico" (D1.4) segue pendente para quando houver UI dedicada.

---

**Fases 1, 2 e 3 implementadas.** Fase 4 continua não iniciada — implementação exige nova autorização
explícita.
