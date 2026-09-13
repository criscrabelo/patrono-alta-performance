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
| `/api/audit` | GET | `*`/`read` | `sanitizeAuditEventForUser()` redige `before`/`after` para quem não tem `hasGlobalScope()` | Presente (só diretoria/administrador acessam a rota); **rodada 7, item 2:** conteúdo auditado (`before`/`after`) só vai para alçada de negócio global — `administrador` via só metadados técnicos |
| `/api/compliance` | GET | `hasGlobalScope(user)` | — | **Corrigido (rodada 3, depois rodada 7, item 1):** não tinha NENHUM gate (r3); `allowed(user,'*',...)` incluía `administrador`, não só alçada de negócio — trocado por `hasGlobalScope()` (r7) |
| `/api/compliance` | POST | `hasGlobalScope(user)` | — | **Corrigido (rodada 3/7):** sem gate antes (r3); mass assignment de `id` corrigido (r3); `hasGlobalScope()` nega `administrador` (r7) |
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
  nunca são enviados ao cliente. **A partir de H2**, `COEVO_DEMO_PASSWORD` deixou de ser comparada
  diretamente no login (senha global removida) — passou a ser reaproveitada, fora de produção, apenas
  como fonte da senha de conveniência que `migrateLegacyStore()`/`seedAuthFields()` atribuem a usuários
  seed/legados de desenvolvimento e teste; `COEVO_MFA_CODE` não é mais lida em nenhum ponto do runtime.
  Novos nomes de variável introduzidos por H2 (só o NOME é documentado aqui — nenhum valor real): 
  `MFA_ENCRYPTION_KEY` (chave de cifragem em repouso do segredo TOTP, AES-256-GCM — mesmo padrão de
  `COEVO_BACKUP_KEY`; obrigatória para qualquer enrolamento/validação de MFA, sem valor padrão embutido),
  `COEVO_SEED_PASSWORD` e `COEVO_SEED_TOTP_SECRET` (overrides opcionais, só fora de produção, para a
  senha/segredo TOTP de conveniência atribuídos a usuários seed — nunca aplicados automaticamente quando
  `NODE_ENV=production`).
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
| 31 | `internalizations.processId` só verificava existência | Processo manual/falso (sem `source:'monday'`) ou de outro departamento podia ser relacionado a uma internalização | Exige `relatedProcess.source==='monday'` (senão `422`) e `scoped(user, relatedProcess)` (senão `403`) — mesmo padrão de Legal Deadline; nenhum cálculo/sincronização automática de prazo foi criado (D1, sobre fonte/origem de Legal Deadline, foi homologada em 12/09/2026 sem mudar isso — ver `docs/DECISIONS.md`, seção 1.1) |
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

## P0 corrigidos — rodada 7 (fechamento dos 2 pontos residuais da revisão final)

Rodada final sobre os 2 pontos residuais identificados na revisão da rodada 6 — os últimos acessos
indiretos de conteúdo pelo `administrador` técnico. Detalhe completo em `docs/PERMISSIONS.md`, seção
"P0 corrigidos — rodada 7"; ADR nova em `docs/DECISIONS.md` (ADR-013).

| # | Item | Antes | Depois |
|---|---|---|---|
| 37 | Compliance usava `allowed(user,'*',...)` como autorização — inclui `administrador`, não só alçada de negócio | `administrador` (papel técnico) lia e criava conteúdo de Compliance, violando MASTER_HANDOFF §11 | `hasGlobalScope(user)` — hoje só `diretoria`; continua deny-by-default enquanto ADR-007 (módulo/dono definitivo) permanecer pendente, mas restrito à alçada de negócio, não a qualquer papel com módulo wildcard |
| 38 | `GET /api/audit` devolvia o evento inteiro, incluindo `before`/`after` (snapshot completo do registro alterado) | `administrador` lia conteúdo jurídico/financeiro/pessoal indiretamente através do histórico de auditoria de qualquer registro alterado por outro usuário | `sanitizeAuditEventForUser()` separa metadados técnicos (sempre visíveis) de `before`/`after` (só para `hasGlobalScope()`) |

