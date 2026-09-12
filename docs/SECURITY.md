# SECURITY.md — Segurança

> Regras oficiais: `docs/MASTER_HANDOFF.md` §11, §26 (P0), §31 (Checklist Segurança), §33 (Go-Live Gate).
> Histórico detalhado de correções anteriores a esta execução: `docs/SEGURANCA-CORRECOES.md` (mantido
> como registro histórico, não reescrito).

## Auditoria completa de rotas do `handler` (rodada 3, item 5)

Toda rota de `server.js` foi revisada individualmente. "Autenticado" significa que passou por
`getUser(req)` (sessão válida, não expirada, sem challenge pendente); rotas antes desse gate estão
marcadas explicitamente. "Escopo" descreve a granularidade de acesso ao **registro**, além do
módulo/ação.

| Rota | Método | Módulo/ação exigido | Escopo necessário | Controle implementado |
|---|---|---|---|---|
| `/`, `/status`, `/app.js` e demais estáticos, `/logo-coevo*.png`, `/assets/*` | GET | Nenhum | N/A — arquivo estático público | Sem dado de negócio; conteúdo idêntico para qualquer visitante |
| `/api/auth/login` | POST | Nenhum (pré-autenticação) | N/A | Senha comparada por hash; emite challenge ou token conforme `requireMfa()` |
| `/api/auth/mfa` | POST | Nenhum (pré-autenticação) | N/A | Valida challenge + código; challenge nunca aceito como token |
| `/api/auth/register` | POST | Nenhum (pré-autenticação) | N/A | Cria apenas uma solicitação pendente; nenhum acesso concedido sem aprovação humana |
| `/api/health` | GET | Nenhum | N/A | Só booleans não sensíveis (persistência, migração, ambiente) — aceitável público (item 7 da rodada 3) |
| `/api/monday/status` | GET | `allowedInDepartment(user,'juridico','read')` | Departamento (via `allowedInDepartment`, sem registro individual) | **Corrigido (rodada 3, depois rodada 5):** rodada 3 tirou de antes do gate de sessão; rodada 5 fechou o vazamento cross-departamento (TI podia operar rota jurídica, já que `lider`/`colaborador` têm o módulo `juridico` independentemente do departamento) |
| `/api/monday/schedule` | GET | `allowedInDepartment(user,'juridico','read')` | Departamento (via `allowedInDepartment`) | **Corrigido (rodada 3, depois rodada 5):** idem acima |
| `/api/me` | GET | Nenhum além de autenticado | Próprio usuário | Retorna apenas os dados do próprio usuário autenticado |
| `/api/projects` | GET | `projetos`/`read` | `scoped()` por projeto (filtro) | Presente desde a rodada 1 |
| `/api/projects/:id` | GET | `projetos`/`read` | `scoped()` por projeto | Presente |
| `/api/projects/:id/governance` | PATCH | `allowedContent(user,'projetos','update')` | `scoped()` por projeto | Presente; campos de governança validados contra `store.users`; `allowedContent()` nega `administrador` (r6, item 3) |
| `/api/projects/:id/target` | PUT | `allowedContent(user,'projetos','update')` + `projectPermissions().changeTarget` | `scoped()` por projeto | **Corrigido (rodada 3/4/6):** faltava `scoped()` (r3); `projectPermissions()` sozinha não é deny-by-default para papel fora de `ROLES` (r4); `allowedContent()` nega `administrador` (r6, item 3) |
| `/api/projects/:id/approval-rules` | PUT | `allowedContent(user,'projetos','update')` + `.changeApprovalRule` | `scoped()` por projeto | **Corrigido (rodada 3/4/6):** `allowedContent()` nega `administrador` (r6, item 3) |
| `/api/projects/:id/recovery-settings` | PUT | `allowedContent(user,'projetos','update')` + `.changeApprovalRule` | `scoped()` por projeto | **Corrigido (rodada 3/4/6):** rota nem buscava o projeto antes (r3); `allowedContent()` nega `administrador` (r6, item 3) |
| `/api/projects/:id/(actions\|milestones\|risks\|internalizations\|negotiations\|legal-treatments\|management-items)` | POST | `allowedContent(user,'projetos','create')` + `.edit` | `scoped()` por projeto (+ `scoped()` no processo relacionado, para `internalizations`) | **Corrigido (rodada 4, depois rodada 5/6):** módulo/mass-assignment (r4); validação de fonte/escopo de `internalizations` no POST (r5, item 4) e no PATCH via `validateInternalizationProcess()` (r6, item 4); `allowedContent()` nega `administrador` (r6, item 3) |
| `.../:itemId` | PATCH | `allowedContent(user,'projetos','update')` + `.edit` (+ `.internalizeProcess` para internalizations) | `scoped()` por projeto + item (+ `validateInternalizationProcess()` sobre o processId candidato, para internalizations) | Campos protegidos/escopo removidos via `sanitizeProjectItemInput()` (r4); `allowedContent()` nega `administrador` e revalidação de `processId` de internalizations no PATCH (r6, itens 3/4) |
| `.../:itemId` | DELETE | `allowedContent(user,'projetos','archive')` + `.archive` | `scoped()` por projeto | **Corrigido (rodada 3/4/6):** faltava buscar/validar o projeto (r3); módulo adicionado (r4); `allowedContent()` nega `administrador` (r6, item 3) |
| `.../:itemId/restore` | POST | `allowedContent(user,'projetos','restore')` + `.restore` | `scoped()` por projeto | **Corrigido (rodada 3/4/6):** `allowedContent()` nega `administrador` (r6, item 3) |
| `management-items/:itemId/(approve\|reject\|escalate)` | POST | `allowedContent(user,'projetos','update')` + `.approveAgreement` (exceto escalate) | `scoped()` por projeto | **Corrigido (rodada 3/4/6):** `escalate` não checava nenhuma permissão de negócio antes do módulo (r4); `allowedContent()` nega `administrador` (r6, item 3) |
| `/api/dashboards` | GET | `dashboardAuthorized()` (módulo + regra corporativa automática + departamento) por item — mesma função de `GET /api/dashboards/:id`, sem filtro próprio | Filtro por `departmentId` | **Corrigido (rodada 4, depois rodada 5/6):** flag manual (r4) → automática para `scope:'corporate'` (r5) → listagem parou de ter um filtro ad hoc próprio (com exceção explícita para `administrador`) e passou a reusar `dashboardAuthorized()` (r6, item 2) |
| `/api/dashboards/:id` | GET | `dashboardAuthorized(user, definition)` | Filtro por `departmentId`; alçada global automática para qualquer `scope:'corporate'`; dashboard `scope:'department'` exige department correspondente OU alçada global (deny-by-default) | **Corrigido (rodada 4/5/6):** r4 só cobria `executive`; r5 tornou automático para todo `scope:'corporate'`; r6 (item 2) fechou o caso de usuário SEM `department` (ex.: `administrador`) que antes não caía em nenhuma condição de negação de dashboard departamental |
| `/api/dashboard-preferences/:id` | GET/PUT | `dashboardAuthorized(user, definition)` (mesma checagem de `/api/dashboards/:id`) | Chaveado por `userId` (preferência própria) + autorização do dashboard | **Corrigido (rodada 5/6):** r5 (item 5) parou de aceitar leitura/gravação sem nenhuma autorização de dashboard; r6 herda automaticamente a correção do item 2 (mesma função `dashboardAuthorized()`) |
| `/api/monday/test` | POST | `allowedInDepartment(user,'juridico','read')` | Departamento | **Corrigido (rodada 5):** mesmo gap das demais rotas de Monday |
| `/api/legal/:module` | GET | `allowedInDepartment(user,'juridico','read')` | `LEGAL_MODULES` allowlist + `scoped()` por registro + departamento no próprio gate | **Corrigido (rodada 2, depois rodada 6, item 1):** allowlist fechada evita indexar `collection()` com valor cru da URL (r2); `allowed()` sozinho não negava um usuário de TI, resultando em 200 com lista vazia em vez de 403 (r6) |
| `/api/monday/sync` | POST | `allowedInDepartment(user,'juridico','create')` | Departamento | **Corrigido (rodada 5):** preserva último valor válido em falha; mesmo gap das demais rotas de Monday |
| `/api/auth/requests` | GET | `*`/`approve` | — | Presente (só diretoria/administrador) |
| `/api/auth/requests/:id/approve` | POST | `*`/`approve` | — | Presente |
| `/api/dashboard` | GET | `central`/`read` | Filtro departamental (`visibleDepartments`) + agenda `scoped()` | **Corrigido (rodada 3, item 6):** antes devolvia `store.departments`/`store.agenda` inteiros a qualquer papel com módulo `central` (todos) |
| `/api/audit` | GET | `*`/`read` | — | Presente (só diretoria/administrador) |
| `/api/compliance` | GET | `*`/`read` | — | **Corrigido (rodada 3, item 5):** não tinha NENHUM gate antes |
| `/api/compliance` | POST | `*`/`create` | — | **Corrigido (rodada 3):** sem gate antes; mass assignment de `id` corrigido |
| `/api/agenda` | GET | `agenda`/`read` | `scoped()` por registro | **Corrigido (rodada 3 e 4, item 9):** vazava agenda de todos os departamentos (r3); GET sem gate de módulo (r4) |
| `/api/agenda` | POST | `allowedContent(user,'agenda','create')` | `department`/`scopeType`/`companyId`/`speId` protegidos via `sanitizeEntityInput()` | **Corrigido (rodada 3/4/6):** mass assignment (r3); `scopeType`/`companyId`/`speId` forjáveis (r4); `allowedContent()` nega `administrador` — conteúdo de negócio, não função técnica (r6, item 3) |
| `/api/departments` | GET | `orcamento`/`read` | Filtro departamental (`visibleDepartments`) | **Corrigido (rodada 3 e 4, item 9):** vazava orçamento de todos os departamentos (r3); GET sem gate de módulo, mesmo carregando orçamento (r4) |
| `/api/committees` | GET | `comites`/`read` | `scoped()` por registro | **Corrigido (rodada 3 e 4, item 3):** sem gate (r3); devolvia a coleção inteira sem escopo (r4) — Comitê Jurídico/TI/Conselho VELKOR não se misturam |
| `/api/committees` | POST | `allowedContent(user,'comites','create')` | `department`/`scopeType`/`companyId`/`speId` protegidos via `sanitizeEntityInput()` | Mass assignment (r3); escopo forjável (r4); `allowedContent()` nega `administrador` (r6, item 3) |
| `/api/presentations/validate` \| `/export` | POST | `allowedContent(user,'comites','export')` | — | Presente; export audita e bloqueia combinação Diretoria+Compartilhável. `allowedContent()` nega `administrador` (r6, item 3) — export é uma das ações explicitamente listadas como conteúdo de negócio |
| `/api/entities/:type` | GET | `entityModule(type)` + `allowedInDepartment(...,'read')` | `scoped()` por registro + departamento no próprio gate | Presente (rodada 1); **rodada 6, item 1:** `allowed()` sozinho não isolava Jurídico x TI — trocado por `allowedInDepartment()`, transversal com as rotas de Monday |
| `/api/entities/:type` | POST | `entityModule(type)` + `allowedContent(...,'create')` | `scoped()` no processo relacionado (Legal Deadline) | **Corrigido (rodada 2/3/6):** sanitização e bloqueio Monday-sourced (r2/r3); `allowedContent()` fecha o isolamento departamental (líder de TI criando conteúdo jurídico, item 1) E nega `administrador` para conteúdo de negócio (item 3), ambos rodada 6 |
| `/api/entities/:type/:id` | PATCH | idem (`'update'`) via `allowedContent` | `scoped()` por registro | **Corrigido (rodada 3, depois rodada 6):** revalida invariantes de Legal Deadline (r3); `allowedContent()` (r6) |
| `/api/entities/:type/:id` | DELETE | idem (`'archive'`) via `allowedContent` | `scoped()` por registro | Bloqueado para tipos Monday-sourced (r3); `allowedContent()` (r6) |
| `/api/entities/:type/:id/restore` | POST | idem (`'restore'`) via `allowedContent` | `scoped()` por registro | Bloqueado para tipos Monday-sourced (r3); `allowedContent()` (r6) |
| `/api/budgets/import/preview` | POST | Nenhum | N/A | Só faz parsing/validação do CSV enviado pelo próprio requisitante; não persiste nem lê dado de terceiros |
| `/api/budgets/import/commit` | POST | `allowedContent(user,'orcamento','create')` | Toda linha do CSV precisa pertencer ao department do usuário (não-global) | **Corrigido (rodada 4/6):** escopo por linha (r4, item 5); `allowedContent()` nega `administrador` (r6, item 3) |
| `/api/backup` \| `/backup/restore` | POST | `*`/`approve` | — | Presente (só diretoria/administrador) |

