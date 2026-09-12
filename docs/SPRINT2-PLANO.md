# SPRINT2-PLANO.md — Plano Técnico do Sprint 2 (Piloto Jurídico)

> **Status deste documento:** plano preparado após a homologação da D1 (`docs/DECISIONS.md`, seção 1.1).
> **Nenhuma tarefa listada aqui foi implementada.** Este documento não autoriza início de codificação —
> serve para identificar dependências e critérios de aceite antes da autorização explícita de
> implementação. Escopo estritamente limitado ao que já está previsto em `docs/MASTER_HANDOFF.md` §24
> (Sprint 2 — piloto). Nenhuma alteração foi feita no MASTER_HANDOFF.

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

| Fase | Tarefa | Responsável | Dependência | Critério de Aceite |
|---|---|---|---|---|
| 1 | Adicionar `originType` (enum `JUDICIAL_PROCESSUAL` \| `INTERNAL_CONTROL`) como campo obrigatório de `legalDeadlines`, validado na criação e revalidado no PATCH (mesmo padrão de `processId`/`origin`/`date`) | Engenharia | D1.3 homologada (`docs/DECISIONS.md`) | `POST`/`PATCH` sem `originType` ou com valor fora do enum → `422`; PATCH que remove `originType` do estado candidato também rejeitado |
| 1 | Implementar o enum **já homologado** de `status` de Legal Deadline (`ativo`/`suspenso`/`cumprido`/`cancelado` — ver "Status do Legal Deadline — homologado", abaixo, e `docs/DECISIONS.md`, seção 1.1) | Engenharia | D1 homologada; enum/reabertura/atraso derivado aprovados em 12/09/2026 | `POST`/`PATCH` com `status` fora do enum → `422`; nenhum valor livre aceito; transições auditadas (`before`/`after`) |
| 1 | Implementar a regra de reabertura homologada: mesmo `id`, `status` volta para `ativo`, ciclo anterior preservado no histórico — nunca criar `status:'reaberto'` | Engenharia | Enum de status implementado (tarefa acima) | Reabertura preserva `id`; histórico mostra o ciclo suspenso/cancelado anterior; nenhuma API aceita `reaberto` como valor de `status` |
| 1 | Implementar a regra de atraso derivado homologada: view calcula "vencido/em atraso" apenas quando `status = ativo` **e** `date` anterior à data atual — nunca gravar isso como `status` | Engenharia | Enum de status implementado (tarefa acima) | `suspenso`/`cumprido`/`cancelado` nunca exibidos como atraso, independentemente de `date`; cobre os casos 13–15 da seção QA |
| 2 | Corrigir `dashboard-service.js`: widgets de prazo do dashboard `legal` (`legal-deadlines`, `legal-risk`) devem consultar `legalDeadlines`, não `processDate()`/coluna bruta do board `processos` | Engenharia | Nenhuma (correção de integridade, independente de `originType`) | Teste de integração confirmando que o widget não usa `processDate()`; nenhuma lógica paralela de cálculo de prazo em `dashboard-service.js` |
| 2 | Endpoint de listagem/filtro de Legal Deadline por processo, com filtro por `originType` e por `status` | Engenharia | Fase 1 concluída | Listagem filtra corretamente por `originType`/`status`; respeita `scoped()`/RBAC já vigentes |
| 2 | Tela de detalhe de Legal Deadline (histórico via auditoria existente — `store.audit` por `entityId`/`correlationId`) | Engenharia + UX | Fase 1 concluída | Histórico exibido em ordem cronológica, sem sobrescrever estado anterior; nenhuma entidade nova de histórico criada (reaproveita auditoria existente, conforme instruído) |
| 2 | Semântica de tela/copy: "Confirmado pelo Jurídico" onde hoje poderia haver ambiguidade; garantir que nenhuma tela sugira "comprovação documental validada" sem `evidenceReference` (D1.4) | UX + Jurídico (revisão de copy) | D1.4 homologada | Revisão de copy aprovada pelo Jurídico; nenhuma string de UI viola a regra de linguagem da D1.4 |
| 3 | Slice mínimo de Agenda/Atenção consumindo o mesmo registro de `legalDeadlines` (sem criar cópia) | Engenharia | Fases 1–2 concluídas | Agenda/Atenção exibem o mesmo `id` de Legal Deadline, nunca uma cópia; QA §30 casos 2 e 6 tornam-se exercitáveis |
| 3 | Google Calendar (se ativado no piloto) como visualização de leitura apenas | Engenharia + TI | Fase 3 (Agenda/Atenção) | Nenhuma escrita no Calendar; nenhuma leitura do Calendar cria/altera Legal Deadline |
| 4 | Testes de permissão específicos de Legal Deadline com `originType` (TI vs. Jurídico; administrador técnico vs. conteúdo) | Engenharia (QA) | Fases 1–2 concluídas | Casos 8 e 9 da seção QA (abaixo) passam via HTTP real, reaproveitando `allowedInDepartment()`/`allowedContent()` já existentes — nenhum mecanismo de autorização novo |
| 4 | Homologação formal com Gestora + Jurídico (MASTER_HANDOFF §32) | Negócio + Jurídico | Fases 1–3 concluídas, CI verde | Checklist de homologação do piloto jurídico aprovado |

