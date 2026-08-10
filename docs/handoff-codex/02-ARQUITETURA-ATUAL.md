# 02 — Arquitetura atual

## Visão geral

A aplicação é um monólito Node.js pequeno. `server.js` entrega os arquivos estáticos, implementa autenticação, integração Monday, regras, APIs e persistência. O frontend é uma SPA manual em `public/app.js`.

```text
Monday.com                         Planilha / cadastro local
    |                                       |
    +-- GraphQL, sincronização 3x/dia ----+
                         |
                         v
                data/store.json
              (persistência real atual)
                         |
                         v
            server.js / APIs HTTP JSON
                         |
                         v
           public/app.js + CSS + widgets
```

O fluxo solicitado “Fontes → normalização → MongoDB → API → frontend” **não existe**. Também não existe ORM/ODM. Há apenas uma preparação paralela para PostgreSQL:

```text
migrations/*.sql -> database.js/pg -> PostgreSQL
```

Essa preparação ainda não está ligada a `readStore`/`writeStore` nem aos handlers.

## Frontend

- Entrada: `public/index.html`.
- Estado global: objeto `state` em `public/app.js`.
- Renderização: template strings e substituição de `#app`.
- Roteamento: `state.screen`, `state.legalModule` e query parameters; não há roteador.
- Componentes reutilizáveis: `public/dashboard-widgets.js` e funções de template no próprio `app.js`.
- Estilos: `styles.css`, `sidebar.css`, `dashboard.css`, `processes.css`, `projects.css` e `dashboard-widgets.css`.
- Cache: nenhum cache de dados; somente preferência de sidebar no `localStorage` e estado em memória.

## Backend

- Um `http.createServer` com handler sequencial.
- JSON via `application/json`; sem framework, middleware ou validação declarativa.
- Alias `/api/v1/*` reescreve internamente para `/api/*`; não há versionamento real.
- `readStore()` relê o JSON por requisição; `writeStore()` sobrescreve todo o arquivo.
- `project-service.js` concentra seed, relacionamentos e payload do projeto de recuperação.
- `dashboard-model.js` define catálogo de dashboards/widgets.
- `dashboard-service.js` calcula payloads e memória de cálculo.

## Estrutura relevante

```text
/
|-- server.js                    API, autenticação, Monday e arquivos estáticos
|-- project-service.js           modelo local de Projetos/Recuperação
|-- dashboard-model.js           definições de dashboards
|-- dashboard-service.js         agregadores e estados de widgets
|-- database.js                  cliente PostgreSQL ainda desacoplado
|-- presentation-export.js       PPTX/PDF
|-- public/                       SPA e estilos
|-- data/store.json              banco real atual; ignorado pelo Git
|-- migrations/                  SQL 001 e 002
|-- scripts/migrate.js           executa somente 001
|-- tests/core.test.js           testes unitários/estruturais
`-- docs/                        documentação anterior e este handoff
```

## Jobs e sincronização

- `setInterval` a cada 60 segundos verifica se o horário atual coincide com `MONDAY_SYNC_TIMES`.
- Padrão: 08:00, 13:00 e 18:00, fuso `America/Sao_Paulo`.
- Deduplica por data + horário no histórico `mondayRuns`.
- Cada quadro é paginado em blocos de 200 itens.
- Upsert por `source === monday` + `externalId`; registros ausentes na origem não são removidos.

## Autenticação

- Login e MFA compartilham segredos de ambiente de homologação.
- Sessões ficam em um `Map` do processo e se perdem no reinício.
- Cliente envia bearer token em `Authorization`.
- Em ambiente não produtivo, bearer `usr-*` funciona como bypass de desenvolvimento.

## Variáveis de ambiente

Somente nomes, sem valores:

- `PORT`, `NODE_ENV`
- `COEVO_DEMO_PASSWORD`, `COEVO_MFA_CODE`, `COEVO_SESSION_MS`, `COEVO_BACKUP_KEY`
- `DATABASE_URL`, `DATABASE_SSL`
- `MONDAY_TOKEN`, `MONDAY_SYNC_TIMES`
- `MONDAY_BOARD_PROCESSOS`, `MONDAY_BOARD_NOTIFICACOES`, `MONDAY_BOARD_DISTRATOS`
- `MONDAY_BOARD_HONORARIOS`, `MONDAY_BOARD_UNIDADES`, `MONDAY_BOARD_COMPRA_VENDA`
- `MONDAY_BOARD_TRANSFERENCIA_INTERMEDIARIA`

## Decisões importantes

- Preservar payload original do Monday em `columns` e `columnsByTitle`.
- Normalizar processos/honorários na camada de leitura, sem reescrever histórico.
- Exibir estados `ready`, `empty` e `integration_pending` para evitar indicadores fictícios.
- Usar soft delete para entidades internas.
- Centralizar políticas de recuperação em dados configuráveis.