**Mass assignment fora de `/api/entities`** (item 5) — revisado em toda a superfície da API. Os três
pontos onde um objeto era construído com `{id: crypto.randomUUID(), ...input}` ou
`{...input, id: ...}` na ordem errada (permitindo que `input.id` vencesse) foram corrigidos:
`/api/agenda` (POST), `/api/committees` (POST) e `/api/compliance` (POST). Em todos os três, os campos
controlados pelo servidor agora são removidos explicitamente do input (`delete clean.id` etc.) **e**
atribuídos depois do spread, como defesa em profundidade.

## P0 — Segredos fora do frontend (verificado nesta execução)

Requisito não negociável da v1.3: "nenhum token, API key, client secret ou credencial pode residir no
front-end, browser, `localStorage` ou `sessionStorage`."

Verificado nesta execução:
- `MONDAY_TOKEN` só é lido de `process.env` dentro de `mondayQuery()` (`server.js`), nunca devolvido em
  nenhuma resposta HTTP. `/api/monday/status` devolve apenas `configured: boolean` e metadados de board.
- `COEVO_DEMO_PASSWORD`, `COEVO_MFA_CODE` e `COEVO_BACKUP_KEY` só existem em `.env` (não versionado) e
  nunca são enviados ao cliente.
- `public/app.js` não usa `localStorage` nem `sessionStorage` para nada relacionado a autenticação — o
  token de sessão vive apenas em `window.__coevoToken` (variável de memória do processo do navegador,
  perdida ao recarregar a página, sem persistência em disco do lado cliente).
