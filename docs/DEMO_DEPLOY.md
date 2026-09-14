# DEMO_DEPLOY.md — Ambiente de Demonstração (DEMO/STAGING) para o Comitê Jurídico

> **Isto NÃO é uma decisão de infraestrutura de produção.** H11 (`docs/PRODUCTION_GATE.md`, PG-22 —
> "Deploy/Infra") continua **aberto**. Este documento cobre apenas um ambiente **temporário de
> demonstração**, para uma apresentação específica ao Comitê Jurídico, usando a master exata
> `cf1c9181ef93e00ab338b6ec1dfb24e0e4b5bbf1`. **Produção continua NO-GO.**

Nenhum passo aqui é executado automaticamente por mim — o deploy é feito por você, com sua própria conta
de hospedagem. Eu preparei apenas os arquivos de configuração (`Dockerfile`, `fly.toml`) e o roteiro
exato de comandos.

## 0. Por que Fly.io

`docs/PRODUCTION_GATE.md` (PG-22) já assumia Fly.io como plataforma-alvo (a ausência de `fly.toml`/
`Dockerfile` era justamente o achado registrado ali). Reaproveitei essa premissa em vez de introduzir uma
plataforma nova — mas qualquer serviço que rode um container Docker + Postgres funciona igualmente
(Render, Railway etc.), adaptando os comandos das seções 2-4 para o equivalente da plataforma escolhida.

## 1. Pré-requisitos (na sua máquina, não neste ambiente)

- Conta Fly.io própria (gratuita ou paga — decisão sua, nunca contratada por mim).
- `flyctl` instalado e autenticado (`fly auth login`).
- Este repositório clonado localmente, na branch `claude/demo-staging-deploy` (ou já mesclada, se você
  preferir abrir PR e mesclar antes — ver seção 6).

## 2. Criar o app e o Postgres (uma vez)

```bash
# Dentro da raiz do repositório, nesta branch:
fly apps create <um-nome-unico-para-seu-app>   # ajuste "app" em fly.toml para esse mesmo nome
fly postgres create --name <nome-do-postgres>   # escolha a menor VM (staging não precisa de mais)
fly postgres attach <nome-do-postgres> -a <um-nome-unico-para-seu-app>
  # ^ isto já define DATABASE_URL como secret automaticamente — nunca precisa ser digitado à mão
```

## 3. Definir os segredos (nunca no Git, nunca me informe os valores)

Gere cada valor localmente e defina via `fly secrets set` — nenhum comando abaixo grava nada em disco
neste repositório:

```bash
# Chaves de 32+ caracteres (mesma exigência de .env.example) — gere uma diferente para cada uma:
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

fly secrets set \
  MFA_ENCRYPTION_KEY="<valor gerado 1>" \
  RATE_LIMIT_HMAC_KEY="<valor gerado 2>" \
  COEVO_BACKUP_KEY="<valor gerado 3>" \
  COEVO_SEED_PASSWORD="<uma senha forte à sua escolha>" \
  TRUST_PROXY_HOPS="1" \
  APP_ENVIRONMENT="staging" \
  -a <um-nome-unico-para-seu-app>
```

- **`COEVO_SEED_PASSWORD`**: vira a senha dos 3 usuários seed (`usr-diretoria`, `usr-juridico`,
  `usr-ti`) na primeira inicialização do banco vazio — ver seção 5 (login).
- **`COEVO_SEED_TOTP_SECRET`** (opcional, mas recomendado): gere um segredo TOTP válido localmente:
  ```bash
  node -e "console.log(require('./auth/crypto').generateTotpSecret())"
  ```
  Defina-o como secret (`fly secrets set COEVO_SEED_TOTP_SECRET="<valor gerado>"`) e cadastre esse
  MESMO valor em um app autenticador (Google Authenticator/Authy — "adicionar conta manualmente",
  colando o segredo). Sem isso, o usuário seed com MFA obrigatório não terá um autenticador
  pré-configurado (o fluxo normal de enrolamento de MFA continua funcionando, só exigiria um passo a
  mais no primeiro acesso).
- **`MONDAY_TOKEN`** (opcional — só se quiser dados reais do Monday no demo): mesmo token read-only já
  usado hoje, `fly secrets set MONDAY_TOKEN="<token>"`. Sem ele, os módulos de Monday aparecem vazios
  (nunca com dado fictício).

### 3.1. Catálogo completo de boards do Monday (workspace Jurídico)

`legal-source-catalog.js` é a fonte única de verdade dos boards do Monday integrados ao Patrono —
`MONDAY_BOARDS` (server.js), o menu Jurídico (public/app.js) e os widgets do Dashboard
(dashboard-service.js) são todos derivados dele, nenhum lugar mantém uma lista paralela. Nesta rodada, os
35 boards habilitados do workspace "Jurídico" (Monday, workspace id `1678965`) cobrem as 7 categorias do
inventário fornecido: Apoio Administrativo, Entrega de Chaves, Clientes, Contratos e Empresas, Processos,
Projetos/Melhorias e Sócios. Uma única duplicata (`entregaChavesCarpeDienDuplicata`, board
`18428261720`) permanece explicitamente desabilitada — sem conteúdo exclusivo identificado que a
justifique como fonte separada do board principal de Entrega de Chaves Carpe Diem.

