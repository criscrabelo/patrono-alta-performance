# 07 — Integrações

## Monday.com

| Item | Estado real |
|---|---|
| Ativa | Sim, quando `MONDAY_TOKEN` está configurado |
| Homologada | Funcional no ambiente local; sem evidência de homologação produtiva formal |
| Direção | Somente leitura na origem; escrita apenas no store local |
| Credencial | `MONDAY_TOKEN` em `.env`, ignorado pelo Git |
| API | GraphQL `https://api.monday.com/v2`, versão `2024-10` |
| Periodicidade | 08:00, 13:00 e 18:00 por padrão, configurável |
| Paginação | 200 itens por chamada até cursor nulo |
| Upsert | `source + externalId` |
| Histórico | `mondayRuns`; 14 execuções no snapshot |

### Quadros e destinos

| Quadro | Coleção local | Ativos |
|---|---|---:|
| Processos Judiciais | `records.processos` | 273 |
| Notificações Clientes | `records.notificacoes` | 1.074 |
| Distratos e Retomadas | `records.distratos` | 38 |
| Honorários Extrajudiciais | `records.honorarios` | 894 |
| Controle de Entrega | `records.unidades` | 112 |
| Contratos para Clientes / Compra e Venda | `records.compraVenda` | 1.404 |
| Transferência intermediária | `records.transferenciaIntermediaria` | 25 |

### Limitações/erros conhecidos

- IDs padrão de seis quadros estão no código; transferência depende de variável.
- Itens excluídos na origem não são removidos/arquivados localmente.
- Não há retry exponencial, fila, lock distribuído ou dead-letter queue.
- Erros por módulo deixam a execução como `partial`.
- A proteção contra execução duplicada depende do histórico no JSON.

## PostgreSQL

- `pg` instalado e `database.js` cria um pool sob demanda.
- `DATABASE_URL` e `DATABASE_SSL` configuram conexão.
- `migrations/001_foundation.sql` e `002_projects_recovery.sql` existem.
- `npm run migrate` aplica apenas a migration 001.
- Nenhuma API usa PostgreSQL; `/api/health` reporta apenas se a URL está configurada.

## Sienge

**Não integrado.** Aparece como fonte futura em dashboards, projeto e campos importados do Monday. Não existe cliente, token, endpoint, job ou coleção Sienge.

## CV / Construtor de Vendas

**Não integrado.** Apenas indicado como pendente na interface. Não existe código de conexão.

## Clicksign

**Não integrado.** O quadro de compra e venda possui campos `ID Clicksign`, `PLATAFORMA` e link de acompanhamento vindos do Monday; isso não representa integração direta.

## E-mail, Calendly e Google Agenda

**Não integrados.** “Esqueci minha senha” mostra somente uma mensagem. A Agenda usa dados locais; não sincroniza calendários.

## OpenAI/IA

**Não existe integração OpenAI.** Têmis, Ivo e IA Executiva são telas informativas/placeholders. Não há SDK, endpoint ou variável de API de IA.

## Exportação de apresentações

- Integração interna com `pptxgenjs` e `pdfkit`.
- Saída em `data/exports`, ignorada pelo Git.
- Validação bloqueia apenas uma combinação de público/classificação; regras ainda são simples.

