# PERMISSIONS.md — Autorização e Escopo

> Regras oficiais: `docs/MASTER_HANDOFF.md` §11 (Permissões e Segurança), §26 (P0), Anexo A (regra 13).
> **Revisão da rodada 2 e 3** (correções de segurança pós-review): este documento é mantido para
> refletir exatamente o que está implementado hoje — nada aqui é declarado "protegido" sem verificação
> funcional correspondente em `tests/security-integration.test.js` (HTTP real) ou `tests/core.test.js`
> (unitário). Ver `docs/SECURITY.md`, "Auditoria completa de rotas", para a tabela rota-a-rota exigida
> pela rodada 3.

## Princípio inegociável

**Autorização é obrigatoriamente server-side.** Ocultar menu, botão ou rota no frontend é apenas UX e
nunca substitui autorização. Todo o RBAC deste sistema é decidido e aplicado em `server.js`, nunca em
`public/app.js`.

## Modelo de papéis (`ROLES`, `server.js`)

| Papel | Módulos | Escopos (`scopes`) | Ações |
|---|---|---|---|
| `diretoria` | `*` | `*` (única alçada de negócio verdadeiramente global) | read, create, update, archive, restore, approve, export |
| `administrador` | `*` (gestão técnica: sistema, usuários, integrações, segurança, configuração) | **`[]`** (rodada 5 — ver abaixo) | `*` |
| `lider` | central, estratégia, projetos, agenda, comitês, orçamento, jurídico, TI | department | read, create, update, archive, export |
| `colaborador` | central, projetos, agenda, jurídico, TI | department | read, create, update |

**Nota sobre o desenho atual:** `lider` e `colaborador` incluem os módulos `juridico` e `ti`
**independentemente do próprio departamento** — ou seja, o gate de módulo (`allowed()`) por si só não
impede um líder de TI de *tentar* uma rota jurídica. A rodada 5 (item 1) introduziu
`allowedInDepartment()` para as rotas de Monday, que não têm registro individual para `scoped()` filtrar;
a **rodada 6 (item 1) generalizou essa proteção de forma transversal**: `allowedInDepartment()` (leitura)
e `allowedContent()` (mutação — ver abaixo) são hoje o gate usado em **todo** o CRUD genérico de
entidades (`/api/entities/:type`, todos os verbos) e em `GET /api/legal/:module`, não apenas nas rotas
de Monday. Não existe mais nenhuma rota departamental (`juridico`/`ti`) que dependa apenas de `allowed()`
+ `scoped()` — a negação por departamento acontece no próprio gate de módulo, retornando `403` (não mais
uma listagem vazia por filtragem de `scoped()`) para quem não é do departamento certo nem tem alçada
global.

## Autorização em camadas (o que existe hoje, nesta ordem, por rota)

1. **Sessão/identidade** — `getUser(req)` só aceita token de sessão válido, não expirado e sem
   `challenge` pendente. Não existe bypass de bearer por prefixo (`usr-*`).
2. **Módulo/ação** — `allowed(user, module, action)`, por papel (ver nota acima sobre `lider`/`ti`).
3. **Allowlist de rota** (`/api/legal/:module` apenas) — `LEGAL_MODULES`, um `Set` fechado dos nomes de
   módulo aceitos nessa rota específica. Corrigido na rodada 2 (ver abaixo).
4. **Tipo de entidade genérica** (`/api/entities/:type` apenas) — `entityModule(type)`, com
   **deny-by-default**: qualquer `type` fora de `ENTITY_MODULE_MAP` é negado.
5. **Fonte Monday-sourced** (`/api/entities/:type` em POST/PATCH/DELETE/restore) — `rejectIfMondaySourced(type)`,
   adicionado na rodada 3: bloqueia qualquer mutação genérica sobre tipos cuja fonte oficial é o Monday
   (mesmo conjunto de `LEGAL_MODULES`). Só GET permanece liberado para esses tipos.
6. **Escopo do registro** — `scoped(user, item)`, reescrito na rodada 2 (deny-by-default por
   department) e novamente na rodada 3 (deny-by-default por companyId/speId) — ver abaixo.
7. **Campos do corpo da requisição** — `sanitizeEntityInput(input, user)`, adicionado na rodada 2 e
   estendido na rodada 3, para que o cliente não possa controlar campos estruturais, de auditoria ou de
   **escopo** (`department`, `scopeType`, `companyId`, `speId`) do próprio registro.
8. **Revalidação de invariantes de domínio no PATCH** (Legal Deadline) — adicionado na rodada 3:
   `validateLegalDeadline()` roda também no PATCH, sobre o estado candidato (registro atual + input),
   não apenas na criação.

## P0 corrigidos — rodada 1 (auditoria inicial)