Ambos os itens cobertos por teste automatizado — unitário (`tests/core.test.js`:
`sanitizeAuditEventForUser()`, `AUDIT_TECHNICAL_FIELDS`) e de integração HTTP real
(`tests/security-integration.test.js`).

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
| ~~Senha global (`COEVO_DEMO_PASSWORD`)~~ **FECHADO por H2** — senha individual por usuário (`docs/PRODUCTION_GATE.md`, seção 19; `docs/DECISIONS.md`, PROD-H2-01) | ~~Alto~~ Fechado | Não | Não | ~~Sim~~ Fechado |
| ~~Código MFA global (`COEVO_MFA_CODE`)~~ **FECHADO por H2** — TOTP individual por usuário (mesma referência acima) | ~~Alto~~ Fechado | Não | Não | ~~Sim~~ Fechado |
| 2 vulnerabilidades altas em `image-size` (via `pptxgenjs`) | Alto | Não — não é exercitado pelos testes desta rodada, e o CI adicionado reporta via `npm audit` sem bloquear | Não, se a exportação PPTX/PDF não for usada com dados sensíveis | **Sim**, antes de expor exportação de apresentações a dado sensível real |
| E-mail duplicado `usr-diretoria`/`usr-juridico` | Médio | Não | Não — é limitação de cadastro conhecida e aceita pela gestão | Recomendado corrigir, mas não é um controle de segurança per se |
| ~~Ausência de rate limiting~~ **FECHADO por H3** (rotas de autenticação sensíveis, ver `docs/PRODUCTION_GATE.md` seção 20); ~~CSP/cabeçalhos adicionais~~ **FECHADO por H4** (seção 21) — CSRF (PG-14) continua em aberto, condicional a uma futura migração de Bearer token para cookie | ~~Alto~~ Fechado (rate limiting + headers) / Baixo hoje (CSRF, condicional) | Não | Recomendado antes de expor a instância além da rede controlada de homologação | ~~Sim~~ Fechado (rate limiting + headers) / NÃO hoje (CSRF, ver PG-14) |
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
| Auth e sessões | **Reforçado por H2** — credencial individual por usuário, sessão persistida (Postgres), revogação real (logout/logout-all/troca-reset de senha/inativação) |
| MFA para perfis privilegiados | **Reforçado por H2** — TOTP individual (RFC 6238) por usuário, nunca ativo antes de confirmação, segredo cifrado em repouso |
| Rate limiting em rotas sensíveis | **FECHADO por H3** — distribuído via PostgreSQL (sobrevive a restart/múltiplas instâncias), por IP/identidade/combinado, cobrindo login/MFA/forgot-reset-password/reset-token administrativo/enroll-confirm-disable de MFA/change-password/logout-all/aprovação de cadastro (`docs/PRODUCTION_GATE.md`, seção 20) |
| Headers de segurança HTTP (CSP/HSTS/X-Frame-Options/Referrer-Policy/Permissions-Policy) | **FECHADO por H4** — CSP auditada a partir do frontend real, HSTS só em produção, clickjacking mitigado em dupla camada, `Cache-Control: no-store` em toda API (`docs/PRODUCTION_GATE.md`, seção 21) |
| CORS explícito (allowlist, sem wildcard) | **FECHADO por H4** — same-origin por padrão, `CORS_ALLOWED_ORIGINS` com matching exato, `Origin: null` sempre negada, CORS nunca substitui autenticação |
| Secrets fora do código | Presente — verificado nesta execução |
| Service account por finalidade nos conectores | Presente para Monday (token único, finalidade de leitura jurídica) |
| Menor privilégio nos conectores | Presente para Monday |
| Validação de upload | N/A — nenhum upload de arquivo implementado ainda |
| Exportação restrita e auditada | Presente para exportação de apresentações (`/api/presentations/export`, com `allowed()` e `audit()`) |
| Logs sem dado bancário completo | Sem dado bancário no fluxo atual — nada a mascarar hoje |
| IA sem permissão além da usuária | N/A — IA não implementada (ver `docs/AI_GOVERNANCE.md`) |
| Automação dentro de alçada | N/A — nenhuma automação crítica implementada |
| Revogação de sessão/usuário/credencial testada | **FECHADO por H2** — `logout`/`logout-all` revogam no servidor; troca/reset de senha e inativação invalidam sessão imediatamente (`docs/PRODUCTION_GATE.md`, seção 19) |
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

