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
tests 70
pass 70
fail 0
```

**`tests/core.test.js` (34 testes)** — unitários e estruturais. Além dos 26 preexistentes e dos 6 da
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

**`tests/security-integration.test.js` (36 testes)** — HTTP real: sobe um servidor
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
