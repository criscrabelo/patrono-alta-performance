# QA.md — Catálogo de Testes

> Regras oficiais: `docs/MASTER_HANDOFF.md` §30 (Checklist QA), §32 (Homologação), §33 (Go-Live Gate).
> Homologação e QA são avaliados **por release/escopo** — funcionalidades deliberadamente fora do MVP
> não bloqueiam a homologação do que foi entregue.

## 10 casos obrigatórios do MVP/Piloto Jurídico (§30) — situação nesta execução

| # | Caso | Situação | Evidência |
|---|---|---|---|
| 1 | Usuário sem acesso tenta registro jurídico → bloqueio server-side, nunca erro técnico | **Coberto** | `allowed(user,'juridico','read')` em `GET /api/legal/:module`; resposta `403 {error:'Sem permissão...'}`, nunca stack trace |
| 2 | Prazo jurídico vence → aparece em Processo, Agenda e Atenção como o mesmo registro | **Fora do Sprint 1** | Agenda/Atenção transversais ainda não consomem `legalDeadlines`; fica para o slice mínimo do Sprint 2 (§24) |
| 3 | Fonte indisponível → último dado válido preservado com status; nenhuma view mostra zero | **Coberto no nível de sincronização Monday** | Ver `docs/INTEGRATIONS.md` — falha de board não apaga nem zera registros existentes; granularidade por registro individual é gap conhecido |
| 4 | Exportação de dado restrito → negada e auditada quando existir no release | **Coberto** | `/api/presentations/export` exige `allowed(user,'comites','export')` e gera entrada de auditoria |
| 5 | Legal Deadline alterado → histórico preservado, prazo anterior não sobrescrito | **Coberto pelo esqueleto** | `PATCH /api/entities/legalDeadlines/:id` incrementa `version` e grava `before`/`after` na auditoria — nada é sobrescrito sem rastro |
| 6 | Legal Deadline suspenso → não exibido como vencimento comum, motivo preservado | **Modelagem permite, UI pendente** | Campo `status` livre suporta "Suspenso"; nenhuma view de Agenda/Atenção ainda interpreta esse status (depende do item 2) |
| 7 | Dois prazos no mesmo processo → coexistem como registros distintos | **Coberto** | `legalDeadlines` é coleção, não campo único — múltiplos registros com o mesmo `processId` coexistem livremente |
| 8 | Prazo sem origem identificada → bloqueado para homologação | **Coberto** | Criação de `legalDeadlines` exige `processId`, `origin`, `date`; ausência de qualquer um retorna `422` |
| 9 | Falha do Monday → não apaga nem altera o último prazo válido conhecido | **Coberto** | Falha de sincronização de board não toca em `legalDeadlines` (coleção não é escrita pelo pipeline de sync, por decisão ADR-003) |
| 10 | Inspeção de frontend/storage + chamada direta a endpoint/ID → nenhum segredo exposto, nenhuma operação autorizada apenas pelo frontend | **Coberto** | Ver `docs/SECURITY.md` — segredos verificados ausentes do frontend; toda autorização é server-side |

**Resultado:** 7 de 10 casos totalmente cobertos nesta execução; os 3 restantes (2, 6 parcial, e o
detalhamento fino de 3) dependem do slice mínimo de Agenda/Atenção do Sprint 2 e de decisão de negócio
pendente (D1), não sendo bloqueio do Sprint 1 conforme a própria v1.3 define o escopo por fase.

## Testes automatizados executados nesta execução

Suíte: `npm test` (Node.js test runner nativo).

```
tests 31
pass 31
fail 0
```

26 testes preexistentes (preservados sem alteração de comportamento) + 5 testes novos desta execução:

1. `entityModule()` nega tipo fora do allowlist, incluindo `__proto__` (deny-by-default).
2. `GET /api/entities` e `GET /api/legal` aplicam `allowed()` por módulo antes de devolver dados.
3. Restauração de entidade genérica respeita escopo departamental do registro.
4. MFA de perfis privilegiados independe da flag `mfa` do cadastro.
5. Legal Deadline não é criado sem origem, processo relacionado ou data.

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

## Próximos passos de QA (fora do Sprint 1)

1. Slice mínimo de Agenda/Atenção consumindo `legalDeadlines` (Sprint 2), habilitando os casos 2 e 6.
2. Testes end-to-end reais contra um servidor HTTP em execução (a suíte atual é majoritariamente estática
   — inspeção de código-fonte e chamadas diretas a funções puras exportadas), especialmente para
   confirmar em runtime os códigos HTTP 401/403/422 das rotas corrigidas.
3. Granularidade de status de frescor por registro individual (não apenas por execução de sincronização).