- `.env.example` não contém nenhum segredo funcional (verificado por teste automatizado).

**Nenhum P0 de segredo exposto foi encontrado nesta auditoria além dos já corrigidos anteriormente**
(ver `docs/SEGURANCA-CORRECOES.md` para o histórico de correção de credenciais pré-preenchidas na tela de
login e rotação de chaves).

## P0 corrigidos — rodada 1 (auditoria inicial)

| # | Item | Antes | Depois |
|---|---|---|---|
| 1 | `GET /api/entities/:type` sem verificação de módulo (item B de `docs/SEGURANCA-CORRECOES.md`) | Qualquer usuário autenticado lia qualquer coleção trocando `:type` na URL | Exige `entityModule(type)` mapeado + `allowed(user, module, 'read')` |
| 2 | `GET /api/legal/:module` sem verificação de módulo (item H) | Mesma classe de problema nas rotas jurídicas | Exige `allowed(user, 'juridico', 'read')` |
| 3 | `requireMfa()` dependia da flag `mfa` do próprio cadastro (item D) | Um papel privilegiado com `mfa: false` recebia token sem segundo fator | MFA exigido pelo papel, independentemente da flag do cadastro |
| 4 | `ENTITY_MODULE_MAP['__proto__']` resolvia para o protótipo do objeto em vez de `undefined` | Chave `__proto__` na URL poderia, em tese, produzir um valor truthy inesperado | Mapa criado com `Object.create(null)`; `entityModule()` valida `typeof type === 'string'` |

