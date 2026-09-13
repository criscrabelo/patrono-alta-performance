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

## QA — Fase 4B (Google Calendar, Minha Semana, responsável do Legal Deadline) — implementada e testada

> A Fase 4B implementou e testou os cenários abaixo (`tests/core.test.js`/`tests/security-integration.test.js`,
> `npm test` — 239 testes, todos passando). Os cenários 1–5 (Google Calendar Opção B) foram cobertos no
> nível de *adapter* (sem credenciais reais de OAuth neste ambiente — blocker técnico registrado em
> `docs/INTEGRATIONS.md`): a leitura real de compromissos não pôde ser exercitada de ponta a ponta, mas o
> comportamento de somente-leitura, ausência de token exposto e não-afetação do Legal Deadline foram
> testados com a integração no estado `not_configured`/`events: []`. Os cenários 6–11 (Opção C, escrita)
> permanecem **não aplicáveis** — não homologados. Os cenários 12–21 (responsável/Minha Semana) e 25–26
> (D4.15) estão testados integralmente. Os cenários 22–24 (copy/labels D4.4/D4.5/D4.6) estão testados via
> `originTypeLabel`/`statusLabel`/`categoryLabel`/`confirmationLabel`.

### Cenários esperados — Google Calendar, Opção B homologada (D4.1: leitura apenas)

1. Usuário com Calendar conectado (consentimento OAuth próprio) vê seus compromissos pessoais lado a
   lado com a Agenda combinada (Legal Deadline + `store.agenda`), sem que um vire cópia do outro.
2. Patrono nunca cria, atualiza ou remove nenhum evento no Google Calendar do usuário (a Opção B é
   leitura pura — nenhum destes três testes deve encontrar escrita externa).
3. Indisponibilidade da leitura de Calendar não altera `status`/`date`/confirmação de nenhum Legal
   Deadline no Patrono; Agenda/Atenção continuam funcionando normalmente sem o Calendar (D4.8).
4. `companyId`/`speId`/`scoped()` continuam sendo respeitados: a visualização de Calendar nunca revela um
   Legal Deadline fora do próprio escopo do usuário (o Calendar mostra só compromissos pessoais do
   próprio usuário; a Agenda combinada ao lado continua usando `scopedLegalDeadlineRows()`).
5. Revogação do acesso do usuário ao próprio Google Calendar simplesmente interrompe a visualização
   complementar — nenhum Legal Deadline no Patrono é afetado (não há nada espelhado para remover).

### Cenários esperados — Google Calendar, Opção C (NÃO homologada; só se uma decisão futura separada a aprovar)

Os cenários abaixo só se tornam aplicáveis **se** uma decisão de negócio futura e separada vier a
homologar o espelhamento com escrita (D4.1 registra essa opção apenas como possibilidade futura — não
para o piloto atual):

6. Legal Deadline `ativo` geraria evento no Calendar; `suspenso`/`cumprido`/`cancelado` não gerariam
   evento novo, e um evento já existente referente a um prazo que mudou de status deixaria de aparecer
   como compromisso ativo.
7. `INTERNAL_CONTROL` no Calendar nunca apareceria rotulado como prazo processual (mesma regra de D4.5).
8. Alteração de `date` no Legal Deadline atualizaria o evento existente no Calendar — nunca criaria um
   segundo evento duplicado.
9. Reabertura de um Legal Deadline (mesmo `id`) voltaria a refletir no Calendar sem criar evento novo.
10. Nenhum caminho de sincronização permitiria que uma edição no Google Calendar alterasse o Legal
    Deadline de volta no Patrono.
11. Título do evento seguiria a recomendação preservada em D4.7 ("Prazo jurídico — Patrono").

### Cenários esperados — responsável do Legal Deadline / `responsibleUserId` (D4.2/D4.3 homologadas)

12. Criar Legal Deadline sem `responsibleUserId` continua válido (campo opcional, homologado em D4.3).
13. `responsibleUserId` preenchido com um `user.id` inexistente/inativo é rejeitado (mesma classe de
    validação de integridade já aplicada a `processId`).
