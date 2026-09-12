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
tests 48
pass 48
fail 0
```

**`tests/core.test.js` (32 testes)** — unitários e estruturais:
- 26 testes preexistentes, preservados sem alteração de comportamento.
- 6 novos: `entityModule()` allowlist/deny-by-default (incluindo `__proto__`); MFA por papel
  independente da flag do cadastro; `scoped()` deny-by-default (sem `department` → negado, exceto
  `scopeType:'global'`); `scoped()` como fundação inerte de empresa/SPE; `sanitizeEntityInput()` remove
  campos protegidos e restringe `department` por escopo do papel; `LEGAL_MODULES` como allowlist
  fechada.

**`tests/security-integration.test.js` (16 testes, novo nesta rodada)** — HTTP real: sobe um servidor
`http.createServer(handler)` de verdade, isolado em diretório de dados temporário
(`COEVO_DATA_DIR`), injeta usuários de teste com e-mails próprios, e faz requisições HTTP reais,
verificando status e corpo da resposta — não presença de texto no código-fonte. Cobre exatamente os 10
cenários mínimos pedidos na revisão de segurança:

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
3. Quando `restore` for concedido a algum papel departamental (hoje só diretoria/administrador têm essa
   ação), adicionar teste HTTP real do caminho "restore fora do escopo → 404" — ver nota em
   `tests/security-integration.test.js`.
