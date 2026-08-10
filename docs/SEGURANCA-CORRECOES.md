# Correções de segurança — 09–10/08/2026

> Complementa `docs/handoff-codex/`, que permanece como fotografia do repositório em 09/08/2026.
> Este documento registra apenas o que mudou depois daquela fotografia. Nenhum segredo é reproduzido aqui.
>
> **Commits desta sequência:** `4caf155` (saneamento do histórico, seção 1) · `ef3e589` (credenciais
> expostas e placeholder, seções 2 a 7) · `c6e2b78` (bypass de autenticação, seção 8).
> **Estado das pendências:** A e C resolvidos; B, D, E, F, G, H, I e J em aberto.

## Contexto

Auditoria de assunção do projeto identificou exposição de dados operacionais e de credenciais no
repositório e no código servido ao cliente. As correções abaixo foram executadas de forma incremental,
com autorização explícita por etapa, preservando `data/store.json` byte a byte em todas elas.

## 1. Saneamento do repositório Git

O repositório possui **um único commit** e **nunca teve remote nem push** — verificado por ausência de
`refs/remotes`, ausência de seção `[remote]` em `.git/config`, ausência de `FETCH_HEAD`/`ORIG_HEAD`/
`packed-refs` e reflog com uma única entrada.

| Item | Antes | Depois |
|---|---|---|
| `BACKUP-PATRONO-DADOS.json` (9,7 MB) | **Versionado** | Removido do índice (`git rm --cached`); arquivo preservado no disco |
| `docs/handoff-codex/screenshots/` (8 PNG) | **Versionadas** | Removidas do índice; arquivos preservados no disco |
| Inventário versionado | 65 arquivos · 10,72 MB | 56 arquivos · 0,46 MB |

O backup continha 3.820 registros reais: 254 números de processo CNJ únicos, ~2.100 registros com nome
de cliente preenchido, 883 números de OAB, além de valores de causa, condenação e honorários. Três das
screenshots reproduziam PII de terceiros (nomes de pessoas físicas em `06`, números CNJ em `04` e `05`).

Regras adicionadas ao `.gitignore` (as 7 originais foram preservadas na ordem, incluindo a exceção
`!.env.example`, que depende da ordem):

```gitignore
BACKUP-PATRONO-DADOS.json
docs/handoff-codex/screenshots/
```

O commit único foi reescrito por `--amend`, preservando a mensagem original. A tag
`patrono-pre-claude-migration` foi recriada no novo commit, mantendo o formato *lightweight*.

**Resíduo conhecido:** o commit anterior permanece no banco de objetos local, alcançável pelo reflog, e
sua árvore ainda contém o backup. Branch e tag estão limpos — nada sensível é distribuído em clone ou
export. O expurgo (`reflog expire` + `gc`) **não foi autorizado** e não foi executado.

## 2. Credenciais pré-preenchidas na tela de login

**Arquivo:** `public/app.js`, linha 43, função `loginScreen()`.

O campo de senha era servido com a senha real no atributo `value`, e o campo de e-mail com um e-mail
corporativo real. O arquivo é servido publicamente por `GET /app.js`, sem autenticação — qualquer
visitante da tela de login lia a credencial.

O valor coincidia exatamente com `COEVO_DEMO_PASSWORD`, confirmado por comparação sem exibição.
Não era dado fictício: era a credencial aceita pelo backend.

```diff
- <input class="input" id="login-email" type="email" value="[e-mail real]" required>
- <input class="input" id="login-password" type="password" value="[senha real]" required>
+ <input class="input" id="login-email" type="email" required>
+ <input class="input" id="login-password" type="password" required>
```

Alteração de uma linha, −54 bytes. IDs, classes, `type`, `required`, estrutura e CSS preservados —
sem impacto visual. Nenhum `placeholder` ou `autocomplete` foi adicionado, por decisão de escopo mínimo.

