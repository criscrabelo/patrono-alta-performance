# SPRINT2-PLANO.md — Plano Técnico do Sprint 2 (Piloto Jurídico)

> **Status deste documento:** plano preparado após a homologação da D1 (`docs/DECISIONS.md`, seção 1.1).
> **FASE 1 IMPLEMENTADA** (`originType`, enum de `status`, regra de reabertura, atraso derivado — ver
> tabela abaixo). **FASES 2, 3 e 4 CONTINUAM NÃO INICIADAS** — nenhuma delas foi implementada nesta
> rodada; nenhuma autorização adicional foi dada além da Fase 1. Escopo estritamente limitado ao que já
> está previsto em `docs/MASTER_HANDOFF.md` §24 (Sprint 2 — piloto). Nenhuma alteração foi feita no
> MASTER_HANDOFF.

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
| 1 | Implementar a regra de reabertura homologada: mesmo `id`, `status` volta para `ativo`, ciclo anterior preservado no histórico — nunca criar `status:'reaberto'` | Engenharia | Enum de status implementado (tarefa acima) | Reabertura preserva `id`; histórico mostra o ciclo suspenso/cancelado anterior; nenhuma API aceita `reaberto` como valor de `status` | ✅ **Implementado** — é um `PATCH` comum; `reason` do input agora alimenta `audit()` em `/api/entities/:type` (extraído antes de sanitizar, para não virar campo persistido no registro) |
| 1 | Implementar a regra de atraso derivado homologada: função central calcula "vencido/em atraso" apenas quando `status = ativo` **e** `date` anterior à data atual — nunca gravar isso como `status` | Engenharia | Enum de status implementado (tarefa acima) | `suspenso`/`cumprido`/`cancelado` nunca exibidos como atraso, independentemente de `date`; testes unitários dedicados | ✅ **Implementado** — `isLegalDeadlineOverdue()` em `server.js`, pura e testada; **ainda não consumida por nenhuma view** (isso é Fase 2) |
| 2 | Corrigir `dashboard-service.js`: widgets de prazo do dashboard `legal` (`legal-deadlines`, `legal-risk`) devem consultar `legalDeadlines`, não `processDate()`/coluna bruta do board `processos` | Engenharia | Nenhuma (correção de integridade, independente de `originType`) | Teste de integração confirmando que o widget não usa `processDate()`; nenhuma lógica paralela de cálculo de prazo em `dashboard-service.js` | ⏳ Não iniciada |
| 2 | Endpoint de listagem/filtro de Legal Deadline por processo, com filtro por `originType` e por `status` | Engenharia | Fase 1 concluída | Listagem filtra corretamente por `originType`/`status`; respeita `scoped()`/RBAC já vigentes | ⏳ Não iniciada |
| 2 | Tela de detalhe de Legal Deadline (histórico via auditoria existente — `store.audit` por `entityId`/`correlationId`) | Engenharia + UX | Fase 1 concluída | Histórico exibido em ordem cronológica, sem sobrescrever estado anterior; nenhuma entidade nova de histórico criada (reaproveita auditoria existente, conforme instruído) | ⏳ Não iniciada |
| 2 | Semântica de tela/copy: "Confirmado pelo Jurídico" onde hoje poderia haver ambiguidade; garantir que nenhuma tela sugira "comprovação documental validada" sem `evidenceReference` (D1.4) | UX + Jurídico (revisão de copy) | D1.4 homologada | Revisão de copy aprovada pelo Jurídico; nenhuma string de UI viola a regra de linguagem da D1.4 | ⏳ Não iniciada |
| 3 | Slice mínimo de Agenda/Atenção consumindo o mesmo registro de `legalDeadlines` (sem criar cópia) | Engenharia | Fases 1–2 concluídas | Agenda/Atenção exibem o mesmo `id` de Legal Deadline, nunca uma cópia; QA §30 casos 2 e 6 tornam-se exercitáveis | ⏳ Não iniciada |
| 3 | Google Calendar (se ativado no piloto) como visualização de leitura apenas | Engenharia + TI | Fase 3 (Agenda/Atenção) | Nenhuma escrita no Calendar; nenhuma leitura do Calendar cria/altera Legal Deadline | ⏳ Não iniciada |
| 4 | Testes de permissão específicos de Legal Deadline com `originType` (TI vs. Jurídico; administrador técnico vs. conteúdo) | Engenharia (QA) | Fases 1–2 concluídas | Casos 8 e 9 da seção QA (abaixo) passam via HTTP real, reaproveitando `allowedInDepartment()`/`allowedContent()` já existentes — nenhum mecanismo de autorização novo | ⚠️ Parcialmente antecipado — a Fase 1 já cobre TI/administrador para Legal Deadline (ver testes desta rodada); listagem/filtro fica para a Fase 2 |
| 4 | Homologação formal com Gestora + Jurídico (MASTER_HANDOFF §32) | Negócio + Jurídico | Fases 1–3 concluídas, CI verde | Checklist de homologação do piloto jurídico aprovado | ⏳ Não iniciada |

