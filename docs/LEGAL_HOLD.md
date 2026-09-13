# LEGAL_HOLD.md — Modelo de Legal Hold

> Sprint 2, Hardening H8 (`docs/PRODUCTION_GATE.md`, PG-19; `docs/DECISIONS.md`, PROD-H8-02). Ver
> `docs/DATA_RETENTION.md` para a política de retenção que este mecanismo excepciona.

## 1. O que é

Um **legal hold** é uma suspensão formal e explícita da retenção/descarte automático de um escopo de
dado, aberta quando existe uma obrigação de preservar evidência — processo jurídico em andamento,
investigação de incidente de segurança, pedido de auditoria externa. Enquanto ativo, **nenhum** registro
dentro do seu escopo pode ser removido pelo runner de retenção (`retention/runner.js`), mesmo que
tecnicamente elegível pelo prazo de política.

Legal hold **nunca é o mecanismo padrão** — é a exceção. A ausência de qualquer hold ativo é o estado
normal do sistema; a presença de um hold é sempre uma decisão humana, motivada e auditada.

## 2. Escopos suportados

| `scopeType` | `scopeValue` | Bloqueia |
|---|---|---|
| `GLOBAL` | (nenhum — deve ser omitido) | Todo o descarte automático de qualquer classe, em qualquer entidade |
| `DATA_CLASS` | Uma classe de `retention/policy.js` (ex.: `AUTH_SESSION`) | Toda a classe, para todas as entidades |
| `ENTITY` | Um identificador de entidade, formato livre mas convencionado (ex.: `user:usr-123`) | Apenas os registros relacionados a essa entidade específica |
| `INCIDENT` | Um `incidentId` (formato `INC-YYYYMMDD-XXXXXXXX`, H7) | Dados relacionados a um incidente específico sob investigação |
| `LEGAL_PROCESS` | Um id de `legal_processes` | Dados relacionados a um processo jurídico específico |

`GLOBAL` exige `scopeValue` omitido; todos os outros escopos exigem `scopeValue` não vazio — validado
por `retention/legal-hold.js#validateScope()`, nunca aceito silenciosamente incorreto.

## 3. Modelo de dados (`legal_holds`, `migrations/009_h8_retention_legal_hold.sql`)

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | `uuid` | Chave primária |
| `scope_type` | `text` | `CHECK` contra os 5 valores da tabela acima |
| `scope_value` | `text` | Nulo apenas quando `scope_type = 'GLOBAL'` (`CHECK` de coerência) |
| `reason` | `text` | **Nunca vazio** (`CHECK (length(trim(reason)) > 0)`) — motivo obrigatório de abertura |
| `status` | `text` | `'active'` ou `'released'` |
| `started_at` / `started_by_user_id` | `timestamptz` / `text` | Quem abriu e quando — nunca anônimo |
| `released_at` / `released_by_user_id` / `release_reason` | nullable | Preenchidos apenas na liberação; `CHECK` de coerência com `status` |
| `created_at` / `updated_at` | `timestamptz` | Auditoria de linha |

**Um legal hold nunca é deletado.** Liberar um hold (`releaseLegalHold()`) apenas transiciona
`status: 'active' → 'released'` e preenche os campos de liberação — a linha permanece para sempre como
histórico de que aquele escopo já esteve (e por quanto tempo esteve) sob preservação. Isso é
deliberado: um histórico de holds é, ele próprio, uma peça de evidência relevante (ex.: para provar que
um dado não foi descartado indevidamente durante um período específico).

## 4. Autorização (RBAC)

Não existe um papel dedicado "jurídico" no modelo de papéis atual (`diretoria`/`administrador`/`lider`/
`colaborador`). Em vez de inventar um novo papel ou um bypass, as rotas de legal hold reaproveitam
exatamente a mesma gate já usada por `/api/backup` (ação sensível equivalente): `allowed(user, '*',
'approve')`, satisfeita apenas por `diretoria` e `administrador`. Um usuário `colaborador` recebe `403`
(testado em `H8-http-A`). O papel Técnico/TI (`administrador`) **não ganha acesso automático ao
conteúdo** dos dados sob hold só por poder criar/liberar o hold — a autorização de legal hold é
independente da autorização de leitura/escrita do dado em si.

