# PERMISSIONS.md — Autorização e Escopo

> Regras oficiais: `docs/MASTER_HANDOFF.md` §11 (Permissões e Segurança), §26 (P0), Anexo A (regra 13).
> **Revisão da rodada 2** (correções de segurança pós-review): este documento foi reescrito para
> refletir exatamente o que está implementado hoje — nada aqui é declarado "protegido" sem verificação
> funcional correspondente em `tests/security-integration.test.js` (HTTP real) ou `tests/core.test.js`
> (unitário).

## Princípio inegociável

**Autorização é obrigatoriamente server-side.** Ocultar menu, botão ou rota no frontend é apenas UX e
nunca substitui autorização. Todo o RBAC deste sistema é decidido e aplicado em `server.js`, nunca em
`public/app.js`.

## Modelo de papéis (`ROLES`, `server.js`)

| Papel | Módulos | Ações |
|---|---|---|
| `diretoria` | `*` | read, create, update, archive, restore, approve, export |
| `administrador` | `*` | `*` |
| `lider` | central, estratégia, projetos, agenda, comitês, orçamento, jurídico, TI | read, create, update, archive, export |
| `colaborador` | central, projetos, agenda, jurídico, TI | read, create, update |

**Nota sobre o desenho atual:** `lider` e `colaborador` incluem os módulos `juridico` e `ti`
**independentemente do próprio departamento** — ou seja, o gate de módulo (`allowed()`) por si só não
impede um líder de TI de *tentar* uma rota jurídica; quem impede é o gate de escopo por registro
(`scoped()`), descrito abaixo. Isso é comportamento pré-existente do desenho de `ROLES`, não alterado
nesta execução — documentado aqui para não ser confundido com uma falha do gate de módulo.

## Autorização em camadas (o que existe hoje, nesta ordem, por rota)

1. **Sessão/identidade** — `getUser(req)` só aceita token de sessão válido, não expirado e sem
   `challenge` pendente. Não existe bypass de bearer por prefixo (`usr-*`).
2. **Módulo/ação** — `allowed(user, module, action)`, por papel (ver nota acima sobre `lider`/`ti`).
3. **Allowlist de rota** (`/api/legal/:module` apenas) — `LEGAL_MODULES`, um `Set` fechado dos nomes de
   módulo aceitos nessa rota específica. Corrigido na rodada 2 (ver abaixo).
4. **Tipo de entidade genérica** (`/api/entities/:type` apenas) — `entityModule(type)`, com
   **deny-by-default**: qualquer `type` fora de `ENTITY_MODULE_MAP` é negado.
5. **Escopo do registro** — `scoped(user, item)`, reescrito na rodada 2 para deny-by-default (ver
   abaixo).
6. **Campos do corpo da requisição** — `sanitizeEntityInput(input, user)`, adicionado na rodada 2, para
   que o cliente não possa controlar campos estruturais/de auditoria/de escopo do próprio registro.

## P0 corrigidos — rodada 1 (auditoria inicial)

| Rota | Problema | Correção |
|---|---|---|
| `GET /api/entities/:type` | Não verificava permissão de módulo | `entityModule(type)` + `allowed(user, module, 'read')` |
| `GET /api/legal/:module` | Não verificava permissão de módulo | `allowed(user, 'juridico', 'read')` |
| `requireMfa()` | Dependia da flag `mfa` do cadastro, não do papel | MFA exigido pelo papel, sempre |

## P0 corrigidos — rodada 2 (revisão de segurança e integridade)

A rodada 1 corrigiu a **ausência** de checagem de módulo, mas deixou duas lacunas que esta rodada fecha:

### 1. `GET /api/legal/:module` ainda usava `:module` para indexar a coleção diretamente

