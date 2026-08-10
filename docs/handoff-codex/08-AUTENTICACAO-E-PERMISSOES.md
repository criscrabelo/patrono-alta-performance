# 08 — Autenticação e permissões

## Fluxo atual

1. `POST /api/auth/login` procura o primeiro usuário pelo e-mail.
2. Compara SHA-256 da senha informada com SHA-256 de `COEVO_DEMO_PASSWORD`.
3. Cria challenge em memória com cinco minutos.
4. Se `requireMfa(user)` retornar verdadeiro, o cliente solicita código.
5. `POST /api/auth/mfa` compara com `COEVO_MFA_CODE` e emite token aleatório.
6. O token fica no `Map sessions`; dura `COEVO_SESSION_MS` ou uma hora.

Não há senha individual persistida, refresh token, logout server-side, revogação, dispositivo confiável ou MFA por usuário.

## Bypass de desenvolvimento

Quando `NODE_ENV !== production`, qualquer bearer iniciado por `usr-` é tratado como ID de usuário existente. O frontend usa `usr-diretoria` como fallback quando não há token. Isso é conveniente para homologação e crítico fora de ambiente controlado.

## Perfis

| Role | Módulos | Ações |
|---|---|---|
| `diretoria` | `*` | read, create, update, archive, restore, approve, export |
| `administrador` | `*` | `*` |
| `lider` | central, estratégia, projetos, agenda, comitês, orçamento, jurídico, TI | read, create, update, archive, export |
| `colaborador` | central, projetos, agenda, jurídico, TI | read, create, update |

Usuários atuais: Diretoria, Líder Jurídico, Líder de Tecnologia e Miguel (colaborador Jurídico).

## Escopo departamental

`scoped(user, item)` permite tudo para diretoria/administrador. Outros perfis veem itens sem `department` ou com `item.department === user.department`.

Limitações:

- Muitos registros usam `departmentId`, mas `scoped` verifica `department` textual.
- Registros Monday não possuem departamento; portanto ficam visíveis a perfis que alcançam a rota jurídica.
- Não há escopo por empreendimento, classificação ou finalidade no runtime, apesar da tabela SQL `access_scopes` preparada.

## Capabilities de Projetos

`projectPermissions` separa `view`, `create`, `edit`, `approveAgreement`, `changeApprovalRule`, `internalizeProcess`, `changeTarget`, `export`, `archive` e `restore`.

- Miguel pode acompanhar/editar o projeto Jurídico, mas não aprovar acordo, alterar alçada, arquivar ou restaurar.
- Diretoria/administrador podem gerir alçadas, metas e decisões.

## Cadastro e aprovação

- Cadastro cria `registrationRequests` com role `colaborador`.
- Aprovação cria usuário com `temporaryPassword: true`, mas não há fluxo de definição/troca de senha.
- O aprovador é gravado por nome.

## Problemas de segurança conhecidos

- Dois usuários seed compartilham o mesmo e-mail; `find` autentica o primeiro.
- `requireMfa` exige MFA somente se `user.mfa` já for true; um privilegiado com flag false não é bloqueado.
- Senha e código MFA são globais.
- Sem rate limiting, lockout, detecção de brute force ou auditoria de tentativas falhas.
- Token fica somente em variável JavaScript, não em cookie HttpOnly; bypass de desenvolvimento amplia o risco.