## 3. Rotação de `COEVO_DEMO_PASSWORD`

O valor anterior tinha 4 caracteres numéricos e estava publicado no código. Foi substituído por valor
gerado com `crypto.randomBytes(32)` em `base64url` (256 bits de entropia, 43 caracteres), gravado
**somente** no `.env` local, que é ignorado pelo Git. O valor nunca foi exibido em terminal, log ou
documentação.

Validado em instância isolada: senha antiga → **HTTP 401**; senha nova → **HTTP 200** com desafio, MFA →
token emitido, `/api/me` retornando o usuário correto.

Como `server.js:11-17` lê o `.env` apenas no boot, foi necessário reiniciar o servidor para a rotação
entrar em vigor. O processo anterior mantinha a credencial comprometida em memória.

## 4. Rotação de `COEVO_BACKUP_KEY`

**Achado:** o valor em uso era **idêntico ao texto de exemplo do `.env.example`**, versionado no Git.
Com 48 caracteres, ele satisfazia a validação `length < 32` de `server.js:84` e era aceito como chave
legítima — os backups pareciam cifrados com AES-256-GCM, mas a chave era pública. Um placeholder que
falhasse na validação teria forçado a configuração correta; como passava, o problema ficou silencioso.

**Verificação antes de rotacionar** — nenhum backup histórico depende da chave:

- auditoria com 23 eventos e **0 `BACKUP`** / **0 `RESTORE_BACKUP`**;
- nenhum arquivo com a assinatura `aes-256-gcm` fora de `server.js`;
- nenhum arquivo com a estrutura `{iv, tag, payload, checksum}`;
- `data/exports/` contém apenas 1 PDF e 1 PPTX de apresentação, em texto claro;
- `data/backups/`, `backups/`, `exports/`, `uploads/` não existem;
- busca por assinatura em Downloads, Área de Trabalho, temporários da sessão e nas duas pastas de
  backup do projeto: nenhum resultado.

`POST /api/backup` não grava arquivo — devolve o payload no corpo da resposta HTTP. Só existiria backup
se alguém tivesse salvo manualmente essa resposta.

Nova chave gerada com `crypto.randomBytes(32)` em `base64url`, 43 caracteres, apenas no `.env`.

**Validação isolada** (`scratchpad/validate-backup-key.js`, replicando fielmente `encryptBackup`/
`decryptBackup`, que não são exportados por `server.js`) — 16 verificações, todas aprovadas, sobre
**payload sintético**, sem tocar o store:

- chave presente, ≥ 32 caracteres, charset compatível com o parser do `.env`;
- `algorithm = aes-256-gcm`, IV de 12 bytes, tag GCM de 16 bytes, checksum coerente;
- payload cifrado não contém o texto claro;
- round-trip preserva o objeto e a acentuação;
- tag adulterada é rejeitada (integridade autenticada);
- chave incorreta é rejeitada;
- grava e relê a partir de arquivo temporário fora do projeto.

`POST /api/backup` e `POST /api/backup/restore` **não foram executados**: o primeiro chama
`writeStore()` para persistir o evento de auditoria, e o segundo sobrescreve o store inteiro. Ambos
violariam a exigência de manter `data/store.json` intacto.

## 5. Placeholder de `COEVO_BACKUP_KEY` no `.env.example`

O valor deixou de ser preenchido, passando a **falhar** deliberadamente a validação de 32 caracteres,
de modo que uma instalação mal configurada receba erro explícito em vez de cifrar com chave pública.
Foi adicionado comentário explicando o risco e como gerar o valor. Comentários iniciados por `#` são
ignorados pelo parser de `server.js:14`. O arquivo mantém 17 variáveis parseáveis e nenhum segredo real.

## 6. Teste de regressão

Adicionado a `tests/core.test.js`: `tela de login não traz credenciais pré-preenchidas nem chave de
exemplo funcional`. Ele garante que os campos de login não voltem a ter atributo `value`, que `required`
seja preservado, e que o placeholder de `COEVO_BACKUP_KEY` permaneça vazio e não funcional.