## Riscos identificados — Sprint 2, Fase 4A (documental; nenhuma integração implementada nesta rodada)

A Fase 4A (`docs/DECISIONS.md`, seção 1.2) homologou uma integração de **leitura apenas** com Google
Calendar (D4.1, Opção B — Patrono nunca escreve eventos no Calendar do usuário) e um campo de responsável
(`responsibleUserId`, D4.2/D4.3) em `legalDeadlines`. Nenhum dos dois foi implementado nesta rodada — os
riscos abaixo são levantados **preventivamente**, para orientar a Fase 4B, não porque algo já exista em
produção.

| Risco | Descrição | Mitigação proposta |
|---|---|---|
| Exposição do próprio conteúdo do Google Calendar do usuário | A visualização complementar (leitura) exibe compromissos pessoais do usuário dentro do Patrono | Consentimento OAuth explícito e por usuário; leitura restrita ao próprio usuário logado (mesmo princípio de `docs/PERMISSIONS.md`) — nunca uma sincronização "em nome do sistema" |
| Sincronização externa | Token/credencial de acesso de leitura ao Calendar do usuário é um novo segredo a proteger | Mesmo tratamento já exigido para o Monday (MASTER_HANDOFF §10, "Segredos de integração — P0 de implementação"): nunca no frontend, sempre server-side, escopo mínimo de leitura por usuário |
| Revogação de acesso | Usuário revoga o acesso do Patrono ao próprio Google Calendar | A visualização complementar simplesmente para de mostrar aqueles compromissos; como a Opção B não escreve nada no Calendar, não há evento espelhado para remover; o Legal Deadline no Patrono nunca é afetado (D4.1/D4.8) |
| Usuário desligado/desativado como responsável | Um responsável (`responsibleUserId`, D4.3 homologada) deixa a empresa ou é desativado | Histórico nunca é apagado; view sinaliza "Responsável inativo" até reatribuição formal (D4.11) — nunca reatribuição automática silenciosa |
| Cache/offline do Calendar | O app de calendário do usuário pode exibir localmente um compromisso desatualizado enquanto a leitura do Patrono está indisponível | Fallback já definido em D4.8: indisponibilidade da leitura nunca afeta o Legal Deadline no Patrono; a visualização complementar sinaliza `unavailable`/`stale`, nunca mostra zero |
| Exposição futura em Calendar (se uma Opção C vier a ser homologada) | Um evento espelhado por escrita revelaria conteúdo jurídico em um app de terceiros, fora do controle de acesso do Patrono | **Não aplicável ao piloto atual** (D4.1 homologou só a Opção B) — se uma decisão futura separada homologar a Opção C, a recomendação de título neutro (D4.7 — "Prazo jurídico — Patrono") deve ser revisitada e homologada antes de qualquer escrita externa |

**Nenhum destes riscos bloqueia a Fase 4A (documental, já homologada) nem qualquer P0/P1 do escopo já
entregue (Fases 1–3)** — são registrados para orientar o desenho de segurança da implementação funcional
da Fase 4B.

## Fase 4B — implementação e como cada risco acima foi tratado