| Rota | Problema | Correção |
|---|---|---|
| `GET /api/entities/:type` | Não verificava permissão de módulo | `entityModule(type)` + `allowed(user, module, 'read')` |
| `GET /api/legal/:module` | Não verificava permissão de módulo | `allowed(user, 'juridico', 'read')` |
| `requireMfa()` | Dependia da flag `mfa` do cadastro, não do papel | MFA exigido pelo papel, sempre |

## P0 corrigidos — rodada 2 (revisão de segurança e integridade)

A rodada 1 corrigiu a **ausência** de checagem de módulo, mas deixou duas lacunas que esta rodada fecha:

### 1. `GET /api/legal/:module` ainda usava `:module` para indexar a coleção diretamente

A correção da rodada 1 verificava `allowed(user, 'juridico', 'read')` — permissão de **módulo** — mas
`moduleName` continuava vindo cru da URL e sendo usado como chave em `collection(store, moduleName)`,
que **cria a coleção se ela não existir**. Um usuário com acesso a `juridico` podia trocar `:module`
para qualquer string (`legalDeadlines`, `users`, qualquer nome arbitrário) e ler — ou fazer o servidor
criar incidentalmente — uma coleção fora do conjunto de boards jurídicos reais.

**Correção:** `LEGAL_MODULES` é um `Set` fechado com exatamente os nomes de módulo válidos para essa
rota (as chaves de `MONDAY_BOARDS` + `honorariosJudiciais`, que é um payload derivado, não uma coleção
própria). Qualquer `moduleName` fora desse conjunto retorna `404` **antes** de qualquer chamada a
`collection()` — a coleção nunca é tocada, lida ou criada.

Testado em runtime: `tests/security-integration.test.js` → `GET /api/legal/legalDeadlines` e
`GET /api/legal/users` retornam 404, e uma chamada subsequente a `GET /api/entities/legalDeadlines`
confirma que nada foi criado incidentalmente.

### 2. Campos controlados pelo servidor podiam ser sobrescritos pelo cliente

`POST`/`PATCH` em `/api/entities/:type` faziam `{...input}` (ou `Object.assign(item, input, ...)`) sem
nenhuma sanitização — o cliente podia enviar `id`, `version`, `createdAt`, `createdBy`, `updatedAt`,
`updatedBy`, `deletedAt`, `deletedBy`, metadados de origem (`source`, `externalId`, `boardId`,
`boardName`, `syncedAt`) ou um `department` diferente do seu próprio, na tentativa de forjar identidade,
histórico ou escopo do registro.

**Correção:** `sanitizeEntityInput(input, user)` remove a lista fixa `PROTECTED_ENTITY_FIELDS` do input
antes de qualquer atribuição, e também remove `department` do input a menos que o papel do usuário tenha
escopo global (`ROLES[user.role].scopes.includes('*')` — hoje, apenas `diretoria`/`administrador`). Os
campos controlados pelo servidor são então atribuídos **depois** do input sanitizado no objeto final
(`{...sanitized, id: ..., version: ..., ...}`), garantindo que nenhuma chave sobrevivente do input possa
vencer por ordem de propriedades.

Testado em runtime: `tests/security-integration.test.js` envia um corpo malicioso completo (todos os
campos protegidos + `department` de outro departamento) em `POST` e `PATCH`, e verifica que o registro
resultante não adota nenhum desses valores.

### 3. `scoped()` tratava ausência de `department` como acesso liberado

Antes: `!item.department` retornava `true` — um registro sem classificação de departamento era, na
prática, global por omissão. Isso escondia dois problemas: (a) qualquer entidade nova criada sem pensar
em `department` nasceria acessível a todo mundo; (b) registros sincronizados do Monday (que não
carregavam `department` algum) eram visíveis a **qualquer** usuário com acesso ao módulo `juridico` —
inclusive um líder de TI, já que `lider` inclui `juridico` em seus módulos (ver nota acima).

**Correção — duas partes:**

1. `scoped()` reescrita para **deny-by-default**: um registro sem `department` **e** sem
   `scopeType: 'global'` explícito é **negado** para papéis não privilegiados, não liberado.
2. `normalizeMondayItem()` passou a atribuir `department: 'Jurídico'` explicitamente a todo registro
   sincronizado do Monday — correto, porque todos os boards em `MONDAY_BOARDS` pertencem ao Jurídico.
   Sem isso, o efeito colateral da correção de `scoped()` seria bloquear também o Jurídico de ver seus
   próprios registros (já que eles não carregavam `department` nenhum).

```js
// Versão atual (rodada 5) — ver seção "P0 corrigidos — rodada 5", item 3, para o que mudou desde a
// rodada 3 (a versão mostrada aqui então bypassava incondicionalmente para user.role === 'administrador';
// a rodada 5 substituiu isso por hasGlobalScope(user), e ROLES.administrador.scopes passou a ser [],
// não mais ['*'] — administrador deixou de ser superusuário de conteúdo).
function scoped(user, item) {
  if (hasGlobalScope(user)) return true;
  if (item.scopeType === 'global') return true;
  if (item.companyId && (!user.companyId || user.companyId !== item.companyId)) return false;
  if (item.speId && (!user.speId || user.speId !== item.speId)) return false;
  if (!item.department) return false;
  return item.department === user.department;
}
```