A seção 8 acrescentou um segundo teste de regressão, sobre autenticação.

**Suíte: 24 → 26 testes, todos passando.** Documentos do handoff que citam "24 testes" refletem o
snapshot de 09/08/2026 e não foram reescritos.

## 7. Integridade de `data/store.json`

Inalterado em toda a sequência. Verificado por SHA-256, MD5, tamanho e `cmp` byte a byte contra cópia
de segurança feita antes da primeira alteração, mantida fora do repositório e fora do OneDrive.

```
sha256  e2779af0ed0194511833fc524a23e33556ff8f1a9e043e3cbd91e9de9d879a57
md5     08942bf370485ba5d78fa027b9627042
bytes   9758979
```

Nenhum dado jurídico, orçamentário, de auditoria, de projeto ou de usuário foi alterado.

## 8. Bypass de autenticação `usr-*` — CORRIGIDO

Commit `c6e2b78`. Substitui integralmente o que este documento antes registrava como pendência A.

### Causa raiz

Duas falhas que se sustentavam mutuamente:

**Primária — lacuna na emissão de token.** `sessions.set()` com token de sessão existia em um único
lugar: `/api/auth/mfa`. O `/api/auth/login` só criava *challenge*. Logo, para quem não passava por MFA
não existia caminho legítimo de sessão. `requireMfa(user)` retorna `user.mfa && role ∈ {diretoria,
administrador, lider}`, e `usr-miguel` (colaborador, `mfa: false`) era o único usuário nessa condição —
assim como qualquer cadastro aprovado, que nasce com `mfa: false`.

**Secundária — dois atalhos criados para contornar a lacuna.** `getUser()` aceitava qualquer bearer
iniciado por `usr-` quando `NODE_ENV !== 'production'`; `authHeaders()` enviava `Bearer usr-diretoria`
na ausência de token; e `submitLogin()` marcava `authenticated = true` mesmo sem token.

Consequência composta: Miguel autenticava, não recebia token e o frontend passava a operar como
**diretoria**. E, independentemente de login, qualquer requisição com `Bearer usr-diretoria` era aceita
sem credencial alguma.

Um terceiro vetor foi descoberto durante os testes: como `sessions` guarda challenge e token no mesmo
mapa, e `getUser()` só verificava `expiresAt`, **o challenge de MFA funcionava como token de sessão**.
Confirmado empiricamente antes da correção (`HTTP 200` para `Bearer <challenge>`).

### Correção aplicada

A ordem importou: fechar a lacuna primeiro, remover o atalho depois.

1. **`/api/auth/login` emite token quando `requireMfa()` é falso**, reaproveitando a mesma mecânica e o
   mesmo TTL (`COEVO_SESSION_MS`) de `/api/auth/mfa`. Quem exige MFA mantém o fluxo idêntico, e nenhum
   challenge é criado no caminho sem MFA.
2. **`getUser()` deixou de aceitar `Bearer usr-*`.** Passou a existir um único caminho de autenticação:
   sessão válida e não expirada.
3. **`getUser()` rejeita challenge como token**, via `!session.challenge`.
4. **`authHeaders()` não envia mais `Authorization`** quando não há token.
5. **`submitLogin()` guarda o token** antes de marcar a sessão como autenticada, e falha explicitamente
   se o login não devolver token.
6. **`IS_PRODUCTION` removido** — ficou sem uso, e mantê-lo sugeriria autenticação condicionada a
   ambiente, o que seria enganoso.

`submitMfa()` e `logout()` já tratavam `window.__coevoToken` corretamente e não foram alterados.

Diff total: `server.js` +3/−4 · `public/app.js` +2/−2 · `tests/core.test.js` +10.

### Estado antes/depois