14. `responsibleUserId` pode ser diferente do responsável/owner do Legal Process relacionado.
15. Alteração de `responsibleUserId` via `PATCH` é auditada (`before`/`after`, `reason`), pelo mesmo
    mecanismo de auditoria já existente.
16. Usuário responsável desativado/desligado: o Legal Deadline continua existindo, histórico intacto, e a
    view sinaliza "Responsável inativo" (D4.11, homologada) até reatribuição formal — nunca oculta o
    prazo.
17. Nenhuma reatribuição automática por heurística (ex.: por department, por quem criou o registro).

### Cenários esperados — "Minha Semana" (D4.2/D4.3/D4.10 homologadas)

18. "Minha Semana" reúne Legal Deadlines atribuídos ao usuário logado, sem duplicar dado. **Gap conhecido
    (não resolvido nesta rodada):** Agenda Events manuais (`store.agenda`) NÃO entram em Minha Semana —
    o campo `owner` é texto livre, sem `user.id` canônico, e inferir por nome seria a mesma "substituição
    textual" vedada para `responsibleUserId` (ver `docs/DATA_MODEL.md`, seção "Fase 4B").
19. Janela temporal é a semana civil homologada (D4.10 — segunda a domingo, `America/Sao_Paulo`; não
    janela móvel de 7 dias).
20. Nenhuma Task é criada automaticamente a partir de um Legal Deadline exibido em "Minha Semana"
    (Legal Deadline ≠ Task, D4.9/D4.10).
21. `scoped()`/`allowedInDepartment()`/`companyId`/`speId` continuam sendo aplicados: "Minha Semana" nunca
    revela um item que o usuário não poderia acessar diretamente pela entidade canônica.

### Cenários esperados — copy/labels (D4.4/D4.5/D4.6 homologadas)

22. Nenhuma tela usa "Comprovado documentalmente"/"Documento validado"/"Evidência confirmada"/"Fonte
    oficial comprovada" sem `evidenceReference` estruturado (D4.4 — regra já homologada via D1.4).
23. Registro `requires_review` nunca exibe "Confirmado pelo Jurídico" — exibe "Requer revisão" (D4.4/D4.6).
24. Labels de `originType`/`status`/derivados seguem a tabela homologada (D4.5/D4.6), sem inventar rótulo
    novo fora da lista aprovada.

### Cenários esperados — visibilidade de cumprido/cancelado na Agenda (D4.15 homologada)

25. Legal Deadline `cumprido`/`cancelado` não aparece por padrão em `GET /api/agenda-items` (view
    operacional), mas continua acessível via filtro explícito de status/histórico e no detalhe.
26. Legal Deadline `suspenso` não aparece como prazo ativo/vencido na Agenda operacional (consistente com
    a regra de que `suspenso` nunca é atraso).

**Todos os cenários aplicáveis (12–26, exceto os de Opção C não homologada) foram convertidos em testes
reais nesta rodada** (`tests/core.test.js`/`tests/security-integration.test.js`), todos passando. Os
cenários 1–5 (Google Calendar Opção B) foram testados no nível de adapter — a leitura real depende de
credenciais de OAuth ainda não provisionadas neste ambiente (blocker técnico, `docs/INTEGRATIONS.md`).

## QA final — encerramento do Sprint 2

Rodada estritamente documental (`docs/DECISIONS.md`, D2-CLOSE) — nenhum teste foi adicionado ou removido
aqui; esta seção apenas consolida o estado de QA já registrado nas Fases 1–4B para o encerramento formal.

- **Total: 254 testes**, 0 falhando, na master consolidada após o PR #8
  (`3eff813a6e5a9996a10164b33f10d00c087161c2`).
- **Node 20.x:** verde. **Node 22.x:** verde — confirmado antes do merge final do PR #8.
- **P0/P1 abertos:** 0.
- **Gaps aceitos** (não são falhas de teste — comportamento explicitamente não implementado, registrado):
  Agenda Events manuais fora de Minha Semana; ausência de "desatribuir" `responsibleUserId`; Google
  Calendar real não ativado.