**Efeito colateral desejado e verificado:** um líder de TI agora recebe uma listagem de
`/api/entities/legalDeadlines` que **não inclui** registros do Jurídico, e um `PATCH`/`restore` por ID
direto contra um registro do Jurídico retorna `404` para um usuário de TI — cobrindo o cenário do
Catálogo Global de Regressão (§30): "TI tenta acessar Jurídico → bloqueado no backend". Testado em
`tests/security-integration.test.js`.

### 4. Empresa/SPE — fundação preparada, **não implementada** (lógica corrigida na rodada 3)

A v1.3 exige autorização por ambiente/empresa/SPE/módulo/registro. **Nenhum cadastro de empresa ou SPE
existe neste repositório** — não foram inventados IDs. O que existe, e é **inerte em produção** até que
esse cadastro seja criado (nenhum registro real ou usuário carrega `companyId`/`speId` hoje):

- `scoped()` verifica `item.companyId` contra `user.companyId`, e `item.speId` contra `user.speId`, com
  **deny-by-default**: se o registro tem `companyId`, o usuário PRECISA ter o mesmo valor — ausência do
  campo no usuário ou valor diferente nega o acesso. Mesma regra para `speId`. (**Corrigido na rodada
  3** — a versão da rodada 2 só negava quando AMBOS os lados carregavam o campo, o que não é
  deny-by-default: um usuário sem `companyId` conseguia acessar um registro COM `companyId`, porque a
  condição de negação nunca chegava a ser avaliada. Ver `docs/DECISIONS.md`, seção de conflitos, e
  `docs/SECURITY.md`, item 10 da rodada 3.)
- Apenas papel com escopo global (`diretoria`/`administrador`) pode **definir** `companyId`/`speId`/
  `scopeType` em um registro — `sanitizeEntityInput()` remove esses três campos do input de qualquer
  outro papel (rodada 3, item 1 — ver abaixo).
- Não existe endpoint, tela ou cadastro para criar/gerenciar empresas ou SPEs.
- Não existe conceito de "Ambiente" (Visão Executiva / Jurídico / TI / VELKOR) como filtro de
  autorização de primeira classe — hoje a segregação real em produção é por `department` (Jurídico, TI).

**Isto NÃO deve ser lido como "empresa/SPE já está protegido"** — está preparado para não exigir nova
revisão de `scoped()` quando o cadastro existir, e nada além disso. Testado com dados sintéticos em
`tests/core.test.js` e `tests/security-integration.test.js` (nenhuma empresa/SPE real foi inventada).

## P0 corrigidos — rodada 3 (segunda revisão de segurança pós-review)

### 1. `scopeType`/`companyId`/`speId` podiam ser forjados por papel departamental

`sanitizeEntityInput()` já protegia `department`, mas não os outros três campos de escopo. Como
`scoped()` libera incondicionalmente qualquer registro com `scopeType:'global'`, um papel departamental
podia se autodeclarar globalmente visível apenas enviando esse campo no `POST`/`PATCH`. Corrigido:
`sanitizeEntityInput()` remove `department`, `scopeType`, `companyId` e `speId` do input de qualquer
papel sem escopo global (`scopes:['*']`). Testado em runtime (`tests/security-integration.test.js`):
um colaborador tenta `scopeType:'global'` na criação e no PATCH; nenhuma das duas tentativas altera o
registro, confirmado consultando-o com um token de outro departamento.

### 2. `scoped()` não era deny-by-default para `companyId`/`speId`

Ver código corrigido na seção "4. Empresa/SPE" acima e item 10 de `docs/SECURITY.md`.

### 3. Legal Deadline não era revalidado no PATCH

A criação já exigia `processId`/`origin`/`date` e validava o processo relacionado; o PATCH não repetia
nenhuma dessas checagens — um `PATCH` podia esvaziar `origin`, esvaziar `date`, ou trocar `processId`
para um processo inexistente ou fora de escopo, sem ser barrado. Corrigido: `validateLegalDeadline()`
roda também no PATCH, sobre o **estado candidato** (`{...item, ...sanitized}`), garantindo que a
invariante vale para o registro como ficaria após a atualização, não apenas para os campos enviados
nesta requisição específica. Testado em runtime: 4 tentativas inválidas (processo inexistente, processo
fora de escopo, `origin` vazio, `date` vazio) são rejeitadas sem alterar o registro nem incrementar sua
versão; um PATCH válido continua funcionando normalmente.

### 4. Motor genérico de entidades permitia mutação de tipos Monday-sourced