A correção da rodada 1 verificava `allowed(user, 'juridico', 'read')` — permissão de **módulo** — mas
`moduleName` continuava vindo cru da URL e sendo usado como chave em `collection(store, moduleName)`,
que **cria a coleção se ela não existir**. Um usuário com acesso a `juridico` podia trocar `:module`
para qualquer string (`legalDeadlines`, `users`, qualquer nome arbitrário) e ler — ou fazer o servidor
criar incidentalmente — uma coleção fora do conjunto de boards jurídicos reais.

**Correção:** `LEGAL_MODULES` é um `Set` fechado com exatamente os nomes de módulo válidos para essa
rota (as chaves de `MONDAY_BOARDS` + `honorariosJudiciais`, que é um payload derivado, não uma coleção
própria). Qualquer `moduleName` fora desse conjunto retorna `404` **antes** de qualquer chamada a
`collection()` — a coleção nunca é tocada, lida ou criada.

Testado em runtime: `tests/security-integration.test.js` → `GET /api/legal/legalDeadlines` e
`GET /api/legal/users` retornam 404, e uma chamada subsequente a `GET /api/entities/legalDeadlines`
confirma que nada foi criado incidentalmente.

### 2. Campos controlados pelo servidor podiam ser sobrescritos pelo cliente

`POST`/`PATCH` em `/api/entities/:type` faziam `{...input}` (ou `Object.assign(item, input, ...)`) sem
nenhuma sanitização — o cliente podia enviar `id`, `version`, `createdAt`, `createdBy`, `updatedAt`,
`updatedBy`, `deletedAt`, `deletedBy`, metadados de origem (`source`, `externalId`, `boardId`,
`boardName`, `syncedAt`) ou um `department` diferente do seu próprio, na tentativa de forjar identidade,
histórico ou escopo do registro.

**Correção:** `sanitizeEntityInput(input, user)` remove a lista fixa `PROTECTED_ENTITY_FIELDS` do input
antes de qualquer atribuição, e também remove `department` do input a menos que o papel do usuário tenha
escopo global (`ROLES[user.role].scopes.includes('*')` — hoje, apenas `diretoria`/`administrador`). Os
campos controlados pelo servidor são então atribuídos **depois** do input sanitizado no objeto final
(`{...sanitized, id: ..., version: ..., ...}`), garantindo que nenhuma chave sobrevivente do input possa
vencer por ordem de propriedades.

Testado em runtime: `tests/security-integration.test.js` envia um corpo malicioso completo (todos os
campos protegidos + `department` de outro departamento) em `POST` e `PATCH`, e verifica que o registro
resultante não adota nenhum desses valores.

### 3. `scoped()` tratava ausência de `department` como acesso liberado

Antes: `!item.department` retornava `true` — um registro sem classificação de departamento era, na
prática, global por omissão. Isso escondia dois problemas: (a) qualquer entidade nova criada sem pensar
em `department` nasceria acessível a todo mundo; (b) registros sincronizados do Monday (que não
carregavam `department` algum) eram visíveis a **qualquer** usuário com acesso ao módulo `juridico` —
inclusive um líder de TI, já que `lider` inclui `juridico` em seus módulos (ver nota acima).

**Correção — duas partes:**

1. `scoped()` reescrita para **deny-by-default**: um registro sem `department` **e** sem
   `scopeType: 'global'` explícito é **negado** para papéis não privilegiados, não liberado.
2. `normalizeMondayItem()` passou a atribuir `department: 'Jurídico'` explicitamente a todo registro
   sincronizado do Monday — correto, porque todos os boards em `MONDAY_BOARDS` pertencem ao Jurídico.
   Sem isso, o efeito colateral da correção de `scoped()` seria bloquear também o Jurídico de ver seus
   próprios registros (já que eles não carregavam `department` nenhum).

```js
function scoped(user, item) {
  if (user.role === 'diretoria' || user.role === 'administrador') return true;
  if (item.scopeType === 'global') return true;
  if (item.companyId && user.companyId && item.companyId !== user.companyId) return false;
  if (item.speId && user.speId && item.speId !== user.speId) return false;
  if (!item.department) return false;
  return item.department === user.department;
}
```