- **Item não testado por dependência externa:** leitura real de compromissos do Google Calendar (fluxo de
  consentimento OAuth, dados reais de um usuário) — não executado end-to-end nesta rodada por ausência de
  credenciais de OAuth (`GOOGLE_CALENDAR_CLIENT_ID`/`GOOGLE_CALENDAR_CLIENT_SECRET`) neste ambiente. O
  adapter e o contrato read-only (status `not_configured`/`unavailable`, ausência de método de escrita,
  ausência de token exposto, filtro pela janela civil de "Minha Semana") **foram** testados.

## QA — Hardening H1A (persistência PostgreSQL)

- **278 testes totais** (254 do Sprint 2 + 24 novos: 21 em `tests/storage.test.js`, 3 em
  `tests/security-integration-postgres.test.js`), 0 falhando, sem remoção de nenhum teste anterior.
- Sem `TEST_DATABASE_URL` configurada: os testes específicos de Postgres são **pulados explicitamente**
  (2 testes `skip`), nunca fingindo cobertura — o restante (276) roda normalmente contra o fallback local.
- Com `TEST_DATABASE_URL` apontando para um Postgres de teste isolado (nunca produção): **278/278**,
  0 pulados — inclui concorrência real (duas leituras da mesma versão, conflito detectado, HTTP 409),
  transação (mutação + auditoria persistidas juntas, nunca uma sem a outra), fail-fast em produção,
  healthcheck, importação JSON→Postgres com `--dry-run` e real.
- CI (`.github/workflows/ci.yml`) ganhou um serviço `postgres:16` isolado para rodar essa mesma bateria
  em todo PR/push, nos dois `Node 20.x`/`Node 22.x`.
- `npm audit`: inalterado (2 vulnerabilidades altas conhecidas, `image-size`/`pptxgenjs` — H9).

## QA — Hardening H1B (normalização relacional do núcleo canônico)

- **319 testes totais** com `TEST_DATABASE_URL` (278 do H1A + 41 novos: 29 em
  `tests/h1b-core-relational.test.js`, 11 de validação pura de `scripts/migrate-h1b-data.js` em
  `tests/storage.test.js`), 0 falhando, sem remoção de nenhum teste anterior.
- Sem `TEST_DATABASE_URL`: **280 testes**, 277 passam, 3 pulados explicitamente (os 2 já existentes do
  H1A + 1 novo de `tests/h1b-core-relational.test.js`) — nunca fingindo cobertura de Postgres que não
  existe.
