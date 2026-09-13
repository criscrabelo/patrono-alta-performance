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
dedicada.

## Sprint 2, Fase 3 — implementada (Agenda/Atenção mínima)

Slice mínimo de Agenda/Atenção, consumindo **somente** entidades canônicas já existentes. `Legal
Deadline` continua sendo a única fonte de verdade de prazo jurídico — Agenda/Atenção nunca se tornam
source of truth, apenas camada de visualização/orquestração (princípio canônico da Fase 3).

**`GET /api/agenda-items`** — combina, sem persistir nada novo:
- Itens de `legalDeadlines`, montados por `legalDeadlineAgendaItems()` sobre `scopedLegalDeadlineRows()`
  (mesmo helper de defesa em profundidade da Fase 2 — escopo checado sobre o prazo **e** sobre o
  Legal Process relacionado, nunca só sobre o campo gravado no prazo). Cada item traz `entityType:
  'legalDeadline'`, `entityId`, `processId`, `process:{id,title}`, `date`, `origin`, `originType`,
  `status`, `overdue` (via `isLegalDeadlineOverdue()`), `dataIntegrity` (via `legalDeadlineIntegrityFlag()`)
  e `target` (a mesma URL de detalhe da Fase 2 — `/api/entities/legalDeadlines/:id/detail`).
- Itens de `store.agenda`, a entidade de compromissos manuais **pré-existente** (título, prioridade,
  responsável, classificação — já com seu próprio `GET`/`POST /api/agenda`, module `'agenda'`). A Fase 3
  não a substitui nem a redefine: `agendaEventItems()` apenas a inclui como mais uma fonte na mesma view
  combinada, com `entityType: 'agendaEvent'`.
- Cada fonte só entra na resposta se o usuário tiver o módulo correspondente
  (`allowedInDepartment(user,'juridico','read')` para Legal Deadline, `allowed(user,'agenda','read')`
  para os eventos manuais) — um usuário de TI, por exemplo, nunca recebe itens `legalDeadline`.
- Ordenação determinística (`sortAgendaItems()`): `date` → `entityType` → `entityId`, comparação
  lexicográfica de string `YYYY-MM-DD` (mesmo padrão civil já usado em todo o Sprint 2, sem conversão
  para `Date`/UTC).

**`GET /api/attention`** — só Legal Deadline (`legalDeadlineAttentionItems()`), com três categorias de
**apresentação** (nunca persistidas, nunca um quinto valor de `status` — o enum `ativo`/`suspenso`/
`cumprido`/`cancelado` da Fase 1 não muda):
- `OVERDUE` — via `isLegalDeadlineOverdue()`, reutilizada tal como está (nenhuma segunda regra de
  atraso).
- `UPCOMING` — `status === 'ativo'` e `date` dentro da janela de `civilDateAfterDays(30)` (a mesma
  janela de 30 dias já usada no dashboard `legal` da Fase 2 — nenhum segundo conceito de "próximo").
- `REQUIRES_REVIEW` — via `legalDeadlineIntegrityFlag()` (Fase 2), para registros legados sem
  `originType`/`status`. Um registro assim nunca também aparece como `OVERDUE`/`UPCOMING` (sem
  `status==='ativo'` confiável, `isLegalDeadlineOverdue()` já retorna `false`).

**Sem duplicação:** nenhuma coleção nova foi criada (`agendaDeadline`, `agendaLegalDeadline`,
`copiedDeadline`, `deadlineSnapshot` ou equivalente). As duas rotas são `GET` puros — nada é criado,
alterado ou migrado por elas; se o `date`/`status` do Legal Deadline mudar via `PATCH` (Fase 1), a
próxima chamada às views já reflete o novo estado, sem nenhum segundo registro persistido.

**JUDICIAL_PROCESSUAL × INTERNAL_CONTROL:** ambos aparecem na Agenda/Atenção com `originType` preservado
tal como está no registro — a API nunca converte um no outro nem infere um rótulo de "prazo processual"
para `INTERNAL_CONTROL`; essa distinção de apresentação fica a cargo de quem consome a resposta.

**Não implementado nesta Fase 3** (fora do escopo autorizado): Google Calendar, automações/reminders/
notificações, cálculo automático de prazo, criação automática de Task a partir de Legal Deadline, e
"Minha Semana" (sem um campo confiável de responsável/atribuição por usuário em Legal Deadline hoje,
essa visão exigiria inventar esse campo — fica documentada como pendente, não forçada nesta rodada).

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
- `legalDeadlines` ainda não tem um campo de responsável — o modelo (`responsibleUserId`, opcional,
  referenciando um `user.id` ativo) já foi **homologado** (ver `docs/DECISIONS.md`, seção 1.2, D4.2/D4.3),
  mas **nenhum campo foi adicionado nesta rodada** (Fase 4A é estritamente documental; a implementação
  do campo fica para a Fase 4B, em PR separado).

## Sprint 2, Fase 4A — rodada documental (decisões HOMOLOGADAS, sem alteração de modelo)