| | Antes | Depois |
|---|---|---|
| Caminhos de emissão de token | 1 (`/api/auth/mfa`) | 2 (`/api/auth/mfa` e login sem MFA) |
| Caminhos de autenticação aceitos | 2 (sessão **ou** `Bearer usr-*`) | 1 (somente sessão válida) |
| `Bearer usr-*` | Concedia acesso sem credencial | **401** |
| Challenge como token | Concedia acesso | **401** |
| Frontend sem token | Enviava `Bearer usr-diretoria` | Não envia `Authorization` |
| Usuário `mfa: false` | Autenticava sem token e operava como diretoria | Recebe token e opera com o próprio papel |
| Fluxo `mfa: true` | login → challenge → MFA → token | **Idêntico** |

### Miguel — escalonamento eliminado sem tocar o cadastro

| Atributo | Antes | Depois |
|---|---|---|
| Token no login | Nenhum | Emitido |
| `/api/me` → papel efetivo | **diretoria** (escalonamento) | **colaborador** |
| `role` no cadastro | `colaborador` | `colaborador` — **intacto** |
| `mfa` no cadastro | `false` | `false` — **intacto** |
| Módulos | `["*"]` (indevido) | `["central","projetos","agenda","juridico","ti"]` |
| Ações | incluía `approve`, `archive`, `restore`, `export` | `["read","create","update"]` |
| `/api/audit` | 200 (indevido) | **403** |
| `/api/projects` | 200 | **200 — preservado** |
| `approveAgreement` / `changeApprovalRule` / `archive` | escalados | `false` |
| `edit` (execução legítima) | `true` | `true` — **preservado** |

### Validação

Bateria de 43 verificações, executada em instância isolada na porta 3008 **antes** (24/31, com as 7
falhas correspondendo exatamente às vulnerabilidades) e **depois** (43/43), e novamente na porta 3007
após o reinício da instância real (**43/43**).

Cobertura: fluxo completo com MFA · login sem MFA emitindo token · papel real do Miguel · senha errada e
usuário inexistente rejeitados · `Bearer usr-miguel`, `usr-juridico`, `usr-diretoria`, `usr-ti`,
`usr-qualquercoisa` e `usr-` todos **401** · challenge como bearer **401** · token válido em seis rotas
protegidas · ausência de header, token aleatório e bearer vazio **401** · RBAC preservado, com
colaborador recebendo **403** em `/api/audit` e no dashboard de TI e **200** em `/api/projects` ·
endpoints públicos inalterados.

Expiração real validada em instância dedicada com `COEVO_SESSION_MS=2500`: token do Miguel e token de
diretoria passam a **401** após expirar, sem nenhum fallback de resgate.

Confirmação direta na instância real após o reinício: `Bearer usr-diretoria` → **HTTP 401**.

### Preservação verificada

`data/store.json` **íntegro**, byte a byte, antes e depois do reinício:
`sha256 e2779af0…d879a57` · `md5 08942bf3…627042` · `9758979 bytes`.

Nenhum usuário, papel, MFA, permissão, dashboard, filtro, projeto ou layout foi alterado. Os quatro
usuários mantêm `id`, `role`, `mfa` e `department` originais; `ROLES` intacto.

### Consequência aceita

`usr-juridico` deixou de ser alcançável. Ele compartilha o e-mail de `usr-diretoria`, e
`store.users.find()` sempre retorna o primeiro; portanto só era acessível via o bypass. A gestão aceitou
essa consequência, sem alterar cadastro, e-mail, papel ou MFA. Registrado como pendência J.

---

# Pendências que exigem decisão humana

## A. Bypass de autenticação `usr-*` — ✅ RESOLVIDO

Corrigido no commit `c6e2b78`. **Ver seção 8** para causa raiz, alterações, validação e estado
antes/depois. Mantido aqui apenas como referência, porque a letra é citada em decisões anteriores.

