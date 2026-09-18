# 17 — Checklist de continuidade

> **⚠️ Checklist de uma fase anterior do handoff (`docs/handoff-codex/`, fotografia histórica anterior
> ao hardening H1–H7 e à rodada de demonstração/staging).** Vários itens abaixo já foram concluídos
> desde então (PostgreSQL definitivo já decidido e implementado — ver `docs/DECISIONS.md`, ADR-001/
> PROD-H1-01/PROD-H1B-01; RBAC, versionamento, login/MFA individuais já homologados nos hardenings H2/
> H3). Preservado como registro histórico, sem reescrever os itens já concluídos. Para o checklist
> operacional ATUAL antes de uma apresentação, ver `docs/DEMO_CURRENT_STATE.md`, seção 8.

## Preparar ambiente

- [ ] Instalar Node.js 20 ou superior.
- [ ] Executar `npm ci` na raiz.
- [ ] Copiar `.env.example` para `.env` sem versionar o arquivo.
- [ ] Definir somente os segredos necessários ao ambiente.
- [ ] Confirmar que `data/store.json` existe ou permitir que o seed o crie.
- [ ] Executar `npm test` e confirmar os 24 testes.
- [ ] Executar `npm start`.
- [ ] Abrir `http://localhost:3007` e `http://localhost:3007/status`.

## Validar autenticação de homologação

- [ ] Validar login e MFA sem registrar valores em logs/screenshots.
- [ ] Confirmar `/api/me` e os módulos do perfil.
- [ ] Testar cadastro, aprovação e restrição de colaborador.
- [ ] Nunca expor ambiente com bypass `usr-*` habilitado.

## Validar dados

- [ ] Fazer cópia segura de `data/store.json` antes de qualquer migration.
- [ ] Conferir volumes dos 35 boards habilitados contra o Monday (catálogo atual —
      `legal-source-catalog.js`; exceção: 1 board duplicado permanece desabilitado, e subitems ainda não
      são importados — ver `docs/DEMO_CURRENT_STATE.md`). *(item original desta lista dizia "sete
      quadros" — número de uma fase anterior do catálogo, corrigido aqui para o valor atual.)*
- [ ] Validar uma amostra de títulos e colunas por quadro.
- [ ] Validar status, escopo, polo, responsáveis e datas dos processos.
- [ ] Validar valores e competências de honorários.
- [ ] Confirmar que números indisponíveis não viraram zero.

## Monday

- [ ] Configurar `MONDAY_TOKEN` e IDs dos quadros.
- [ ] Usar `/api/monday/test` com perfil autorizado.
- [ ] Rodar sync manual em homologação.
- [ ] Conferir `mondayRuns` e status por módulo.
- [ ] Testar scheduler nos três horários e fuso de São Paulo.
- [ ] Definir política para itens removidos na origem.

## Banco definitivo

- [ ] Decidir formalmente PostgreSQL x MongoDB. O código atual prepara PostgreSQL, não MongoDB.
- [ ] Corrigir o runner para aplicar 001 e 002 em ordem e registrar migrations.
- [ ] Criar repositórios que substituam `readStore`/`writeStore`.
- [ ] Migrar dados com checksum, contagem e reconciliação.
- [ ] Criar constraints/índices para origem+ID, projeto, departamento, competência e soft delete.
- [ ] Executar testes de concorrência, rollback, backup e restore.

## Telas

- [ ] Painel Executivo e Dashboard Jurídico.
- [ ] Processos: filtros, chips, paginação, retorno e query string.
- [ ] Honorários: filtros, total, mês/trimestre/semestre.
- [ ] Orçamento Jurídico separado de TI.
- [ ] Projetos e projeto de Recuperação.
- [ ] Desktop, tablet, mobile, teclado e zoom 200%.

## Integrações futuras

- [ ] Sienge: contrato de dados, autenticação, conciliação e idempotência.
- [ ] CV/Clicksign: diferenciar campo importado do Monday de integração direta.
- [ ] E-mail/calendário: consentimento, escopo e auditoria.
- [ ] IA: somente após governança, minimização de dados e confirmação humana.

## Antes de produção

- [ ] Substituir autenticação de demonstração.
- [ ] Remover bypass de desenvolvimento.
- [ ] Corrigir vulnerabilidades de dependência.
- [ ] Adicionar rate limiting, schemas, headers, logs e monitoramento.
- [ ] Executar pentest, WCAG, carga, recuperação e LGPD.
- [ ] Homologar regras com Jurídico, TI, Compliance e Diretoria.

