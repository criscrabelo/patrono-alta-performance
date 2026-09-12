# DATA_MODEL.md — Modelo de Dados Conceitual

> Modelo conceitual oficial: `docs/MASTER_HANDOFF.md` §6–§9. Sem SQL definitivo (regra explícita da
> v1.3). Este documento mapeia as entidades canônicas do piloto contra a implementação atual do
> repositório e registra o esqueleto adicionado no Sprint 1.

## Entidades do piloto jurídico — situação atual

| Entidade (§6) | Implementação atual | Situação | Nota |
|---|---|---|---|
| Legal Process | Coleção `processos`, sincronizada do Monday (somente leitura), com `externalId`, `source`, `syncedAt`, `department:'Jurídico'` (atribuído explicitamente na rodada 2 — ver `docs/DECISIONS.md`, ADR-005). Mutação via motor genérico de entidades bloqueada (rodada 3, ADR-008) — só a sincronização Monday escreve nesta coleção | **Presente**, como registro operacional/transitório (Monday é System of Record transitório, §9) | Não é modelado com ID Patrono próprio ainda — usa o registro Monday normalizado diretamente |
| Legal Deadline | Coleção genérica `legalDeadlines`, adicionada no Sprint 1 via `/api/entities/legalDeadlines` | **Sprint 2, Fase 1 implementada** — `originType` obrigatório e enum fechado de `status` (com default server-side `ativo`) validados em `validateLegalDeadline()`; `isLegalDeadlineOverdue()` pronta e testada, ainda não consumida por nenhuma view (Fase 2) | Exige `processId`, `origin`, `date`, `originType` na criação; herda versionamento, exclusão lógica, restauração e auditoria do motor genérico |
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
| `originType` | Sim (Sprint 2, Fase 1) | Enum fechado `JUDICIAL_PROCESSUAL` \| `INTERNAL_CONTROL` (D1.3 homologada, `docs/DECISIONS.md` seção 1.1) — nunca ausente, vazio ou fora do enum, na criação e no PATCH (estado candidato) |
| `status` | Não na criação (default server-side `ativo`); enum fechado sempre validado | `ativo` \| `suspenso` \| `cumprido` \| `cancelado` (D1 homologada). `reaberto`/`vencido`/`atrasado`/`em_atraso` nunca são valores aceitos — reabertura é o retorno a `ativo` (mesmo `id`, histórico preservado); atraso é condição derivada, calculada por `isLegalDeadlineOverdue()`, nunca persistida |
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

## Sprint 2, Fase 1 — implementada (D1 homologada, `docs/DECISIONS.md` seção 1.1)

A D1 e a decisão de `status` complementar foram homologadas pela Cristiane em 12/09/2026. A Fase 1 do
Sprint 2 (`docs/SPRINT2-PLANO.md`) implementou a modelagem e as invariantes correspondentes — **Fases
2–4 continuam não iniciadas** (correção dos widgets do dashboard, listagem/filtros/tela de detalhe,
Agenda/Atenção, Google Calendar).

### `originType` — implementado

Enum fechado `JUDICIAL_PROCESSUAL` (fato jurídico formal: intimação, publicação, despacho, decisão,
audiência, mandado, ciência formal) \| `INTERNAL_CONTROL` (prazo gerencial interno do Jurídico), validado
por `validateLegalDeadline()` — obrigatório na criação; no PATCH, revalidado sobre o **estado candidato**
(mesmo padrão de `processId`/`origin`/`date`), rejeitando ausência, `null`, string vazia/só com espaços,
ou qualquer valor fora do enum, sem gravar nada. `evidenceReference` **não foi implementado** (evolução
futura, fora da Fase 1) — referência a Document/File Reference quando essa entidade existir (gap já
registrado abaixo). Sem esse campo, um Legal Deadline é considerado **"Confirmado pelo Jurídico"**, nunca
"comprovado documentalmente" — distinção de linguagem que passa a valer para qualquer tela/mensagem que
o Sprint 2 (Fase 2+) vier a construir sobre este modelo.

