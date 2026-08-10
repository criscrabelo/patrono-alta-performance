# Correções de segurança — 09–10/08/2026

> Complementa `docs/handoff-codex/`, que permanece como fotografia do repositório em 09/08/2026.
> Este documento registra apenas o que mudou depois daquela fotografia. Nenhum segredo é reproduzido aqui.

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

**Suíte: 24 → 25 testes, todos passando.** Documentos do handoff que citam "24 testes" refletem o
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

---

# Pendências que exigem decisão humana

## A. Bypass de autenticação `usr-*` — NÃO CORRIGIDO

**Mecanismo.** `server.js:77` aceita qualquer bearer iniciado por `usr-` como identidade de usuário
quando `NODE_ENV !== 'production'`. `public/app.js:40` envia `Bearer usr-diretoria` como fallback quando
não há token. Com `NODE_ENV=development`, a API inteira fica acessível sem credencial.

**Evidência coletada em instância isolada:**

```
Bearer usr-diretoria  → HTTP 200  Cristiane Carneiro Rabelo (diretoria)
Bearer usr-miguel     → HTTP 200  Miguel (colaborador)
Bearer usr-ti         → HTTP 200  Líder de Tecnologia (lider)
```

**Por que não foi corrigido.** Existe **um único caminho** que emite token de sessão: `/api/auth/mfa`
(`server.js:195`). Para usuários com `mfa: false` — caso de `usr-miguel` e de qualquer cadastro
aprovado, que nasce com `mfa: false` — o login responde `mfaRequired: false` **sem token**, e
`submitLogin()` marca `authenticated = true` mesmo assim. O bypass é, portanto, **estrutural** para
esses usuários.

Confirmado empiricamente:

```
login miguel@coevo.local → HTTP 200  mfaRequired=false  token no corpo: NAO
```

Remover o bypass sem adicionar um caminho de emissão de token **bloquearia o acesso do Miguel**.
Adicionar esse caminho é uma decisão sobre o contrato de autenticação. Além disso, a correção altera o
acesso **efetivo** do Miguel: hoje ele opera como diretoria por escalonamento acidental; corrigido,
passa a operar como colaborador — que é o comportamento correto, mas muda o que ele vê na prática.

Ambos os pontos acionam a condição de parada definida pela gestão, então a correção ficou pendente.

**Correção proposta (4 alterações coordenadas, mínimas):**

1. `server.js` — `/api/auth/login` emite token diretamente quando `requireMfa(user)` é falso, fechando
   a lacuna que torna o bypass necessário.
2. `public/app.js` — `submitLogin()` armazena esse token em `window.__coevoToken` e só marca
   `authenticated = true` se houver token.
3. `public/app.js:40` — remover o fallback `Bearer usr-diretoria`; sem token, não enviar `Authorization`.
4. `server.js:77` — remover a aceitação de `Bearer usr-*`.

**Rollback:** `git checkout -- server.js public/app.js` restaura ao commit de segurança. Ambos os
arquivos estão versionados.

**Efeito colateral positivo:** corrige também o escalonamento de privilégio do item C.

## B. RBAC de `GET /api/entities/:type` — NÃO CORRIGIDO

`server.js:300` não aplica `allowed()`. `POST`, `PATCH`, `DELETE` e `/restore` aplicam; apenas o `GET`
não. Qualquer usuário autenticado lê qualquer coleção de `records`, contornando a permissão de módulo
verificada em `/api/legal/*`.

**Evidência:** `Bearer usr-miguel` em `/api/entities/processos` → **HTTP 200 com 273 registros**.

**Por que não foi corrigido.** Julguei que se trata de lacuna **adjacente** ao bypass `usr-*`, não parte
dele — e a autorização para tocar este ponto estava condicionada a ser parte direta. Há também uma
sutileza de projeto: `allowed(user, type)` compara o nome da coleção com a lista de módulos do perfil, e
`processos` não é um módulo. A correção literal faria `GET /api/entities/*` retornar 403 para `lider` e
`colaborador` em praticamente todos os tipos. Isso é *deny-by-default* e consistente com os outros
verbos, mas é uma decisão de política de allowlist, não um ajuste mecânico.