## P0 corrigidos — rodada 2 (revisão de segurança pós-review, antes do merge)

A revisão de código apontou corretamente que a rodada 1 foi **insuficiente** em três pontos. Detalhe
completo em `docs/PERMISSIONS.md`; resumo:

| # | Item | Antes | Depois |
|---|---|---|---|
| 5 | `GET /api/legal/:module` verificava módulo, mas `:module` cru ainda indexava `collection()` diretamente | Um usuário com acesso a `juridico` podia trocar `:module` para qualquer string e ler/criar incidentalmente qualquer coleção de `store.records` | `LEGAL_MODULES` (allowlist fechada) — módulo fora da lista retorna 404 antes de qualquer acesso à coleção |
| 6 | `POST`/`PATCH` em `/api/entities/:type` aplicavam `{...input}` sem sanitização | Cliente podia forjar `id`, `version`, `createdAt/By`, `updatedAt/By`, `deletedAt/By`, metadados de origem (`source`, `externalId`, `boardId`, `boardName`, `syncedAt`) e `department` de outro departamento | `sanitizeEntityInput()` remove `PROTECTED_ENTITY_FIELDS` do input e restringe `department` a papéis com escopo global; campos do servidor são atribuídos depois do input |
| 7 | `scoped()` tratava ausência de `department` como acesso liberado | Registro sem `department` (inclusive todo registro sincronizado do Monday) era visível a qualquer usuário com acesso ao módulo, mesmo de outro departamento (ex.: TI lendo Jurídico) | Deny-by-default: só `scopeType:'global'` explícito libera um registro sem `department`; `normalizeMondayItem()` passou a marcar `department:'Jurídico'` |
| 8 | Legal Deadline aceitava qualquer `processId`, sem checar se o processo existia ou pertencia ao escopo do usuário | Um prazo podia ser criado apontando para um processo inexistente ou de outro departamento | `POST /api/entities/legalDeadlines` valida `processId` contra a coleção `processos` e aplica `scoped()` sobre o processo relacionado |

Todos os itens 1–8 cobertos por teste automatizado — unitário (`tests/core.test.js`) e/ou de integração
HTTP real (`tests/security-integration.test.js`, servidor real, requisições reais, status HTTP
verificado — não apenas presença de texto no código-fonte).

## P0 corrigidos — rodada 3 (segunda revisão de segurança pós-review, antes do merge)

Uma segunda revisão apontou que a rodada 2 ainda deixava lacunas — inclusive uma na própria correção da
rodada 2 (item 9 abaixo). Detalhe completo em `docs/PERMISSIONS.md`; resumo:

