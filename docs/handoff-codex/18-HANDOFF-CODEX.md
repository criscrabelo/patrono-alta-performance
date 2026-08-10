# 18 — Handoff Codex

## Estado entregue

COEVO Alta Performance é uma aplicação local executável com dados jurídicos reais sincronizados do Monday, dashboard Jurídico, processos e honorários com filtros, orçamento departamental, autenticação/RBAC de homologação, auditoria, exportação e um projeto estratégico de recuperação de crédito.

## O que funciona

- Servidor local em `localhost:3007`.
- Sincronização Monday manual e programada.
- 3.820 registros ativos em sete coleções Monday.
- Filtros/paginação de processos e honorários extrajudiciais.
- Honorários judiciais derivados.
- Dashboards com memória de cálculo e estados de integração.
- Financeiro Jurídico separado de TI.
- Projeto de recuperação com governança Miguel/Cristiane.
- Auditoria, soft delete, restore por API e backup cifrado condicionado a chave.
- 24 testes passando antes desta documentação.

## O que está pendente

- Banco transacional definitivo; MongoDB não existe e PostgreSQL não está conectado.
- Autenticação e MFA de produção.
- Sienge, CV, Clicksign, e-mail, calendário e OpenAI.
- Casos e valores reais de recuperação.
- UIs completas de CRUD para projetos, lixeira, backup, documentos, riscos e estratégia.
- Testes E2E, segurança, acessibilidade, carga e disaster recovery.

## Arquivos importantes

- `server.js`: handler, autenticação, integração, regras e persistência.
- `public/app.js`: SPA inteira e regras de apresentação.
- `project-service.js`: projeto/recuperação.
- `dashboard-model.js` e `dashboard-service.js`: dashboards reutilizáveis.
- `data/store.json`: dado operacional atual; não versionado.
- `migrations/001_foundation.sql` e `002_projects_recovery.sql`.
- `tests/core.test.js`.
- `docs/handoff-codex/`: fotografia completa.

## Evidências visuais

As capturas em `docs/handoff-codex/screenshots/` registram o estado observado do menu lateral, painel executivo, dashboard Jurídico, Processos Judiciais, filtros, Honorários Extrajudiciais, Projetos e Orçamento. Elas foram produzidas sem armazenar credenciais na documentação.

## Decisões arquiteturais vigentes

- Preservar payload Monday e normalizar na leitura.
- Não inventar KPIs: usar estados vazio/pendente.
- Soft delete e auditoria para mutações.
- Relações de projeto por IDs, sem duplicar processo.
- Políticas financeiras configuráveis, sem motor automático ainda.

## Não alterar sem verificar

1. **Campos e títulos Monday:** funções de normalização dependem deles.
2. **Nomenclatura:** “Recompra” é apresentada como “Transferência intermediada”.
3. **Cores COEVO:** identidade visual foi aprovada e deve ser preservada.
4. **Orçamento:** Jurídico e TI têm fontes e confiabilidade diferentes.
5. **Indicadores indisponíveis:** não converter `null` em zero.
6. **Responsáveis:** Miguel é owner operacional; Cristiane é manager, por IDs.
7. **Alçadas:** não hardcode aprovação sempre em Cristiane; respeitar regras configuráveis.
8. **Store local:** fazer backup antes de qualquer migração; não sobrescrever dados sincronizados.
9. **Auth:** o fluxo atual é de homologação e não deve ser confundido com segurança produtiva.
10. **Migration runner:** atualmente não aplica 002.

## Próximos passos recomendados

1. Congelar e versionar contratos de dados/API.
2. Escolher banco definitivo e migrar com reconciliação.
3. Implementar identidade e RBAC produtivos.
4. Corrigir vulnerabilidades e controles de borda.
5. Integrar Sienge e construir a carteira mestre de recuperação.
6. Completar CRUDs e testes E2E.
7. Homologar funcional, visual, segurança e compliance por fase.

## Confirmação de escopo

Este handoff descreve o código e o `store.json` observados no snapshot. Não presume MongoDB, Sienge, IA ou módulos que não estejam implementados.