Ver ADR-008 em `docs/DECISIONS.md`. `rejectIfMondaySourced(type)` bloqueia POST/PATCH/DELETE/restore
para qualquer tipo em `LEGAL_MODULES`; Legal Deadline passou também a exigir
`relatedProcess.source === 'monday'` como defesa em profundidade. Testado em runtime: as quatro
mutações retornam 403 contra `processos`; GET continua funcionando; um "processo" sintético sem
`source:'monday'` (inserido diretamente na store de teste, simulando um caminho fora da API) é
corretamente rejeitado por Legal Deadline.

### 5–7. Rotas sem gate de módulo/escopo: `/api/monday/status`, `/api/monday/schedule`, `/api/dashboard`, `/api/departments`, `/api/agenda`, `/api/committees`, `/api/compliance`

Ver a tabela completa "Auditoria completa de rotas" em `docs/SECURITY.md` — cobre todas as rotas
revisadas nesta rodada, incluindo as sete acima (que passaram por gate de sessão/módulo/escopo
adicionado ou corrigido) e confirma quais rotas já estavam corretas.

### 8. Rotas críticas de projeto sem `scoped(user,project)`

`projectPermissions(user)` concede `edit`/`changeTarget`/`changeApprovalRule`/`archive`/`restore`/
`approveAgreement` por **usuário**, não por projeto — com mais de um projeto no sistema, um papel
departamental de um projeto podia, em tese, alterar/arquivar sub-recursos de um projeto de **outro**
departamento, pois seis rotas não verificavam `scoped(user,project)`: `PUT .../target`,
`PUT .../approval-rules`, `PUT .../recovery-settings`, `DELETE .../:itemId`,
`POST .../:itemId/restore` e `POST management-items/:itemId/(approve|reject|escalate)`. Todas as seis
passaram a buscar o projeto pai e checar `scoped(user,project)` antes de qualquer leitura/gravação
adicional. Testado em runtime com um segundo projeto sintético (departamento diferente do único projeto
real do seed): as seis rotas negam contra o projeto de outro departamento (com 404, já que o gate de
escopo vem antes do gate de ação — nunca revela se a ação seria permitida); o ciclo legítimo no projeto
real do piloto continua funcionando.

## P0 corrigidos — rodada 4 (rodada de fechamento)

### 1. Visão Executiva acessível a papéis não executivos

`executive` usava `module:'central'`, que é módulo comum a `lider`/`colaborador` — qualquer papel
departamental abria o Centro de Comando e via `financeRows`/`agenda`/`committees` de **todos** os
departamentos consolidados (mesma classe de vazamento do item 14/rodada 3, mas pelo dashboard, não pela
rota `/api/dashboard`). Corrigido com um campo de declaração explícita: `requiresGlobalScope:true` em
`dashboard-model.js`, verificado em `server.js` (`GET /api/dashboards` e `GET /api/dashboards/:id`) além
do gate de módulo. Dashboards futuros com `scope:'corporate'` devem declarar essa flag quando a
consolidação exigir alçada global — não é automático por `scope:'corporate'` sozinho (orçamento
corporativo, por exemplo, já é adequadamente restrito pelo módulo `orcamento`, que colaborador não tem).

### 2. Mass assignment em sub-recursos de projeto

`{id:newId(prefix), ..., ...input}` no POST (e uma sanitização incompleta no PATCH, que já protegia
`id`/`projectId`/`createdAt`/`createdBy`/`deletedAt`/`deletedBy` mas não os campos de escopo) permitiam
ao cliente forjar identidade e vínculo com outro projeto. `sanitizeProjectItemInput()` (mesmo padrão de
`sanitizeEntityInput`) resolve os dois verbos.

### 3. Comitês sem escopo de registro

O gate de módulo (rodada 3) não bastava — `GET /api/committees` devolvia a coleção inteira, e o POST não
usava `sanitizeEntityInput()`, deixando `scopeType`/`companyId`/`speId` forjáveis. Corrigido reaproveitando
`scoped()` e `sanitizeEntityInput()` já usados no resto da plataforma — nenhum mecanismo de escopo novo.

### 4. Agenda com escopo global forjável

A sanitização própria do POST de agenda (rodada 3) só cobria `department`. Substituída por
`sanitizeEntityInput()`, que cobre os quatro campos de escopo de forma uniforme com todo o resto do
sistema.

### 5. Importação de orçamento sem escopo por linha

`POST /api/budgets/import/commit` não validava o `department` de cada linha do CSV contra o escopo do
usuário. Papel não-global agora precisa ter **todas** as linhas do próprio departamento — qualquer linha
de outro departamento bloqueia a importação inteira (nunca parcial). Papel global segue sem restrição.

### 6. Legal Deadline — validação apenas de truthiness

`origin`/`date` só eram testados como truthy. `origin:'   '` e `date:'banana'`/`'2026-99-99'`/vazio
passavam. Corrigido: `origin` exige `trim()` não vazio; `date` validado por `isValidCivilDate()`
(regex `YYYY-MM-DD` + reconstrução via `Date.UTC`, rejeitando datas inexistentes no calendário).
Nenhum cálculo de prazo foi implementado — apenas validação do valor informado, como pedido.