**Risco de corrigir:** baixo. O frontend **nunca** chama `/api/entities` (verificado) e nenhum teste
depende da rota. Não há consumidor externo conhecido.

**Correção proposta:** aplicar `allowed(user, type)` no `GET`, ou — preferencialmente — introduzir uma
allowlist explícita de tipos com o módulo correspondente, eliminando a coincidência frágil entre nome de
coleção e nome de módulo.

## C. Escalonamento de privilégio de usuário sem MFA — NÃO CORRIGIDO

`submitLogin()` marca `authenticated = true` sem token quando `mfaRequired` é falso; o fallback então
envia o bearer da diretoria. Consequência: **Miguel autentica e opera com permissões de diretoria.**
Resolvido pelos itens 1–3 da correção proposta em A.

## D. `requireMfa()` depende da flag do próprio usuário

`server.js:91` exige MFA apenas se `user.mfa` já for verdadeiro. Um usuário privilegiado com
`mfa: false` não é obrigado a cadastrar segundo fator. A correção adequada é exigir MFA por papel.
Envolve política de identidade — fora do escopo autorizado.

## E. Senha global, sem senha individual

`COEVO_DEMO_PASSWORD` é compartilhada por todos os usuários e comparada por SHA-256 puro, sem salt e
sem KDF. Cadastros aprovados recebem `temporaryPassword: true`, mas não existe fluxo de definição de
senha. Correção estrutural: senha por usuário com Argon2id ou bcrypt.

## F. Cópias do acervo fora do repositório

Descobertas durante a varredura, em `Documentos`:

| Pasta | `.env` | `data/store.json` | `BACKUP-PATRONO-DADOS.json` |
|---|---|---|---|
| `PLATAFORMA JURÍDICO - BACAKUP ANTES CLAUDE/` | 1.055 bytes | 9.758.979 bytes | — |
| `PLATAFORMA JURÍDICO - BACKUP PRE CLAUDE/` | 1.055 bytes | 9.758.979 bytes | 9.758.979 bytes |

1.055 bytes é exatamente o tamanho do `.env` **antes** das rotações: a senha antiga e a chave de backup
antiga continuam existindo nessas cópias, junto com `MONDAY_TOKEN` e `COEVO_MFA_CODE`, ambos ainda
vigentes. O acervo jurídico completo existe em mais três arquivos de 9,7 MB. Nada foi tocado nessas
pastas.

## G. Pasta sincronizada pelo OneDrive

O projeto está sob `OneDrive`. Exclusões locais não removem cópias já replicadas: o OneDrive mantém
lixeira na nuvem (~30 dias) e histórico de versões. Aplica-se ao `.env.bak` já excluído, ao `.env`, ao
`data/store.json` e ao `BACKUP-PATRONO-DADOS.json`. Solução de fundo: mover o projeto para fora da
pasta sincronizada.

## H. Demais itens pré-existentes, sem alteração

- Duas vulnerabilidades altas em `image-size`, transitiva de `pptxgenjs`; a correção implica downgrade
  major e exige revalidar a exportação.
- `MONDAY_TOKEN` duplicado no `.env` (linhas 9 e 18) com valores idênticos — inofensivo, pois a primeira
  ocorrência prevalece no parser.
- `DATABASE_URL` no `.env` é igual ao exemplo, com marcador no lugar da senha: `/api/health` reporta
  `databaseConfigured: true` para uma string de conexão não funcional.
- Placeholders de `COEVO_DEMO_PASSWORD` e `COEVO_MFA_CODE` no `.env.example` ainda são valores
  funcionais, sujeitos ao mesmo problema já corrigido em `COEVO_BACKUP_KEY`.
- Ausência de rate limiting, limite de corpo, CSRF, CSP e demais cabeçalhos de segurança.
- Auditoria no mesmo arquivo mutável dos dados, sem append-only nem assinatura.

## Ações operacionais pendentes para a gestão

1. Guardar os novos valores de `COEVO_DEMO_PASSWORD` e `COEVO_BACKUP_KEY`, lidos do `.env`, em
   gerenciador de senhas. A senha é global — Miguel também precisará dela.
2. Esvaziar a lixeira do OneDrive e revisar o histórico de versões.
3. Decidir sobre as pendências A a G.
