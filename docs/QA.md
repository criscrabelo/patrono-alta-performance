# QA.md — Catálogo de Testes

> Regras oficiais: `docs/MASTER_HANDOFF.md` §30 (Checklist QA), §32 (Homologação), §33 (Go-Live Gate).
> Homologação e QA são avaliados **por release/escopo** — funcionalidades deliberadamente fora do MVP
> não bloqueiam a homologação do que foi entregue.

## 10 casos obrigatórios do MVP/Piloto Jurídico (§30) — situação nesta execução

| # | Caso | Situação | Evidência |
|---|---|---|---|
| 1 | Usuário sem acesso tenta registro jurídico → bloqueio server-side, nunca erro técnico | **Coberto, testado em HTTP real** | `tests/security-integration.test.js`: usuário com papel sem nenhum módulo autorizado → `403` real, corpo com `error`, nunca stack trace |
| 2 | Prazo jurídico vence → aparece em Processo, Agenda e Atenção como o mesmo registro | **Fora do Sprint 1** | Agenda/Atenção transversais ainda não consomem `legalDeadlines`; fica para o slice mínimo do Sprint 2 (§24) |
| 3 | Fonte indisponível → último dado válido preservado com status; nenhuma view mostra zero | **Coberto no nível de sincronização Monday** | Ver `docs/INTEGRATIONS.md` — falha de board não apaga nem zera registros existentes; granularidade por registro individual é gap conhecido |
| 4 | Exportação de dado restrito → negada e auditada quando existir no release | **Coberto** | `/api/presentations/export` exige `allowed(user,'comites','export')` e gera entrada de auditoria |
| 5 | Legal Deadline alterado → histórico preservado, prazo anterior não sobrescrito | **Coberto, testado em HTTP real** | `tests/security-integration.test.js`: `PATCH` incrementa `version` (controlado pelo servidor, não pelo cliente), preserva `createdAt`, grava `before`/`after` na auditoria |
| 6 | Legal Deadline suspenso → não exibido como vencimento comum, motivo preservado | **Modelagem permite, UI pendente** | Campo `status` livre suporta "Suspenso"; nenhuma view de Agenda/Atenção ainda interpreta esse status (depende do item 2) |
| 7 | Dois prazos no mesmo processo → coexistem como registros distintos | **Coberto** | `legalDeadlines` é coleção, não campo único — múltiplos registros com o mesmo `processId` coexistem livremente |
| 8 | Prazo sem origem identificada → bloqueado para homologação | **Coberto, testado em HTTP real** | `tests/security-integration.test.js`: ausência de `processId`, `origin` ou `date` retorna `422`; `processId` inexistente ou fora do escopo do usuário também retorna erro (`422`/`403`) e não cria o registro |
| 9 | Falha do Monday → não apaga nem altera o último prazo válido conhecido | **Coberto** | Falha de sincronização de board não toca em `legalDeadlines` (coleção não é escrita pelo pipeline de sync, por decisão ADR-003) |
| 10 | Inspeção de frontend/storage + chamada direta a endpoint/ID → nenhum segredo exposto, nenhuma operação autorizada apenas pelo frontend | **Coberto, testado em HTTP real** | Ver `docs/SECURITY.md`; `tests/security-integration.test.js` confirma 401 sem token, 401 para bypass `usr-*`, 403 para tipos/módulos arbitrários incluindo `__proto__`, e 404 para acesso por ID fora do escopo em `PATCH`/`restore` |

**Resultado:** 8 de 10 casos totalmente cobertos nesta execução (2 casos a mais que a rodada anterior,
graças à integridade relacional de Legal Deadline e aos testes de HTTP real); os 2 restantes (2 e 6)
dependem do slice mínimo de Agenda/Atenção do Sprint 2, não sendo bloqueio do Sprint 1 conforme a
própria v1.3 define o escopo por fase.

## Testes automatizados executados nesta execução

Suíte: `npm test` (Node.js test runner nativo — cada arquivo `*.test.js` roda em processo próprio).

```
tests 132
pass 132
fail 0
```