## 5. Endpoints

Todos exigem sessão autenticada + `allowed(user, '*', 'approve')`.

### `POST /api/legal-holds`

Corpo: `{ scopeType, scopeValue?, reason }`. Cria um hold `active`. Retorna `201` com o hold criado.
`422` se `reason` vazio ou `scopeType`/`scopeValue` inconsistentes (ver §2). Audita
`LEGAL_HOLD_CREATED` com `context` de H8 (`requestId`/`ipHmac`/`userAgentSummary`).

### `POST /api/legal-holds/:id/release`

Corpo: `{ releaseReason }`. Marca o hold como `released`. `422` se `releaseReason` vazio, `404` se o
hold não existe ou já foi liberado. Audita `LEGAL_HOLD_RELEASED`.

### `GET /api/legal-holds`

Query opcional: `status`, `scopeType`, `scopeValue`. Lista holds — **nunca vaza um hold de um escopo
para um filtro de outro escopo** (testado em `H8-hold-E`, cross-scope): filtrar por `scopeValue=X` nunca
retorna holds de `scopeValue=Y`.

## 6. Aplicação do hold no runner de retenção

`retention/legal-hold.js#isUnderLegalHold(pool, { dataClass, entityScopeValue })` é a **função central**,
consultada por `retention/runner.js` antes de qualquer inspeção ou exclusão:

- Um hold `GLOBAL` ativo bloqueia **tudo**.
- Um hold `DATA_CLASS` ativo para a classe consultada bloqueia **toda a classe** (nenhum registro dessa
  classe é elegível a purge enquanto o hold estiver ativo, independentemente de por quanto tempo já
  esteja expirado).
- Um hold `ENTITY`/`INCIDENT`/`LEGAL_PROCESS` ativo bloqueia **apenas os registros daquele escopo
  específico** (ex.: sessões de um único usuário) — os demais registros da mesma classe continuam
  elegíveis normalmente.

O runner primeiro **inspeciona** (conta elegíveis/sob hold/removíveis, nunca altera nada) e só então, em
modo `execute`, reexecuta a mesma lógica de exclusão condicionada — a query de `DELETE` inclui sempre um
`NOT EXISTS` contra `legal_holds` ativos no escopo aplicável, nunca uma checagem em memória separada da
exclusão real (elimina uma janela de corrida entre checar e apagar).

## 7. Nunca confundir com backup

Ver `docs/DATA_RETENTION.md`, seção 8: legal hold preserva **dado/evidência**; backup existe para
**recuperação operacional**. Um dado pode estar sob legal hold sem nunca ter sido perdido/danificado; um
backup pode expirar pela sua própria política sem que isso libere nenhum legal hold ativo sobre o dado
que ele contém.

## 8. Testes

`tests/h8-retention-legal-hold.test.js` — criação/liberação/validação de escopo/reason obrigatório,
liberação nunca deleta a linha, listagem sem vazamento cross-scope, `isUnderLegalHold()` para os três
níveis de escopo (GLOBAL/DATA_CLASS/ENTITY), hold bloqueando purge real do runner (dry-run e execute),
autorização HTTP (`403` para `colaborador`, sucesso para `diretoria`), e verificação de que o token/
segredo de sessão nunca aparece em `audit_log`.

## 9. Referências

- `retention/legal-hold.js`, `migrations/009_h8_retention_legal_hold.sql`.
- `docs/DATA_RETENTION.md`, `docs/PRODUCTION_GATE.md` (seção 25), `docs/DECISIONS.md` (PROD-H8-02).
- `docs/INCIDENT_RESPONSE.md` — o gatilho `legalHoldReviewRequired` de um incidente (H7) agora tem um
  mecanismo real a ser acionado manualmente (`POST /api/legal-holds` com `scopeType: 'INCIDENT'`); H7 em
  si não abre o hold automaticamente — permanece uma decisão humana explícita.