| # | Item | Antes | Depois |
|---|---|---|---|
| 9 | `sanitizeEntityInput()` protegia `department`, mas não `scopeType`/`companyId`/`speId` | Um papel departamental podia enviar `scopeType:'global'` no corpo da requisição e tornar o próprio registro globalmente visível (`scoped()` libera qualquer registro com `scopeType:'global'`) | Os quatro campos de escopo (`department`, `scopeType`, `companyId`, `speId`) só são preservados do input para papéis com escopo global (`scopes:['*']`) |
| 10 | `scoped()` só negava companyId/speId quando **ambos os lados** carregavam o campo | Um usuário SEM `companyId` conseguia acessar um registro COM `companyId`, porque a condição de negação nunca era avaliada quando o usuário não tinha o campo — isso não é deny-by-default | Registro com `companyId` exige que o usuário tenha o MESMO valor; ausência ou mismatch nega. Mesma regra para `speId` |
| 11 | Legal Deadline não era revalidado no PATCH | Um PATCH podia esvaziar `origin`/`date`, ou trocar `processId` para um processo inexistente/fora de escopo, sem nenhuma checagem | PATCH revalida as mesmas invariantes da criação sobre o estado candidato (item atual + input sanitizado) antes de gravar |
| 12 | Motor genérico de entidades permitia criar/alterar/arquivar/restaurar tipos cuja fonte oficial é o Monday (`processos`, `notificacoes`, `distratos`, `honorarios`, `unidades`, `compraVenda`, `transferenciaIntermediaria`, `honorariosJudiciais`) | Um usuário podia fabricar um "processo" local falso (sem `source:'monday'`) e depois relacioná-lo a um Legal Deadline, contornando a fonte oficial | `rejectIfMondaySourced()` bloqueia POST/PATCH/DELETE/restore para esses tipos (só GET permanece); Legal Deadline também passou a exigir `relatedProcess.source === 'monday'`, como defesa em profundidade |
| 13 | `/api/monday/status` e `/api/monday/schedule` ficavam ANTES do gate de sessão | Qualquer visitante sem autenticação lia IDs/nomes internos de boards e, em `/schedule`, histórico de sincronização com nomes de solicitantes e mensagens de erro | Movidas para depois do gate de sessão, com `allowed(user,'juridico','read')`; payload reduzido (sem `boards`; `lastRuns` sem `requestedBy`/`error`) |
| 14 | `/api/dashboard` devolvia `store.departments` (com orçamento completo) e `store.agenda` inteiros para qualquer papel com módulo `central` (todos os papéis) | Colaborador do Jurídico lia orçamento e agenda da TI, e vice-versa | Filtra por `visibleDepartments()`/`scoped()` antes de montar a resposta; papel global continua vendo o consolidado |
| 15 | `/api/departments` e `/api/agenda` (GET) sem nenhum filtro de escopo | Mesma classe de vazamento do item 14, em rotas próprias | Ambas agora filtram por escopo departamental |
| 16 | `/api/committees` (GET) e `/api/compliance` (GET/POST) sem nenhum gate de permissão | Colaborador (sem módulo `comites`) lia comitês; qualquer usuário autenticado lia e criava entradas de compliance | `/committees` exige `allowed(user,'comites',...)`; `/compliance` restrito a `allowed(user,'*',...)` (diretoria/administrador) até existir um módulo/dono de negócio próprio — decisão registrada em `docs/DECISIONS.md` |
| 17 | Mass assignment em `/api/agenda`, `/api/committees`, `/api/compliance` (POST) | `{id: crypto.randomUUID(), ...input}` ou `{...input, id: ...}` na ordem que permitia ao cliente sobrescrever `id` (e, em compliance, indiretamente `responsible`/`createdAt` embora esses já viessem depois) | Campos protegidos removidos explicitamente do input e reatribuídos depois do spread, nas três rotas |
| 18 | Rotas críticas de projeto (`target`, `approval-rules`, `recovery-settings`, `DELETE`/`restore` de sub-recurso, decisão de `management-items`) não verificavam `scoped(user,project)` | `projectPermissions(user)` concede `edit`/`changeTarget`/etc. por **usuário**, não por projeto — com mais de um projeto, um papel departamental de um projeto podia alterar/arquivar sub-recursos de um projeto de outro departamento | Todas as seis rotas passaram a buscar o projeto pai e checar `scoped(user,project)` antes de qualquer ação |

Todos os itens 9–18 cobertos por teste automatizado — unitário (`tests/core.test.js`) e de integração
HTTP real (`tests/security-integration.test.js`), incluindo dados sintéticos para os cenários de
companyId/speId e um segundo projeto sintético em departamento diferente para os testes de escopo de
projeto.

## P0 corrigidos — rodada 4 (rodada de fechamento, sem expansão de escopo)

Uma quarta revisão, após CI verde da rodada 3, encontrou mais P0. Nenhum deles amplia o produto —
todos fecham lacunas de autorização/integridade na fundação já entregue. Detalhe completo em
`docs/PERMISSIONS.md`.