- Cobertura por categoria (nomenclatura A–Z do plano de execução do H1B):
  - **A–C** (users): CRUD básico via ponte relacional, e-mail duplicado permitido (gap documentado, não
    uma regressão), `deletedAt` preservado com login rejeitado para usuário inativo.
  - **D–E** (Legal Process/Legal Deadline persistidos): tabela relacional confirmada por consulta SQL
    direta, nunca mais dentro do blob.
  - **F–J** (integridade referencial): `processId`/`responsibleUserId` órfão rejeitado tanto na validação
    de aplicação quanto (segunda linha de defesa) pela FK real do banco, bypassando a aplicação;
    `responsibleUserId` opcional aceito; `status`/`originType` fora do enum rejeitados pela CHECK
    constraint do banco, também bypassando a aplicação.
  - **K** (concorrência): duas leituras do mesmo Legal Deadline, a primeira escrita vence, a segunda
    recebe `StoreConflictError` — via `version` própria da linha, não mais só a `version` global do blob.
  - **L–M** (transação/rollback): criação persiste Legal Deadline + evento de auditoria juntos; falha
    simulada na gravação do evento de auditoria reverte a transação inteira — nem o Legal Deadline nem o
    audit ficam persistidos.
  - **N–O** (reabertura/archive/restore): mesmas regras de negócio já homologadas (reabertura exige
    `reason`; archive/restore preserva a linha via `deletedAt`), agora sobre a tabela relacional.
  - **P–R** (Agenda/Atenção/Minha Semana): as três views continuam funcionando idênticas, lendo da tabela
    relacional em vez do blob.
  - **U–V** (regressão de RBAC): segregação TI≠Jurídico e "administrador técnico ≠ superusuário de
    conteúdo" seguem negando corretamente, mesmo com o dado vindo de tabelas relacionais.
  - **W** (audit append-only): múltiplas mutações no mesmo registro geram múltiplos eventos, nenhum
    sobrescrito.
  - **X–Z** (`scripts/migrate-h1b-data.js`): `--dry-run` nunca grava; importação real popula as 4 tabelas
    e faz o cutover (remove as 4 chaves do blob); reimportação sem `--force` é recusada, com `--force` é
    idempotente (`ON CONFLICT DO NOTHING`, nunca duplica); um órfão crítico aborta a importação inteira
    sem gravar nada.
  - Teste de regressão dedicado para um bug real encontrado e corrigido durante esta rodada: a ordenação
    de leitura das tabelas relacionais (`ORDER BY id`) mudava a ordem efetiva de `store.users` em relação
    à ordem de inserção original do array JSONB, alterando silenciosamente qual usuário “vence” em um
    `find()` por email duplicado — corrigido para `ORDER BY created_at, id` e coberto por teste próprio.
  - **Marcador de cutover H1B** (blocker P1 corrigido em revisão final, antes da homologação): migration
    de schema (004 aplicada) ≠ migração de dados. Testes dedicados com Postgres real confirmam: (A/B/C)
    migration 004 aplicada sem o marcador de cutover em `data_migrations` faz `storage.init()` falhar
    explicitamente, `app_users` permanece vazio (nenhum bootstrap automático) e as 4 coleções continuam
    íntegras no `app_store`; (D/E) depois que `scripts/migrate-h1b-data.js` grava o marcador,
    `storage.init()` passa a funcionar normalmente; (F/G/H) uma falha no MEIO da transação de cutover
    (um valor de `date` inválido para a coluna SQL, depois de usuário/processo/um Legal Deadline válido já
    terem sido inseridos na mesma transação) reverte TUDO — tabelas relacionais, blob e marcador, nunca
    estado parcial; (J/K) `healthcheck()` reporta `schemaReady:false` antes do cutover e `true` depois.
    Também corrigido: `hasCriticalIssues()` em `scripts/migrate-h1b-data.js` calculava
    `processesReport.invalid`/`auditReport.invalid` mas nunca os usava na decisão de abortar — corrigido
    para depender só da validação já conhecida no `--dry-run`, nunca de uma constraint SQL posterior
    detectar algo que o relatório já sabia.
- CI roda `tests/h1b-core-relational.test.js` contra bancos Postgres **isolados**, criados e derrubados
  pelo próprio arquivo de teste (`CREATE DATABASE`/`DROP DATABASE`), para nunca colidir com
  `tests/storage.test.js`/`tests/security-integration-postgres.test.js` rodando em paralelo no mesmo
  serviço `postgres:16`.
- `npm audit`: inalterado (2 vulnerabilidades altas conhecidas, `image-size`/`pptxgenjs` — H9).

## QA — Hardening H2 (autenticação individual, MFA individual e sessões persistentes)

- **342 testes totais** com `TEST_DATABASE_URL` (319 do H1B + 23 novos em
  `tests/h2-auth-sessions.test.js`), 0 falhando, sem remoção de nenhum teste anterior. As 3 suítes
  pré-existentes que fazem login via HTTP (`security-integration.test.js`,
  `security-integration-postgres.test.js`, `h1b-core-relational.test.js`) foram atualizadas para o novo
  fluxo — `loginAs()` usa senha individual (via `authCrypto.verifyPassword`) e, quando MFA é exigido, um
  código TOTP real calculado a partir do segredo fixo de desenvolvimento, contra o endpoint renomeado
  `POST /api/auth/mfa/verify` — sem alterar o que cada teste efetivamente verifica.
- Sem `TEST_DATABASE_URL`: comportamento inalterado (os testes específicos de Postgres continuam pulados
  explicitamente, nunca fingindo cobertura).
