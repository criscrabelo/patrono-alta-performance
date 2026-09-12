# SECURITY.md — Segurança

> Regras oficiais: `docs/MASTER_HANDOFF.md` §11, §26 (P0), §31 (Checklist Segurança), §33 (Go-Live Gate).
> Histórico detalhado de correções anteriores a esta execução: `docs/SEGURANCA-CORRECOES.md` (mantido
> como registro histórico, não reescrito).

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