| # | Item | Antes | Depois |
|---|---|---|---|
| 19 | `/api/dashboards/executive` usava só `module:'central'`, que também pertence a `lider`/`colaborador` | Qualquer papel departamental acessava o Centro de Comando e via orçamento/agenda/decisões de **todos** os departamentos, consolidados | Dashboard com `requiresGlobalScope:true` (hoje só `executive`) exige alçada global (`diretoria`/`administrador`), verificado tanto na listagem (`visibleDashboards`) quanto no detalhe; dashboards futuros de escopo `'corporate'` devem declarar explicitamente essa flag |
| 20 | POST de sub-recursos de projeto (`actions`/`milestones`/`risks`/`internalizations`/`negotiations`/`legal-treatments`/`management-items`) construía `{id:..., ...input}` — `...input` por último | Cliente podia sobrescrever `id`, `projectId`, `createdAt`, `createdBy` | `sanitizeProjectItemInput()` (mesmo padrão de `sanitizeEntityInput`) remove os campos protegidos antes; servidor os atribui depois. Aplicado também ao PATCH, que já removia os campos mas não os de escopo (`departmentId`/`scopeType`/`companyId`/`speId`) |
| 21 | `GET /api/committees` tinha gate de módulo (rodada 3) mas devolvia a coleção inteira; POST não protegia `scopeType`/`companyId`/`speId` | Comitê Jurídico e Comitê TI se misturavam; papel departamental podia forjar escopo global | Reaproveita `scoped()`/`sanitizeEntityInput()` — mesma política de toda a plataforma, sem mecanismo próprio |
| 22 | `sanitizeEntityInput()` em `/api/agenda` (rodada 3) só protegia `department` | Papel departamental ainda podia forjar `scopeType:'global'`/`companyId`/`speId` num evento de agenda | Troca da sanitização própria por `sanitizeEntityInput()`, protegendo os quatro campos de escopo de forma consistente |
| 23 | `POST /api/budgets/import/commit` não validava o `department` das linhas do CSV contra o escopo do usuário | Usuário departamental podia importar/alterar linhas de outro departamento | Para papel não-global, qualquer linha com `department` diferente do próprio bloqueia a **importação inteira** (nunca parcial); papel global segue sem restrição |
| 24 | `validateLegalDeadline()` só testava truthiness de `origin`/`date` | `origin:' '` (só espaços) e `date:'banana'`/`'2026-99-99'`/vazio passavam | `origin` exige string não vazia após `trim()`; `date` validado por `isValidCivilDate()` — regex `YYYY-MM-DD` + reconstrução via `Date.UTC` para rejeitar datas que não existem no calendário (ex.: 31/04, 29/02 em ano não bissexto) |
| 25 | Legal Deadline podia ter `department`/`companyId`/`speId`/`scopeType` inconsistentes com o processo relacionado | Cliente (inclusive diretoria/administrador) podia forjar escopo divergente do processo | `validateLegalDeadline()` agora **herda** os quatro campos de escopo do processo relacionado, sobrescrevendo qualquer valor enviado — em POST e em PATCH (inclusive ao trocar `processId`), para qualquer papel |
| 26 | Rotas de sub-recurso de projeto dependiam só de `projectPermissions(user)`, que não é deny-by-default para papel fora de `ROLES` | Um papel desconhecido (`role` inexistente em `ROLES`) com `department:'Jurídico'` herdava `edit`/`create` por coincidência de department, contornando o módulo `projetos` | Adicionado `allowed(user,'projetos',ação)` em todas as 8 rotas de sub-recurso que só usavam `projectPermissions()` |
| 27 | `GET /api/agenda` e `GET /api/departments` sem gate de módulo — só "estar autenticado" + escopo do registro | Endpoint sensível (departments carrega orçamento) protegido só por autenticação | Reaproveitados os módulos já existentes `agenda` e `orcamento` (nenhum módulo novo criado) |

Todos os itens 19–27 cobertos por teste automatizado — unitário e de integração HTTP real.

## P0 corrigidos — rodada 5 (fechamento de autorização/segregação)

Rodada curta, sem Sprint 2/IA/VELKOR/Sienge/automações/escrita externa, focada em 5 lacunas de
autorização/segregação apontadas após a rodada 4. Detalhe completo (comportamento antes/depois, trechos
de código) em `docs/PERMISSIONS.md`, seção "P0 corrigidos — rodada 5".

| # | Item | Antes | Depois |
|---|---|---|---|
| 28 | Rotas de Monday (`/status`, `/schedule`, `/test`, `/sync`) sem escopo por departamento | `lider`/`colaborador` têm os módulos `juridico` E `ti` simultaneamente em `ROLES`; sem registro individual para `scoped()`, um líder de TI passava no gate de módulo e operava função exclusivamente jurídica (e vice-versa) | Nova `allowedInDepartment(user, module, action)` — `allowed()` + checagem de `user.department` para módulos departamentais (`MODULE_DEPARTMENT`), com bypass só para alçada global ou para o papel técnico `administrador` |
| 29 | Dashboards `scope:'corporate'` sem alçada global exigida por padrão | Só `executive` tinha `requiresGlobalScope:true` manual (r4); `budget`/`strategy`/`projects`/`risks` (também `scope:'corporate'`) ficavam acessíveis a qualquer papel com o módulo correspondente | `dashboardRequiresGlobalScope(definition)` — automático para qualquer `scope:'corporate'`, salvo `allowDepartmentScope:true` explícito (nenhum dashboard hoje declara essa exceção) |
| 30 | `administrador` com `scopes:['*']` e bypass incondicional em `scoped()` | Papel técnico (MASTER_HANDOFF §11: "administrador técnico ≠ superusuário de conteúdo") herdava acesso irrestrito a conteúdo de qualquer departamento/empresa/SPE | `ROLES.administrador.scopes` mudou para `[]`; `scoped()` usa `hasGlobalScope(user)` como única fonte de verdade — `administrador` mantém `modules:['*']`/`actions:['*']` (funções técnicas legítimas), mas não bypassa mais `scoped()` |
| 31 | `internalizations.processId` só verificava existência | Processo manual/falso (sem `source:'monday'`) ou de outro departamento podia ser relacionado a uma internalização | Exige `relatedProcess.source==='monday'` (senão `422`) e `scoped(user, relatedProcess)` (senão `403`) — mesmo padrão de Legal Deadline; nenhum cálculo/sincronização automática de prazo foi criado (D1 continua pendente) |
| 32 | `GET`/`PUT /api/dashboard-preferences/:id` sem autorização de dashboard | Usuário sem acesso a um dashboard ainda lia/gravava sua própria preferência para ele | Nova `dashboardAuthorized(user, definition)`, reutilizando a mesma checagem de `GET /api/dashboards/:id` (módulo + regra corporativa/global do item 29 + departamento), aplicada antes de qualquer leitura/gravação |