- Cobertura por categoria (`tests/h2-auth-sessions.test.js`, nomenclatura A–Z/restart/multi-instância):
  - **A** (senha): correta aceita, incorreta e e-mail inexistente recebem o mesmo 401 genérico.
  - **B** (hash nunca exposto): `GET /api/me` nunca devolve `passwordHash`/`mfaSecretEncrypted`; a coluna
    `password_hash` no banco está sempre no formato `scrypt$...`, nunca a senha em texto puro.
  - **C** (senha temporária): `temporaryPassword:true` restringe a conta a uma allowlist de autogestão
    (`ACCOUNT_SETUP_REQUIRED`) até a troca de senha; a senha temporária não pode virar a senha nova.
  - **D** (MFA individual): o segredo TOTP do usuário A nunca valida o código do usuário B; cada usuário
    com MFA próprio loga corretamente com o próprio segredo.
  - **E** (código/challenge inválido): código incorreto rejeitado sem emitir token; challenge expirado
    rejeitado mesmo com código correto (expiração ajustada via SQL direto, já que o repository de
    `auth_challenges` só persiste `used_at`/`attempts` em `update()` — `expires_at` é imutável após a
    criação, por design).
  - **F** (uso único do challenge): um challenge já confirmado não pode emitir uma segunda sessão.
  - **G/H/I** (sessão persistida/hash/token bruto): `auth_sessions.token_hash` bate com o hash do token
    devolvido ao cliente; nenhuma linha da tabela contém o token bruto em qualquer coluna.
  - **J** (expiração): sessão expirada nega acesso (401) sem esperar logout.
  - **K/L** (logout/logout-all): logout revoga só a sessão atual; logout-all revoga todas as sessões do
    usuário, inclusive as emitidas por outros logins.
  - **M/N** (troca/reset de senha revogam sessões): sessão emitida antes da troca/reset deixa de
    funcionar (`credentials_version` divergente); a nova sessão emitida pela própria troca continua
    válida; o token de reset é reaproveitado por SQL direto (o repository de `password_reset_tokens` só
    persiste `used_at` em `update()` — `token_hash` é imutável pela ponte, por design) para exercitar o
    fluxo completo sem depender de um canal de e-mail (fora de escopo desta rodada).
  - **O** (`deletedAt`): usuário inativado perde acesso imediatamente, dentro da própria janela de
    expiração original; não consegue iniciar nova sessão.
  - **P** (`credentials_version`): sessão com versão divergente da do usuário é rejeitada.
  - **Q/R** (bloqueio/desbloqueio): 5 tentativas malsucedidas bloqueiam a conta por um período; após o
    período (simulado ajustando `locked_until` para o passado), o login volta a funcionar com a senha
    correta.
  - **S/T** (auditoria): `LOGIN_FAILURE`/`MFA_CHALLENGE`/`MFA_SUCCESS`/`LOGIN_SUCCESS`/`LOGOUT` presentes;
    nenhum evento contém a senha em texto puro, o segredo MFA ou o hash do token de sessão.
  - **U** (token de reset expirado): rejeitado mesmo dentro da janela de uso único.
  - **Restart**: sessão emitida antes de um "restart" simulado (módulo `server.js`/`storage` recarregado
    do zero, HTTP e pool de Postgres anteriores encerrados) continua válida depois — prova de que a
    sessão nunca dependeu de estado em memória do processo.
  - **Multi-instância**: duas instâncias independentes (dois módulos `server.js`/`storage` carregados
    separadamente, cada uma com seu próprio Pool) compartilhando o MESMO Postgres — uma sessão criada
    pela instância A é validada pela instância B; uma revogação feita na instância A reflete
    IMEDIATAMENTE na instância B (sem esperar expiração), confirmando que a revogação é uma propriedade
    do banco compartilhado, não do processo que a emitiu.
- CI roda `tests/h2-auth-sessions.test.js` contra um banco Postgres **isolado**, criado e derrubado pelo
  próprio arquivo de teste, no mesmo padrão de `tests/h1b-core-relational.test.js` — nunca colide com os
  demais arquivos de teste rodando em paralelo no mesmo serviço `postgres:16`.
