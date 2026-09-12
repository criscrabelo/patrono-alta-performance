# ARCHITECTURE.md — Arquitetura Técnica (Fase 0)

> Arquitetura funcional oficial: `docs/MASTER_HANDOFF.md` §3–§5. Este documento cobre apenas a
> arquitetura **técnica** escolhida para viabilizar essa arquitetura funcional na Fase 0/Sprint 1
> (ver `docs/DECISIONS.md`, ADR-001 e ADR-002, para a justificativa de cada escolha).

## Stack atual

- **Runtime:** Node.js ≥ 20, módulo `http` nativo (sem framework HTTP) — `server.js`.
- **Frontend:** SPA sem framework (HTML/CSS/JS puro) em `public/`, servido estaticamente pelo próprio
  `server.js`.
- **Persistência operacional (interina):** `data/store.json`, arquivo local ignorado pelo Git.
- **Persistência definitiva (preparada, não conectada às APIs):** PostgreSQL via `pg`, com migrations em
  `migrations/001_foundation.sql` e `migrations/002_projects_recovery.sql`, executadas por
  `scripts/migrate.js` quando `DATABASE_URL` está configurado.
- **Integração externa:** Monday.com via GraphQL, exclusivamente server-side (`mondayQuery`,
  `fetchMondayBoard` em `server.js`) — nunca a partir do navegador.
- **Exportação de documentos:** `pptxgenjs` e `pdfkit`, usados em `presentation-export.js`.
- **Testes:** `node:test` nativo, sem framework externo — `tests/core.test.js`.

## Mapeamento para as 8 camadas do Handoff Master (§3)

| Camada (MASTER_HANDOFF §3) | Implementação atual | Situação |
|---|---|---|
| 1. Ambientes | Sidebar única, calculada por papel/departamento em `public/app.js` | Parcial — os quatro ambientes da v1.3 (Executiva, Jurídico, TI, VELKOR) ainda não são um seletor de ambiente explícito; ver Gap Analysis |
| 2. Módulos de negócio | Jurídico e TI como pilotos; VELKOR e demais ambientes não implementados | Parcial, dentro do esperado para o piloto (§23) |
| 3. Entidades canônicas | RBAC + auditoria + versionamento genéricos via `/api/entities/:type`; `legalDeadlines` adicionado nesta execução | Parcial — ver `docs/DATA_MODEL.md` |
| 4. Views e centrais | Dashboards (`dashboard-model.js`, `dashboard-service.js`), agenda, comitês | Parcial |
| 5. Governança transversal | `ROLES`/`allowed()`/`scoped()`, trilha de auditoria (`audit()`), `/api/audit` | Presente, com gaps corrigidos nesta execução (ver `docs/PERMISSIONS.md`) |
| 6. Integrações | Monday somente leitura, server-side, com token exclusivamente em variável de ambiente | Presente e em conformidade com o P0 de segredos |
| 7. Patrono IA | Não implementada | Fora de escopo do Sprint 1 (correto, por instrução explícita) |
| 8. Administração | Cadastro/aprovação de usuários, backup cifrado condicionado a chave | Parcial |

## Decisões técnicas da Fase 0

Ver `docs/DECISIONS.md`, seção "ADRs de Engenharia":
- **ADR-001** — manter Node.js nativo + `data/store.json` como base, com PostgreSQL como próximo passo.
- **ADR-002** — manter autenticação própria (login + MFA por desafio), corrigida para exigir MFA por
  papel privilegiado independentemente da flag do cadastro.
- **ADR-003** — modelar `Legal Deadline` via motor genérico de entidades, sem pipeline automático de
  origem (decisão de negócio D1 pendente).

## Autorização server-side (P0 — MASTER_HANDOFF §11/§26)

Toda rota protegida valida, no backend, antes de responder:

1. **Identidade** — `getUser(req)` resolve o usuário a partir de um token de sessão válido e não
   expirado (`sessions` em memória); nenhuma rota confia em cabeçalho, corpo ou frontend para identidade.
2. **Papel/ação** — `allowed(user, module, action)` compara o papel do usuário contra `ROLES`.
3. **Escopo do registro** — `scoped(user, item)` restringe a registros do próprio departamento, exceto
   para `diretoria`/`administrador`.
4. **Tipo de entidade (Sprint 1)** — `entityModule(type)` mapeia cada tipo de coleção genérica
   (`/api/entities/:type`) para o módulo de RBAC correspondente, com **deny-by-default** para qualquer
   tipo fora do mapa — corrige o P0 em que `GET /api/entities/:type` e `GET /api/legal/:module` não
   verificavam permissão de módulo (ver `docs/SECURITY.md`, "P0 corrigidos").

Nenhuma dessas verificações depende de o menu, botão ou rota estarem ocultos no frontend — a ocultação
de UI é tratada exclusivamente como conveniência de navegação, nunca como controle de acesso.

## Ambientes de execução

- **Variáveis de ambiente:** `.env` (não versionado) carregado manualmente no boot (`server.js:11-17`);
  `.env.example` documenta todas as chaves esperadas, sem valores funcionais.
- **Portas/ambiente:** `PORT` (padrão 3007), `NODE_ENV`.
- **Dados demonstrativos vs produção:** atualmente um único ambiente de homologação; a separação formal
  de dados demonstrativos (MASTER_HANDOFF §19) é um gap — ver Gap Analysis no relatório final.

## Próximos passos técnicos recomendados (fora do Sprint 1)

1. Migrar `data/store.json` para PostgreSQL com transações reais (ADR-001 já prepara o caminho).
2. Avaliar IdP corporativo para autenticação (ADR-002 já prepara a separação de responsabilidades).
3. Corrigir a vulnerabilidade de alta severidade em `pptxgenjs`/`image-size` (`npm audit`), validando a
   geração de PPTX/PDF após o upgrade.
4. Implementar seletor explícito de Ambiente (Visão Executiva / Jurídico / TI / VELKOR) na navegação,
   como camada 1 da arquitetura funcional (§3, §5) — hoje a navegação é calculada implicitamente por
   papel/departamento, sem um conceito de "ambiente" de primeira classe na UI.