### 7. Legal Deadline sem herança de escopo do processo

Um prazo podia ter `department`/`companyId`/`speId`/`scopeType` inconsistentes com o Legal Process ao
qual está subordinado — inclusive quando criado por diretoria/administrador, que têm alçada para operar
em qualquer escopo, mas não para criar uma relação estruturalmente inconsistente. `validateLegalDeadline()`
agora herda os quatro campos do processo relacionado, sobrescrevendo qualquer valor enviado pelo
cliente — em POST e em PATCH (inclusive ao trocar `processId` para um processo de outro escopo).

### 8. `projectPermissions()` não é deny-by-default para papel desconhecido

Rotas de sub-recurso de projeto dependiam só de `projectPermissions(user)`, cujas regras (`create:
user.role !== 'colaborador' || ...`, `edit: elevated || user.department === 'Jurídico'`) concedem
capacidade por **exclusão** — um `role` que não seja `'colaborador'` e não seja reconhecido em `ROLES`
ainda assim recebe `create:true`; um `department === 'Jurídico'` sem nenhum papel reconhecido ainda
recebe `edit:true`. Corrigido adicionando `allowed(user,'projetos',ação)` — que usa `ROLES` e nega por
padrão para papel desconhecido — em todas as 8 rotas de sub-recurso que só usavam `projectPermissions()`
(as 3 rotas de topo, `GET /api/projects` e `GET /api/projects/:id`, já tinham esse gate desde a rodada 1).

### 9. `/api/agenda` e `/api/departments` protegidos só por autenticação

Nenhuma das duas tinha gate de módulo — apenas sessão válida (+ escopo do registro, no caso da agenda).
`/api/departments` carrega o objeto `budget` completo por departamento. Corrigido reaproveitando módulos
já existentes: `agenda` (mesmo módulo já usado no POST) e `orcamento` (mesmo módulo do dashboard e da
importação de orçamento) — nenhum módulo novo foi criado em `ROLES`.

## P0 corrigidos — rodada 5 (fechamento de autorização/segregação)

### 1. Isolamento de módulo Jurídico x TI em rotas sem registro individual

`lider`/`colaborador` têm simultaneamente os módulos `juridico` e `ti` em `ROLES` (ver nota acima).
Rotas com `scoped(user, item)` por registro já negavam corretamente entre departamentos, mas as rotas
de Monday (`GET /api/monday/status`, `GET /api/monday/schedule`, `POST /api/monday/test`,
`POST /api/monday/sync`) não têm registro individual para aplicar `scoped()` — um líder de TI passava
livremente no gate de módulo (`allowed(user,'juridico','read')`) e operava uma função exclusivamente
jurídica, e vice-versa.

**Correção:** nova função `allowedInDepartment(user, module, action)`, que aplica `allowed()` e, para
módulos departamentais (`MODULE_DEPARTMENT = { juridico: 'Jurídico', ti: 'TI' }`), exige adicionalmente
`user.department === MODULE_DEPARTMENT[module]` — com bypass apenas para alçada global
(`hasGlobalScope(user)`) ou para o papel técnico `administrador` (que precisa operar integrações de
qualquer departamento, mas não ganha acesso a **conteúdo** por isso — ver item 3). Deny-by-default:
qualquer papel departamental do departamento errado é negado. As quatro rotas de Monday passaram a usar
`allowedInDepartment()` em vez de `allowed()`.

Testado em runtime (`tests/security-integration.test.js`): líder de TI recebe `403` nas quatro rotas de
Monday; líder Jurídico continua acessando-as normalmente; líder Jurídico recebe `403` no dashboard
departamental de TI (rota TI equivalente, protegida por `dashboardAuthorized()` — item 5); diretoria
(alçada global) continua acessando ambos.

### 2. Dashboards corporativos (`scope:'corporate'`) devem exigir alçada global por padrão

Na rodada 4, apenas `executive` declarava `requiresGlobalScope:true` manualmente. Outros dashboards com
`scope:'corporate'` (`budget`, `strategy`, `projects`, `risks`) não tinham a flag e ficavam acessíveis a
qualquer papel com o módulo correspondente, mesmo sem alçada global.

**Correção:** `dashboardRequiresGlobalScope(definition)` (`dashboard-model.js`) torna a regra automática:
`definition.scope === 'corporate' && definition.allowDepartmentScope !== true` — **qualquer** dashboard
corporativo exige alçada global, salvo exceção explícita e documentada
(`allowDepartmentScope:true`, que nenhum dashboard atual declara). A flag manual
`requiresGlobalScope:true` foi removida de `executive` (agora coberto pela regra automática, como os
demais). `visibleDashboards()` e o handler de `GET /api/dashboards/:id` passaram a usar essa função.

