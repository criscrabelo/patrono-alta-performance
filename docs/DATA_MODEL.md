# DATA_MODEL.md — Modelo de Dados Conceitual

> Modelo conceitual oficial: `docs/MASTER_HANDOFF.md` §6–§9. Sem SQL definitivo (regra explícita da
> v1.3). Este documento mapeia as entidades canônicas do piloto contra a implementação atual do
> repositório e registra o esqueleto adicionado no Sprint 1.

## Entidades do piloto jurídico — situação atual

| Entidade (§6) | Implementação atual | Situação | Nota |
|---|---|---|---|
| Legal Process | Coleção `processos`, sincronizada do Monday (somente leitura), com `externalId`, `source`, `syncedAt` | **Presente**, como registro operacional/transitório (Monday é System of Record transitório, §9) | Não é modelado com ID Patrono próprio ainda — usa o registro Monday normalizado diretamente |
| Legal Deadline | Coleção genérica `legalDeadlines`, adicionada nesta execução via `/api/entities/legalDeadlines` | **Esqueleto criado no Sprint 1** — sem pipeline automático de origem (decisão D1 pendente, ver `docs/DECISIONS.md`) | Exige `processId`, `origin`, `date` na criação; herda versionamento, exclusão lógica, restauração e auditoria do motor genérico |
| Responsibility | Sem entidade própria; responsável é um campo textual dentro dos registros Monday normalizados (`processResponsibleValues`) | **Gap** | `responsibilities` reservado em `ENTITY_MODULE_MAP` para uso futuro quando a modelagem de Responsibility for necessária além do campo textual |
| External Identity | Cada registro sincronizado do Monday já carrega `source: 'monday'`, `externalId`, `boardId`, `boardName`, `syncedAt` | **Presente**, de forma implícita (par sistema/id/timestamp por registro) | Padrão consistente com "`patrono_id → (sistema, id_externo, tipo de fonte, última sincronização)`" (§8); generalização como entidade própria fica para quando outra fonte além do Monday for integrada |
| Document / File Reference | Não implementado | **Gap** — fora do escopo funcional atual (nenhum módulo de documentos ainda) | `documentReferences` reservado em `ENTITY_MODULE_MAP` para quando o piloto exigir referência documental (Google Drive, §10/§23) |
| Source metadata (por registro) | `source`, `externalId`, `syncedAt` nos registros Monday; execuções de sincronização (`mondayRuns`) registram sucesso/erro por board | **Presente** no nível de execução de sincronização; **parcial** no nível de campo (não há "última tentativa" por registro individual, apenas por execução de board) | Ver `docs/INTEGRATIONS.md` para o detalhamento do tratamento de fonte indisponível |

## Esqueleto adicionado no Sprint 1 — `legalDeadlines`

Implementado via o motor genérico de entidades já existente (`/api/entities/:type`), que já fornece
gratuitamente:

- ID Patrono (`crypto.randomUUID()`), nunca CPF/CNPJ ou identificador externo;
- versionamento (`version`, incrementado a cada `PATCH`);
- exclusão lógica (`deletedAt`/`deletedBy`) e restauração (`/restore`), preservando histórico;
- auditoria automática (`before`/`after`) em toda criação, atualização, arquivamento e restauração;
- escopo departamental (`scoped()`) e autorização por módulo (`entityModule()` → `juridico`).

Campos mínimos exigidos na criação (bloqueio obrigatório, QA §30 caso 8):

| Campo | Obrigatório | Descrição |
|---|---|---|
| `processId` | Sim | Referência ao Legal Process relacionado |
| `origin` | Sim | Origem identificada do prazo (nunca inventada; deve vir de fonte validada ou registro autorizado, §6) |
| `date` | Sim | Data-limite |
| `status` | Não (default implícito) | Ex.: Ativo, Suspenso, Cumprido — suspensão preserva motivo/estado, nunca é exibida como vencimento comum (§30 caso 6) |
| `responsible` | Não | Responsável pelo cumprimento |

**O que este esqueleto não faz** (por instrução explícita da v1.3 e do usuário):
- Não calcula prazo processual automaticamente.
- Não aplica CPC, calendário forense ou regra jurídica.
- Não é populado automaticamente a partir de nenhum board do Monday — a fonte/origem por tipo de
  processo/board (Decision Backlog D1) precisa ser homologada antes do Sprint 2.
- Não infere prazo a partir do Google Calendar (§10: "Google Calendar não é fonte do prazo jurídico").

## Distinções que não podem ser violadas (checadas nesta execução)

| Distinção | Verificação nesta execução |
|---|---|
| Person ≠ User | Nenhuma entidade `Person` própria ainda existe; `users` no seed são contas de acesso, não cadastro de pessoa física — sem violação, mas também sem modelagem de Person ainda (gap, fora do piloto jurídico mínimo) |
| Contract ≠ Document | Nenhuma das duas entidades foi criada nesta execução — sem risco de colisão |
| Legal Deadline ≠ campo de data do processo | Corrigido nesta execução: `legalDeadlines` é coleção própria, não um campo `deadline_date` dentro de `processos` |
| Canonical Identity ≠ Source of Truth | Nenhuma migração de source of truth foi feita; Monday permanece fonte operacional/transitória dos boards, conforme §9 |
| View ≠ Entidade | Dashboards (`dashboard-model.js`) continuam sem armazenamento próprio de registros de negócio — apenas agregam `store.records`/coleções existentes |

## Gaps de modelagem (não resolvidos nesta execução, fora do escopo do Sprint 1)

- Person, Organization, Contract, Document, Financial Obligation e demais entidades das camadas
  Comercial/Contratual/Financeira do §6 não têm modelagem própria — corretamente fora de escopo, pois o
  piloto do Sprint 1/2 é apenas Processos Jurídicos (§23).
- `Legal Process` ainda não tem um ID Patrono canônico próprio, independente do registro Monday — hoje o
  registro normalizado do Monday *é* o registro operacional. Fica como próximo passo técnico quando o
  Legal Process precisar existir independentemente de uma fonte externa específica.
