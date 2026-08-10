# 03 — Mapa de rotas

## Roteamento da SPA

Todas as telas usam fisicamente `GET /`. O estado é determinado por `state.screen`, `state.legalModule` e query parameters. Portanto, os paths abaixo são rotas conceituais, não URLs independentes.

| Tela/estado | Seleção | Permissão de menu | Status |
|---|---|---|---|
| Login/MFA/Cadastro | não autenticado | pública | Parcial/homologação |
| Painel Executivo COEVO | `executivo` | `central` | Pronto com dados parciais |
| Alertas & Pendências | `alertas` | `central` | Parcial |
| Painel Executivo Jurídico | `juridico` sem módulo | `juridico` | Pronto/parcial |
| Processos Judiciais | `juridico` + `processos` | `juridico` | Pronto |
| Honorários Extrajudiciais | `juridico` + `honorarios` | `juridico` | Pronto |
| Honorários Judiciais | `juridico` + `honorarios-judiciais` | `juridico` | Pronto/parcial |
| Notificações, distratos, compra/venda, transferências | submódulos Jurídico | `juridico` | Parcial, tabela genérica |
| Contratos, administrativos, retomadas, riscos regulatórios, fatos | submódulos Jurídico | `juridico` | Placeholder/sem fonte própria |
| Painel Executivo TI | `ti` | `ti` | Parcial |
| Submódulos TI | `ti-*` | conforme ID | Placeholder |
| Engenharia/Obras | `engenharia` | `central` | Integração pendente |
| Estratégia & Metas | `estrategia` | `estrategia` | Widgets pendentes |
| Projetos | `projetos` | `projetos` | Pronto para um projeto |
| Projeto Recuperação | `?project=prj-aumento-recuperacao-credito` | `projetos` | Parcial/estruturado |
| Orçamento | `orcamento` | `orcamento` | Pronto com fontes distintas |
| Comitês & Reuniões | `comites` | `comites` | Parcial |
| Agenda | `agenda` | `agenda` | Parcial |
| Calculadora | `calculadora` | `agenda` | Pronto/utilitário |
| IA & Inteligência | `ia` | `central` | Informativo |
| Têmis / Ivo | `temis` / `ivo` | `juridico` | Placeholder; sem IA |
| Auditoria/Usuários | `auditoria` / `usuarios` | `*` | Parcial |
| Integrações | `integracoes` | `*` | Status Monday |
| Logs | `logs` | `*` | Pronto, últimos 100 |
| Riscos | `riscos` | `central` | Widgets pendentes |
| Documentos/Lixeira/Inconsistências/Config./Backup | respectivos IDs | variável | Placeholder ou API sem UI completa |
| Status técnico | `GET /status` | pública | Pronto |

## Query parameters utilizados

- Processos: `processos=1`, `search`, `status`, `enterprise`, `responsible`, `scope`, `year`, `type`, `month`, `party`, `page`, `pageSize`, `sort`, `direction`.
- Honorários extrajudiciais: `honorarios=1` e os filtros anteriores aplicáveis, mais `competence`, `paymentMethod`, `unit`, `summaryMode`.
- Honorários judiciais: `honorariosJudiciais=1`, `summaryMode`.
- Dashboard Jurídico: `dashboard=juridico`, `competence`, `period`, `compare`, `compareCompetence`, `months`.
- Projeto: `project=<id>`.

## Rotas estáticas reais

| Método | Path | Status |
|---|---|---|
| GET | `/` | SPA |
| GET | `/status` | Página técnica |
| GET | `/app.js`, CSS e widgets listados em `server.js` | Ativos |
| GET | `/assets/*` e `/logo-coevo*.png` | Ativos; validação de caminho limitada |

O mapa completo de APIs está em `05-APIS-E-ENDPOINTS.md`.

