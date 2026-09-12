# PERMISSIONS.md — Autorização e Escopo

> Regras oficiais: `docs/MASTER_HANDOFF.md` §11 (Permissões e Segurança), §26 (P0), Anexo A (regra 13).

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

`allowed(user, module, action)` decide por módulo/ação. `scoped(user, item)` decide por registro:
diretoria/administrador veem tudo; os demais só veem registros sem `department` ou com
`department === user.department`.

## Autorização em quatro camadas nesta execução

1. **Sessão/identidade** — `getUser(req)` só aceita token de sessão válido, não expirado e sem
   `challenge` pendente. Não existe bypass de bearer por prefixo (`usr-*`) — removido antes desta
   execução, ver `docs/SECURITY.md`.
2. **Módulo/ação** — `allowed()`.
3. **Registro (escopo departamental)** — `scoped()`.
4. **Tipo de entidade genérica** — `entityModule(type)`, adicionado nesta execução, com
   **deny-by-default**: qualquer `type` fora de `ENTITY_MODULE_MAP` é negado, em vez de aceito por
   coincidência de nome com a lista de módulos.

## P0 corrigidos nesta execução (object-level authorization / IDOR)

| Rota | Problema (documentado em `docs/SEGURANCA-CORRECOES.md`, itens B e H) | Correção |
|---|---|---|
| `GET /api/entities/:type` | Não verificava permissão de módulo — qualquer usuário autenticado lia qualquer coleção trocando `:type` na URL | Passa a exigir `entityModule(type)` mapeado e `allowed(user, module, 'read')` antes de devolver dados |
| `GET /api/legal/:module` | Mesma classe de problema — nenhuma verificação de módulo, apenas escopo departamental do registro | Passa a exigir `allowed(user, 'juridico', 'read')` antes de devolver registros |
| `POST /api/entities/:type/:id/restore` | Verificava módulo, mas não verificava se o registro restaurado pertencia ao escopo do usuário | Passa a exigir também `scoped(user, item)` |

Estas três rotas cobrem os testes obrigatórios do MVP/Piloto Jurídico (§11/§30): "acesso por URL/ID
direto bloqueado" e "escopo por registro/documento respeitado". Testes de regressão em
`tests/core.test.js` (linhas finais) garantem que a verificação não seja removida silenciosamente no
futuro.

## P0 corrigido — MFA por papel, não por flag do cadastro (item D)

`requireMfa(user)` agora depende exclusivamente do papel (`diretoria`, `administrador`, `lider`), nunca
da flag `user.mfa` do cadastro. Antes, um usuário aprovado com papel privilegiado e `mfa: false` recebia
token de sessão direto no login, sem segundo fator — corrigido e coberto por teste de regressão.

## Pendências conhecidas (não resolvidas nesta execução, registradas para P1)

- **Senha global** (`COEVO_DEMO_PASSWORD`) e **código MFA global** (`COEVO_MFA_CODE`) — não há senha nem
  segundo fator por usuário. Estrutural, requer Argon2id/bcrypt e MFA por usuário (ADR-002,
  `docs/DECISIONS.md`).
- **E-mail duplicado** entre `usr-diretoria` e `usr-juridico` — `usr-juridico` não é alcançável pelo
  login normal (primeiro registro por e-mail sempre vence). Aceito pela gestão anteriormente
  (`docs/SEGURANCA-CORRECOES.md`, item J); não alterado nesta execução por não ser P0 de segurança (não
  há escalonamento de privilégio, apenas indisponibilidade de acesso de um cadastro).
- **Escopo por empreendimento/classificação/documento** — `scoped()` cobre apenas departamento; escopo
  mais granular (por empreendimento, por documento, por campo) do §11 ainda não existe.

## Catálogo de testes de permissão obrigatórios do MVP/Piloto Jurídico (§11)

Ver `docs/QA.md` para o detalhamento e mapeamento para os testes automatizados existentes.