Testado em runtime: líder departamental recebe `403` em `GET /api/dashboards/budget` e o dashboard não
aparece em `GET /api/dashboards`; diretoria continua acessando e vendo-o na listagem; dashboards
departamentais (`legal`, `ti`) continuam funcionando normalmente para o departamento correspondente.

### 3. Administrador técnico não pode ser superusuário de conteúdo (MASTER_HANDOFF §11)

`administrador` tinha `scopes:['*']`, e `scoped()` tratava `user.role === 'administrador'` como bypass
incondicional — ou seja, o papel técnico (destinado a gerenciar sistema/usuários/integrações/
segurança/configuração) herdava acesso irrestrito a **conteúdo** de qualquer departamento/empresa/SPE,
o que o MASTER_HANDOFF proíbe explicitamente ("Administrador técnico ≠ superusuário de conteúdo").

**Correção (mínima, sem reorganização):** `ROLES.administrador.scopes` mudou de `['*']` para `[]`.
`scoped()` passou a usar `hasGlobalScope(user)` (que lê `ROLES[user.role].scopes.includes('*')`) como
única fonte de verdade para o bypass, em vez de checar o papel diretamente — com isso, `administrador`
deixa de bypassar `scoped()`: precisa que o próprio registro esteja no seu escopo, como qualquer outro
usuário sem alçada global. `administrador` mantém `modules:['*']`/`actions:['*']`, que continuam
legítimos para as funções técnicas já existentes (rotas de sistema como auditoria, aprovação de
cadastro, backup, e — via `allowedInDepartment()` — operação de integrações/Monday de qualquer
departamento, sem que isso implique acesso ao conteúdo sincronizado). `diretoria` continua sendo a única
alçada de negócio verdadeiramente global.

Testado em runtime e unitariamente: `administrador` autenticado recebe `200` em `GET /api/legal/processos`
(passa no gate de módulo) mas com `records: []` (nenhum processo departamental é retornado, porque
`scoped()` nega por ausência de escopo global); diretoria continua vendo os processos normalmente.
`hasGlobalScope({role:'administrador'})` agora retorna `false`; `scoped(administrador, {department:'X'})`
retorna `false` (unitário, `tests/core.test.js`).

### 4. `internalizations.processId` deve validar fonte e escopo

`POST /api/projects/:id/internalizations` só verificava que `processId` **existia** em `processos`. Um
processo manual/falso (sem `source:'monday'`) ou de outro departamento passava.

**Correção:** enquanto o Monday for a fonte autorizada do piloto (D1 continua pendente — nenhum cálculo
ou sincronização automática de prazo foi implementado), a criação de internalização passou a exigir que
o processo relacionado exista, tenha `source === 'monday'` (senão `422`) e esteja no escopo do usuário
via `scoped(user, relatedProcess)` (senão `403`) — mesmo padrão já usado por Legal Deadline.

Testado em runtime: internalização com `processId` de processo manual/não-Monday → `422`; com `processId`
de processo do Monday mas de outro departamento → `403`; com `processId` válido e no escopo → `201`
(continua funcionando).

### 5. Dashboard preferences devem herdar a autorização do dashboard

`GET`/`PUT /api/dashboard-preferences/:id` não validavam autorização alguma antes de ler/gravar a
preferência do usuário para aquele dashboard — um usuário sem acesso a um dashboard ainda conseguia
configurar suas próprias preferências para ele.

**Correção:** nova função `dashboardAuthorized(user, definition)` unifica exatamente a mesma checagem já
usada em `GET /api/dashboards/:id` (módulo + regra corporativa/alçada global do item 2 + departamento),
aplicada agora também nas duas rotas de preferências, antes de qualquer leitura ou gravação.

Testado em runtime: líder recebe `403` em `GET`/`PUT /api/dashboard-preferences/executive` e
`/budget`; diretoria consegue ler e gravar ambos; preferência de dashboard departamental permitido
(`legal`) continua funcionando para o líder Jurídico, e é negada (`403`) para o líder de TI.

## P0 corrigidos — rodada 6 (fechamento final de autorização/integridade)

### 1. Isolamento Jurídico x TI generalizado a todo o CRUD genérico de entidades e `/api/legal/:module`

A rodada 5 criou `allowedInDepartment()` só para as quatro rotas de Monday. Rotas equivalentes — que
também usam módulos departamentais (`juridico`/`ti`) sem registro individual anterior para `scoped()`
filtrar — continuavam vulneráveis: `POST /api/entities/:type` cria um registro **novo**, então não há
nada para `scoped()` negar; um líder de TI passava em `allowed(user,'juridico','create')` e o servidor
criava um registro jurídico com `department:'TI'`. `GET /api/legal/:module` e `GET /api/entities/:type`
também usavam só `allowed()`, resultando em uma listagem vazia (200) em vez de negar a operação (403).