**Garantias de leitura, preservadas em todo o caminho de sincronização:**
- Monday é usado **somente como fonte read-only** — `mondayQuery()` só envia operações GraphQL `query`,
  nunca `mutation`; nenhum item/coluna/board/automação/responsável do Monday é criado, editado ou
  apagado por este código em nenhuma circunstância.
- Um `LegalDeadline` **nunca** é criado automaticamente a partir de uma data do Monday — continua sendo
  uma entidade canônica própria (Postgres), preenchida manualmente. Datas do Monday (ex.: "PRAZO FINAL"
  de Notificações Clientes) aparecem como contexto operacional, nunca como prazo judicial confirmado.
- `MONDAY_TOKEN` permanece exclusivamente no backend — nunca é exposto ao frontend.
- Subitens ("Subelementos de...") não viram módulos separados nesta rodada — ver limitações (seção 7).

### 3.2. Executando a sincronização (duas formas, mesma rotina)

Ambas chamam exatamente a mesma função (`runMondaySync()`, server.js) — nenhuma implementação paralela:

**a) Via script administrativo no servidor (preferível no DEMO — sem copiar token de navegador):**
```bash
fly ssh console -a <um-nome-unico-para-seu-app> -C "node scripts/sync-monday.js"
# ou, para sincronizar só alguns boards:
fly ssh console -a <um-nome-unico-para-seu-app> -C "node scripts/sync-monday.js --modules=processos,notificacoes"
```
Imprime uma tabela BOARD | ID | LIDOS | CRIADOS | ATUALIZADOS | INALTERADOS | FALHAS | STATUS ao final.
Restrito ao operador que tem acesso ao console Fly do app; não abre nenhuma rota HTTP nova nem cria bypass
de autenticação — é só um ponto de entrada CLI para a mesma rotina já usada por `POST /api/monday/sync`.

**b) Via API, autenticado como usuário do Jurídico (`usr-diretoria`/`usr-juridico`):**
```bash
curl -X POST https://patrono-legal-demo.fly.dev/api/monday/sync \
  -H "Authorization: Bearer <token da sessão>" -H "Content-Type: application/json" -d '{}'
```
Sem `{"modules":[...]}` no corpo, sincroniza todos os 35 boards habilitados.
- **Nunca defina `NODE_ENV=production`** neste ambiente — ver a nota abaixo.

### Por que NODE_ENV=development (não "production") neste DEMO

Fora de produção (`NODE_ENV != production`), o próprio código já cria os 3 usuários seed
(`usr-diretoria`, `usr-juridico`, `usr-ti`) com uma senha de conveniência
(`COEVO_SEED_PASSWORD`/`COEVO_SEED_TOTP_SECRET`) na primeira inicialização de um banco vazio — mecanismo
já existente no código (`seedAuthFields()`, `server.js`), não uma alteração feita para este demo. Em
produção, esse mesmo código propositalmente NÃO cria senha automática (por design, para nunca existir uma
credencial previsível em produção real) — o que exigiria um fluxo de primeiro acesso manual. Como este é
um ambiente temporário para amanhã, `NODE_ENV=development` é a escolha certa: nenhuma
proteção de segurança (auth/MFA/RBAC/scope/rate limiting/headers/audit/redaction) depende de
`NODE_ENV=production` — todas continuam ativas exatamente como estão hoje.

## 4. Deploy

```bash
fly deploy -a <um-nome-unico-para-seu-app>
```

O `release_command` do `fly.toml` já roda `node scripts/migrate.js` (schema, idempotente) a cada deploy.

**Depois do primeiro deploy, uma única vez**, rode o cutover H1B (idempotente — recusa rodar de novo se
já aplicado):

```bash
fly ssh console -a <um-nome-unico-para-seu-app> -C "node scripts/migrate-h1b-data.js"
```

Isso grava o marcador de cutover (`data_migrations`) sem migrar nenhum dado do `app_store` (que está
vazio neste ambiente novo) — apenas desbloqueia o boot em modo Postgres, exatamente como documentado em
`docs/DATA_MODEL.md`/H1B.

## 5. Login e primeiro acesso

Usuário recomendado: **`usr-diretoria`** (Cristiane Carneiro Rabelo, alçada global — vê todo o módulo
Jurídico, incluindo o Dashboard/Visão para Comitê sem restrição de departamento).

- **Login**: use o campo de e-mail da tela de login normalmente — mas atenção: `usr-diretoria` e
  `usr-juridico` compartilham o mesmo e-mail (`juridico@coevoconstrutora.com.br`) no cadastro seed
  existente (uma inconsistência de dado pré-existente, não introduzida por este trabalho) — o login por
  e-mail recusa como "credenciais inválidas" quando o e-mail é ambíguo. Se isso acontecer, use a rota
  técnica de login por identificador (o mesmo endpoint aceita `{"login":"usr-diretoria","password":...}`
  em vez de `{"email":...}` — peça para alguém com acesso técnico fazer esse único login inicial por
  API/curl, ou ajuste o formulário para enviar `login` antes da apresentação).