**Efeito colateral desejado e verificado:** um líder de TI agora recebe uma listagem de
`/api/entities/legalDeadlines` que **não inclui** registros do Jurídico, e um `PATCH`/`restore` por ID
direto contra um registro do Jurídico retorna `404` para um usuário de TI — cobrindo o cenário do
Catálogo Global de Regressão (§30): "TI tenta acessar Jurídico → bloqueado no backend". Testado em
`tests/security-integration.test.js`.

### 4. Empresa/SPE — fundação preparada, **não implementada**

A v1.3 exige autorização por ambiente/empresa/SPE/módulo/registro. **Nenhum cadastro de empresa ou SPE
existe neste repositório** — não foram inventados IDs. O que existe, e é **inerte** até que esse
cadastro seja criado:

- `scoped()` verifica `item.companyId`/`user.companyId` e `item.speId`/`user.speId` **somente quando
  ambos os lados carregam esses campos** — hoje nenhum registro nem usuário os carrega, então essas
  linhas nunca são exercitadas em produção. É a fundação do gate, não o gate em operação.
- Não existe endpoint, tela ou cadastro para criar/gerenciar empresas ou SPEs.
- Não existe conceito de "Ambiente" (Visão Executiva / Jurídico / TI / VELKOR) como filtro de
  autorização de primeira classe — hoje a segregação real em produção é por `department` (Jurídico, TI).

**Isto NÃO deve ser lido como "empresa/SPE já está protegido"** — está preparado para não exigir nova
revisão de `scoped()` quando o cadastro existir, e nada além disso.

## P0 corrigido — MFA por papel, não por flag do cadastro (item D, rodada 1)

`requireMfa(user)` depende exclusivamente do papel (`diretoria`, `administrador`, `lider`), nunca da
flag `user.mfa` do cadastro. Testado em runtime: login como papel privilegiado sempre retorna
`mfaRequired: true`, nunca um token direto, independentemente de `user.mfa`.

## Pendências conhecidas (não resolvidas nesta execução, registradas para P1)

- **Senha global** (`COEVO_DEMO_PASSWORD`) e **código MFA global** (`COEVO_MFA_CODE`) — não há senha nem
  segundo fator por usuário. Ver `docs/SECURITY.md` para a classificação de bloqueio.
- **E-mail duplicado** entre `usr-diretoria` e `usr-juridico`** — não alterado nesta execução (aceito
  anteriormente pela gestão, `docs/SEGURANCA-CORRECOES.md` item J).
- **Escopo por empreendimento/classificação/documento** — `scoped()` cobre departamento e (de forma
  inerte) empresa/SPE; escopo mais granular por empreendimento/documento/campo do §11 ainda não existe.
- **`restore` só existe para `diretoria`/`administrador`** — não há papel departamental capaz de
  restaurar, então o gate de escopo em `restore` (`scoped(user, item)`, presente no código) não é
  exercitável via HTTP hoje; coberto apenas por teste unitário direto de `scoped()`.

## Catálogo de testes de permissão

- **Unitários** (`tests/core.test.js`): `scoped()`, `sanitizeEntityInput()`, `entityModule()`,
  `LEGAL_MODULES`, `requireMfa()` — chamadas diretas às funções exportadas, sem passar por HTTP.
- **Integração HTTP real** (`tests/security-integration.test.js`): sobe um servidor HTTP real com o
  `handler` exportado, injeta usuários de teste com e-mails próprios (contornando a limitação conhecida
  de e-mail duplicado do seed), e faz requisições reais, verificando status HTTP e corpo da resposta —
  não apenas presença de texto no código-fonte.

Ver `docs/QA.md` para o mapeamento completo contra os 10 casos obrigatórios do MVP/Piloto Jurídico
(§30) e o resultado da execução mais recente.