**Correção:** todos os verbos de `/api/entities/:type` (GET/POST/PATCH/DELETE/restore) e
`GET /api/legal/:module` passaram a usar `allowedInDepartment()` (leitura) ou `allowedContent()`
(mutação — ver item 3, que combina `allowedInDepartment()` com a negação de `administrador` em módulos
de conteúdo). Deny-by-default por departamento, aplicado no próprio gate de módulo, antes de qualquer
acesso a `collection()` ou a `scoped()`.

Testado em runtime: líder de TI recebe `403` (não mais 200 com lista vazia) em `GET /api/legal/processos`
e em `POST /api/entities/documentReferences`; líder Jurídico recebe `403` no equivalente departamental
de TI (hoje só exercitável via dashboard `ti`, já que nenhum tipo de entidade está mapeado para `ti` em
`ENTITY_MODULE_MAP` — nenhum tipo foi inventado só para testar); diretoria continua acessando e criando
normalmente.

### 2. Dashboard departamental acessível por usuário sem department (administrador técnico)

`dashboardAuthorized()` só negava quando `user.department` existia **e** não batia com o
`departmentId` do dashboard (`user.department && definition.departmentId && mismatch`). Um usuário SEM
`department` (como `administrador` técnico, que desde a rodada 5 não tem `department` de negócio nem
alçada global) nunca caía nessa condição — passava despercebido pelos dashboards departamentais `legal`
e `ti`, apesar de `modules:['*']` sempre aceitar o gate de módulo acima. A listagem (`GET /api/dashboards`)
tinha ainda uma exceção **explícita** (`user.role === 'administrador'`) que isentava esse papel do
filtro departamental inteiro.

**Correção:** para dashboards com `scope:'department'`, `dashboardAuthorized()` agora exige
positivamente (A) alçada de negócio global **ou** (B) `user.department` correspondente ao
`departmentId` do dashboard — ausência de qualquer um dos dois nega. A exceção explícita para
`administrador` foi removida da listagem, que passou a reutilizar `dashboardAuthorized()` diretamente
(mesma função usada em `GET /api/dashboards/:id` e em `/api/dashboard-preferences/:id` — nenhuma lógica
divergente).

Testado em runtime: `administrador` recebe `403` em `GET /api/dashboards/legal` e `GET /api/dashboards/ti`,
e nenhum dos dois aparece na sua listagem nem em `/api/dashboard-preferences/legal`; líder Jurídico,
líder de TI e diretoria continuam acessando os dashboards departamentais correspondentes normalmente.

### 3. Administrador técnico ainda podia criar/alterar conteúdo de negócio

A rodada 5 retirou `scopes:['*']` de `administrador`, fechando a **leitura** irrestrita via `scoped()`.
Mas `modules:['*']`/`actions:['*']` continuavam intactos — e como não há registro prévio no `POST`, não
existe `scoped()` para barrar a **criação**. `administrador` continuava conseguindo criar/alterar/
arquivar/restaurar/exportar conteúdo em `POST /api/agenda`, `POST /api/committees`,
`POST /api/entities/documentReferences`, sub-recursos de projeto, importação de orçamento e exportação de
apresentações.

**Correção (mínima, sem reorganização de papéis):** `BUSINESS_CONTENT_MODULES` é o conjunto explícito dos
módulos operacionais/departamentais de negócio (`central`, `estrategia`, `projetos`, `agenda`, `comites`,
`orcamento`, `juridico`, `ti`) — distintos das rotas técnicas de sistema/integração gated por
`allowed(user,'*',ação)` (módulo literal `'*'`: auditoria, aprovação de cadastro, backup), que
`administrador` continua operando normalmente. `allowedContent(user, module, action)` combina
`allowedInDepartment()` com a negação explícita de `administrador` para qualquer um desses módulos —
aplicado em toda rota de **mutação** de conteúdo (todos os verbos exceto leitura, que `scoped()` já
filtra corretamente desde a rodada 5): `POST`/`PATCH`/`DELETE`/`restore` de `/api/entities/:type`,
`POST /api/agenda`, `POST /api/committees`, todas as rotas de sub-recurso e governança de projeto,
`POST /api/presentations/validate`/`export` e `POST /api/budgets/import/commit`.

`administrador` mantém integralmente as funções técnicas legítimas: auditoria (`GET /api/audit`),
aprovação de cadastro (`GET`/`POST /api/auth/requests`), backup/restauração (`POST /api/backup`/`restore`),
e a operação de integrações departamentais via `allowedInDepartment()` (Monday, que não muda nesta
rodada — continua sendo uma função técnica de sistema, não criação de conteúdo via motor genérico).

Testado em runtime: `administrador` recebe `403` em `POST /api/agenda`, `POST /api/committees`,
`POST /api/entities/documentReferences` e `POST /api/projects/:id/actions` (este último, tecnicamente
`404` — `scoped(user,project)` é avaliado antes do gate de conteúdo, e `administrador` não tem escopo
sobre nenhum projeto; o resultado prático — não conseguir criar o registro — é o mesmo); continua
acessando normalmente `GET /api/audit` e `GET /api/auth/requests`.

