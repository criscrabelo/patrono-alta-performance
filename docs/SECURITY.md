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

## P0 corrigidos nesta execução

| # | Item | Antes | Depois |
|---|---|---|---|
| 1 | `GET /api/entities/:type` sem verificação de módulo (item B de `docs/SEGURANCA-CORRECOES.md`) | Qualquer usuário autenticado lia qualquer coleção trocando `:type` na URL | Exige `entityModule(type)` mapeado + `allowed(user, module, 'read')` |
| 2 | `GET /api/legal/:module` sem verificação de módulo (item H) | Mesma classe de problema nas rotas jurídicas | Exige `allowed(user, 'juridico', 'read')` |
| 3 | Restauração de entidade sem checagem de escopo do registro | `POST /api/entities/:type/:id/restore` verificava módulo mas não `scoped(user, item)` | Passa a exigir também escopo do registro |
| 4 | `requireMfa()` dependia da flag `mfa` do próprio cadastro (item D) | Um papel privilegiado com `mfa: false` recebia token sem segundo fator | MFA exigido pelo papel, independentemente da flag do cadastro |
| 5 | `ENTITY_MODULE_MAP['__proto__']` resolvia para o protótipo do objeto em vez de `undefined` | Chave `__proto__` na URL poderia, em tese, produzir um valor truthy inesperado | Mapa criado com `Object.create(null)`; `entityModule()` valida `typeof type === 'string'` |

Todos cobertos por teste de regressão em `tests/core.test.js`.

## P0 conhecidos e ainda abertos (herdados, não corrigidos nesta execução)

Ver `docs/SEGURANCA-CORRECOES.md` para o detalhamento completo de cada item. Resumo do que permanece em
aberto após esta execução:

| Item | Severidade | Situação |
|---|---|---|
| Persistência em `data/store.json` sem transação/concorrência real | Crítico | Aberto — ver ADR-001 em `docs/DECISIONS.md` |
| Senha global (`COEVO_DEMO_PASSWORD`), sem senha individual por usuário | Alto | Aberto — ver ADR-002 |
| Código MFA global (`COEVO_MFA_CODE`), sem segundo fator por usuário/dispositivo | Alto | Aberto — ver ADR-002 |
| Duas vulnerabilidades de alta severidade em `image-size` (dependência transitiva de `pptxgenjs`) | Alto | Aberto — exige upgrade major, requer revalidação de exportação PPTX/PDF |
| E-mail duplicado entre `usr-diretoria`/`usr-juridico` | Médio | Aberto — aceito anteriormente pela gestão, é alteração de cadastro fora do escopo autorizado |
| Ausência de rate limiting, limite de corpo, CSRF, CSP e cabeçalhos de segurança adicionais | Alto | Aberto |
| Auditoria no mesmo arquivo mutável dos dados, sem append-only nem assinatura | Médio | Aberto |
| Cópias do acervo fora do repositório (backups locais, OneDrive) | Alto (operacional) | Fora do escopo de código — ação operacional da gestão, já documentada em `docs/SEGURANCA-CORRECOES.md` |

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