Resumo: `Bearer usr-*` retorna **401**; usuários com `mfa: false` recebem token legítimo no login;
challenge de MFA não é aceito como token; o escalonamento acidental do Miguel desapareceu sem alteração
de cadastro.

## B. RBAC de `GET /api/entities/:type` — NÃO CORRIGIDO — **PENDENTE**

`server.js:300` não aplica `allowed()`. `POST`, `PATCH`, `DELETE` e `/restore` aplicam; apenas o `GET`
não. Qualquer usuário autenticado lê qualquer coleção de `records`, contornando a permissão de módulo
verificada em `/api/legal/*`.

**Evidência original:** `Bearer usr-miguel` em `/api/entities/processos` → **HTTP 200 com 273
registros**. Aquele vetor específico deixou de funcionar com a correção da seção 8, mas **a lacuna
permanece**: um usuário autenticado legitimamente, com token válido, continua lendo qualquer coleção de
`records` sem verificação de módulo. A correção da seção 8 fechou o acesso sem credencial, não este
ponto.

**Por que não foi corrigido.** Trata-se de lacuna **adjacente** ao bypass `usr-*`, não parte dele — e a
autorização para tocar este ponto estava condicionada a ser parte direta. Há também uma
sutileza de projeto: `allowed(user, type)` compara o nome da coleção com a lista de módulos do perfil, e
`processos` não é um módulo. A correção literal faria `GET /api/entities/*` retornar 403 para `lider` e
`colaborador` em praticamente todos os tipos. Isso é *deny-by-default* e consistente com os outros
verbos, mas é uma decisão de política de allowlist, não um ajuste mecânico.

**Risco de corrigir:** baixo. O frontend **nunca** chama `/api/entities` (verificado) e nenhum teste
depende da rota. Não há consumidor externo conhecido.

**Correção proposta:** aplicar `allowed(user, type)` no `GET`, ou — preferencialmente — introduzir uma
allowlist explícita de tipos com o módulo correspondente, eliminando a coincidência frágil entre nome de
coleção e nome de módulo.

## C. Escalonamento de privilégio de usuário sem MFA — ✅ RESOLVIDO

Corrigido no commit `c6e2b78`, junto com o item A. `submitLogin()` passou a exigir token antes de marcar
a sessão como autenticada, e o fallback privilegiado foi removido. **Miguel autentica como colaborador**,
com `role` e `mfa` intactos no cadastro. Ver seção 8.

## D. `requireMfa()` depende da flag do próprio usuário — **PENDENTE**

`server.js` exige MFA apenas se `user.mfa` já for verdadeiro. Um usuário privilegiado com `mfa: false`
não é obrigado a cadastrar segundo fator. Depois da seção 8 isso ganhou um efeito adicional: tal usuário
receberia **token direto no login**, sem segundo fator. Nenhum usuário atual está nessa situação — os três
perfis privilegiados têm `mfa: true` —, mas o caminho está aberto. A correção adequada é exigir MFA por
papel, não pela flag do próprio usuário. Envolve política de identidade — fora do escopo autorizado.

## E. Senha global, sem senha individual — **PENDENTE**

`COEVO_DEMO_PASSWORD` é compartilhada por todos os usuários e comparada por SHA-256 puro, sem salt e
sem KDF. Cadastros aprovados recebem `temporaryPassword: true`, mas não existe fluxo de definição de
senha. Correção estrutural: senha por usuário com Argon2id ou bcrypt.

## F. Cópias do acervo fora do repositório — **PENDENTE**

Descobertas durante a varredura, em `Documentos`:

| Pasta | `.env` | `data/store.json` | `BACKUP-PATRONO-DADOS.json` |
|---|---|---|---|
| `PLATAFORMA JURÍDICO - BACAKUP ANTES CLAUDE/` | 1.055 bytes | 9.758.979 bytes | — |
| `PLATAFORMA JURÍDICO - BACKUP PRE CLAUDE/` | 1.055 bytes | 9.758.979 bytes | 9.758.979 bytes |

