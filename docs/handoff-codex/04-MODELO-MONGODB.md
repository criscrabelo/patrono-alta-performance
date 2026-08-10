# 04 — Modelo de dados (MongoDB solicitado x persistência real)

## Conclusão da inspeção

**Não existe MongoDB, driver Mongo, Mongoose, schemas MongoDB ou índices Mongo no projeto.** O arquivo mantém este nome para atender ao checklist de handoff, mas documenta o modelo real: um objeto JSON em `data/store.json`.

As estruturas abaixo se comportam como coleções lógicas. Não possuem validação de schema nem índices de banco. Relacionamentos são IDs em strings.

## Coleções jurídicas em `records`

Campos comuns observados: `id`, `source`, `externalId`, `module`, `boardId`, `boardName`, `title`, `group`, `columns`, `columnsByTitle`, `createdAt`, `syncedAt`, `classification`, `deletedAt`, `version`.

| Coleção lógica | Ativos | Origem | Finalidade |
|---|---:|---|---|
| `records.processos` | 273 | Monday / Processos Judiciais | Carteira processual |
| `records.notificacoes` | 1.074 | Monday / Notificações Clientes | Notificações e cobrança extrajudicial |
| `records.distratos` | 38 | Monday / Distratos e Retomadas | Distratos/retomadas no mesmo quadro |
| `records.honorarios` | 894 | Monday / Honorários Extrajudiciais | Honorários extrajudiciais |
| `records.unidades` | 112 | Monday / Controle de Entrega | Entrega e documentação de unidades |
| `records.compraVenda` | 1.404 | Monday / Contratos para Clientes | Compra e venda/contratos |
| `records.transferenciaIntermediaria` | 25 | Monday / Transferência intermediária | Recompra apresentada com nova nomenclatura |
| `records.requests` | 2 ativos / 3 totais | Cadastro interno | Exercício do CRUD genérico |

Total Monday ativo no snapshot: **3.820 registros**.

### Origem e sincronização

- `source` = `monday`.
- `externalId` é o ID do item Monday.
- `boardId`/`boardName` identificam o quadro.
- `syncedAt` é atualizado em cada sincronização.
- O upsert busca `source + externalId`; não existe índice físico para essa chave.
- `deletedAt` implementa soft delete, embora dados Monday não sejam removidos durante o sync.

## Coleções corporativas de topo

| Chave | Volume | Campos observados / propósito |
|---|---:|---|
| `users` | 4 | `id`, `name`, `email`, `role`, `department`, `mfa`, `active` |
| `departments` | 2 | `id`, `name`, `color`, `source`, `budget` |
| `financials` | 2 | `departmentId`, budget, planned, committed, actual, balance, forecast |
| `agenda` | 2 | evento, departamento, data, prioridade, status, responsável |
| `committees` | 0 | Comitês futuros |
| `audit` | 23 | ação, entidade, antes/depois, responsável, data e correlação |
| `compliance` | 0 | revisões de compliance |
| `mondayRuns` | 14 | execuções e resultado por módulo |
| `dashboardPreferences` | 1 | preferências por `userId + dashboardId` |

`registrationRequests` e `budgetImports` são criadas pelas rotas quando usadas, mas podem estar ausentes no store atual; o seed inicial as define.

## Coleções de Projetos/Recuperação

| Chave | Volume | Campos/relacionamentos principais |
|---|---:|---|
| `projects` | 1 | `departmentId`, `objectiveId`, `ownerUserId`, `managerUserId`, `targetId`, status |
| `strategicObjectives` | 1 | objetivo por `departmentId` |
| `projectWorkstreams` | 10 | `projectId`, owner, prazo, progresso, status |
| `projectActions` | 12 | `projectId`, `workstreamId`, `indicatorId`, `dependencyId` |
| `projectMilestones` | 7 | `projectId`, datas, status, owner |
| `projectIndicators` | 24 | `projectId`, valor, unidade, fonte, status |
| `projectApprovalRules` | 1 | `projectId`, `levels`, `parameters`, versão |
| `projectRecoverySettings` | 1 | aging, critérios, status e políticas de honorários |
| `projectTargets`, `projectRisks`, `projectManagementItems`, `projectAssignments` | 0 | Estruturas prontas, sem dados reais |
| `recoveryCases`, `recoveryNegotiations`, `legalNegotiationHistory` | 0 | Recuperação ainda sem registros |

## Campos solicitados que não existem literalmente

| Campo solicitado | Situação real |
|---|---|
| `enterpriseId` | Não existe; empreendimento é texto vindo das colunas Monday |
| `sourceSystem` | Equivalente parcial: `source` |
| `sourceRecordId` | Equivalente: `externalId` |
| `competence` | Existe em filtros/normalização e orçamento SQL; não é campo comum dos registros Monday |
| `lastSyncedAt` | Equivalente: `syncedAt`; payload agregado usa `lastSyncedAt` |
| `departmentId` | Usado em financeiro e projetos; registros Monday geralmente não o possuem |
| `projectId` | Usado nas estruturas de projeto |

## PostgreSQL preparado

- `001_foundation.sql`: departments, users, access scopes, budgets, agenda, committees, auditoria, compliance, versões, imports e contratos de integração.
- `002_projects_recovery.sql`: projetos, atribuições, frentes, ações, marcos, riscos, indicadores, metas, alçadas, recuperação, negociações e tratativas.
- O script de migration executa somente `001_foundation.sql`.