## Status do Legal Deadline — HOMOLOGADO e IMPLEMENTADO (Fase 1)

**Aprovado pela Cristiane em 12/09/2026** (`docs/DECISIONS.md`, seção 1.1, "Status do Legal Deadline") e
**implementado nesta Fase 1** do Sprint 2.

- **Enum fechado:** `ativo`, `suspenso`, `cumprido`, `cancelado`. Nenhum outro valor é aceito —
  `LEGAL_DEADLINE_STATUSES` em `server.js`, validado por `validateLegalDeadline()`.
- **Reabertura:** um `PATCH` comum para `status:'ativo'` — mesmo `id`, `version` incrementada,
  `updatedAt`/`updatedBy` atualizados, e o motivo (`reason` do input) preservado no histórico de
  auditoria (`before`/`after`), nunca em um quinto status `reaberto`.
- **Atraso é condição derivada:** `isLegalDeadlineOverdue(deadline, today)` — `true` somente quando
  `status === 'ativo'` **e** `date` é anterior a `today` (comparação de string determinística, fuso
  `America/Sao_Paulo` por padrão). `suspenso`/`cumprido`/`cancelado` nunca são atraso.

Detalhe completo do que foi implementado em `docs/DATA_MODEL.md`, seção "Sprint 2, Fase 1 — implementada".

## QA — Fase 1 implementada; Fases 2–4 seguem planejadas

Ver `docs/QA.md`, seção "QA planejado para o Sprint 2 — Legal Deadline com D1 homologada": os casos que
dependiam apenas do modelo de dados (originType/status/reabertura/atraso, isolamento Jurídico×TI,
administrador técnico, múltiplos prazos, novo fato gerador, mass assignment, processo manual/fora de
escopo) foram implementados como testes reais nesta Fase 1 (`tests/core.test.js`,
`tests/security-integration.test.js`). Os casos que dependem de UI/listagem/dashboard/Agenda-Atenção
(correção dos widgets, tela de detalhe, slice de Agenda/Atenção, Google Calendar) continuam apenas
planejados, para as Fases 2–4.

## Dependências entre fases

Fase 1 (modelo de dados: `originType` + `status`) — **concluída** — desbloqueia Fase 2 (endpoints/telas)
e Fase 4 (testes de permissão específicos). Fase 2 (correção do dashboard) é independente das demais e
pode ser feita em paralelo. Fase 3 (Agenda/Atenção) depende de Fase 1 e 2 estarem concluídas, pois
consome o mesmo `legalDeadlines` já filtrável/exibível. Fase 4 (homologação formal) é sempre a última.

## Riscos e bloqueios conhecidos antes de iniciar as Fases 2–4

- Nenhum bloqueio técnico identificado para a Fase 2 — o modelo de dados que ela depende (Fase 1) está
  implementado e testado (132 testes, 111 herdados + 21 novos, todos passando).
- O levantamento de código não conseguiu confirmar, para os boards além de `processos`, se existe
  qualquer coluna de data relevante — isso não bloqueia o Sprint 2 (D1.2 já restringe o piloto a
  `processos`), mas deve ser revisitado se o Jurídico identificar necessidade de expandir o escopo de
  boards no futuro (rito descrito em `docs/DECISIONS.md`, seção 1.1, D1.2).
- `evidenceReference` permanece fora de escopo (D1.4) — nenhuma Fase do Sprint 2 depende dela.

---

**Fase 1 implementada.** Fases 2, 3 e 4 continuam não iniciadas — implementação de qualquer uma delas
requer nova autorização explícita.
