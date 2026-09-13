# QA.md — Catálogo de Testes

> Regras oficiais: `docs/MASTER_HANDOFF.md` §30 (Checklist QA), §32 (Homologação), §33 (Go-Live Gate).
> Homologação e QA são avaliados **por release/escopo** — funcionalidades deliberadamente fora do MVP
> não bloqueiam a homologação do que foi entregue.

## 10 casos obrigatórios do MVP/Piloto Jurídico (§30) — situação nesta execução

| # | Caso | Situação | Evidência |
|---|---|---|---|
| 1 | Usuário sem acesso tenta registro jurídico → bloqueio server-side, nunca erro técnico | **Coberto, testado em HTTP real** | `tests/security-integration.test.js`: usuário com papel sem nenhum módulo autorizado → `403` real, corpo com `error`, nunca stack trace |
| 2 | Prazo jurídico vence → aparece em Processo, Agenda e Atenção como o mesmo registro | **Coberto na Fase 3 do Sprint 2** | `GET /api/agenda-items`/`GET /api/attention` exibem o mesmo `entityId` de Legal Deadline (nunca uma cópia), referenciando o processo relacionado |
| 3 | Fonte indisponível → último dado válido preservado com status; nenhuma view mostra zero | **Coberto no nível de sincronização Monday** | Ver `docs/INTEGRATIONS.md` — falha de board não apaga nem zera registros existentes; granularidade por registro individual é gap conhecido |
| 4 | Exportação de dado restrito → negada e auditada quando existir no release | **Coberto** | `/api/presentations/export` exige `allowed(user,'comites','export')` e gera entrada de auditoria |
| 5 | Legal Deadline alterado → histórico preservado, prazo anterior não sobrescrito | **Coberto, testado em HTTP real** | `tests/security-integration.test.js`: `PATCH` incrementa `version` (controlado pelo servidor, não pelo cliente), preserva `createdAt`, grava `before`/`after` na auditoria |
| 6 | Legal Deadline suspenso → não exibido como vencimento comum, motivo preservado | **Coberto na Fase 3 do Sprint 2** | `GET /api/attention` nunca classifica `suspenso`/`cumprido`/`cancelado` como `OVERDUE`, mesmo com `date` passada; motivo preservado no histórico (Fase 1/2) |
| 7 | Dois prazos no mesmo processo → coexistem como registros distintos | **Coberto** | `legalDeadlines` é coleção, não campo único — múltiplos registros com o mesmo `processId` coexistem livremente |
| 8 | Prazo sem origem identificada → bloqueado para homologação | **Coberto, testado em HTTP real** | `tests/security-integration.test.js`: ausência de `processId`, `origin` ou `date` retorna `422`; `processId` inexistente ou fora do escopo do usuário também retorna erro (`422`/`403`) e não cria o registro |
| 9 | Falha do Monday → não apaga nem altera o último prazo válido conhecido | **Coberto** | Falha de sincronização de board não toca em `legalDeadlines` (coleção não é escrita pelo pipeline de sync, por decisão ADR-003) |
| 10 | Inspeção de frontend/storage + chamada direta a endpoint/ID → nenhum segredo exposto, nenhuma operação autorizada apenas pelo frontend | **Coberto, testado em HTTP real** | Ver `docs/SECURITY.md`; `tests/security-integration.test.js` confirma 401 sem token, 401 para bypass `usr-*`, 403 para tipos/módulos arbitrários incluindo `__proto__`, e 404 para acesso por ID fora do escopo em `PATCH`/`restore` |

**Resultado:** 10 de 10 casos cobertos após a Fase 3 do Sprint 2 (casos 2 e 6 passaram a ter teste real
com o slice mínimo de Agenda/Atenção — `GET /api/agenda-items`/`GET /api/attention`).

## Testes automatizados executados nesta execução

Suíte: `npm test` (Node.js test runner nativo — cada arquivo `*.test.js` roda em processo próprio).

```
tests 196
pass 196
fail 0
```

**`tests/core.test.js` (71 testes)** — unitários e estruturais. Além dos 26 preexistentes e dos 6 da
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

**`tests/security-integration.test.js` (125 testes)** — HTTP real: sobe um servidor
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

