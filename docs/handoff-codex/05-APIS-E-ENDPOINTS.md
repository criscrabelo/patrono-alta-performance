# 05 — APIs e endpoints

Todas as rotas `/api/*`, exceto autenticação, health e status Monday, exigem bearer token. `/api/v1/*` é apenas alias para `/api/*`.

## Autenticação e sistema

| Método | Endpoint | Propósito | Permissão/status |
|---|---|---|---|
| POST | `/api/auth/login` | Valida e-mail + senha de demonstração; cria challenge | Público; homologação |
| POST | `/api/auth/mfa` | Valida challenge + código global; devolve token | Público; homologação |
| POST | `/api/auth/register` | Cria solicitação de cadastro | Público; parcial |
| GET | `/api/health` | Saúde, persistência e flag de banco | Público |
| GET | `/api/me` | Usuário e política RBAC | Autenticado |
| GET | `/api/auth/requests` | Solicitações de acesso | Ação `approve` |
| POST | `/api/auth/requests/:id/approve` | Aprova e cria usuário | Ação `approve` |

## Monday e integrações

| Método | Endpoint | Parâmetros/corpo | Dados/status |
|---|---|---|---|
| GET | `/api/monday/status` | nenhum | Flag e catálogo de quadros; público |
| GET | `/api/monday/schedule` | nenhum | Horários e últimas 10 execuções; público |
| POST | `/api/monday/test` | nenhum | Testa conta; `juridico:read` |
| POST | `/api/monday/sync` | `{modules?: string[]}` | Sincroniza quadros; `juridico:create` |

## Dados jurídicos

| Método | Endpoint | Filtros | Resposta/status |
|---|---|---|---|
| GET | `/api/legal/:module` | nenhum | Todos os ativos Monday no escopo |
| GET | `/api/legal/processos?paginated=1` | `search`, status, empreendimento, responsável, escopo, ano, tipo, mês, polo, página e ordenação | `records`, `count`, `totalAvailable`, `pagination`, `facets` |
| GET | `/api/legal/honorarios?paginated=1` | busca, status, empreendimento, responsável, ano, tipo, mês, competência, pagamento, unidade, página e ordenação | Registros normalizados, facets e resumo financeiro |
| GET | `/api/legal/honorariosJudiciais` | nenhum | Processos com `HONORÁRIOS EFETIVADOS`, totais por período |

`:module` aceita dinamicamente o nome da coleção. Não existe allowlist server-side nessa rota.

## Dashboards

| Método | Endpoint | Propósito |
|---|---|---|
| GET | `/api/dashboard` | Métricas, departamentos, financeiro e agenda |
| GET | `/api/dashboards` | Catálogo permitido ao perfil |
| GET | `/api/dashboards/:id` | Payload de widgets; query `competence`, `period` |
| GET | `/api/dashboard-preferences/:id` | Preferência do usuário |
| PUT | `/api/dashboard-preferences/:id` | Ordem, ocultos e densidade; auditado |

## Projetos

| Método | Endpoint | Permissão/coleções |
|---|---|---|
| GET | `/api/projects` | `projetos:read`; `projects` e relações |
| GET | `/api/projects/:id` | `projetos:read`; payload completo |
| PATCH | `/api/projects/:id/governance` | `projetos:update`; owner, manager, sponsor e coowners |
| PUT | `/api/projects/:id/target` | capability `changeTarget`; `projectTargets` |
| PUT | `/api/projects/:id/approval-rules` | capability `changeApprovalRule` |
| PUT | `/api/projects/:id/recovery-settings` | capability `changeApprovalRule` |
| POST | `/api/projects/:id/:resource` | Cria action, milestone, risk, internalization, negotiation, legal-treatment ou management-item |
| PATCH | `/api/projects/:id/:resource/:itemId` | Atualiza e audita |
| DELETE | `/api/projects/:id/:resource/:itemId` | Soft delete; capability `archive` |
| POST | `/api/projects/:id/:resource/:itemId/restore` | Restaura; capability `restore` |
| POST | `/api/projects/:id/management-items/:itemId/:decision` | `approve`, `reject` ou `escalate` |

## Agenda, comitês, compliance e apresentações

| Método | Endpoint | Status |
|---|---|---|
| GET/POST | `/api/agenda` | Leitura/criação; sem update/delete dedicado |
| GET/POST | `/api/committees` | Listagem/criação de rascunho |
| GET/POST | `/api/compliance` | Listagem/criação |
| POST | `/api/presentations/validate` | Valida combinação de público/classificação |
| POST | `/api/presentations/export` | Gera PPTX e PDF em `data/exports` |

## CRUD genérico

| Método | Endpoint | Observação |
|---|---|---|
| GET | `/api/entities/:type` | Lista ativos no escopo |
| POST | `/api/entities/:type` | Cria com versão 1 |
| PATCH | `/api/entities/:type/:id` | Atualiza e incrementa versão |
| DELETE | `/api/entities/:type/:id` | Soft delete |
| POST | `/api/entities/:type/:id/restore` | Restaura |

Risco: `:type` é dinâmico, e a segurança depende de o nome coincidir com os módulos permitidos pelo perfil.

## Orçamento, auditoria e backup

| Método | Endpoint | Status |
|---|---|---|
| GET | `/api/departments` | Departamentos completos, inclusive budget embutido |
| POST | `/api/budgets/import/preview` | Parse CSV sem persistir |
| POST | `/api/budgets/import/commit` | Valida, deduplica por checksum e persiste batch |
| GET | `/api/audit` | Últimos 100 eventos; requer módulo `*` |
| POST | `/api/backup` | Backup AES-256-GCM; requer `approve` e chave |
| POST | `/api/backup/restore` | Restaura store inteiro; requer `approve` |

## Limitações transversais

- Sem OpenAPI/Swagger, schemas de entrada, tamanho máximo de body, rate limit ou idempotency keys gerais.
- Erros são mensagens JSON simples.
- A maioria das respostas não usa DTOs formais.
- As rotas persistem sobrescrevendo o arquivo completo.