**`tests/core.test.js` (49 testes)** — unitários e estruturais. Além dos 26 preexistentes e dos 6 da
rodada 2, dois testes foram **atualizados na rodada 3** porque a versão anterior validava exatamente o
comportamento incorreto que a rodada 3 corrigiu:
- `scoped()` — companyId/speId agora testados com deny-by-default real (ausência ou mismatch nega,
  mesmo com dados sintéticos), substituindo a asserção anterior que esperava o bug ("sem companyId no
  usuário, o gate não se aplica").
- `sanitizeEntityInput()` — passou a cobrir também `scopeType`/`companyId`/`speId`, confirmando que só
  papel com escopo global pode defini-los.

2 testes novos da **rodada 4**: `isValidCivilDate()` (aceita/rejeita datas civis, incluindo anos
bissextos e meses/dias inexistentes) e `sanitizeProjectItemInput()` (protege campos de sub-recurso de
projeto e campos de escopo, mesmo padrão de `sanitizeEntityInput`).

5 testes novos da **rodada 5**: `hasGlobalScope()` (só `diretoria` tem alçada global; `administrador`
deixou de ter), `scoped()` com `administrador` (nega conteúdo departamental; aceita `scopeType:'global'`),
`allowedInDepartment()` (nega módulo departamental de outro departamento; `administrador`/alçada global
passam), `normalizeDeptSlug()` (normalização de acentos/caixa) e `dashboardAuthorized()` (módulo + regra
corporativa automática + departamento).

4 testes novos da **rodada 6**: `allowedContent()` (nega `administrador` em todo módulo de
`BUSINESS_CONTENT_MODULES` para qualquer ação de mutação; diretoria e líder do próprio departamento
continuam liberados), `BUSINESS_CONTENT_MODULES` (contém exatamente os 8 módulos operacionais/
departamentais esperados), `dashboardAuthorized()` sem `department` (nega dashboard departamental para
`administrador`; diretoria continua acessando) e `validateInternalizationProcess()` (fonte Monday +
processo não arquivado + escopo do usuário, chamada direta).

2 testes novos da **rodada 7**: `sanitizeAuditEventForUser()` (remove `before`/`after` para quem não
tem `hasGlobalScope()`; diretoria recebe o evento completo; campos técnicos sempre presentes) e
`AUDIT_TECHNICAL_FIELDS` (não inclui `before`/`after` nem qualquer campo de conteúdo de negócio).

4 testes novos do **Sprint 2, Fase 1** (D1 homologada): `validateLegalDeadline()` exige `originType`
do enum fechado (`JUDICIAL_PROCESSUAL`/`INTERNAL_CONTROL` válidos; ausente/vazio/espaços/`null`/inválido
rejeitados) e `status` do enum fechado (`ativo`/`suspenso`/`cumprido`/`cancelado` válidos;
`reaberto`/`vencido`/`em_atraso`/`pendente`/ausente rejeitados); `isLegalDeadlineOverdue()` (atraso só
quando `status==='ativo'` e `date` anterior a hoje; `suspenso`/`cumprido`/`cancelado` nunca atrasados) e
sua imunidade a deslocamento de timezone/UTC (comparação lexicográfica pura de datas civis).

**`tests/security-integration.test.js` (83 testes)** — HTTP real: sobe um servidor
`http.createServer(handler)` de verdade, isolado em diretório de dados temporário
(`COEVO_DATA_DIR`), injeta usuários e dados de teste, e faz requisições HTTP reais, verificando status e
corpo da resposta — não presença de texto no código-fonte.

Os 16 testes da rodada 2 cobrem:
1. Usuário sem nenhum módulo autorizado → `403` em rota jurídica.
2. `GET /api/legal/:module` com módulo fora da allowlist → `404`, sem criar a coleção incidentalmente.
3. Tipo desconhecido em `/api/entities/:type` → `403` em todos os verbos (GET/POST/PATCH/DELETE/restore).
4. Registro de outro departamento não aparece na listagem; `PATCH`/`restore` por ID fora do escopo → `404`.
5. `POST` não permite sobrescrever campos protegidos (`id`, `version`, `createdBy`, `department` etc.).
6. `PATCH` não permite alterar campos protegidos, incluindo tentativa de auto-arquivamento via `deletedAt`.
7. Legal Deadline sem `origin`/`processId`/`date` → `422`.
8. Legal Deadline com `processId` inexistente ou fora do escopo do usuário → `422`/`403`, nunca criado.
9. Papel privilegiado sempre passa por desafio de MFA (nunca recebe token direto no login).
10. Challenge de MFA não funciona como token; `__proto__`/`constructor` permanecem bloqueados em todos os verbos.

Os 10 testes novos da **rodada 3** cobrem:
1. Papel departamental não consegue definir `scopeType:'global'` via POST nem PATCH.
2. `companyId` nega por ausência mesmo com `department` correspondente (deny-by-default sintético).
3. PATCH de Legal Deadline não quebra invariantes (processo inexistente, fora de escopo, `origin`/`date`
   vazios, PATCH válido preservando integridade — 5 sub-casos em um teste).
4. Processo do Monday não pode ser criado/alterado/arquivado/restaurado pela API genérica; Legal
   Deadline rejeita processo sem `source:'monday'`.
5. Agenda não vaza entre departamentos; mass assignment de `id`/`department` bloqueado.
6. Comitês (`GET`) exigem módulo `comites`; Compliance (`GET`/`POST`) restrito a alçada global; mass
   assignment de `id` bloqueado em ambos.
7. `/api/dashboard` filtra departamentos/agenda por escopo; papel global continua vendo o consolidado.
8. Rotas críticas de projeto (`target`/`approval-rules`/`recovery-settings`/`DELETE`/`restore`/decisão
   de gestão) negam por escopo de projeto, com um segundo projeto sintético em outro departamento.
9. `/api/monday/status` e `/api/monday/schedule` exigem autenticação; payload não expõe
   `boards`/`requestedBy`/mensagens de erro.

Os 10 testes novos da **rodada 4** (fechamento, sem expansão de escopo) cobrem:
1. Colaborador/lider não executivo recebe `403` em `/api/dashboards/executive` (e ele não aparece
   listado em `GET /api/dashboards`); diretoria continua acessando normalmente.
2. `POST` de sub-recurso de projeto ignora `id`/`projectId`/`createdBy`/`createdAt` forjados — resultado
   permanece vinculado ao projeto da URL e aos metadados do servidor.
3. Comitê Jurídico não vaza para TI e Comitê TI não vaza para Jurídico; tentativa de forjar
   `scopeType`/`companyId` em um comitê não tem efeito.
4. Agenda não aceita `scopeType`/`companyId`/`speId` forjados por papel departamental.
5. Importação de orçamento com CSV misto (departamento próprio + de outro departamento) é bloqueada
   inteira para papel não-global; CSV só do próprio departamento é aceito; papel global segue livre.
6. Legal Deadline rejeita `origin` só com espaços, em POST e PATCH.
7. Legal Deadline rejeita `date` inválida (`"banana"`, `" "`, `"2026-99-99"`), em POST e PATCH.
8. Legal Deadline herda `department`/`companyId`/`speId`/`scopeType` do processo relacionado — mesmo
   quando diretoria tenta forjar valores diferentes; herança se atualiza ao trocar `processId` via PATCH.
9. Papel desconhecido (fora de `ROLES`) com `department:'Jurídico'` não consegue listar, criar, alterar,
   arquivar, restaurar, aprovar nem escalar nada em Projetos.

Os 15 testes novos da **rodada 5** cobrem:
1. Líder de TI recebe `403` nas quatro rotas de Monday (`status`/`schedule`/`test`/`sync`), mesmo tendo
   o módulo `juridico` em `ROLES`; líder Jurídico continua acessando-as normalmente.
2. Líder Jurídico recebe `403` no dashboard departamental de TI (rota TI equivalente), mesmo tendo o
   módulo `ti` em `ROLES`; líder de TI continua acessando o próprio.
3. Diretoria (alçada global) continua acessando rotas de Monday e dashboard de TI.
4. Dashboard corporativo `budget` bloqueado (`403`) para líder departamental e ausente da listagem
   (`GET /api/dashboards`).
5. Diretoria continua acessando `budget` e vendo-o na listagem.
6. Dashboards departamentais (`legal`, `ti`) continuam funcionando normalmente para o departamento
   correspondente.
7. Administrador técnico recebe `200` em `/api/legal/processos` (passa no gate de módulo) mas com
   `records: []` — não acessa conteúdo jurídico automaticamente; diretoria continua acessando.
8. Internalization com `processId` de processo manual/não-Monday é rejeitada com `422`.
9. Internalization com `processId` de processo do Monday fora do escopo do usuário é rejeitada com
   `403`; internalization com `processId` válido continua funcionando (`201`).
10. Dashboard preference de `executive`/`budget` negada (`403`, GET e PUT) a líder departamental;
    diretoria consegue ler e gravar ambas.
11. Preferência de dashboard departamental permitido (`legal`) continua funcionando para o líder do
    departamento correspondente, e é negada para líder de outro departamento.

Os 10 testes novos da **rodada 6** cobrem:
1. Líder de TI recebe `403` ao tentar criar conteúdo jurídico via motor genérico de entidades
   (`POST /api/entities/documentReferences`) — isolamento transversal, não apenas nas rotas de Monday.
2. Líder de TI recebe `403` em `GET /api/legal/processos` (não mais `200` com lista vazia).
3. Líder Jurídico recebe `403` no módulo TI equivalente (dashboard departamental de TI — não existe
   ainda tipo de entidade mapeado para `ti` em `ENTITY_MODULE_MAP` para testar via `/api/entities`).
4. Diretoria (alçada global) continua acessando `/api/legal/processos` e criando conteúdo jurídico
   normalmente.
5. Administrador técnico recebe `403` em dashboards departamentais (`legal`, `ti`), que não aparecem em
   sua listagem nem em `/api/dashboard-preferences/legal`.
6. Líder Jurídico, líder de TI e diretoria continuam acessando seus dashboards departamentais
   normalmente.
7. Administrador técnico recebe `403` (ou `404`, quando `scoped()` nega antes do gate de conteúdo) ao
   tentar criar conteúdo de negócio: `POST /api/agenda`, `POST /api/committees`,
   `POST /api/entities/documentReferences`, `POST /api/projects/:id/actions`.
8. Administrador técnico continua executando funções técnicas legítimas: `GET /api/audit`,
   `GET /api/auth/requests`.
9. PATCH de internalization para processo manual/não-Monday (`422`), processo inexistente (`422`) e
   processo do Monday fora do escopo (`403`) são rejeitados, sem alterar o registro.
10. PATCH de internalization preservando o `processId` válido continua funcionando (`200`).

Os 5 testes novos da **rodada 7** cobrem:
1. Administrador técnico recebe `403` em `GET` e `POST /api/compliance`.
2. Líder e colaborador departamentais recebem `403` em `GET` e `POST /api/compliance` (comportamento
   pré-existente, reafirmado após a troca do mecanismo de autorização).
3. Diretoria (alçada de negócio global) continua acessando `GET`/`POST /api/compliance`, sem mass
   assignment de `id`/`responsible`/`createdAt`.
4. Administrador técnico recebe `200` em `GET /api/audit`, mas nenhum evento devolvido contém
   `before`/`after`; diretoria recebe o evento completo, incluindo `before`/`after` de um PATCH real de
   Legal Deadline gerado no próprio teste.
5. Usuário sem `allowed(user,'*')` recebe `403` em `GET /api/audit` (comportamento pré-existente).

Os 17 testes novos do **Sprint 2, Fase 1** (D1 homologada) cobrem:
1. Líder Jurídico cria Legal Deadline `JUDICIAL_PROCESSUAL` válido — `201`, `status` default `ativo`.
2. Líder Jurídico cria Legal Deadline `INTERNAL_CONTROL` válido — `201`.
3. `POST` sem `originType` → `422`.
4. `POST` com `originType` fora do enum → `422`.
5. `PATCH` com `originType` fora do enum → `422`, sem alterar o registro gravado.
6. `PATCH` tentando esvaziar `originType` → `422`, sem alterar o registro gravado.
7. `POST` com `status` fora do enum → `422`.
8. `POST` com `status:'reaberto'` → `422` (reabertura nunca é status persistido).
9. `PATCH` com `status` fora do enum → `422`, sem alterar o registro gravado.
10. `PATCH` para `status:'suspenso'` → `200`, audita `before`/`after` e o `reason` informado; reabertura
    subsequente (`status:'ativo'`) preserva o mesmo `id`, incrementa `version` e mantém o ciclo
    `suspenso` anterior recuperável no histórico de auditoria.
11. Líder de TI recebe `403` ao tentar criar Legal Deadline.
12. Administrador técnico recebe `403`/`404` ao tentar criar Legal Deadline (não é superusuário de
    conteúdo).
13. Acesso a Legal Deadline por ID fora do escopo do usuário é negado (`403`) sem revelar conteúdo.
14. Legal Deadline continua rejeitando processo manual/não-Monday (`422`) e processo inexistente
    (`422`), mesmo com `originType`/`status` válidos.
15. Mass assignment continua bloqueado (`id`/`version`/`createdBy`/`department`) mesmo com
    `originType`/`status` no corpo da requisição.
16. Um processo pode ter múltiplos Legal Deadlines (`originType` distintos) coexistindo.
17. Novo fato gerador (nova intimação) cria novo Legal Deadline, sem alterar o registro anterior.

## Catálogo Global de Regressão (§30)

Ativado apenas quando a funcionalidade correspondente entrar em release — nenhum item deste catálogo é
aplicável ainda, pois nenhuma das funcionalidades listadas (matching CV/Sienge, aditivo de contrato,
IA, VELKOR, múltiplas SPEs) foi implementada nesta execução.

## Estados de dados (§18) verificados nesta execução

| Estado | Verificado em |
|---|---|
| Carregando / Disponível / Vazio real | Comportamento pré-existente, não alterado |
| Parcial | Sincronização Monday marca execução como `partial` (HTTP 207) quando algum board falha |
| Indisponível | Board com erro aparece com `status: 'error'` na execução, sem afetar os demais |

## CI

`.github/workflows/ci.yml` roda `npm ci` + `npm test` em todo Pull Request (Node 20.x e 22.x), para que
o resultado da suíte não dependa apenas da afirmação local de quem abriu o PR. Ver `docs/SECURITY.md`,
seção "CI", para o detalhamento.

## Próximos passos de QA (fora do Sprint 1)

1. Slice mínimo de Agenda/Atenção consumindo `legalDeadlines` (Sprint 2), habilitando os casos 2 e 6.
2. Granularidade de status de frescor por registro individual (não apenas por execução de sincronização).
3. Quando `restore`/`archive`/`approveAgreement` de projeto forem concedidos a algum papel
   departamental (hoje só diretoria/administrador têm essas ações, e ambos têm escopo global), revisar
   os testes de integração para incluir um cenário real de "permissão concedida, mas escopo nega" — ver
   nota em `tests/security-integration.test.js`.
4. Decisão de negócio sobre o módulo/escopo definitivo de Compliance (ADR-007, `docs/DECISIONS.md`) —
   hoje restrito a alçada global por deny-by-default, não por desenho final pretendido.

## QA do Sprint 2 — Legal Deadline com D1 homologada

A D1 (`docs/DECISIONS.md`, seção 1.1) foi homologada, incluindo o enum de `status`, a regra de
reabertura e a regra de atraso derivado. **A Fase 1 do Sprint 2 (`docs/SPRINT2-PLANO.md`) implementou
o modelo de dados correspondente** — os casos abaixo marcados ✅ têm teste real (unitário e/ou HTTP) em
`tests/core.test.js`/`tests/security-integration.test.js`; os marcados ⏳ dependem de Fases 2–4
(dashboard, listagem, Agenda/Atenção, Google Calendar) e continuam apenas planejados.

1. ✅ Criar Legal Deadline `JUDICIAL_PROCESSUAL` válido (com `processId`, `origin`, `date`, `originType`).
2. ✅ Criar Legal Deadline `INTERNAL_CONTROL` válido.
3. ✅ `originType` ausente, vazio, só com espaços ou fora do enum → rejeitado com `422` (POST e PATCH).
4. ✅ `origin` vazio (ou só espaços) → rejeitado (já testado desde a rodada 4).
5. ✅ `date` inválida → rejeitado (já testado desde a rodada 4).
6. ✅ `processId` inexistente → rejeitado (já testado desde a rodada 2).
7. ✅ Processo fora do escopo do usuário → negado (já testado desde a rodada 2/5).
8. ✅ Líder de TI tentando criar Legal Deadline (módulo `juridico`) → `403`
   (`allowedInDepartment()`/`allowedContent()`, mesmo mecanismo das rodadas de segurança 5–6).
9. ✅ Administrador técnico tentando criar Legal Deadline (conteúdo de negócio) → negado
   (`allowedContent()`, mesmo mecanismo da rodada 6).
10. ✅ Um processo com múltiplos Legal Deadlines coexistindo, com `originType` distintos.
11. ✅ Nova intimação/novo fato gerador → novo Legal Deadline (novo `id`, mesmo `processId`, registro
    anterior inalterado).
12. ✅ Alteração do mesmo prazo/fato gerador → mesmo `id`, histórico preservado via auditoria.
13. ✅ Suspensão → aceita (`200`), audita `before`/`after` e o `reason` informado.
14. ✅ Reabertura (`suspenso` → `ativo`) → mesmo `id`, `version` incrementada, histórico preserva o
    ciclo suspenso anterior (não apenas o estado final).
15. ✅ Cumprimento/cancelamento são valores válidos do enum (mesmo mecanismo do caso 3/21 abaixo).
16. ⏳ Dashboard jurídico usa `legalDeadlines`, nunca a coluna bruta `DATA`/`CITAÇÃO/PROTOCOLO` do Monday
    — **Fase 2, não implementado ainda** (risco registrado em `docs/DATA_MODEL.md`).
17. ✅ Falha do Monday não apaga o último Legal Deadline válido conhecido (comportamento pré-existente,
    reafirmado — `legalDeadlines` não é escrita pelo pipeline de sync).
18. ✅ Nenhuma rota de Legal Deadline gera cálculo automático de prazo — confirmado por inspeção de
    código (nenhuma função de cálculo processual existe) e pelos testes de `isLegalDeadlineOverdue()`,
    que é puramente derivada (não persiste nem calcula prazo, só interpreta `status`+`date` já gravados).
19. ⏳ Google Calendar (quando ativado) não atua como fonte de Legal Deadline — **Fase 3, não aplicável
    ainda** (Calendar não integrado).
20. ✅ Acesso direto por ID de Legal Deadline fora do escopo do usuário → bloqueado, sem revelar
    conteúdo (`403` no gate de módulo departamental).
21. ✅ `status` fora do enum homologado (`ativo`/`suspenso`/`cumprido`/`cancelado`) → rejeitado com
    `422`, em POST e em PATCH.
22. ✅ `isLegalDeadlineOverdue()`: `ativo` + `date` anterior a hoje → `true` (testado com `today`
    explícito, determinístico). **Nenhuma view ainda consome essa função** (Fase 2).
23. ✅ `isLegalDeadlineOverdue()`: `suspenso` + `date` anterior a hoje → `false`.
24. ✅ `isLegalDeadlineOverdue()`: `cumprido` + `date` anterior a hoje → `false`.
25. ✅ `isLegalDeadlineOverdue()`: `cancelado` + `date` anterior a hoje → `false`.
26. ✅ Reabertura de Legal Deadline `suspenso` → mesmo `id`, `status` retorna para `ativo`, histórico
    preserva o ciclo anterior (`before`/`after`, motivo, responsável, data/hora).
27. ✅ Nenhuma API aceita `status:'reaberto'` (nem `vencido`/`atrasado`/`em_atraso`/`pendente`) como
    valor persistido — sempre rejeitado por estar fora do enum fechado (POST e PATCH, unitário e HTTP).

**Resumo:** 24 de 27 casos implementados e testados nesta Fase 1 (unitário e/ou HTTP real); os 3
restantes (16, 19, e a integração de `isLegalDeadlineOverdue()` a uma view em 22) dependem de Fases 2–3,
não iniciadas nesta rodada.