Todos os itens 28–32 cobertos por teste automatizado — unitário (`tests/core.test.js`: `hasGlobalScope()`,
`scoped()` com `administrador`, `allowedInDepartment()`, `normalizeDeptSlug()`, `dashboardAuthorized()`) e
de integração HTTP real (`tests/security-integration.test.js`, incluindo um usuário `administrador` de
teste, novo nesta rodada).

## P0 corrigidos — rodada 6 (fechamento final de autorização/integridade)

Última rodada de fechamento sobre os 4 pontos restantes da revisão de autorização/segregação, sem
expansão de escopo (sem Sprint 2/IA/VELKOR/Sienge/automações/novos módulos/novos dashboards). Detalhe
completo em `docs/PERMISSIONS.md`, seção "P0 corrigidos — rodada 6".

| # | Item | Antes | Depois |
|---|---|---|---|
| 33 | Isolamento Jurídico x TI não era transversal — só as rotas de Monday usavam `allowedInDepartment()` | `POST /api/entities/:type` cria um registro NOVO (nada para `scoped()` filtrar); líder de TI passava em `allowed(user,'juridico','create')` e o servidor criava conteúdo jurídico com `department:'TI'`. `GET /api/legal/:module`/`GET /api/entities/:type` devolviam 200 com lista vazia em vez de negar | Todos os verbos de `/api/entities/:type` e `GET /api/legal/:module` passaram a usar `allowedInDepartment()` (leitura) / `allowedContent()` (mutação) — deny-by-default por departamento no próprio gate de módulo, com `403` real |
| 34 | Dashboard departamental acessível por usuário sem `department` (`administrador`) | `dashboardAuthorized()` só negava quando `user.department` existia E não batia — um usuário sem `department` nunca caía nessa condição; a listagem tinha ainda uma exceção explícita `user.role==='administrador'` | `dashboardAuthorized()` exige positivamente alçada global OU department correspondente para `scope:'department'`; exceção explícita removida da listagem, que passou a reusar a mesma função |
| 35 | `administrador` ainda podia criar/alterar/arquivar/restaurar/exportar conteúdo de negócio | `modules:['*']`/`actions:['*']` permanecem intactos (legítimos para rotas técnicas via `allowed(user,'*',ação)`), mas o mesmo wildcard também "abria" qualquer módulo de conteúdo (agenda/comitês/orçamento/projetos/jurídico/TI) para mutação, já que não há `scoped()` prévio num `POST` | Nova `allowedContent()` — `BUSINESS_CONTENT_MODULES` (conjunto explícito dos módulos de conteúdo de negócio) + negação de `administrador` nesses módulos para qualquer ação de mutação — aplicada em toda rota de mutação de conteúdo; leitura permanece via `scoped()` (inalterada desde a r5) |
| 36 | PATCH de `internalizations` não revalidava `processId` | Validação (existência + `source:'monday'` + escopo) só rodava no POST; uma internalização válida podia ser alterada depois para um `processId` manual/inexistente/fora de escopo sem checagem | `validateInternalizationProcess()` extraída e reaproveitada em POST e PATCH; no PATCH, valida o estado candidato (input ou, se omitido, o valor já gravado) — mesmo padrão de `validateLegalDeadline()` |

Todos os itens 33–36 cobertos por teste automatizado — unitário (`tests/core.test.js`: `allowedContent()`,
`BUSINESS_CONTENT_MODULES`, `dashboardAuthorized()` sem department, `validateInternalizationProcess()`) e
de integração HTTP real (`tests/security-integration.test.js`).

## P0 conhecidos e ainda abertos — classificados por o que bloqueiam

Nenhum destes itens foi resolvido, escondido ou reclassificado como "aceito" apenas por já existir antes
desta execução. A tabela abaixo classifica explicitamente cada um contra três limiares distintos, para
que não se confunda "PR mergeado" com "plataforma pronta para produção":

- **Bloqueia merge técnico deste PR** — precisa estar corrigido ou coberto por teste antes deste PR ser
  aceito.
- **Bloqueia homologação** — pode ser mergeado, mas a homologação formal do release (§32 da v1.3) não
  pode ser assinada enquanto aberto.
- **Bloqueia produção/go-live** — pode ser homologado em ambiente controlado, mas não pode ir a produção
  com dados reais em escala enquanto aberto (§33, Go-Live Gate).