`source` (campo já reservado pelo motor genérico) **não** foi adotado para Legal Deadline — permanece
exclusivo de registros sincronizados do Monday (`source:'monday'`); Legal Deadline nunca tem esse campo
preenchido, por nascer sempre de registro manual (D1.1).

### `status` — implementado

Enum fechado `ativo`, `suspenso`, `cumprido`, `cancelado`, validado por `validateLegalDeadline()` em
toda criação e PATCH. Nenhum outro valor é aceito — incluindo, explicitamente, `reaberto`, `vencido`,
`atrasado` e `em_atraso`. **Default server-side:** quando o cliente não informa `status` na criação, o
servidor atribui `ativo` antes da validação (só o campo **ausente** recebe o default — um valor explícito,
mesmo inválido, segue para validação normal, nunca é silenciosamente substituído).

**Reabertura não é um quinto status.** Um Legal Deadline reaberto é um `PATCH` comum para
`status:'ativo'`: mantém o mesmo `id`, incrementa `version`, atualiza `updatedAt`/`updatedBy`. Para
`legalDeadlines` especificamente (e só para este tipo — nenhuma outra entidade genérica recebe este
tratamento), o `PATCH` de `/api/entities/:type` extrai `reason` do input antes de sanitizar, para
alimentar `audit()` com o motivo da alteração; o ciclo anterior (`before`/`after`, quem alterou, quando,
por quê) fica preservado no histórico de auditoria, nunca em um valor de status separado. **Reabertura
exige `reason` textual não vazio (após remover espaços):** quando o registro atual tem `status` diferente
de `ativo` e o `PATCH` está levando o estado candidato de volta a `ativo`, a ausência de `reason` (ou um
valor só com espaços) é rejeitada com `422`, sem alterar `status`, `version` ou qualquer campo do
registro, e sem criar evento de auditoria — a suspensão/cancelamento/cumprimento anterior permanece
intocado. `reason` nunca é persistido como campo do registro `legalDeadlines`; alimenta exclusivamente o
evento de auditoria.

**"Vencido"/"atrasado"/"em atraso" é condição derivada, não status.** Nova função pura e centralizada
`isLegalDeadlineOverdue(deadline, today)`: retorna `true` somente quando `status === 'ativo'` **e**
`date` é anterior a `today` (data civil `YYYY-MM-DD`, comparação lexicográfica determinística, sem
conversão para `Date`/UTC — `today` default usa o fuso `America/Sao_Paulo`, mesmo padrão já usado por
`scheduleDueNow()`). `suspenso`, `cumprido` e `cancelado` nunca são considerados atrasados,
independentemente de `date`; um prazo `ativo` com `date` igual a hoje também não é considerado atrasado
(só vence após o fim da data civil). Consumida na Fase 2 por `dashboard-service.js` e pela listagem/
detalhe de Legal Deadline (ver seção "Sprint 2, Fase 2" abaixo) — sempre a mesma função, nunca
recalculada em paralelo.

## Sprint 2, Fase 2 — implementada (views e consumo canônico de Legal Deadline)

Corrige o risco identificado na D1: nenhuma view/widget jurídico pode mais apresentar "prazo crítico"/
"próximo prazo"/"prazo vencido"/"prazo em atraso"/"prazo processual" com base em DATA/CITAÇÃO/PROTOCOLO
ou qualquer outra coluna bruta do Monday. A única fonte canônica de prazo jurídico é `legalDeadlines`.

**`dashboard-service.js` corrigido:** a função `processDate()` (que lia `CITAÇÃO/PROTOCOLO`/`DATA` do
board `processos` e tratava isso como prazo) foi **removida**. Os widgets `legal-risk` e `legal-deadlines`
do dashboard `legal` passam a consumir `store.records.legalDeadlines`, relacionado ao processo por
`processId` — nunca o campo de data bruto do processo. `isLegalDeadlineOverdue()` (já existente, Fase 1)
é reutilizada tal como está: não há uma segunda regra de atraso dentro do dashboard. `scoped()` também é
reaplicado, tanto sobre o próprio Legal Deadline quanto sobre o processo relacionado, como defesa em
profundidade — um prazo nunca é exibido se o processo ao qual está vinculado deixou de ser acessível ao
usuário, mesmo que o prazo já tenha herdado esse escopo na criação/PATCH (Fase 1). `dashboardPayload()`
passou a receber `user` e um objeto de dependências (`scoped`, `isLegalDeadlineOverdue`,
`civilDateAfterDays`) injetado por `server.js`, evitando duplicar essas funções em `dashboard-service.js`.

