# 01 — Resumo executivo

> Fotografia do repositório em 09/08/2026 (America/Sao_Paulo). O nome presente no código e na interface é **COEVO Alta Performance**. Referências a “Patrono Alta Performance” nos pedidos anteriores são nomenclatura legada.

## Objetivo atual

A aplicação é um núcleo corporativo multidepartamental, com Jurídico e Tecnologia como pilotos. Consolida dados do Monday, orçamento departamental, dashboards, filtros jurídicos, governança de acesso, auditoria e um projeto estratégico de recuperação de crédito.

## Stack real

- Node.js 20+, CommonJS e servidor HTTP nativo em `server.js`.
- Frontend SPA sem framework, em HTML, CSS e JavaScript puro.
- Persistência operacional em `data/store.json` (arquivo ignorado pelo Git).
- Cliente PostgreSQL `pg` e duas migrations SQL preparadas, mas o runtime não usa PostgreSQL para as APIs.
- Integração Monday via GraphQL/`fetch`.
- `pptxgenjs` e `pdfkit` para exportação de apresentações.
- Testes com `node:test`: 24 testes no snapshot.

## Estágio

**Homologação local funcional.** Processos, notificações, distratos, honorários, unidades, compra e venda e transferência intermediada possuem dados sincronizados. Autenticação, MFA, RBAC, auditoria e backup são implementações de homologação, não prontas para produção.

## Módulos mais maduros

- Processos Judiciais: filtragem server-side, paginação, ordenação, chips e query string.
- Honorários Extrajudiciais: filtros, totalização mensal/trimestral/semestral e normalização em leitura.
- Honorários Judiciais: derivação do campo `HONORÁRIOS EFETIVADOS` dos processos.
- Dashboard Jurídico: filtros de competência/período e indicadores derivados do Monday.
- Orçamento departamental: Jurídico e TI separados.
- Projetos: portfólio e projeto “Aumento da Recuperação de Crédito” com modelo persistido.

## Integrações

- Monday: ativa, leitura e sincronização local; 14 execuções registradas.
- PostgreSQL: cliente e migrations preparados; não conectado ao fluxo das APIs.
- Sienge, CV, Clicksign, e-mail e OpenAI: não integrados. Alguns campos oriundos do Monday citam esses sistemas, o que não equivale a integração.

## Riscos principais

1. **Crítico:** persistência em arquivo JSON sem controle de concorrência/transação.
2. **Crítico:** autenticação compartilhada de demonstração, sessões em memória e bypass por `usr-*` fora de produção.
3. **Alto:** migração PostgreSQL 002 não é executada pelo script `npm run migrate`.
4. **Alto:** duas vulnerabilidades de alta severidade em dependências de `pptxgenjs`/`image-size`.
5. **Alto:** APIs genéricas aceitam tipos dinâmicos e carecem de validação de schema.
6. **Alto:** ausência de rate limiting, cookies seguros, CSRF, CSP e logs estruturados.

## Pendências principais

- Adotar banco oficial e repositórios transacionais.
- Implementar autenticação individual, hash forte de senha, MFA real e revogação.
- Integrar Sienge e criar conciliação financeira.
- Popular os casos, negociações, metas e riscos de recuperação.
- Transformar placeholders (IA, documentos, lixeira, riscos, estratégia e parte de TI) em módulos reais.
- Ampliar testes para integração, segurança, acessibilidade e concorrência.