| Item | Severidade | Bloqueia merge deste PR? | Bloqueia homologação? | Bloqueia produção/go-live? |
|---|---|---|---|---|
| Persistência em `data/store.json` sem transação/concorrência real | Crítico | Não — fora do escopo desta rodada (ADR-001) | Não, para o piloto em ambiente controlado de um único processo | **Sim** — antes de dados reais em escala (§33.8 backup/restauração testados pressupõe persistência transacional confiável) |
| Senha global (`COEVO_DEMO_PASSWORD`) | Alto | Não | Não, para homologação interna com usuários conhecidos | **Sim** — antes de qualquer usuário externo ao núcleo atual |
| Código MFA global (`COEVO_MFA_CODE`) | Alto | Não | Não, mesma razão acima | **Sim** |
| 2 vulnerabilidades altas em `image-size` (via `pptxgenjs`) | Alto | Não — não é exercitado pelos testes desta rodada, e o CI adicionado reporta via `npm audit` sem bloquear | Não, se a exportação PPTX/PDF não for usada com dados sensíveis | **Sim**, antes de expor exportação de apresentações a dado sensível real |
| E-mail duplicado `usr-diretoria`/`usr-juridico` | Médio | Não | Não — é limitação de cadastro conhecida e aceita pela gestão | Recomendado corrigir, mas não é um controle de segurança per se |
| Ausência de rate limiting/CSRF/CSP/cabeçalhos adicionais | Alto | Não | Recomendado antes de expor a instância além da rede controlada de homologação | **Sim** |
| Auditoria no mesmo arquivo mutável, sem append-only/assinatura | Médio | Não | Não | Recomendado antes de auditoria ser usada como evidência formal/legal |
| Revogação de sessão/usuário/credencial (fora do TTL) | Alto | Não | Recomendado | **Sim** |
| Plano mínimo de resposta a incidentes | Alto (operacional) | Não | Não | **Sim**, antes de dados reais em escala (§33.11) |
| Retenção/legal hold por categoria de dado | Alto (operacional/negócio) | Não | Não | **Sim** (§33.12) — depende de decisão de negócio, não apenas de código |
| Cópias do acervo fora do repositório (backups locais, OneDrive) | Alto (operacional) | Não — fora do escopo de código | N/A | Ação operacional da gestão, já documentada em `docs/SEGURANCA-CORRECOES.md` |

**Nenhum item desta tabela bloqueia o merge deste PR** — todos são pendências estruturais/operacionais
que exigem decisão de negócio, contratação de serviço (IdP, WAF) ou uma migração maior (banco
transacional), fora do escopo de uma rodada de correções de segurança sobre a fundação existente. O que
**bloqueava o merge** (as lacunas de autorização e integridade encontradas na revisão) está corrigido e
testado nas seções acima.

## Checklist de Segurança (§31) — situação por item

| Controle | Situação |
|---|---|
| Auth e sessões | Presente — corrigido nesta execução (MFA por papel) |
| MFA para perfis privilegiados | Presente e corrigido nesta execução |
| Secrets fora do código | Presente — verificado nesta execução |
| Service account por finalidade nos conectores | Presente para Monday (token único, finalidade de leitura jurídica) |
| Menor privilégio nos conectores | Presente para Monday |
| Validação de upload | N/A — nenhum upload de arquivo implementado ainda |
| Exportação restrita e auditada | Presente para exportação de apresentações (`/api/presentations/export`, com `allowed()` e `audit()`) |
| Logs sem dado bancário completo | Sem dado bancário no fluxo atual — nada a mascarar hoje |
| IA sem permissão além da usuária | N/A — IA não implementada (ver `docs/AI_GOVERNANCE.md`) |
| Automação dentro de alçada | N/A — nenhuma automação crítica implementada |
| Revogação de sessão/usuário/credencial testada | **Gap** — não há endpoint de revogação explícita de sessão além da expiração por TTL |
| Plano mínimo de resposta a incidentes | **Gap** — não existe ainda; recomendado antes de produção com dados reais em escala |
| Retenção/hold definidos | **Gap** — não definido; depende de decisão de negócio por categoria de dado |
| Backup e restauração testados | Parcial — mecanismo existe (`/api/backup`, `/api/backup/restore`) e foi validado isoladamente (ver `docs/SEGURANCA-CORRECOES.md`), mas não em ambiente de produção real |

**Nenhum destes controles deve ser adiado quando aplicável ao escopo de produção** (§31) — os marcados
"Gap" acima são registrados como pendência explícita, não como aceitos silenciosamente.

## CI (adicionado nesta rodada)

O repositório não tinha pipeline de CI — "31/31 passando" (ou qualquer contagem) dependia inteiramente
da afirmação local de quem rodou os testes. Adicionado `.github/workflows/ci.yml`: roda em todo Pull
Request e push para `master`/`main`, faz `npm ci` (instalação determinística a partir do
`package-lock.json`) e `npm test` em Node 20.x e 22.x. Também roda `npm audit --audit-level=high` como
relatório informativo (não bloqueia o merge — a vulnerabilidade conhecida em `pptxgenjs`/`image-size`
já está registrada acima e exige upgrade major com revalidação própria).

Nenhuma ferramenta de lint/typecheck foi adicionada: o projeto não usa TypeScript nem tem um linter
configurado (`package.json` não declara nenhum), e inventar uma agora, apenas para "cumprir checklist",
não foi pedido nem é consistente com o estado real do repositório.