- `npm audit`: inalterado (2 vulnerabilidades altas conhecidas, `image-size`/`pptxgenjs` — H9; não
  corrigidas nesta rodada, deliberadamente fora do escopo de H2).

## QA — Adendo ao Hardening H2 (revisão pós-PR #13)

Correção de 5 blockers identificados na revisão técnica humana do PR #13, antes do merge
(`docs/DECISIONS.md`, PROD-H2-01, adendo).

- **352 testes totais** com `TEST_DATABASE_URL` (342 anteriores + 10 novos), 0 falhando, nenhum teste
  removido. `tests/h1b-core-relational.test.js` e `tests/security-integration.test.js` tiveram seus
  `loginAs()` ajustados para usar `login_identifier` no único caso de e-mail deliberadamente duplicado
  em cada arquivo (a diretoria do seed principal; o usuário líder duplicado propositalmente pelo próprio
  teste [H1B-B] para provar a ausência de `UNIQUE(email)`).
- **2 testes novos em `tests/core.test.js`**:
  - TOTP verificado contra os 6 vetores de teste oficiais do RFC 6238 (Apêndice B, SHA1, 8 dígitos —
    `totpAt()` aceita `digits` como parâmetro só para bater exatamente com o vetor publicado, sem alterar
    o padrão de 6 dígitos usado em produção).
  - `validateAuthRuntimeConfig()`: produção sem `MFA_ENCRYPTION_KEY` falha; produção com chave curta
    (<32 caracteres) falha; produção com chave válida aceita; fora de produção, ausência da chave nunca
    impede o carregamento do módulo.
- **8 testes novos em `tests/h2-auth-sessions.test.js`** cobrindo o fluxo administrativo de primeiro
  acesso/identidade única/anti-enumeração:
  - Usuário recém-aprovado nasce com `passwordHash:null` e não consegue logar sem um token de ativação.
  - Operador sem `allowed(user,'*','approve')` não consegue emitir token administrativo para outro
    usuário (403).
  - Operador autorizado emite o token (`POST /api/auth/users/:id/reset-token`): resposta contém o token
    bruto uma única vez; o banco (`password_reset_tokens.token_hash`) contém só o hash, nunca o bruto; o
    evento de auditoria correspondente nunca contém o token bruto; o token permite definir a primeira
    senha; depois de usado, não pode ser reaproveitado; após definida a senha, o usuário segue o fluxo
    normal de login.
  - Dois usuários com o mesmo e-mail: login por e-mail ambíguo falha (nunca first-match); login por
    `login_identifier` autentica exatamente o usuário correto; a senha de um nunca autentica o outro.
  - `forgot-password` com e-mail ambíguo não cria nenhum token de reset (nunca escolhe um registro
    arbitrário); o fluxo administrativo por `userId` continua funcionando corretamente mesmo com e-mail
    compartilhado.
  - `login_identifier` tem índice único no banco (`pg_indexes`) e todo usuário da suíte (seed, backfill
    ou criado no teste) tem um valor próprio, sem colisões.
  - Login inexistente, senha errada, usuário inativo, conta bloqueada e e-mail ambíguo respondem
    exatamente o mesmo `401`/"Credenciais inválidas" — nenhum distingue o motivo externamente
    (anti-enumeração).
- **Descoberta durante a correção**: o backfill de conveniência de senha para usuários legados/de teste
  (`backfillDevAuthFields()`) não podia mais usar `!candidate.passwordHash` como único sinal — depois de
  um round-trip pelo Postgres, a coluna nulável sempre volta como `null` (nunca `undefined`), então
  `null` deixou de distinguir "usuário legado sem o campo" de "usuário genuinamente pendente de primeiro
  acesso real". Corrigido para usar `temporaryPassword === true` como sinal adicional (uma coluna
  `boolean NOT NULL`, que sobrevive ao round-trip exatamente como gravada) — só objetos legados/de teste
  que nunca declaram esse campo continuam recebendo a senha de conveniência.
- CI roda a mesma bateria (Node 20.x/22.x, Postgres real) sem nenhum teste pulado.
- `npm audit`: inalterado (2 vulnerabilidades altas conhecidas — H9, não corrigidas nesta rodada).