Esta rodada **não altera o modelo de dados**. Fecha, em `docs/DECISIONS.md` (seção 1.2, D4.1–D4.15), as
decisões de negócio/UX necessárias antes de qualquer alteração futura de modelo relacionada à Fase 4:
campo de responsável em `legalDeadlines` (D4.2/D4.3 — **homologado**: `responsibleUserId` opcional,
referência a usuário ativo, sem múltiplos responsáveis), integração de leitura com Google Calendar (D4.1
— **homologado: Opção B, leitura apenas**, sem nova entidade e sem escrita externa; nenhum espelhamento
de Legal Deadline no Calendar), e a visão "Minha Semana" (D4.10 — **homologado**: semana civil
`America/Sao_Paulo`, também sem nova entidade — view sobre `legalDeadlines` + `store.agenda`). Todos os
pontos relevantes de modelo já estão homologados (ver D4.14); a implementação do modelo (adicionar o
campo, construir as views) fica para a Fase 4B, em PR(s) separado(s) — nada foi implementado aqui.

## Sprint 2, Fase 4B — implementação funcional (responsável, Minha Semana, Calendar read-only)

Esta rodada implementa exatamente o que foi homologado documentalmente na Fase 4A, sem criar nenhuma
entidade nova nem tabela/coleção paralela:

- **`legalDeadlines.responsibleUserId`** (opcional): campo simples adicionado ao registro já existente,
  não uma entidade nova. Validado em `validateLegalDeadline()` (mesma função central já usada por
  POST/PATCH): quando informado, deve referenciar um `user.id` existente; uma **nova** atribuição
  (diferente da atribuição anterior a este PATCH/POST) exige que o usuário não esteja com `deletedAt`
  preenchido. **Não existia nenhum campo `active`/`isActive`/`status` de usuário no modelo antes desta
  rodada** — a auditoria confirmou que a única convenção de "registro não mais válido" já usada em toda a
  plataforma é o soft-delete (`deletedAt`/`deletedBy`), hoje aplicado a `processos`/`agenda`/entidades
  genéricas; esta rodada estende a MESMA convenção para `users`, em vez de inventar um segundo campo
  paralelo. Não existe rota para inativar um usuário nesta fase (fora de escopo) — os testes atribuem
  `deletedAt` diretamente, como já era feito para processos.
- **"Desatribuir" responsável (`responsibleUserId: null`)** não foi homologado — o PATCH rejeita
  explicitamente (422) essa tentativa quando já existe um responsável, em vez de inventar o
  comportamento. Reatribuição para outro usuário válido/ativo continua permitida normalmente.
- **D4.11 (responsável que se torna inativo depois):** `responsibleUserId` nunca é apagado/alterado
  automaticamente; a view (`responsibleInfo()`, reutilizada em Agenda/Atenção/detalhe/Minha Semana)
  apenas adiciona um campo derivado `responsibleInactive: true`, sem tocar no registro.
- **"Minha Semana" (`GET /api/my-week`)**: view pura, nenhuma coleção `myWeek`/`weeklyItems`/
  `weekSnapshot` é criada. Janela = semana civil corrente (segunda a domingo, `America/Sao_Paulo`),
  calculada por `civilWeekWindow()` a partir de `todayCivilDate()` — nunca "próximos 7 dias corridos".
  Contém: (a) Legal Deadlines cujo `responsibleUserId` é o usuário logado, reaproveitando
  `scopedLegalDeadlineRows()` (mesma defesa em profundidade — `responsibleUserId` nunca amplia
  autorização); (b) a leitura (vazia, adapter) do Google Calendar. **Gap conhecido e não resolvido nesta
  rodada:** eventos manuais de `store.agenda` não entram em Minha Semana — o campo `owner` desse
  registro é texto livre, não um `user.id` canônico, e inferir a atribuição por nome seria a mesma
  "substituição textual" que a Fase 4B proíbe explicitamente para `responsibleUserId`. Corrigir isso
  exigiria uma decisão de modelo própria (um campo canônico de atribuição em `store.agenda`), fora do
  escopo desta rodada.
- **D4.15 (Agenda operacional):** `legalDeadlineAgendaItems(store, user, { includeInactive })` passa a
  filtrar `cumprido`/`cancelado`/`suspenso` por padrão (`isOperationallyVisible()`); nenhum registro é
  apagado ou tem o status alterado — os mesmos itens continuam acessíveis via detalhe, via listagem
  paginada (`?paginated=1&status=...`, já existente) e via o novo parâmetro explícito
  `?includeInactive=1` na própria rota de Agenda (reaproveitando o padrão de parâmetro explícito já usado
  no Sprint 2, sem criar uma API paralela).
- **Google Calendar (Opção B homologada, D4.1):** implementado apenas como *adapter* somente leitura
  (`googleCalendarStatus()`/`googleCalendarEvents()`, rotas `GET /api/calendar/status` e
  `GET /api/calendar/events`). **Blocker técnico, não uma decisão de produto:** este ambiente não tem
  credenciais reais de OAuth do Google (`GOOGLE_CALENDAR_CLIENT_ID`/`GOOGLE_CALENDAR_CLIENT_SECRET`), então
  a ativação real (login OAuth, leitura de compromissos de verdade) permanece bloqueada por design —
  `status: 'not_configured'` e `events: []` sempre, nunca uma simulação. Nenhum método de escrita da API
  do Calendar existe no código (verificado por teste de código-fonte). Quando credenciais reais existirem,
  a interface já definida (`configured`/`connected`/`status`/`events`) é o ponto de extensão.
