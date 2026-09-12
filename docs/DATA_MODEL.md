# DATA_MODEL.md — Modelo de Dados Conceitual

> Modelo conceitual oficial: `docs/MASTER_HANDOFF.md` §6–§9. Sem SQL definitivo (regra explícita da
> v1.3). Este documento mapeia as entidades canônicas do piloto contra a implementação atual do
> repositório e registra o esqueleto adicionado no Sprint 1.

## Entidades do piloto jurídico — situação atual

| Entidade (§6) | Implementação atual | Situação | Nota |
|---|---|---|---|
| Legal Process | Coleção `processos`, sincronizada do Monday (somente leitura), com `externalId`, `source`, `syncedAt`, `department:'Jurídico'` (atribuído explicitamente na rodada 2 — ver `docs/DECISIONS.md`, ADR-005). Mutação via motor genérico de entidades bloqueada (rodada 3, ADR-008) — só a sincronização Monday escreve nesta coleção | **Presente**, como registro operacional/transitório (Monday é System of Record transitório, §9) | Não é modelado com ID Patrono próprio ainda — usa o registro Monday normalizado diretamente |
| Legal Deadline | Coleção genérica `legalDeadlines`, adicionada no Sprint 1 via `/api/entities/legalDeadlines` | **Esqueleto do Sprint 1 presente; D1 (fonte/origem) HOMOLOGADA — ver `docs/DECISIONS.md`, seção 1.1** | Exige `processId`, `origin`, `date` na criação; herda versionamento, exclusão lógica, restauração e auditoria do motor genérico. `originType` obrigatório e proposta de enum de `status` estão planejados para o Sprint 2 (ver seção "D1 homologada" abaixo) — **ainda não implementados** |
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

Campos mínimos exigidos na criação **e preservados no PATCH** (bloqueio obrigatório, QA §30 caso 8;
revalidação no PATCH adicionada na rodada 3 de correções de segurança — `docs/PERMISSIONS.md`, item 3):

| Campo | Obrigatório | Descrição |
|---|---|---|
| `processId` | Sim | Referência ao Legal Process relacionado — validada na criação **e no PATCH** contra a coleção `processos` (existência + `source==='monday'` + escopo do usuário sobre o processo; ver `docs/DECISIONS.md`, ADR-004 para a ambiguidade `processos`/`legalProcesses`, e ADR-008 para o bloqueio de mutação genérica sobre tipos Monday-sourced) |
| `origin` | Sim | Origem identificada do prazo (nunca inventada; deve vir de fonte validada ou registro autorizado, §6) — não pode ser esvaziada por PATCH |
| `date` | Sim | Data-limite — não pode ser esvaziada por PATCH |
| `status` | Não (default implícito) | Ex.: Ativo, Suspenso, Cumprido — suspensão preserva motivo/estado, nunca é exibida como vencimento comum (§30 caso 6) |
| `responsible` | Não | Responsável pelo cumprimento |

A revalidação no PATCH roda sobre o **estado candidato** (registro atual mesclado com o input
sanitizado), não apenas sobre os campos enviados na requisição — um PATCH que altera só `responsible`,
por exemplo, ainda revalida `processId`/`origin`/`date` do estado resultante, cobrindo o caso em que o
processo relacionado tenha sido excluído/desescopado desde a criação do prazo.

**O que este esqueleto não faz** (por instrução explícita da v1.3 e do usuário):
- Não calcula prazo processual automaticamente.
- Não aplica CPC, calendário forense ou regra jurídica.
- Não é populado automaticamente a partir de nenhum board do Monday — confirmado pela D1 homologada
  (`docs/DECISIONS.md`, seção 1.1): nenhuma coluna de data do Monday (incluindo `DATA`/
  `CITAÇÃO/PROTOCOLO`) é tratada como prazo jurídico por si só.
- Não infere prazo a partir do Google Calendar (§10: "Google Calendar não é fonte do prazo jurídico").

## D1 homologada — modelo previsto para o Sprint 2 (não implementado nesta etapa)

A decisão D1 (`docs/DECISIONS.md`, seção 1.1) foi homologada pela Cristiane em 12/09/2026. Esta seção
documenta o modelo de dados **previsto** para o Sprint 2 — nenhum destes campos foi criado ou alterado
em código nesta etapa; permanece o esqueleto descrito acima até a implementação ser autorizada.

### Campos adicionais previstos para `legalDeadlines`

| Campo | Obrigatório (Sprint 2) | Descrição |
|---|---|---|
| `originType` | Sim | Enum fechado — `JUDICIAL_PROCESSUAL` (fato jurídico formal: intimação, publicação, despacho, decisão, audiência, mandado, ciência formal) ou `INTERNAL_CONTROL` (prazo gerencial interno do Jurídico). Impede que os dois tipos recebam a mesma semântica/criticidade visual; ambos devem ser filtráveis separadamente nas views |
| `evidenceReference` | Não (evolução futura, fora do Sprint 2) | Referência a Document/File Reference quando essa entidade existir (gap já registrado abaixo). Sem este campo, um Legal Deadline é considerado **"Confirmado pelo Jurídico"**, nunca "comprovado documentalmente" — distinção de linguagem obrigatória em toda tela/mensagem do produto |

`source` (campo já reservado pelo motor genérico) **não** foi adotado para Legal Deadline nesta
homologação — permanece exclusivo de registros sincronizados do Monday (`source:'monday'`); Legal
Deadline nunca tem esse campo preenchido, por nascer sempre de registro manual (D1.1).

### Proposta de `status` — a aprovar antes da implementação

Ver `docs/DECISIONS.md`, seção 1.1, e o plano do Sprint 2 para a recomendação técnica completa
(ativo/suspenso/cumprido/cancelado, e a recomendação de tratar reabertura como retorno a `ativo` com
evento preservado no histórico, em vez de um status próprio). **Não decidido silenciosamente** — segue
como proposta até aprovação explícita, antes de qualquer implementação.

### Regra de integridade obrigatória para o Sprint 2 (dashboard)

O levantamento técnico da D1 identificou que `dashboard-service.js` (widgets do dashboard `legal`
relacionados a prazo) usa hoje uma coluna bruta de data do Monday (`processDate()`, sobre o board
`processos`) em vez da coleção `legalDeadlines`. Isso contraria a D1 homologada e é registrado como
**tarefa obrigatória do Sprint 2** (não corrigida nesta etapa — é alteração de código, fora do escopo de
homologação documental): nenhuma view pode calcular ou apresentar "prazo jurídico" com lógica própria
paralela; `legalDeadlines` passa a ser a única fonte canônica para qualquer widget de prazo.

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