- **Exposição do próprio conteúdo do Calendar / sincronização externa:** nesta rodada, a integração real
  não foi ativada — não há credenciais de OAuth (`GOOGLE_CALENDAR_CLIENT_ID`/`GOOGLE_CALENDAR_CLIENT_SECRET`)
  neste ambiente. Em vez de improvisar armazenamento de token ou simular compromissos, o risco fica
  estruturalmente eliminado por não haver nenhum token/segredo de Calendar no código: `GET
  /api/calendar/status` sempre devolve `not_configured` e `GET /api/calendar/events` sempre devolve
  `events: []` (verificado por teste HTTP: a resposta nunca contém as substrings `token`/`secret`).
  Reportado como **blocker técnico** para uma futura ativação real, não resolvido nem contornado
  nesta rodada.
- **Sem escrita externa:** confirmado por teste de código-fonte (`tests/core.test.js`) — nenhum método de
  escrita da API do Google Calendar existe em `server.js`.
- **Usuário desligado/desativado como responsável (D4.11):** implementado exatamente como previsto —
  `responsibleUserId` nunca é apagado; a view sinaliza `responsibleInactive: true` (testado em
  `tests/security-integration.test.js`).
- **Isolamento por usuário/identidade do Calendar:** como a leitura real não foi ativada, não há caminho
  de código que misture o Calendar de um usuário com o de outro (não existe nenhum estado de conexão
  persistido); quando a integração real for ativada, a mesma regra (D4.1: "compromissos pertencem à
  identidade do usuário conectado, nunca uma agenda corporativa global por alçada de negócio") permanece
  o requisito a ser validado antes de qualquer merge.
- **`responsibleUserId` não amplia autorização:** testado explicitamente (companyId/speId fora de
  escopo, TI, administrador técnico) em `tests/security-integration.test.js` — nenhum desses papéis ganha
  visibilidade adicional por ser (ou não) responsável por um Legal Deadline.

## Riscos residuais após o Sprint 2

Rodada de encerramento (`docs/DECISIONS.md`, D2-CLOSE) — consolidação, sem nova mitigação de código.
Separados em três categorias, para não misturar risco funcional do piloto com risco de produção:

### A. Riscos aceitos do piloto (não bloqueiam o encerramento do Sprint 2)

- Agenda Events manuais não entram em "Minha Semana" (gap de modelo, `store.agenda.owner` textual).
- `responsibleUserId` sem operação de "desatribuir" (não homologado).
- Cache/offline do Calendar do usuário (mitigado por D4.8 — indisponibilidade nunca afeta Legal Deadline).

### B. Bloqueios para produção (fora do escopo do Sprint 2, gate separado)

- Persistência `data/store.json` não é production-grade (migração PostgreSQL preparada, ADR-001, não
  executada).
- Gestão/revogação de sessão além do soft-delete de usuário (`deletedAt`) implementado nesta Fase 4B.
- Hardening HTTP/security headers amplo, rate limiting global, CSP completa, CSRF amplo.
- Incident response formal e retenção/legal hold.
- Vulnerabilidade conhecida de dependência `pptxgenjs`.

### C. Dependências externas (bloqueiam apenas a funcionalidade específica, não o Sprint 2)

- Google Calendar real: sem credenciais de OAuth do Google e sem mecanismo seguro de armazenamento de
  token por usuário neste ambiente — adapter e contrato read-only já testados; ativação real depende de
  provisionamento externo, não de trabalho de código adicional deste Sprint.

**Nenhum item das categorias B/C declara produção pronta.** Produção continua exigindo um gate técnico/de
negócio separado, com autorização própria.

## Gate de Produção

O gate técnico formal de produção — auditoria completa, achados classificados P0/P1/P2/P3, matriz
GO/NO-GO, plano de hardening (H1–H11) e decisão atual — está em `docs/PRODUCTION_GATE.md` (decisão
`PROD-GATE-01`, `docs/DECISIONS.md`). Estado atual: **NO-GO para produção**. Este documento não duplica
aquele conteúdo — apenas referencia.

**H1A (persistência PostgreSQL) implementado — aguardando homologação** (`docs/DECISIONS.md`,
PROD-H1-01): fecha PG-01/PG-02/PG-03 do gate. Segredos de conexão (`DATABASE_URL`) seguem a mesma
prática já auditada — server-side only, nunca expostos por `/api/health` ou qualquer outra rota (só
`persistence`/`databaseConfigured`/`databaseReachable`/`schemaReady`, nunca host/usuário/senha). Gate
como um todo permanece NO-GO.

**H1B (normalização relacional do núcleo canônico) implementado — aguardando homologação**
(`docs/DECISIONS.md`, PROD-H1B-01): `users`/`legalProcesses`/`legalDeadlines`/`audit` ganham tabela
própria com FK real (Legal Deadline → Legal Process/usuário responsável), sem alterar nenhum controle de
segurança já auditado — RBAC (`allowed()`/`allowedInDepartment()`/`allowedContent()`), segregação
departamental, `scoped()` (companyId/speId/department) e "administrador técnico ≠ superusuário de
conteúdo" permanecem exatamente como estavam, agora exercidos com os dados vindos das tabelas relacionais
em vez do blob JSONB — cobertos por testes de regressão dedicados
(`tests/h1b-core-relational.test.js`, itens U/V). FK usa `ON DELETE RESTRICT` (nunca cascade
destrutivo) — inativação continua sendo exclusivamente `deletedAt` (soft-delete), nunca remoção física.
`email` de `app_users` continua sem constraint de unicidade (gap preexistente, documentado e não fechado
por H1B — `docs/DECISIONS.md`, PROD-H1B-01, item 7). Gate como um todo permanece NO-GO.

**H2 (autenticação individual, MFA individual e sessões persistentes) implementado — aguardando
homologação** (`docs/DECISIONS.md`, PROD-H2-01; `docs/PRODUCTION_GATE.md`, seção 19): substitui
integralmente a senha global (`COEVO_DEMO_PASSWORD` comparada diretamente), o código MFA global
(`COEVO_MFA_CODE`) e a sessão em memória (`sessions = new Map()`) por senha individual (`crypto.scrypt`),
MFA individual (TOTP/RFC 6238, segredo cifrado em repouso, nunca ativo antes de confirmação) e sessão
persistida em `auth_sessions` (Postgres, token opaco cujo hash é o único valor gravado). Revogação real:
logout, logout-all, troca/reset de senha e inativação (`deletedAt`) invalidam sessão(ões) imediatamente,
sem depender do cliente descartar o token. Bloqueio por tentativas malsucedidas é por conta
(`failed_login_count`/`locked_until`) — não é o rate limiting global/por IP de H3, que continua em
aberto. Nenhum controle de autorização já auditado foi alterado: RBAC (`allowed()`/
`allowedInDepartment()`/`allowedContent()`), segregação departamental, `scoped()` e "administrador
técnico ≠ superusuário de conteúdo" permanecem exatamente como estavam — autenticação decide quem,
autorização continua decidindo o quê. Gate como um todo permanece NO-GO.

**Adendo ao H2 (revisão pós-PR #13)** (`docs/DECISIONS.md`, PROD-H2-01, adendo;
`docs/PRODUCTION_GATE.md`, seção 19): 5 blockers corrigidos antes do merge —
(1) **identidade de login única**: `email` nunca foi único (gap preexistente, PROD-H1B-01) — login
passa a resolver primariamente por `login_identifier` (novo, `UNIQUE NOT NULL`,
`migrations/006_h2_unique_login_identity.sql`); e-mail só é aceito quando resolve para exatamente um
usuário ativo, nunca escolhendo o primeiro registro em caso de ambiguidade (login ou
forgot-password);
(2) **primeiro acesso administrativo** (`POST /api/auth/users/:id/reset-token`): sem provedor de
e-mail integrado, um usuário recém-aprovado ganha um caminho real para definir a própria senha, via
token de uso único emitido por um operador com a mesma alçada de aprovação já auditada, devolvido em
texto puro uma única vez para entrega fora de banda;
(3) **`MFA_ENCRYPTION_KEY` validada no boot** em produção (antes só descoberta no primeiro uso real de
MFA);
(4) **anti-enumeração**: conta bloqueada deixa de responder `423` (revelava externamente que aquela
conta existe e está bloqueada) e passa a responder o mesmo `401` de qualquer outra falha de login;
(5) **TOTP verificado em teste automatizado** contra os vetores oficiais do RFC 6238. Nenhum controle
de autorização foi alterado. Gate como um todo permanece NO-GO.

**H3 (rate limiting global e proteção contra abuso distribuída) implementado — aguardando
homologação** (`docs/DECISIONS.md`, PROD-H3-01; `docs/PRODUCTION_GATE.md`, seção 20): fecha PG-10/PG-11.
Proteção distribuída via PostgreSQL (nova tabela `rate_limit_buckets`, migração aditiva
`007_h3_rate_limiting.sql`) contra força bruta/abuso por IP, por identidade resolvida antes de
autenticar, ou pela combinação dos dois — nunca um limitador em memória (`new Map()`), que perderia
estado a cada restart e não funcionaria com múltiplas instâncias. Camada isolada
(`auth/rate-limit.js`), deliberadamente fora da ponte relacional de H1B/H2 — acesso direto ao pool
Postgres, porque o incremento atômico por linha sob concorrência exige uma única instrução SQL, não uma
CAS de documento inteiro. `X-Forwarded-For` nunca confiado sem uma política explícita de proxy
confiável (`TRUST_PROXY_HOPS`); toda chave de bucket é derivada por HMAC-SHA256
(`RATE_LIMIT_HMAC_KEY`, mesmo padrão de `MFA_ENCRYPTION_KEY`) — nunca IP/e-mail/token em texto puro
persistido. Rotas protegidas: login, MFA verify, forgot-password, reset-password, reset-token
administrativo, MFA enroll/confirm/disable, change-password, logout-all, aprovação de cadastro.
Resposta 429 genérica, sem revelar contador/existência de conta/motivo interno. Complementar ao
bloqueio POR CONTA já fechado por H2 (`failed_login_count`/`locked_until`) — nenhuma das duas camadas
substitui a outra. Nenhum controle de autorização foi alterado. Gate como um todo permanece NO-GO.

**Adendo ao H3 (revisão técnica pós-PR #14)** (`docs/DECISIONS.md`, PROD-H3-01, adendo;
`docs/PRODUCTION_GATE.md`, seção 20): um blocker de segurança e duas lacunas corrigidos antes do merge —
(1) **`TRUST_PROXY_HOPS` calculava a posição errada da cadeia** (`chain.length - 1 - N`, deslocada um
salto): no cenário mais comum (1 proxy confiável) caía incorretamente no IP do próprio proxy, e com um
`X-Forwarded-For` pré-forjado pelo atacante antes de chegar ao proxy, selecionava a entrada forjada em
vez da real — reabrindo o bypass que esta proteção deveria impedir. O teste original partia da mesma
premissa errada, por isso o CI verde não pegava o bug. Corrigida para `chain.length - N`, com validação
adicional da entrada final via `node:net.isIP()`;
(2) **identidade de rate limit passa a ser canônica por `userId`**: `email` e `login_identifier` da
MESMA conta agora sempre alimentam o mesmo bucket de identidade/combinado — antes, alternar entre os
dois permitia até dobrar o teto de tentativas de login;
(3) **auditoria `RATE_LIMIT_TRIGGERED` implementada** (pendente desde a decisão original): registrada só
na transição exata em que um bucket passa a bloquear (deduplicada pelo próprio contador atômico), nunca
com dado bruto sensível, e uma falha ao gravá-la nunca impede o bloqueio. Gate como um todo permanece
NO-GO.

**Segundo adendo ao H3 (revisão técnica, 3ª rodada do PR #14)** (`docs/DECISIONS.md`, PROD-H3-01, 2º
adendo): um P1 corrigido antes do merge — **`RATE_LIMIT_TRIGGERED` atribuía o ALVO da tentativa como se
fosse o autor**. Em `login`/`forgot-password`, quando o e-mail/`login_identifier` apresentado resolvia
para uma conta real (usada só para computar a chave canônica do bucket), essa conta virava
`responsible` no evento — atribuindo a uma conta potencialmente sob ataque a autoria da própria
tentativa contra ela mesma. Corrigido: `RATE_LIMIT_TRIGGERED` NUNCA atribui o usuário-alvo como ator em
rotas públicas/não autenticadas (login, MFA verify, forgot-password, reset-password) — o ator
permanece anônimo nesses casos, mesmo quando a identidade é resolvida para fins de bucket canônico.
Ator identificado (`responsible` = o próprio usuário) só é usado em rotas que já passaram por
autenticação de sessão válida (change-password, logout-all, admin-reset-token, MFA enroll/confirm/
disable, aprovação de cadastro), onde o autor é genuinamente conhecido. Nenhum dado sensível adicional
foi registrado para compensar. Gate como um todo permanece NO-GO.

**H4 (HTTP security headers e política explícita de CORS) implementado — aguardando homologação**
(`docs/DECISIONS.md`, PROD-H4-01; `docs/PRODUCTION_GATE.md`, seção 21): fecha PG-12/PG-13. Camada
centralizada (`applySecurityHeaders()`/`handlePreflight()`, `server.js`) aplicada a TODA resposta —
estática, preflight ou `/api/*` — via `res.setHeader()`, mesclado automaticamente com os headers de
`json()`/`rateLimited()`/`staticFile()`. CSP construída a partir de uma auditoria real do frontend
(nunca `default-src */script-src *`): `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`,
`frame-ancestors 'none'`, `img-src`/`font-src`/`connect-src 'self'` (Google Calendar/Monday são
chamados só server-side, nunca pelo navegador). `script-src`/`style-src` precisam de `'unsafe-inline'`
por dois motivos independentes e documentados no código: manipuladores de evento inline em
`public/app.js` (`onclick=`/etc., ~28 pontos de `innerHTML` — refactor para `addEventListener()` fora
do escopo desta rodada) e 5 barras de progresso com largura calculada em tempo de render; os demais
usos ESTÁTICOS de estilo/script inline foram eliminados nesta rodada (`public/status.html` extraído
para arquivos externos; `.btn-block` substituindo `style="width:100%..."` em `public/app.js`).
Clickjacking mitigado em dupla camada (CSP `frame-ancestors 'none'` + `X-Frame-Options: DENY`). HSTS só
em produção (`max-age=31536000`, sem `includeSubDomains`/`preload` por falta de decisão formal sobre
subdomínios). Referrer-Policy `strict-origin-when-cross-origin`; Permissions-Policy nega todo recurso
de navegador não usado pelo Patrono. `Cache-Control: no-store` em toda resposta de API.
CORS same-origin por padrão, com allowlist explícita (`CORS_ALLOWED_ORIGINS`) — nunca wildcard, nunca
reflete a Origin recebida, comparação sempre por igualdade EXATA de origem (nunca substring/`endsWith`
— nega explicitamente um ataque de sufixo de domínio), `Origin: null` sempre negada. CORS nunca
substitui autenticação. PG-14 (CSRF) permanece explicitamente NÃO fechado por esta rodada — continua
P2, condicional a uma futura migração de Bearer token para cookie (não realizada). Gate como um todo
permanece NO-GO.

**Correção pós-H4 — normalização da allowlist CORS** (mesma decisão PROD-H4-01): a configuração
`CORS_ALLOWED_ORIGINS` passa agora pela MESMA normalização aplicada à Origin recebida, via um único
helper `normalizeCorsOrigin()` (nunca duas semânticas de comparação divergentes). Trata barra final,
caixa do host e porta padrão do esquema como equivalentes à origem canônica (via `URL.origin` nativo);
rejeita por inteiro — fail-closed, nunca trunca silenciosamente — qualquer entrada com path/query/hash
ou esquema diferente de `http:`/`https:`. Em produção, uma entrada malformada em `CORS_ALLOWED_ORIGINS`
interrompe o boot explicitamente (`validateAuthRuntimeConfig()`); fora de produção é apenas descartada.
Não altera PG-12/PG-13/PG-14, não reabre H3, não expande o escopo de H4.

**H5 (Backup/Restore production-grade do PostgreSQL) implementado PARCIALMENTE — PG-21 permanece
aberto** (`docs/DECISIONS.md`, PROD-H5-01; `docs/PRODUCTION_GATE.md`, seção 22;
`docs/BACKUP_RESTORE_RUNBOOK.md`): backup real via `pg_dump -Fc` (`scripts/backup-postgres.js`,
`npm run backup:postgres`), nunca dependente apenas do endpoint HTTP legado; manifesto com integridade
(SHA-256), ambiente de origem, versão do PostgreSQL/migration/commit da aplicação; criptografia
application-side OPCIONAL (AES-256-GCM, `BACKUP_ENCRYPTION_KEY`, independente de `COEVO_BACKUP_KEY`,
com `encryptionKeyId` lógico — nunca a chave — preparando rotação futura). Storage adapter abstrato:
`filesystem` só fora de produção (fail-fast se tentado em produção), `s3` (S3-compatible, via
`@aws-sdk/client-s3`) único aceito em produção — nenhum bucket real foi criado nesta rodada (proibido
pelo escopo). RPO=6h/RTO=4h definidos e comprovados por restore real (`tests/h5-backup-restore-postgres.test.js`,
18 testes, `pg_dump`/`pg_restore` reais contra PostgreSQL real, nunca mock). Restore
(`scripts/restore-postgres.js`, `npm run restore:postgres`) nunca assume banco "atual" implicitamente;
verifica integridade (tamanho+SHA-256) ANTES de tocar o banco; bloqueia cross-environment restore por
padrão (override explícito `RESTORE_ALLOW_CROSS_ENVIRONMENT=I_ACCEPT_THE_RISK`); exige confirmação forte
para produção (`RESTORE_CONFIRM_PRODUCTION=YES_I_UNDERSTAND`); nunca sobrescreve banco populado sem
`RESTORE_REPLACE=YES_REPLACE_TARGET_DATA` explícito; após restore bem-sucedido, revoga (trunca)
`auth_sessions`/`auth_challenges`/`password_reset_tokens`/`rate_limit_buckets` no destino — dados
efêmeros nunca restaurados cegamente, decisão de segurança deliberada (reautenticar é mais seguro que
ressuscitar estado potencialmente comprometido). Evidência operacional durável em `backup_runs`/
`restore_runs` (migration 008), nunca segredo. Mensagens de erro sanitizadas (`backup/sanitize.js`)
antes de log/persistência — `pg_dump`/`pg_restore` podem incluir a connection string no erro.
**PG-21 permanece explicitamente ABERTO**: a arquitetura e o restore real estão comprovados, mas o
adapter `s3` nunca foi exercitado contra um bucket real (só testado com cliente S3 injetado) — sem
infraestrutura provisionada nesta rodada. Gate como um todo permanece NO-GO.