## Status do Legal Deadline — HOMOLOGADO para o Sprint 2 (não implementado)

**Aprovado pela Cristiane em 12/09/2026** (`docs/DECISIONS.md`, seção 1.1, "Status do Legal Deadline").
Registrado aqui apenas como referência de implementação para a Fase 1 — a decisão em si vive em
`docs/DECISIONS.md`.

- **Enum fechado aprovado:** `ativo`, `suspenso`, `cumprido`, `cancelado`. Nenhum outro valor.
- **Reabertura aprovada:** retorno ao status `ativo`, preservando o evento de reabertura no histórico de
  auditoria (`before`/`after`, com `reason` explicando o motivo), em vez de um quinto status `reaberto`.
  Justificativa homologada: um Legal Deadline reaberto se comporta exatamente como um prazo ativo em
  qualquer view; o que importa preservar é *que* ele foi reaberto e *por quê*, o que o histórico de
  auditoria já resolve sem precisar de um status paralelo.
- **Atraso é condição derivada, não status, aprovado:** "vencido"/"atrasado"/"em atraso" nunca é gravado
  em `status`. Uma view só pode exibir essa condição quando `status = ativo` **e** `date` é anterior à
  data atual — `suspenso`, `cumprido` e `cancelado` nunca aparecem como atraso.

**Isto está aprovado, mas continua não implementado.** A Fase 1 (tabela acima) é onde essa implementação
acontece — ainda não iniciada.

## QA a preparar (não implementado nesta etapa)

Ver `docs/QA.md`, seção "QA planejado para o Sprint 2 — Legal Deadline com D1 homologada", para os 27
casos completos (criação válida processual/interna, rejeições de `originType`/`origin`/`date`/`processId`,
isolamento Jurídico×TI, administrador técnico sem acesso a conteúdo, múltiplos prazos, novo fato gerador
vs. alteração, suspensão/cancelamento/cumprimento, correção do dashboard, falha do Monday, ausência de
cálculo automático, Google Calendar não-fonte, acesso direto por ID fora do escopo, enum de `status`
fora do domínio, atraso derivado por combinação `status`+`date`, e reabertura preservando histórico).

## Dependências entre fases

Fase 1 (modelo de dados: `originType` + `status`) bloqueia Fase 2 (endpoints/telas) e Fase 4 (testes de
permissão específicos). Fase 2 (correção do dashboard) é independente das demais e pode ser feita em
paralelo. Fase 3 (Agenda/Atenção) depende de Fase 1 e 2 estarem concluídas, pois consome o mesmo
`legalDeadlines` já filtrável/exibível. Fase 4 (homologação formal) é sempre a última.

## Riscos e bloqueios conhecidos antes de iniciar

- O enum de `status`/regra de reabertura/regra de atraso derivado **já foi aprovado** (12/09/2026) — não
  é mais um bloqueio para a Fase 1.
- O levantamento de código não conseguiu confirmar, para os boards além de `processos`, se existe
  qualquer coluna de data relevante — isso não bloqueia o Sprint 2 (D1.2 já restringe o piloto a
  `processos`), mas deve ser revisitado se o Jurídico identificar necessidade de expandir o escopo de
  boards no futuro (rito descrito em `docs/DECISIONS.md`, seção 1.1, D1.2).
- Nenhum bloqueio técnico identificado para iniciar a Fase 1 assim que autorizado — a decisão de negócio
  necessária (D1 + status) está integralmente homologada; falta apenas autorização explícita para
  implementar.

---

**Este plano não inicia o Sprint 2.** Implementação de qualquer fase requer nova autorização explícita.