- **Senha**: a que você definiu em `COEVO_SEED_PASSWORD` (seção 3).
- **MFA**: obrigatório para este papel. Se você configurou `COEVO_SEED_TOTP_SECRET` e já cadastrou no
  autenticador (seção 3), o código de 6 dígitos do app já funciona no primeiro login. Se não configurou,
  o primeiro login pedirá o enrolamento normal de MFA (fluxo já existente do produto).
- **Se precisar resetar a senha depois**: use o fluxo já existente do produto — não crie nem me peça uma
  senha nova diretamente no banco. Um usuário com papel `diretoria`/`administrador` pode gerar um token
  de redefinição para qualquer conta via `POST /api/auth/users/:id/reset-token` (autenticado), e o
  usuário-alvo conclui a troca pelo fluxo normal de "esqueci minha senha"/redefinição já existente na
  tela de login.

## 6. Sobre a branch

Estes 4 arquivos (`Dockerfile`, `.dockerignore`, `fly.toml`, este documento) vivem na branch
`claude/demo-staging-deploy`, criada a partir da mesma master (`cf1c9181...`) — nenhum código funcional
do módulo Jurídico foi alterado. Não abri PR automaticamente nem mesclei nada; decida você se quer
mesclar esses arquivos de infraestrutura à master (não é obrigatório para o deploy funcionar — `fly
deploy` lê o `Dockerfile`/`fly.toml` do checkout local, mesclado ou não).

## 6.1. O que foi validado e o que não foi

O módulo Jurídico em si (Dashboard, Visão para Comitê, Processos, Prazos, Atenção, Minha Semana, login,
MFA, RBAC/scope) já foi validado ponta a ponta com PostgreSQL real e navegador real (Playwright) nesta
mesma master, antes deste documento — ver `docs/LEGAL_COMMITTEE_READINESS.md`, seção 10. O que **não**
pude validar dentro deste ambiente de execução: o build do `Dockerfile` em si — o sandbox onde estou
rodando bloqueia pull de imagens do Docker Hub (política de rede do ambiente, não um problema do
`Dockerfile`). O `Dockerfile` é um wrapper padrão (Node 20, `npm ci`, sem build step, sem dependência
nativa/compilação) sobre uma aplicação já testada — risco baixo, mas rode `docker build .` (ou
`fly deploy` diretamente) localmente antes da apresentação para confirmar, e me avise se algo aparecer.

## 7. Limitações deste ambiente

- **Subitens do Monday não são importados nesta rodada.** As queries de sincronização buscam apenas os
  itens de nível superior de cada board (`items_page`) — os boards "Subelementos de..." não têm uma
  fonte própria no Patrono. Ficou fora do escopo desta rodada (prazo de apresentação); quando priorizado,
  a extensão correta é buscar `subitems{...}` dentro do próprio item pai (nunca como um módulo/entidade
  separada, para não duplicar parent+subitem como se fossem registros distintos).
- Um pequeno número de módulos do menu Jurídico permanece sem fonte mapeada no inventário fornecido
  (Contratos genérico, Riscos e Regulatório, Recuperação de Crédito, Fatos Relevantes, Comitê Jurídico) —
  aparecem com a mensagem honesta "ainda não integrado", nunca com um "0" fictício.
- Sem backup/restore configurado (fora de escopo de um demo temporário — H5 já cobre isso para produção
  real).
- Sem agregador de log externo (mesma limitação já documentada em PG-17/H6 — logs ficam só em
  `fly logs`).
- Sem HA/múltiplas réplicas. **Atenção (P0 corrigido):** `fly.toml` estava com `min_machines_running = 0`
  (a máquina dormia entre acessos, economizando custo) — o Fly chegou a autostopar a máquina no meio de
  uma sincronização real via SSH ("App has excess capacity, autostopping machine" -> SIGINT), porque
  autostop mede tráfego HTTP, não sessões SSH/scripts em execução. Corrigido para
  `auto_stop_machines = false` / `min_machines_running = 1` — a máquina fica sempre ativa durante o
  período de sincronização/apresentação (custo maior, aceito deliberadamente só para este ambiente
  temporário). Se quiser voltar a economizar custo depois do Comitê, reverta para
  `auto_stop_machines = "stop"` / `min_machines_running = 0` antes de destruir o ambiente (seção 8).
- Google Calendar (Minha Semana) continua não configurado, a menos que você defina
  `GOOGLE_CALENDAR_CLIENT_ID`/`GOOGLE_CALENDAR_CLIENT_SECRET` — sem isso, a tela mostra honestamente "não
  configurado", nunca um evento fictício.

## 8. Encerrar o ambiente depois do Comitê

```bash
fly apps destroy <um-nome-unico-para-seu-app>
fly postgres destroy <nome-do-postgres>
```

Nada aqui é uma decisão de produção — é seguro apagar assim que a apresentação terminar.