### 4. PATCH de internalizations não revalidava `processId`

A rodada 5 validou `processId` (existência + `source:'monday'` + `scoped()`) apenas no `POST` de
`/api/projects/:id/internalizations`. O `PATCH` de sub-recurso de projeto é genérico e não repetia
nenhuma dessas checagens — uma internalização criada corretamente podia ser alterada depois para um
`processId` manual, inexistente ou fora de escopo, sem nenhuma validação, quebrando a integridade
relacional (mesma classe de falha já corrigida para Legal Deadline nas rodadas 3/4).

**Correção:** `validateInternalizationProcess(processId, user, store)` extrai a validação para uma
função única, reaproveitada em `POST` e `PATCH`. No `PATCH`, valida o **estado candidato** — o
`processId` do input, se enviado; senão o já gravado no item — mesmo padrão de `validateLegalDeadline()`
no PATCH: a invariante precisa valer para o registro como ficaria após a atualização, não apenas para os
campos desta requisição específica. `processId` continua não sendo obrigatório (regra de negócio
pré-existente, não alterada); só valida quando informado/presente.

Testado em runtime: PATCH para processo manual (`source` diferente de `'monday'`) → `422`; PATCH para
processo inexistente → `422`; PATCH para processo do Monday mas fora do escopo do usuário → `403`; PATCH
legítimo preservando o `processId` válido → `200`; nenhuma tentativa inválida altera o registro gravado.

## P0 corrigido — MFA por papel, não por flag do cadastro (item D, rodada 1)

`requireMfa(user)` depende exclusivamente do papel (`diretoria`, `administrador`, `lider`), nunca da
flag `user.mfa` do cadastro. Testado em runtime: login como papel privilegiado sempre retorna
`mfaRequired: true`, nunca um token direto, independentemente de `user.mfa`.

## Pendências conhecidas (não resolvidas nesta execução, registradas para P1)

- **Senha global** (`COEVO_DEMO_PASSWORD`) e **código MFA global** (`COEVO_MFA_CODE`) — não há senha nem
  segundo fator por usuário. Ver `docs/SECURITY.md` para a classificação de bloqueio.
- **E-mail duplicado** entre `usr-diretoria` e `usr-juridico`** — não alterado nesta execução (aceito
  anteriormente pela gestão, `docs/SEGURANCA-CORRECOES.md` item J).
- **Escopo por empreendimento/classificação/documento** — `scoped()` cobre departamento e (de forma
  inerte) empresa/SPE; escopo mais granular por empreendimento/documento/campo do §11 ainda não existe.
- **`restore`, `archive` e `approveAgreement` de projeto só existem para `diretoria`/`administrador`**
  — não há papel departamental capaz dessas ações em nenhum projeto, e ambos os papéis elevados têm
  escopo global (`scoped()` sempre `true`). Logo, o gate `scoped(user,project)` adicionado nessas rotas
  na rodada 3 não é exercitável via HTTP como um "permissão concedida, mas escopo nega" — é coberto por
  teste unitário direto de `scoped()`, e por teste de integração que confirma a negação por escopo
  (antes mesmo de chegar ao gate de ação) para o papel departamental que tenta essas rotas.
- **`/api/compliance` restrito a alçada global** (rodada 3, ADR-007) — nenhum papel departamental
  acessa até existir uma decisão de negócio sobre o módulo/escopo correto de Compliance.

## Catálogo de testes de permissão

- **Unitários** (`tests/core.test.js`): `scoped()` (incluindo os casos sintéticos de companyId/speId, e o
  caso `administrador` da rodada 5), `sanitizeEntityInput()` (incluindo scopeType/companyId/speId),
  `entityModule()`, `LEGAL_MODULES`, `requireMfa()`, `hasGlobalScope()`, `allowedInDepartment()`,
  `normalizeDeptSlug()`, `dashboardAuthorized()` (rodada 5, e o caso departamento-sem-alçada-global da
  rodada 6), `allowedContent()`, `BUSINESS_CONTENT_MODULES`, `validateInternalizationProcess()` (rodada
  6) — chamadas diretas às funções exportadas, sem passar por HTTP.
- **Integração HTTP real** (`tests/security-integration.test.js`): sobe um servidor HTTP real com o
  `handler` exportado, injeta usuários e dados de teste (incluindo um segundo projeto sintético em
  outro departamento, registros com companyId/speId sintéticos, e um usuário `administrador` — rodada
  5), e faz requisições reais, verificando status HTTP e corpo da resposta — não apenas presença de
  texto no código-fonte.

Ver `docs/QA.md` para o mapeamento completo contra os 10 casos obrigatórios do MVP/Piloto Jurídico
(§30) e o resultado da execução mais recente.