`JUDICIAL_PROCESSUAL` × `INTERNAL_CONTROL`: os indicadores rotulados como "prazo processual"/"risco
jurídico" (`legal-risk`, `legal-deadlines`) só consideram Legal Deadlines com `originType:
'JUDICIAL_PROCESSUAL'`. `INTERNAL_CONTROL` nunca é somado a essas métricas nem aparece rotulado como
prazo processual — permanece disponível apenas via listagem/filtro dedicada (abaixo).

**Listagem/filtro:** `GET /api/entities/legalDeadlines?paginated=1` (mesma rota genérica, sem
arquitetura paralela) aceita `processId`, `originType`, `status`, `overdue` (`true`/`false`),
`dateFrom`/`dateTo`, com paginação no mesmo padrão de `filterProcesses()`/`filterHonorariums()`
(`pageSize` em `[25,50,100]`, `page`/`totalPages`). Sem `?paginated=1`, a rota mantém o array simples já
existente desde a Fase 1 (nenhum chamador existente quebra). Cada registro retornado inclui `overdue`
(via `isLegalDeadlineOverdue()`) e `dataIntegrity` (ver "Registros legados", abaixo).

**Detalhe/histórico:** `GET /api/entities/legalDeadlines/:id/detail` retorna o registro completo, o
processo relacionado (`{id, title}`), `overdue`, `dataIntegrity` e o histórico de auditoria (`store.audit`
filtrado por `entity:'legalDeadlines'`/`entityId`, em ordem cronológica). Mesmo gate de autorização da
listagem (`allowedInDepartment` + `scoped()` sobre o prazo **e** sobre o processo relacionado — defesa em
profundidade). O histórico reaproveita `sanitizeAuditEventForUser()` sem modificação: só quem tem alçada
de negócio global (hoje, diretoria) recebe `before`/`after` completo; os demais (incluindo líder/
colaborador Jurídico) veem apenas os metadados técnicos (ação, responsável, data, `reason`,
`correlationId`) — nenhuma entidade nova de histórico foi criada.

Nenhuma tela nova de UI foi construída nesta Fase 2 — listagem/filtro/detalhe existem como capacidade de
API; a semântica de copy "Confirmado pelo Jurídico" (D1.4) permanece pendente para quando houver uma tela
dedicada. Agenda/Atenção e Google Calendar não foram tocados (Fase 3, não iniciada).

### Registros legados anteriores à D1 — sem backfill automático

`originType` é uma decisão jurídica sobre a natureza do prazo (fato jurídico-processual vs. controle
interno) — **não pode ser inferida automaticamente** a partir de dados existentes. Esta rodada
**não criou nenhuma migration nem backfill** para Legal Deadlines eventualmente persistidos antes da
homologação da D1 (12/09/2026). Caso existam registros assim em dados persistidos, eles precisam ser
**revisados e classificados manualmente pelo Jurídico** (atribuindo `originType`/`status` corretos via
`PATCH` comum, um a um) antes de qualquer edição ou homologação formal do piloto — nenhuma tela ou rotina
deve assumir que um Legal Deadline pré-D1 já tem `originType` válido sem essa revisão.

**Sinalização na Fase 2 (`legalDeadlineIntegrityFlag()`):** a listagem (`?paginated=1`) e o detalhe
(`.../detail`) calculam, de forma puramente apresentacional (nunca persistida), um campo `dataIntegrity`
— `'requires_review'` quando `originType` e/ou `status` estiverem ausentes no registro, `'ok'` caso
contrário. Nenhum valor é inferido ou corrigido silenciosamente; a view apenas sinaliza a inconsistência
para revisão manual, sem inventar um status novo persistido.

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