1.055 bytes é exatamente o tamanho do `.env` **antes** das rotações: a senha antiga e a chave de backup
antiga continuam existindo nessas cópias, junto com `MONDAY_TOKEN` e `COEVO_MFA_CODE`, ambos ainda
vigentes. O acervo jurídico completo existe em mais três arquivos de 9,7 MB. Nada foi tocado nessas
pastas.

## G. Pasta sincronizada pelo OneDrive — **PENDENTE**

O projeto está sob `OneDrive`. Exclusões locais não removem cópias já replicadas: o OneDrive mantém
lixeira na nuvem (~30 dias) e histórico de versões. Aplica-se ao `.env.bak` já excluído, ao `.env`, ao
`data/store.json` e ao `BACKUP-PATRONO-DADOS.json`. Solução de fundo: mover o projeto para fora da
pasta sincronizada.

## H. Demais itens pré-existentes, sem alteração — **PENDENTES**

- `MONDAY_TOKEN` duplicado no `.env` (linhas 9 e 18) com valores idênticos — inofensivo, pois a primeira
  ocorrência prevalece no parser.
- `DATABASE_URL` no `.env` é igual ao exemplo, com marcador no lugar da senha: `/api/health` reporta
  `databaseConfigured: true` para uma string de conexão não funcional.
- Placeholders de `COEVO_DEMO_PASSWORD` e `COEVO_MFA_CODE` no `.env.example` ainda são valores
  funcionais, sujeitos ao mesmo problema já corrigido em `COEVO_BACKUP_KEY`.
- Ausência de rate limiting, limite de corpo, CSRF, CSP e demais cabeçalhos de segurança.
- Auditoria no mesmo arquivo mutável dos dados, sem append-only nem assinatura.
- `/api/legal/*` não verifica módulo: qualquer usuário autenticado lê as coleções jurídicas. Mesma
  natureza do item B, em outra rota.

## I. Vulnerabilidades de dependência — **PENDENTE**

Duas vulnerabilidades de severidade alta em `image-size`, dependência transitiva de `pptxgenjs`
(loops infinitos em parsers ICNS, JXL e HEIF). A correção disponível instala `pptxgenjs@1.1.5` —
**downgrade major** — e exige revalidar a geração de PPTX e PDF antes de aceitar.

## J. E-mail duplicado `usr-diretoria` / `usr-juridico` — **PENDENTE**

Os dois usuários compartilham `juridico@coevoconstrutora.com.br`. Como o login resolve por
`store.users.find()`, o primeiro registro sempre vence: **`usr-diretoria`**. Consequências:

- `usr-juridico` nunca foi alcançável pelo fluxo normal de login;
- até o commit `c6e2b78` ele era acessível apenas via `Bearer usr-juridico`;
- depois da correção, **não tem nenhum caminho de acesso**.

A gestão aceitou essa consequência. O saneamento exige atribuir um e-mail próprio ao perfil — alteração
de cadastro de usuário, expressamente fora do escopo autorizado até aqui. Nada foi alterado: cadastro,
e-mail, papel e MFA permanecem intactos.

## Ações operacionais pendentes para a gestão

1. Guardar os novos valores de `COEVO_DEMO_PASSWORD` e `COEVO_BACKUP_KEY`, lidos do `.env`, em
   gerenciador de senhas. A senha é global — **Miguel precisará dela** para autenticar, e passará a ver
   a plataforma com as permissões corretas de colaborador, sem Auditoria, Logs, Backup nem o dashboard
   de TI. Esse é o comportamento correto; o acesso anterior era escalonamento acidental.
2. Esvaziar a lixeira do OneDrive e revisar o histórico de versões.
3. Decidir sobre as pendências **B, D, E, F, G, H, I e J**. Os itens A e C estão resolvidos.