Os 8 testes novos da **correção pós-revisão do PR #4** (reason obrigatório na reabertura, restrito a
`legalDeadlines`, body null-safe) cobrem:
1. Reabertura de `suspenso` → `ativo` sem `reason` → `422`; `status`/`version` do registro não se alteram.
2. Reabertura de `cancelado` → `ativo` sem `reason` → `422`.
3. Reabertura de `cumprido` → `ativo` sem `reason` → `422`.
4. Reabertura com `reason` válido → `200`; mesmo `id`; `version` incrementada; evento de auditoria com o
   `reason` exato informado.
5. `reason` contendo apenas espaços em branco é tratado como ausente → `422`.
6. `reason` nunca aparece como campo persistido no registro `legalDeadlines` (nem na resposta do `PATCH`
   nem na listagem subsequente) — alimenta somente o evento de auditoria.
7. `PATCH` de Legal Deadline com corpo JSON `null` não derruba o servidor (nunca `500`) e responde de
   forma controlada (`200`/`422`, corpo estruturado), sem corromper o registro existente.
8. Entidade genérica (`documentReferences`) não sofreu nenhuma alteração de comportamento: `reason`
   enviado no corpo continua sendo persistido como campo comum do registro (como antes do PR #4), e o
   evento de auditoria continua usando o `reason` default de `audit()` — o tratamento especial desta
   rodada é exclusivo de `legalDeadlines`.

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
16. ✅ Dashboard jurídico usa `legalDeadlines`, nunca a coluna bruta `DATA`/`CITAÇÃO/PROTOCOLO` do Monday
    — **Fase 2 implementada**: `processDate()` removida de `dashboard-service.js`; teste de regressão
    dedicado confirma que um processo com `DATA`/`CITAÇÃO` mas sem Legal Deadline não gera prazo.
17. ✅ Falha do Monday não apaga o último Legal Deadline válido conhecido (comportamento pré-existente,
    reafirmado — `legalDeadlines` não é escrita pelo pipeline de sync).
18. ✅ Nenhuma rota de Legal Deadline gera cálculo automático de prazo — confirmado por inspeção de
    código (nenhuma função de cálculo processual existe) e pelos testes de `isLegalDeadlineOverdue()`,
    que é puramente derivada (não persiste nem calcula prazo, só interpreta `status`+`date` já gravados).
19. ⏳ Google Calendar (quando ativado) não atua como fonte de Legal Deadline — **Fase 4, não aplicável
    ainda** (Calendar não integrado; explicitamente fora de escopo da Fase 3).
20. ✅ Acesso direto por ID de Legal Deadline fora do escopo do usuário → bloqueado, sem revelar
    conteúdo (`403` no gate de módulo departamental).
21. ✅ `status` fora do enum homologado (`ativo`/`suspenso`/`cumprido`/`cancelado`) → rejeitado com
    `422`, em POST e em PATCH.
22. ✅ `isLegalDeadlineOverdue()`: `ativo` + `date` anterior a hoje → `true` (testado com `today`
    explícito, determinístico). **Consumida na Fase 2** pelo dashboard `legal` e pela listagem/detalhe
    (`overdue` em cada registro), sempre a mesma função — nunca recalculada em paralelo.
23. ✅ `isLegalDeadlineOverdue()`: `suspenso` + `date` anterior a hoje → `false`.
24. ✅ `isLegalDeadlineOverdue()`: `cumprido` + `date` anterior a hoje → `false`.
25. ✅ `isLegalDeadlineOverdue()`: `cancelado` + `date` anterior a hoje → `false`.
26. ✅ Reabertura de Legal Deadline `suspenso` → mesmo `id`, `status` retorna para `ativo`, histórico
    preserva o ciclo anterior (`before`/`after`, motivo, responsável, data/hora).
27. ✅ Nenhuma API aceita `status:'reaberto'` (nem `vencido`/`atrasado`/`em_atraso`/`pendente`) como
    valor persistido — sempre rejeitado por estar fora do enum fechado (POST e PATCH, unitário e HTTP).

**Resumo:** 26 de 27 casos implementados e testados entre a Fase 1 e a Fase 2 (unitário e/ou HTTP real); o
único restante (19, Google Calendar) depende da Fase 4, não iniciada.

## QA do Sprint 2 — Fase 3 (Agenda/Atenção mínima)

Testes adicionados nesta rodada (10 unitários em `tests/core.test.js`, 18 HTTP em
`tests/security-integration.test.js`) — nenhum teste anterior foi removido; 196 no total, todos
passando.

**Unitários (10):** Legal Deadline ativo futuro aparece na Agenda com `entityType`/`entityId`/`target`
corretos; vencido entra como `OVERDUE` e suspenso/cumprido/cancelado nunca entram como overdue; próximo
dentro da janela de 30 dias entra como `UPCOMING` (via `civilDateAfterDays()`); registro legado aparece
como `REQUIRES_REVIEW` sem inferir nada; `JUDICIAL_PROCESSUAL`/`INTERNAL_CONTROL` identificados
corretamente pelo campo `originType`; processo sem Legal Deadline não gera item e DATA/CITAÇÃO nunca
viram prazo (regressão); múltiplos Legal Deadlines do mesmo processo geram itens distintos; alteração do
Legal Deadline reflete na view sem duplicata persistida; ordenação determinística de `sortAgendaItems()`;
itens sempre contêm `entityType`/`entityId` e nenhuma cópia de Legal Deadline é persistida em
`store.records`.

**HTTP (18):**
1. Líder Jurídico vê itens autorizados (Legal Deadline + evento manual de agenda) em `/api/agenda-items`.
2. Líder de TI não vê agenda jurídica (nenhum item `legalDeadline`).
3. Administrador técnico não vê conteúdo jurídico em `/api/agenda-items` nem `/api/attention`.
4. Diretoria vê o consolidado conforme alçada global.
5. `companyId` fora de escopo não aparece em `/api/agenda-items` nem `/api/attention`.
6. `speId` fora de escopo não aparece em `/api/agenda-items` nem `/api/attention`.
7. `summary` de `/api/attention` não vaza contagem de item fora de escopo (comparação antes/depois).
8. Item de Legal Deadline na Agenda referencia o detalhe correto (`target` aponta para o mesmo registro).
9. Processo relacionado fora de escopo bloqueia o item, mesmo com o prazo tecnicamente no escopo do
   usuário (defesa em profundidade).
10. Processo sem Legal Deadline não gera prazo na Agenda/Atenção.
11. Regressão obrigatória: DATA/CITAÇÃO do processo Monday nunca aparecem como prazo na Agenda/Atenção.
12. `INTERNAL_CONTROL` nunca recebe label/campo de prazo processual na Agenda.
13. `requires_review` não é tratado como confirmado — aparece sinalizado, nunca como Legal Deadline
    válido.
14. `suspenso`/`cumprido`/`cancelado` nunca aparecem como `OVERDUE` em `/api/attention`, mesmo com data
    passada.
15. `GET /api/agenda-items`/`GET /api/attention` não criam nem alteram nada (idempotentes).
16. Não duplicidade: chamadas repetidas de Agenda/Atenção/detalhe nunca criam um segundo Legal Deadline.
17. Agenda é view, não source of truth: alteração da `date` no Legal Deadline reflete na Agenda sem criar
    segundo item.
18. Reabertura: suspenso não aparece como overdue; após reabertura com `reason`, Agenda/Atenção passam a
    refletir overdue no mesmo `id`.

## QA do Sprint 2 — Fase 2 (views e consumo canônico de Legal Deadline)

Testes adicionados nesta rodada (8 unitários em `tests/core.test.js`, 15 HTTP em
`tests/security-integration.test.js`) — nenhum teste anterior foi removido; 163 no total, todos
passando.

**Unitários (8):**
1. `dashboard-service.js` não contém mais `processDate()` nem lê `CITAÇÃO/PROTOCOLO` diretamente como
   prazo (teste estrutural sobre o código-fonte).
2. Processo com `DATA`/`CITAÇÃO` mas sem nenhum Legal Deadline não gera prazo fictício no dashboard
   `legal` (regressão obrigatória).
3. Widget de prazo consome `legalDeadlines`: `ativo` + data passada é vencido; `ativo` + data de hoje
   não é.
4. `suspenso`/`cumprido`/`cancelado` com data passada nunca aparecem como vencidos no dashboard.
5. `INTERNAL_CONTROL` nunca é rotulado como prazo processual (não entra em `legal-risk`/`legal-deadlines`).
6. `JUDICIAL_PROCESSUAL` aparece corretamente; múltiplos Legal Deadlines do mesmo processo coexistem sem
   se substituir.
7. `legalDeadlineIntegrityFlag()` sinaliza registros legados sem `originType`/`status` para revisão
   (`'requires_review'`), sem inferir nada.
8. `civilDateAfterDays()` (janela de dias) e `filterLegalDeadlines()` (filtros por `processId`/
   `originType`/`status`/`overdue`/`dateFrom`/`dateTo` + paginação no mesmo padrão de
   `filterProcesses()`/`filterHonorariums()`).

**HTTP (15):**
1. Regressão obrigatória: processo com `DATA`/`CITAÇÃO` mas sem Legal Deadline não aparece como prazo em
   `GET /api/dashboards/legal`.
2. `GET /api/dashboards/legal` calcula "Prazos vencidos"/"Prazos críticos" exclusivamente a partir de
   `legalDeadlines`.
3. Líder de TI não acessa dashboard/prazos jurídicos.
4. Administrador técnico não recebe conteúdo jurídico em dashboard, listagem nem detalhe.
5. Diretoria acessa dashboard, listagem e detalhe conforme alçada global.
6. Listagem paginada: filtro por `processId`.
7. Listagem paginada: filtro por `originType`.
8. Listagem paginada: filtro por `status`.
9. Listagem paginada: filtro por `overdue` (suspenso/cumprido/cancelado nunca entram em `overdue=true`).
10. Listagem paginada: filtros combinados (`processId` + `status` + `originType`).
11. Detalhe retorna processo relacionado, atraso derivado e histórico; histórico respeita permissão
    (sem `before`/`after` para quem não tem alçada global, via `sanitizeAuditEventForUser()`).
12. Detalhe por ID fora do escopo é negado, sem revelar existência/conteúdo.
13. Detalhe de Legal Deadline inexistente retorna `404`.
14. Processo com zero Legal Deadlines não aparece como tendo prazo na listagem filtrada por `processId`.
15. (Coberto nos testes acima) suspenso/cumprido/cancelado nunca entram em `overdue=true` na listagem.

## P1 corrigido pós-revisão do PR #5 — contagens agregadas do dashboard "legal" por escopo

A revisão encontrou que `active-processes`, `"A classificar"` (dentro de `legal-risk`), `legal-quality` e
`legal-attention` calculavam sobre `recordList(store, 'processos')`/`activeProcesses(store)`/
`recordList(store, key)` **sem** aplicar `scoped(user, row)` — só o Legal Deadline em si (e o processo
relacionado a ele) já tinham essa defesa em profundidade. Um usuário Jurídico com `companyId`/`speId`
próprio podia, em tese, ver contagens agregadas somando registros de outra empresa/SPE.

**Correção:** novo helper `scopedRecordList(store, key, user, deps)` (`recordList(...).filter(row =>
deps.scoped(user, row))`), usado no dashboard `legal` para `all`/`active` (de onde derivam
`active-processes`, `"A classificar"` e `legal-quality`) e para cada pasta de `legal-attention`. Nenhum
tratamento especial foi criado para diretoria — `scoped()` já retorna `true` para alçada global, então o
consolidado continua aparecendo normalmente. O dashboard executivo **não foi alterado** (fora do escopo
desta correção; hoje só acessível a quem já tem alçada global, tornando o gap inexistente na prática ali).

Testes adicionados (4 unitários em `tests/core.test.js`, 2 HTTP em `tests/security-integration.test.js`):
- Unitário: usuário da empresa A não conta processo/notificação da empresa B em `active-processes`/
  `"A classificar"`/`legal-quality`/`legal-attention`.
- Unitário: diretoria (alçada global) continua vendo o consolidado de A+B, sem tratamento especial manual.
- Unitário: deny-by-default também por `speId` (usuário da SPE X não conta processo da SPE Y).
- HTTP: comparação antes/depois por usuário (baseline) confirma que `active-processes`/`legal-attention`
  aumentam para o usuário da própria empresa e permanecem inalterados para o usuário de outra empresa,
  com diretoria vendo o consolidado.
- HTTP: mesma comparação antes/depois para `speId`.

## QA planejado — Fase 4 (Google Calendar, Minha Semana, responsável do Legal Deadline)

> **Esta rodada é estritamente documental.** Nenhum teste de código foi adicionado ou executado para os
> cenários abaixo — são critérios de aceite **futuros**, a serem implementados e executados somente após
> homologação das decisões correspondentes em `docs/DECISIONS.md`, seção 1.2 (D4.1–D4.14), e autorização
> explícita para a Fase 4B. Nenhum destes cenários deve ser lido como "já testado" ou "já passando".

### Cenários esperados — Google Calendar (dependem de D4.1 homologada)

1. Usuário com Calendar conectado vê seus compromissos pessoais lado a lado com a Agenda combinada
   (Legal Deadline + `store.agenda`), sem que um vire cópia do outro.
2. Legal Deadline `ativo` aparece no Calendar (se D4.1 aprovar B ou C); `suspenso`/`cumprido`/`cancelado`
   não geram evento novo, e um evento já existente referente a um prazo que mudou de status deixa de
   aparecer como compromisso ativo.
3. `INTERNAL_CONTROL` no Calendar nunca aparece rotulado como prazo processual (mesma regra de D4.1/D4.5).
4. Alteração de `date` no Legal Deadline atualiza o evento existente no Calendar — nunca cria um segundo
   evento duplicado.
5. Reabertura de um Legal Deadline (mesmo `id`) volta a refletir no Calendar sem criar evento novo.
6. Revogação do acesso do usuário ao próprio Google Calendar remove os eventos espelhados, sem afetar o
   Legal Deadline no Patrono.
7. Indisponibilidade da integração de Calendar não altera `status`/`date`/confirmação de nenhum Legal
   Deadline no Patrono; Agenda/Atenção continuam funcionando normalmente sem o Calendar.
8. Nenhum caminho de sincronização permite que uma edição no Google Calendar altere o Legal Deadline de
   volta no Patrono (mesmo se D4.1 aprovar a Opção C).
9. Título do evento no Calendar segue a política definida em D4.7 (recomendação: "Prazo jurídico —
   Patrono", sem identificar o processo).
10. `companyId`/`speId`/`scoped()` continuam sendo respeitados: um usuário nunca recebe, na integração de
    Calendar, um Legal Deadline fora do próprio escopo.

### Cenários esperados — responsável do Legal Deadline / `responsibleUserId` (dependem de D4.2/D4.3)

11. Criar Legal Deadline sem `responsibleUserId` continua válido (campo opcional, conforme proposta D4.3).
12. `responsibleUserId` preenchido com um `user.id` inexistente/inválido é rejeitado (mesma classe de
    validação de integridade já aplicada a `processId`).
13. `responsibleUserId` pode ser diferente do responsável/owner do Legal Process relacionado.
14. Alteração de `responsibleUserId` via `PATCH` é auditada (`before`/`after`, `reason`), pelo mesmo
    mecanismo de auditoria já existente.
15. Usuário responsável desativado/desligado: o Legal Deadline continua existindo, histórico intacto, e a
    view sinaliza "Responsável inativo" (D4.11) até reatribuição formal — nunca oculta o prazo.
16. Nenhuma reatribuição automática por heurística (ex.: por department, por quem criou o registro).

### Cenários esperados — "Minha Semana" (depende de D4.2/D4.3 e D4.10)

17. "Minha Semana" reúne Legal Deadlines e Agenda Events atribuídos ao usuário logado, sem duplicar dado
    de nenhum dos dois.
18. Janela temporal segue a decisão homologada (D4.10 — recomendação: semana civil local, segunda a
    domingo, `America/Sao_Paulo`).
19. Nenhuma Task é criada automaticamente a partir de um Legal Deadline exibido em "Minha Semana"
    (Legal Deadline ≠ Task, D4.9/D4.10).
20. `scoped()`/`allowedInDepartment()`/`companyId`/`speId` continuam sendo aplicados: "Minha Semana" nunca
    revela um item que o usuário não poderia acessar diretamente pela entidade canônica.

### Cenários esperados — copy/labels (dependem de D4.4/D4.5/D4.6)

21. Nenhuma tela usa "Comprovado documentalmente"/"Documento validado"/"Evidência confirmada"/"Fonte
    oficial comprovada" sem `evidenceReference` estruturado (D4.4 — regra já homologada via D1.4).
22. Registro `requires_review` nunca exibe "Confirmado pelo Jurídico" — exibe "Requer revisão" (D4.4/D4.6).
23. Labels de `originType`/`status`/derivados seguem a tabela homologada (D4.5/D4.6), sem inventar rótulo
    novo fora da lista aprovada.

**Nenhum destes 23 cenários foi executado nesta rodada.** Ficam registrados como backlog de QA da Fase
4B, a ser convertido em testes reais (`tests/core.test.js`/`tests/security-integration.test.js`) somente
após a implementação correspondente ser autorizada.
