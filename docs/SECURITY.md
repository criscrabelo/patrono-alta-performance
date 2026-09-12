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
| `/api/monday/status` | GET | `juridico`/`read` | — | **Corrigido (rodada 3):** antes do gate de sessão; agora autenticado + módulo, payload reduzido (sem `boards`) |
| `/api/monday/schedule` | GET | `juridico`/`read` | — | **Corrigido (rodada 3):** idem; `lastRuns` sem `requestedBy`/`error` |
| `/api/me` | GET | Nenhum além de autenticado | Próprio usuário | Retorna apenas os dados do próprio usuário autenticado |
| `/api/projects` | GET | `projetos`/`read` | `scoped()` por projeto (filtro) | Presente desde a rodada 1 |
| `/api/projects/:id` | GET | `projetos`/`read` | `scoped()` por projeto | Presente |
| `/api/projects/:id/governance` | PATCH | `projetos`/`update` | `scoped()` por projeto | Presente; campos de governança validados contra `store.users` |
| `/api/projects/:id/target` | PUT | `projectPermissions().changeTarget` | `scoped()` por projeto | **Corrigido (rodada 3, item 5):** faltava `scoped()` — só existência do projeto era checada |
| `/api/projects/:id/approval-rules` | PUT | `projectPermissions().changeApprovalRule` | `scoped()` por projeto | **Corrigido (rodada 3)** |
| `/api/projects/:id/recovery-settings` | PUT | `projectPermissions().changeApprovalRule` | `scoped()` por projeto | **Corrigido (rodada 3):** rota nem buscava o projeto antes, só a configuração por `projectId` |
| `/api/projects/:id/(actions\|milestones\|risks\|internalizations\|negotiations\|legal-treatments\|management-items)` | POST | `projectPermissions().edit` | `scoped()` por projeto | Presente |
| `.../:itemId` | PATCH | `.edit` (+ `.internalizeProcess` para internalizations) | `scoped()` por projeto + item | Presente; campos protegidos (`id`,`projectId`,`createdAt`,`createdBy`,`deletedAt`,`deletedBy`) removidos do input |
| `.../:itemId` | DELETE | `.archive` | `scoped()` por projeto | **Corrigido (rodada 3):** faltava buscar/validar o projeto — só o item era checado |
| `.../:itemId/restore` | POST | `.restore` | `scoped()` por projeto | **Corrigido (rodada 3)** |
| `management-items/:itemId/(approve\|reject\|escalate)` | POST | `.approveAgreement` (exceto escalate) | `scoped()` por projeto | **Corrigido (rodada 3)** |
| `/api/dashboards` | GET | `allowed(user, definition.module)` por item | Filtro ad hoc por `departmentId` | Presente (lógica própria, não `scoped()`) |
| `/api/dashboards/:id` | GET | `allowed(user, definition.module)` | Filtro ad hoc por `departmentId` | Presente |
| `/api/dashboard-preferences/:id` | GET/PUT | Nenhum além de autenticado | Chaveado por `userId` (preferência própria) | Presente — não há registro cross-user possível |
| `/api/monday/test` | POST | `juridico`/`read` | — | Presente |
| `/api/legal/:module` | GET | `juridico`/`read` | `LEGAL_MODULES` allowlist + `scoped()` por registro | **Corrigido (rodada 2):** allowlist fechada evita indexar `collection()` com valor cru da URL |
| `/api/monday/sync` | POST | `juridico`/`create` | — | Presente; preserva último valor válido em falha |
| `/api/auth/requests` | GET | `*`/`approve` | — | Presente (só diretoria/administrador) |
| `/api/auth/requests/:id/approve` | POST | `*`/`approve` | — | Presente |
| `/api/dashboard` | GET | `central`/`read` | Filtro departamental (`visibleDepartments`) + agenda `scoped()` | **Corrigido (rodada 3, item 6):** antes devolvia `store.departments`/`store.agenda` inteiros a qualquer papel com módulo `central` (todos) |
| `/api/audit` | GET | `*`/`read` | — | Presente (só diretoria/administrador) |
| `/api/compliance` | GET | `*`/`read` | — | **Corrigido (rodada 3, item 5):** não tinha NENHUM gate antes |
| `/api/compliance` | POST | `*`/`create` | — | **Corrigido (rodada 3):** sem gate antes; mass assignment de `id` corrigido |
| `/api/agenda` | GET | Nenhum módulo específico | `scoped()` por registro | **Corrigido (rodada 3, item 5):** vazava agenda de todos os departamentos |
| `/api/agenda` | POST | `agenda`/`create` | `department` forçado ao do usuário (não-global) | **Corrigido (rodada 3):** mass assignment de `id`/`department` corrigido |
| `/api/departments` | GET | Nenhum módulo específico | Filtro departamental (`visibleDepartments`) | **Corrigido (rodada 3, item 5):** vazava orçamento de todos os departamentos |
| `/api/committees` | GET | `comites`/`read` | — | **Corrigido (rodada 3, item 5):** sem gate antes — colaborador (sem módulo `comites`) conseguia ler |
| `/api/committees` | POST | `comites`/`create` | — | Mass assignment de `id`/`createdBy`/`createdAt` corrigido (rodada 3) |
| `/api/presentations/validate` \| `/export` | POST | `comites`/`export` | — | Presente; export audita e bloqueia combinação Diretoria+Compartilhável |
| `/api/entities/:type` | GET | `entityModule(type)` + `allowed(...,'read')` | `scoped()` por registro | Presente (rodada 1) |
| `/api/entities/:type` | POST | idem (`'create'`) | `scoped()` no processo relacionado (Legal Deadline) | **Corrigido (rodada 2/3):** sanitização de campos protegidos e de escopo; bloqueado para tipos Monday-sourced (`rejectIfMondaySourced`); Legal Deadline valida processo (existência + fonte `monday` + escopo) |
| `/api/entities/:type/:id` | PATCH | idem (`'update'`) | `scoped()` por registro | **Corrigido (rodada 3):** revalida invariantes de Legal Deadline sobre o estado candidato; bloqueado para tipos Monday-sourced |
| `/api/entities/:type/:id` | DELETE | idem (`'archive'`) | `scoped()` por registro | Bloqueado para tipos Monday-sourced (rodada 3) |
| `/api/entities/:type/:id/restore` | POST | idem (`'restore'`) | `scoped()` por registro | Bloqueado para tipos Monday-sourced (rodada 3) |
| `/api/budgets/import/preview` | POST | Nenhum | N/A | Só faz parsing/validação do CSV enviado pelo próprio requisitante; não persiste nem lê dado de terceiros |
| `/api/budgets/import/commit` | POST | `orcamento`/`create` | — | Presente; checksum + deduplicação |
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
