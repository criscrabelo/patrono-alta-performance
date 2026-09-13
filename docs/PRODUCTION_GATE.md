# PRODUCTION_GATE.md — Gate de Produção (diagnóstico, hardening, GO/NO-GO)

> Rodada estritamente documental — nenhum código foi alterado para produzir este documento. Auditoria
> feita por leitura de `server.js`, `database.js`, `migrations/`, `package.json`, `.github/workflows/ci.yml`,
> `.env.example`, `public/app.js`, e por execução real de `npm test`/`npm audit` (sem corrigir nada). Ver
> `docs/DECISIONS.md`, decisão `PROD-GATE-01`, e `docs/SECURITY.md` (referência cruzada).

## 1. Objetivo

Responder formalmente: **"O Patrono está pronto para produção?"**

Este documento é o gate técnico que essa pergunta precisa passar antes de qualquer deploy. Ele não
implementa hardening — apenas audita o estado real, classifica bloqueios e define os critérios objetivos
de aceite para uma futura autorização de produção, a ser tratada em PR(s) separado(s) do Sprint 3
funcional.

## 2. Escopo

Cobre: persistência, autenticação/sessão, rate limiting, hardening HTTP, gestão de segredos, integração
Google Calendar (o que é blocker de produção vs. blocker só da funcionalidade), dependências
(`npm audit`), logging, auditoria, retenção/legal hold, incident response, backup/restore, deploy/infra,
e um checklist mínimo de LGPD. Não cobre: desenho de novas funcionalidades de negócio (Sprint 3).

## 3. Estado atual (resumo)

- Sprint 2 formalmente encerrado (`docs/DECISIONS.md`, D2-CLOSE), 254 testes passando, CI verde.
- Persistência ativa é **`data/store.json`** (arquivo JSON local), reescrito por inteiro
  (`fs.writeFileSync`) a cada mutação — não há transação, lock, nem versionamento de esquema.
- PostgreSQL **não está conectado ao runtime**: `database.js` e `migrations/*.sql` existem, mas nenhum
  arquivo de `server.js` os importa; `scripts/migrate.js` só roda se `DATABASE_URL` estiver definido, de
  forma manual e desconectada do boot da aplicação. `GET /api/health` já expõe isso honestamente:
  `persistence: 'local-fallback'`, `databaseConfigured: Boolean(process.env.DATABASE_URL)`.
- Sessões vivem em um `Map()` em memória do processo — perdidas a cada reinício; não há `logout` que as
  invalide no servidor (o cliente só descarta o token localmente); não há revogação ativa de sessão.
- Autenticação usa uma **senha única compartilhada** (`COEVO_DEMO_PASSWORD`) e um **código de MFA único
  compartilhado** (`COEVO_MFA_CODE`) — não há senha nem segredo de MFA por usuário. Adequado para um
  piloto controlado; **não é modelo de autenticação de produção**.
- Não existe rate limiting em nenhuma rota (login incluído).
- Único header de hardening HTTP presente: `x-content-type-options: nosniff`. Não há CSP, HSTS,
  `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`, nem CORS configurado
  explicitamente (implicitamente same-origin, por ausência de qualquer header de CORS).
- Segredos (`MONDAY_TOKEN`, `COEVO_BACKUP_KEY`, credenciais futuras do Google) são lidos exclusivamente de
  `process.env`, nunca devolvidos por nenhuma rota (`configured: boolean` é o máximo exposto), e
  `.gitignore` cobre `.env*`, `data/store.json` e backups — nenhum segredo commitado, `.env.example` sem
  placeholder funcional (testado).
- Google Calendar: adapter somente leitura implementado (`docs/INTEGRATIONS.md`), mas **sem OAuth real**
  — nenhuma biblioteca de cliente OAuth do Google integrada, nenhum mecanismo de armazenamento de token
  por usuário existe. É opcional/complementar — não bloqueia o core jurídico.
- `npm audit`: **2 vulnerabilidades altas** (`image-size`, efeito em `pptxgenjs`) — DoS por loop infinito
  em parsers ICNS/JXL/HEIF. Correção disponível é um downgrade major (`pptxgenjs@1.1.5`), não um patch
  compatível — já registrado e tratado como informativo (não bloqueante) no CI.
- Logging: mínimo — uma linha de boot e uma linha de erro do agendador Monday (`error.message`, nunca
  stack/payload/token). Não existe logging estruturado, agregação, alerta ou monitoramento de produção.
- Auditoria de negócio (`audit()`) já existe e é redigida por alçada (`sanitizeAuditEventForUser()`), mas
  não captura IP/sessão/user-agent, e não tem política de retenção/rotação — cresce indefinidamente no
  mesmo arquivo.
- **Não existe `fly.toml` nem `Dockerfile` neste repositório** — divergência em relação à premissa desta
  rodada (que assumia sua existência). Não há nenhuma infraestrutura de deploy como código versionada;
  `.github/workflows/ci.yml` roda apenas `npm test` (+ `npm audit` informativo), sem job de deploy.
- Backup/restore: `POST /api/backup`/`POST /api/backup/restore` existem (AES-256-GCM, sob demanda,
  autorização restrita), mas não há agendamento automático, armazenamento externo/offsite, RPO/RTO
  definidos, nem evidência de um teste de restore executado fora dos testes automatizados de unidade.

## 4. Achados (P0/P1/P2/P3)

**Definição de severidade:**
- **P0** — risco crítico; produção não pode ocorrer enquanto aberto.
- **P1** — necessário antes do go-live (waiver formal pode liberar temporariamente, nunca por silêncio).
- **P2** — importante, pode ser pós-go-live com mitigação formal registrada.
- **P3** — melhoria, não bloqueia produção.

| ID | Área | Achado | Risco | Severidade | Bloqueia produção? | Correção recomendada | Critério de aceite | Dependência |
|---|---|---|---|---|---|---|---|---|
| PG-01 | Persistência | ~~`data/store.json` é a única persistência ativa; reescrita integral sem lock/transação a cada mutação~~ **FECHADO por H1A** (ver seção 17) — quando `DATABASE_URL` configurada, PostgreSQL é a persistência canônica; cada escrita é 1 UPDATE transacional | Corrupção sob concorrência, perda de durabilidade, sem escala horizontal | ~~**P0**~~ **FECHADO** | ~~SIM~~ NÃO (fechado) | Migrar para PostgreSQL (schema já preparado em `migrations/`), conectar `database.js` ao runtime | Runtime lê/escreve exclusivamente via banco transacional; testes de concorrência passam | H1A |
| PG-02 | Persistência | ~~Nenhum lock/atomicidade entre leitura e escrita do JSON~~ **FECHADO por H1A** — concorrência otimista real via `version`/CAS (`storage/postgres-store.js`), conflito responde 409, nunca sobrescrita silenciosa | Race condition (last-write-wins silencioso) sob requisições concorrentes | ~~**P0**~~ **FECHADO** | ~~SIM~~ NÃO (fechado) | Resolvido junto com PG-01 (transação de banco) | Nenhuma escrita concorrente perde dado sem detecção | H1A |
| PG-03 | Persistência | ~~Sem versionamento de schema/migração automática no boot~~ **FECHADO por H1A** — `schema_migrations` + `npm run migrate` determinístico (`scripts/migrate.js`) | Drift entre ambientes, deploy quebrado silenciosamente | ~~**P1**~~ **FECHADO** | ~~SIM~~ NÃO (fechado) | Rodar migrations no pipeline de deploy, não manualmente | Deploy falha explicitamente se a migration pendente não rodar | H1A |
| PG-04 | Sessão/Auth | ~~Sessões em `Map()` em memória, perdidas a cada reinício do processo~~ **FECHADO por H2** (ver seção 19) — sessão persistida em `auth_sessions` (Postgres), sobrevive a restart e é compartilhada entre instâncias | Logout forçado de todos os usuários a cada deploy/restart; sem HA | ~~**P1**~~ **FECHADO** | ~~SIM~~ NÃO (fechado) | Sessão em armazenamento compartilhado (banco/cache), sobrevivendo a restart/múltiplas instâncias | Sessão válida sobrevive a um restart do processo | H2, PG-01 |
| PG-05 | Sessão/Auth | ~~Não há `logout` que invalide a sessão no servidor~~ **FECHADO por H2** — `POST /api/auth/logout` revoga a sessão atual (`revokedAt`), testado com token pós-logout recebendo 401 | Token roubado continua válido até expirar mesmo após "logout" do usuário | ~~**P1**~~ **FECHADO** | ~~SIM~~ NÃO (fechado) | Endpoint de logout que remove a sessão do armazenamento server-side | Token usado após logout retorna 401 | H2 |
| PG-06 | Sessão/Auth | ~~Não há revogação ativa de sessão~~ **FECHADO por H2** — `POST /api/auth/logout-all` revoga todas as sessões do usuário; troca/reset de senha e inativação (`deletedAt`) também revogam (via `credentialsVersion`/checagem em `getUser()`) | Sessão comprometida não pode ser encerrada remotamente | ~~**P1**~~ **FECHADO** | ~~SIM~~ NÃO (fechado) | Endpoint administrativo de revogação por usuário/sessão | Sessão revogada devolve 401 imediatamente | H2 |
| PG-07 | Sessão/Auth | ~~Senha única compartilhada (`COEVO_DEMO_PASSWORD`) para todos os usuários~~ **FECHADO por H2** — senha individual por usuário (`scrypt`, salt próprio), fluxo de troca/reset com token de uso único | Sem responsabilização individual real por login; qualquer vazamento afeta todos | ~~**P0**~~ **FECHADO** | ~~SIM~~ NÃO (fechado) | Senha/hash por usuário (bcrypt/argon2), fluxo de cadastro/redefinição real | Login exige credencial própria por usuário, hash armazenado com salt | H2 |
| PG-08 | Sessão/Auth | ~~Código de MFA único compartilhado (`COEVO_MFA_CODE`)~~ **FECHADO por H2** — TOTP individual (RFC 6238) por usuário, segredo cifrado em repouso (AES-256-GCM), nunca ativo antes da confirmação do enrolamento | MFA não é MFA real — mesmo segundo fator para todos os usuários | ~~**P0**~~ **FECHADO** | ~~SIM~~ NÃO (fechado) | MFA individual por usuário, com fator separado e mecanismo aprovado para produção | Cada usuário tem segredo/fator de MFA próprio, não reutilizável entre contas | H2 |
| PG-09 | Sessão/Auth | ~~Nenhuma política de senha~~ **FECHADO por H2** — comprimento mínimo (10), rejeita trivial/repetida/sequencial, nunca texto puro, sem rotação obrigatória sem causa (só em troca/reset/comprometimento/decisão administrativa) | N/A hoje (não há senha por usuário); vira obrigatório ao resolver PG-07 | ~~**P1**~~ **FECHADO** | ~~SIM~~ NÃO (fechado) | Definir política mínima de senha ao implementar PG-07 | Política documentada e validada no cadastro/redefinição | PG-07 |
| PG-10 | Sessão/Auth | ~~Sem proteção a força bruta GLOBAL (por IP) em `/api/auth/login`/`/api/auth/mfa/verify`~~ **FECHADO por H3** (ver seção 20) — rate limiting distribuído por IP/identidade/combinado (PostgreSQL, sobrevive a restart/múltiplas instâncias), complementar ao bloqueio POR CONTA já fechado por H2 | Enumeração de credenciais/código por tentativa exaustiva distribuída entre contas/IPs | ~~**P0**~~ **FECHADO** | ~~SIM~~ NÃO (fechado) | Rate limiting + bloqueio progressivo por IP | N tentativas falhas em janela de tempo bloqueiam/atrasam novas tentativas por IP, além do bloqueio por conta já implementado | H3 |
| PG-11 | Rate limiting | ~~Nenhuma rota tem rate limiting (login, API geral, integrações)~~ **FECHADO por H3** — login, MFA verify, forgot/reset-password, reset-token administrativo, enroll/confirm/disable de MFA, change-password, logout-all e aprovação de cadastro protegidos; API geral (fora das rotas de autenticação sensíveis) permanece sem rate limiting, fora do escopo mínimo desta rodada | Abuso, DoS de aplicação, força bruta | ~~**P0**~~ **FECHADO** (para as rotas sensíveis de autenticação — ver seção 20) | NÃO (fechado para o escopo mínimo) | Rate limiting global + reforçado em rotas sensíveis (login/MFA) | Rajada acima do limite recebe 429, sem afetar outros usuários | H3 |
| PG-12 | HTTP hardening | ~~Ausência de CSP/HSTS/X-Frame-Options/Referrer-Policy/Permissions-Policy~~ **FECHADO por H4** (ver seção 21) — CSP real (auditada a partir do frontend), HSTS em produção, X-Frame-Options DENY + frame-ancestors 'none', Referrer-Policy, Permissions-Policy negando recursos não usados | Clickjacking, XSS com maior impacto, downgrade de protocolo | ~~**P1**~~ **FECHADO** | ~~SIM~~ NÃO (fechado) | Adicionar headers de hardening padrão (helmet-like, sem framework novo se possível) | Headers presentes e validados em resposta HTTP real | H4 |
| PG-13 | HTTP hardening | ~~CORS não configurado explicitamente (same-origin implícito)~~ **FECHADO por H4** — allowlist explícita (`CORS_ALLOWED_ORIGINS`), same-origin continua sendo o padrão sem configuração adicional | Comportamento não documentado; risco se um domínio de app separado for introduzido | ~~**P2**~~ **FECHADO** | ~~NÃO~~ NÃO (fechado) | Documentar e, se necessário, configurar allowlist explícita | Política de CORS documentada e testada | H4 |
| PG-14 | HTTP hardening | Sem CSRF explícito (mitigado estruturalmente por Bearer token sem cookie) | Baixo hoje; se sessão migrar para cookie (PG-04), CSRF volta a ser relevante | **P2** | NÃO hoje / SIM se migrar para cookie | Reavaliar ao mudar modelo de sessão | Sem alteração enquanto o modelo for Bearer token puro | H2 (condicional) |
| PG-15 | Dependências | `npm audit`: 2 altas (`image-size`/`pptxgenjs`, DoS por parser) | Negação de serviço na geração de apresentações PPTX | **P1** | SIM | Avaliar migração/downgrade controlado de `pptxgenjs` com validação de exportação PPTX/PDF | Vulnerabilidade tratada ou mitigação/waiver formal registrado | H9 |
| PG-16 | Google Calendar | Sem OAuth real, sem token storage seguro | Bloqueia apenas a leitura real de Calendar (funcionalidade opcional) | **P2** | NÃO (feature opcional, adapter seguro por design) | Implementar OAuth mínimo + storage seguro de token quando priorizado | Fluxo de leitura real testado ponta a ponta sem expor token | H10 |
| PG-17 | Logging/Monitoramento | Nenhum logging estruturado, alerta ou monitoramento de produção | Incidente pode passar despercebido; sem visibilidade operacional | **P1** | SIM | Logging estruturado (sem PII/segredo) + alerta básico de erro/disponibilidade | Log de erro em produção é buscável e não contém segredo/PII | H6 |
| PG-18 | Auditoria | Eventos de auditoria não capturam IP/sessão/user-agent; sem rotação/retenção | Rastreabilidade incompleta para investigação; crescimento não controlado do arquivo | **P2** | NÃO (MVP aceitável) | Adicionar metadados de origem e política de retenção ao evoluir para produção | Auditoria permite reconstruir "quem, quando, de onde, o quê" | H8 |
| PG-19 | Retenção/Legal Hold | Nenhuma política de retenção/exclusão/legal hold definida para nenhuma entidade | Impossível responder a obrigação legal de retenção ou a um pedido de exclusão (LGPD) | **P0** | SIM | Definir política por tipo de dado (audit, Legal Deadline, documentos, backups) | Política documentada e aplicável tecnicamente (mesmo que manual no início) | H8 |
| PG-20 | Incident Response | Nenhum processo de resposta a incidente definido | Sem detecção/contenção/comunicação formal em caso de violação | **P0** | SIM | Checklist mínimo de IR (ver seção 8) | Checklist existe, tem responsável nomeado e canal de comunicação definido | H7 |
| PG-21 | Backup/Restore | **H5 IMPLEMENTADO PARCIALMENTE (ver seção 22) — PERMANECE ABERTO.** `pg_dump`/`pg_restore` reais do PostgreSQL canônico, RPO=6h/RTO=4h definidos e comprovados por restore real, manifesto com integridade (SHA-256), política de ambiente/confirmação/replace, revogação de estado efêmero pós-restore — tudo implementado e testado (`tests/h5-backup-restore-postgres.test.js`, 18/18). Falta apenas: o adapter de storage offsite real (`s3`) nunca foi exercitado contra um bucket real (só testado com cliente S3 injetado) — nenhuma infraestrutura foi provisionada nesta rodada (fora de escopo de H5, ver H11); agendamento de produção real (cron/scheduler) também é H11 | Perda de dado sem recuperação viável em caso de incidente | **P0** | SIM | Backup agendado, offsite, com RPO/RTO definidos e teste de restore documentado | Restore de um backup real é executado e validado ao menos uma vez, com evidência — **atendido para o mecanismo em si; falta a validação com storage offsite real** | H5 (parcial), H11 |
| PG-22 | Deploy/Infra | Não existe `fly.toml` nem `Dockerfile` no repositório — nenhuma infraestrutura como código versionada | Deploy depende de processo manual/tácito, não reprodutível | **P0** | SIM | Criar infraestrutura como código (container + config de deploy), healthcheck, variáveis de ambiente documentadas | Deploy reproduzível a partir do repositório, sem passo manual não documentado | H11 |
| PG-23 | LGPD | Sem política formal de minimização, finalidade, retenção, descarte e direitos do titular | Exposição legal/regulatória em produção | **P1** | SIM | Checklist mínimo de LGPD (seção 9) formalizado com o time jurídico | Checklist preenchido e aprovado pelo responsável de negócio/jurídico | — |
| PG-24 | LGPD | Monday.com e (futuramente) Google Calendar são suboperadores/subprocessadores sem lista/DPA documentado | Ausência de rastreabilidade de para onde dados pessoais trafegam | **P1** | SIM | Documentar suboperadores e base legal de transferência | Lista de suboperadores mantida em `docs/SECURITY.md`/`docs/INTEGRATIONS.md` | — |
| PG-25 | Dependências | Sem `npm audit` como gate de CI (hoje é apenas informativo, `|| true`) | Nova vulnerabilidade alta/crítica pode entrar sem bloquear o merge | **P2** | NÃO (aceitável com revisão manual continuada) | Tornar `npm audit` bloqueante para novas vulnerabilidades altas/críticas além da já conhecida | CI falha em nova vulnerabilidade alta/crítica não registrada como waiver | H9 |

**Contagem original (25 achados, PG-01 a PG-25 — soma exata da tabela acima na abertura do gate):**

- **P0 = 10** — PG-01, PG-02, PG-07, PG-08, PG-10, PG-11, PG-19, PG-20, PG-21, PG-22.
- **P1 = 10** — PG-03, PG-04, PG-05, PG-06, PG-09, PG-12, PG-15, PG-17, PG-23, PG-24.
- **P2 = 5** — PG-13, PG-14, PG-16, PG-18, PG-25.
- **P3 = 0** — nenhum achado desta rodada é "melhoria cosmética" já não coberta por um P1/P2 real.

**Contagem após o Hardening H1A (ver seção 17) — PG-01/PG-02/PG-03 fechados:**

- **P0 aberto = 8** — PG-07, PG-08, PG-10, PG-11, PG-19, PG-20, PG-21, PG-22 (PG-01/PG-02 fechados).
- **P1 aberto = 9** — PG-04, PG-05, PG-06, PG-09, PG-12, PG-15, PG-17, PG-23, PG-24 (PG-03 fechado).
- **P2 = 5** — inalterado.
- **Fechados = 3** — PG-01, PG-02, PG-03.

**Contagem após o Hardening H2 (ver seção 19) — PG-04/PG-05/PG-06/PG-07/PG-08/PG-09 fechados:**

- **P0 aberto = 6** — PG-10 (agora só a fração de rate limiting por IP/global — H3), PG-11, PG-19, PG-20,
  PG-21, PG-22 (PG-07/PG-08 fechados).
- **P1 aberto = 5** — PG-12, PG-15, PG-17, PG-23, PG-24 (PG-04/PG-05/PG-06/PG-09 fechados).
- **P2 = 5** — inalterado.
- **Fechados = 9** — PG-01, PG-02, PG-03, PG-04, PG-05, PG-06, PG-07, PG-08, PG-09.

**Contagem após o Hardening H3 (ver seção 20) — PG-10/PG-11 fechados:**

- **P0 aberto = 4** — PG-19, PG-20, PG-21, PG-22 (PG-10/PG-11 fechados).
- **P1 aberto = 5** — inalterado (PG-12, PG-15, PG-17, PG-23, PG-24).
- **P2 = 5** — inalterado.
- **Fechados = 11** — PG-01, PG-02, PG-03, PG-04, PG-05, PG-06, PG-07, PG-08, PG-09, PG-10, PG-11.

**Contagem após o Hardening H4 (ver seção 21) — PG-12/PG-13 fechados:**

- **P0 aberto = 4** — inalterado (PG-19, PG-20, PG-21, PG-22).
- **P1 aberto = 4** — PG-15, PG-17, PG-23, PG-24 (PG-12 fechado).
- **P2 aberto = 4** — PG-14, PG-16, PG-18, PG-25 (PG-13 fechado). PG-14 permanece **explicitamente
  não fechado** por H4 — continua P2, condicional a uma futura migração de Bearer token para cookie
  (nenhuma migração desse tipo ocorreu nesta rodada).
- **Fechados = 13** — PG-01 a PG-13.

**Após o Hardening H5 (ver seção 22) — nenhum fechamento de contagem:**

- **P0 aberto = 4** — inalterado (PG-19, PG-20, PG-21, PG-22). PG-21 permanece aberto DELIBERADAMENTE:
  o mecanismo de backup/restore production-grade do PostgreSQL está implementado e testado com
  evidência real (`pg_dump`/`pg_restore` reais, RPO/RTO definidos e comprovados), mas o storage offsite
  real (`s3`) nunca foi exercitado contra um bucket real (sem infraestrutura provisionada nesta rodada —
  item 53 do escopo H5 proibiu criar bucket real). Fechar PG-21 sem essa evidência seria fechar por
  intenção, não por comprovação — nunca feito neste projeto (mesma disciplina de todo H1A-H4).
- **P1/P2 inalterados** — H5 não altera nenhum outro achado.
- **Fechados = 13** — inalterado (PG-01 a PG-13).

PG-01/PG-02 são exibidos como dois achados por clareza de causa raiz (persistência sem transação e sem
lock são sintomas distintos do mesmo problema), mas compartilham a mesma correção (H1) — contados
separadamente na tabela e nesta soma, não duplicados fora dela. PG-24 foi reclassificado de P2 para P1
nesta revisão: a definição de severidade deste documento (seção 4) trata como P1 qualquer achado
"necessário antes do go-live" — e a própria linha de PG-24 já indicava "SIM" para bloqueio de produção,
o que é inconsistente com P2 ("pode ser pós-go-live com mitigação formal"). Corrigido para refletir a
própria classificação declarada.

## 5. Matriz GO/NO-GO

| Gate | Status atual | Bloqueia produção? | Critério GO |
|---|---|---|---|
| Persistência | **FECHADO por H1A** — PostgreSQL conectado ao runtime quando `DATABASE_URL` configurada, transacional e testado sob concorrência real (ver seção 17); fallback local (JSON) só fora de produção | NÃO (fechado) | ~~PostgreSQL conectado ao runtime, testado sob concorrência~~ atendido |
| Sessões | **FECHADO por H2** — persistida em `auth_sessions` (Postgres), sobrevive a restart/múltiplas instâncias, logout/logout-all revogam no servidor (ver seção 19) | NÃO (fechado) | ~~Sessão persistida + logout/revogação funcionais~~ atendido |
| Autenticação (credenciais) | **FECHADO por H2** — senha individual (hash próprio) + MFA individual (TOTP, RFC 6238) por usuário, senha temporária força troca, reset por token de uso único (ver seção 19) | NÃO (fechado) | ~~Credencial e MFA por usuário~~ atendido |
| Rate limiting | **FECHADO por H3** (para rotas sensíveis de autenticação) — rate limiting distribuído (PostgreSQL) por IP/identidade/combinado em login, MFA, forgot/reset-password, reset-token administrativo, enroll/confirm/disable de MFA, change-password, logout-all, aprovação de cadastro; bloqueio POR CONTA já fechado por H2 (`failed_login_count`/`locked_until`) permanece complementar (ver seção 20) | NÃO (fechado para o escopo mínimo) | ~~Rate limiting em rotas sensíveis~~ atendido; API geral fora de rotas de autenticação sensíveis fica para uma rodada futura, se priorizada |
| Headers HTTP | **FECHADO por H4** — CSP/HSTS(produção)/X-Frame-Options/frame-ancestors/Referrer-Policy/Permissions-Policy/nosniff presentes; CORS same-origin por padrão com allowlist explícita (ver seção 21) | NÃO (fechado) | ~~CSP/HSTS/X-Frame-Options/Referrer-Policy/Permissions-Policy presentes~~ atendido |
| CSRF | Mitigado estruturalmente (Bearer, sem cookie) — **PG-14 permanece não fechado por H4**, deliberadamente | NÃO (hoje) | Reavaliar se o modelo de sessão mudar |
| Secrets | Server-side only, sem vazamento identificado | NÃO | Manter prática atual + revisão contínua |
| Backup | **H5 (parcial, ver seção 22)** — `pg_dump` real, RPO=6h definido, manifesto/integridade/criptografia opcional implementados; falta storage offsite real exercitado (só `s3` testado com cliente injetado) | SIM (até offsite real ser validado) | Backup agendado + offsite real + RPO/RTO definidos |
| Restore | **H5 (parcial)** — `pg_restore` real testado ponta a ponta com evidência (seção 22/`BACKUP_RESTORE_RUNBOOK.md`), RTO=4h comprovado; falta restaurar a partir de um backup que tenha passado por storage offsite real | SIM (até offsite real ser validado) | Restore testado e documentado ao menos uma vez — mecanismo atendido, falta o offsite real |
| Logging/Monitoramento | Mínimo, sem estrutura/alerta | SIM | Logging estruturado + alerta básico de erro/disponibilidade |
| Auditoria | Existe, sem IP/sessão/retenção | NÃO (MVP aceitável) | Evoluir metadados/retenção antes de escala maior |
| Incident Response | Inexistente | SIM | Checklist mínimo formalizado com responsável nomeado |
| Retenção/Legal Hold | Inexistente | SIM | Política definida por tipo de dado |
| Dependências (`npm audit`) | 2 altas conhecidas, gate não bloqueante | SIM (a vulnerabilidade em si) | Corrigida ou com waiver formal aprovado |
| OAuth Calendar | Não implementado (adapter seguro) | NÃO (feature opcional) | Necessário só para ativar a leitura real do Calendar |
| Deploy/Infra | Sem `fly.toml`/`Dockerfile`/pipeline de deploy | SIM | Infraestrutura como código + deploy reproduzível |
| LGPD | Sem checklist formal | SIM | Checklist mínimo aprovado pelo responsável de negócio/jurídico |

## 6. Critérios para GO de produção

**GO PRODUÇÃO** só quando, simultaneamente:

- nenhum P0 aberto;
- nenhum P1 aberto sem waiver formal (seção 7);
- persistência production-grade (PostgreSQL conectado, testado sob concorrência);
- backup e restore validados (teste de restore executado e documentado);
- segredos seguros (mantendo a prática já verificada nesta auditoria);
- sessões adequadas (persistidas, com logout e revogação);
- rate limiting em produção;
- hardening HTTP aplicado;
- vulnerabilidades críticas/altas conhecidas tratadas ou com waiver;
- incident response definido;
- retenção/legal hold definida;
- logs seguros e estruturados;
- CI verde;
- smoke test pós-deploy definido e executado;
- plano de rollback definido e testado ao menos uma vez;
- autorização explícita de negócio (Cristiane/Gestora) para o deploy em si.

## 7. Processo de waiver

Um P1 pode ser aceito temporariamente **somente** com um waiver formal, nunca por silêncio ou omissão.
Todo waiver deve registrar:

- **Risco** — o que pode dar errado e o impacto realista;
- **Justificativa** — por que aceitar agora em vez de bloquear;
- **Mitigação** — o que reduz o risco enquanto o waiver estiver ativo;
- **Owner** — responsável nomeado pelo acompanhamento;
- **Prazo** — data ou marco em que o waiver expira e precisa ser revisto;
- **Aceite formal** — quem autorizou (negócio/jurídico/técnico, conforme o risco).

Nenhum waiver foi emitido nesta rodada — todos os P0/P1 listados permanecem abertos, sem exceção
concedida.

## 8. Checklist mínimo de Incident Response

- [ ] **Detecção** — como um incidente é percebido (hoje: nenhum mecanismo automatizado; depende de
      relato manual).
- [ ] **Classificação** — critério de severidade (a definir).
- [ ] **Contenção** — passos imediatos para limitar dano (a definir; hoje dependeria de intervenção
      manual direta no servidor).
- [ ] **Responsável** — pessoa/papel nomeado para conduzir a resposta (a definir).
- [ ] **Comunicação** — quem é avisado, em que prazo, com que conteúdo (a definir; relevante para LGPD —
      notificação à ANPD/titulares em caso de incidente com dado pessoal).
- [ ] **Evidências** — preservação de logs/auditoria durante a investigação (parcialmente possível hoje
      via `store.audit`, mas sem IP/sessão e sem garantia de retenção).
- [ ] **Recuperação** — como voltar ao estado operacional normal (depende de PG-21, backup/restore
      validado).
- [ ] **Lições aprendidas** — revisão pós-incidente formal (a definir).

Nenhum item está marcado como atendido nesta rodada — o checklist existe como estrutura mínima a ser
preenchida antes do go-live, não como trabalho já realizado.

## 9. Checklist mínimo de LGPD

- [ ] **Minimização** — revisar se cada campo coletado tem finalidade declarada (parcialmente verdade:
      o modelo não coleta campos supérfluos identificados nesta auditoria, mas não há revisão formal).
- [ ] **Finalidade** — declaração explícita de para que cada dado pessoal é usado (a formalizar).
- [ ] **Controle de acesso** — já existe via RBAC/`scoped()` (Sprint 1–2), mas não foi mapeado
      formalmente como controle LGPD.
- [ ] **Rastreabilidade** — parcialmente coberta por `store.audit` (sem IP/sessão — ver PG-18).
- [ ] **Retenção** — inexistente (ver PG-19).
- [ ] **Descarte** — inexistente; soft-delete (`deletedAt`) preserva o dado, não o descarta.
- [ ] **Resposta a incidente envolvendo dado pessoal** — inexistente (ver seção 8).
- [ ] **Direitos do titular** (acesso, correção, exclusão, portabilidade) — nenhum fluxo dedicado existe.
- [ ] **Papel de operador/controlador** — não formalizado entre COEVO e o Patrono enquanto plataforma.
- [ ] **Suboperadores** (Monday.com, futuramente Google) — não documentados formalmente como
      suboperadores/subprocessadores (ver PG-24).
- [ ] **Transferência internacional** — Monday.com e Google são serviços internacionais; não há
      declaração formal de base legal para a transferência.

Nenhum item deste checklist deve ser lido como "resolvido" — é o mínimo a formalizar com o time
jurídico/negócio antes de produção, não um parecer jurídico completo (fora do escopo desta auditoria
técnica).

## 10. Plano de hardening (ordem proposta)

A ordem é de dependência técnica, não necessariamente de prioridade de negócio isolada — H1 e H2
desbloqueiam praticamente todos os outros gates (sessão persistida depende de um banco; backup
confiável depende de persistência transacional).

- **H1 — Persistência production-grade**: conectar `database.js`/PostgreSQL ao runtime (resolve
  PG-01/PG-02/PG-03).
- **H2 — Sessões/autenticação**: sessão persistida, logout, revogação, credencial e MFA por usuário
  (resolve PG-04/PG-05/PG-06/PG-07/PG-08/PG-09).
- **H3 — Rate limiting**: login/MFA reforçados + API geral (resolve PG-10/PG-11).
- **H4 — HTTP hardening**: CSP/HSTS/demais headers, revisão de CORS (resolve PG-12/PG-13).
- **H5 — Backup/restore**: agendamento, offsite, RPO/RTO, teste de restore documentado (resolve PG-21,
  depende de H1).
- **H6 — Logging/monitoramento**: logging estruturado sem PII/segredo, alerta básico (resolve PG-17).
- **H7 — Incident response**: preencher o checklist da seção 8 com responsáveis e processo reais
  (resolve PG-20).
- **H8 — Retenção/legal hold**: política por tipo de dado + evolução da auditoria (resolve
  PG-18/PG-19).
- **H9 — Dependências**: tratar `pptxgenjs`/`image-size` (avaliação de downgrade/alternativa) e tornar
  `npm audit` bloqueante para novidades (resolve PG-15/PG-25).
- **H10 — OAuth Calendar seguro**: só quando priorizado — não bloqueia os demais gates (resolve PG-16).
- **H11 — Deploy/infra + smoke test/rollback/go-live**: criar infraestrutura como código, definir
  healthcheck, smoke test pós-deploy e plano de rollback testado (resolve PG-22 e fecha os critérios da
  seção 6).

Cada `H*` deve virar um PR próprio, com testes, quando autorizado — nenhum foi implementado nesta
rodada.

## 11. Dependências externas

- Provisionamento de um banco PostgreSQL gerenciado (ambiente de produção) — pré-requisito de H1.
- Definição de canal/ferramenta de logging e monitoramento (não escolhida nesta rodada) — pré-requisito
  de H6.
- Definição de infraestrutura de deploy (provedor, container, TLS, domínio) — pré-requisito de H11,
  atualmente inexistente no repositório.
- Credenciais reais de OAuth do Google (bloqueia apenas H10, não os demais gates).
- Decisão de negócio/jurídico sobre o checklist de LGPD (seção 9) — não é decisão técnica.

## 12. Waivers concedidos

Nenhum. Todos os achados P0/P1 permanecem abertos, sem exceção.

## 13. Checklist pré-produção

- [ ] Todos os P0 fechados
- [ ] Todos os P1 fechados ou com waiver formal aprovado
- [ ] H1–H9 e H11 implementados e testados (H10 apenas se o Calendar real for priorizado)
- [ ] `npm test` verde (unitários + HTTP)
- [ ] `npm audit` sem vulnerabilidade alta/crítica não tratada/sem waiver
- [ ] CI verde em Node 20.x/22.x
- [ ] Restore de backup testado e documentado
- [ ] Checklist de Incident Response preenchido com responsáveis reais
- [ ] Checklist de LGPD aprovado pelo responsável de negócio/jurídico
- [ ] Autorização explícita de negócio para o deploy

## 14. Checklist go-live

- [ ] Deploy executado a partir de infraestrutura como código versionada (H11)
- [ ] Smoke test pós-deploy executado com sucesso
- [ ] Healthcheck (`/api/health`) verde no ambiente de produção
- [ ] Monitoramento/alerta ativo desde o primeiro minuto
- [ ] Plano de rollback testado e pronto para execução imediata
- [ ] Responsável de plantão definido para a janela de go-live

## 15. Checklist rollback

- [ ] Critério objetivo de quando acionar rollback (ex.: erro acima de X% ou indisponibilidade)
- [ ] Rollback de código (voltar à versão anterior) validado em ambiente não produtivo
- [ ] Rollback de dado/schema (se aplicável) documentado e, quando possível, testado
- [ ] Comunicação definida para stakeholders em caso de rollback
- [ ] Post-mortem obrigatório após qualquer rollback em produção

## 17. Status do Hardening H1A (IMPLEMENTADO — AGUARDANDO HOMOLOGAÇÃO)

**Decisão relacionada:** `docs/DECISIONS.md`, PROD-H1-01.

**Arquitetura implementada (H1A):** PostgreSQL como persistência canônica quando `DATABASE_URL` está
configurada, via uma camada única (`storage/`) que a aplicação inteira consome através de
`readStore()`/`writeStore()` — mesma assinatura de sempre, agora assíncrona. A store inteira (o mesmo
objeto JS que hoje vive em `data/store.json`) é persistida como UM documento JSONB em `app_store` (id
fixo = 1, coluna `version` para concorrência otimista). Esta é uma arquitetura de PONTE deliberada — ver
"O que H1A NÃO fecha" abaixo — não um schema relacional normalizado por entidade.

**Critérios fechados de fato, com teste real (não apenas leitura de código):**
- **PG-01** (persistência sem transação): PostgreSQL é a persistência ativa; cada escrita é 1 `UPDATE`
  atômico. Testado contra um Postgres real (`tests/storage.test.js`, `tests/security-integration-postgres.test.js`).
- **PG-02** (race condition/last-write-wins): concorrência otimista real — duas leituras da mesma
  versão, a primeira escrita vence, a segunda recebe `StoreConflictError`/HTTP 409. Testado com duas
  leituras concorrentes via `storage/postgres-store.js` diretamente E com duas requisições HTTP `PATCH`
  simultâneas reais contra o `handler` de `server.js`.
- **PG-03** (schema sem versionamento): `schema_migrations` + `npm run migrate` (`scripts/migrate.js`),
  determinístico, idempotente, `exit code` correto em falha. Testado rodando contra um Postgres real.

**O que H1A NÃO fechou (H1B — ver seção 18, IMPLEMENTADO/AGUARDANDO HOMOLOGAÇÃO — fecha a lista abaixo
para as 4 entidades do núcleo canônico; demais entidades permanecem no documento JSONB único):**
- ~~Nenhuma FK relacional real entre entidades~~ — Legal Deadline → Legal Process e `responsibleUserId` →
  `users` agora têm FK real no PostgreSQL (`migrations/004_h1b_core_relational.sql`).
- ~~Nenhuma entidade ganhou tabela própria~~ — `users` (`app_users`), `legalProcesses`
  (`legal_processes`), `legalDeadlines` (`legal_deadlines`) e `audit` (`audit_log`) têm tabela relacional
  própria, canônica, sem dual-write com o blob.
- ~~Nenhuma garantia de integridade referencial no nível do banco~~ — FK real, com `ON DELETE RESTRICT`
  (nunca cascade destrutivo), mais CHECK constraints para os enums de `originType`/`status`.

**Fail-fast em produção:** `NODE_ENV=production` sem `DATABASE_URL` lança `FailFastError` na configuração
do storage — o processo não inicia; se `DATABASE_URL` está configurada mas o Postgres está
inalcançável/schema incompatível, `storage.init()` (chamado antes de o servidor aceitar conexões) rejeita
e o processo termina com `process.exit(1)`. Nunca cai silenciosamente em modo arquivo. Testado
(`storage.configure()` com `nodeEnv:'production'` sem `databaseUrl` lança `FailFastError`).

**Healthcheck:** `GET /api/health` expõe `persistence` (`'postgres'`|`'json-local-fallback'`),
`databaseConfigured`, `databaseReachable`, `schemaReady` — nunca host/usuário/senha/connection string.
Testado contra Postgres real.

**Backup/Restore sob Postgres:** `POST /api/backup` continua funcionando como snapshot cifrado sob
demanda (não é o backup canônico de produção — isso é H5). `POST /api/backup/restore` é bloqueado
explicitamente sob backend Postgres (`RESTORE_NOT_SUPPORTED_FOR_POSTGRES`, HTTP 501) — nunca tenta
reconciliar um backup antigo por cima do runtime Postgres sem mecanismo validado.

**Importação JSON → PostgreSQL:** `scripts/import-data.js`, com `--dry-run` (conta por coleção, detecta
duplicados/erros, não grava nada) e importação real (recusa sobrescrever dado existente sem `--force`,
nunca apaga o arquivo JSON de origem, roda dentro de transação). Testado, incluindo contra um Postgres
real (importação idêntica, recusa sem `--force`, sucesso com `--force`).

**Testes:** 24 novos (`tests/storage.test.js`: 21; `tests/security-integration-postgres.test.js`: 3 — mais
1 teste de "pulado explicitamente" em cada arquivo quando `TEST_DATABASE_URL` não está configurada).
Todos os 278 testes passam tanto sem Postgres disponível (fallback local, 2 suites puladas
explicitamente) quanto com um Postgres real conectado (`TEST_DATABASE_URL`, 0 puladas). CI
(`.github/workflows/ci.yml`) ganhou um serviço `postgres:16` isolado só para esta finalidade.

**Por que "aguardando homologação" e não "concluído":** a implementação está testada e funcional, mas
depende de revisão humana (mesmo rito de toda mudança de código deste projeto) antes de qualquer
autorização de uso — e H1B (normalização relacional) permanece pendente, então PG-01/PG-02/PG-03 estão
fechados apenas no escopo específico que H1A se propôs a resolver (persistência real, concorrência real,
versionamento de schema real), não como uma reescrita relacional completa.

## 18. Status do Hardening H1B (IMPLEMENTADO — AGUARDANDO HOMOLOGAÇÃO)

**Decisão relacionada:** `docs/DECISIONS.md`, PROD-H1B-01.

**Arquitetura implementada (H1B):** normalização relacional progressiva do núcleo canônico — `users`,
`legalProcesses` (=`store.records.processos`), `legalDeadlines` (=`store.records.legalDeadlines`) e
`audit` (=`store.audit`) deixam de ser canônicos dentro do documento JSONB `app_store` e passam a viver
em tabelas próprias (`app_users`, `legal_processes`, `legal_deadlines`, `audit_log` —
`migrations/004_h1b_core_relational.sql`). A ponte relacional (`storage/index.js`) é TRANSPARENTE para
`server.js`: `readStore()`/`writeStore()` continuam devolvendo `store.users`/
`store.records.processos`/`store.records.legalDeadlines`/`store.audit` no mesmo formato de sempre — só a
origem/destino mudou. Nenhuma das ~24 rotas de mutação de `server.js` precisou ser alterada. Mecanismo:
a cada leitura, a ponte hidrata essas 4 coleções a partir das tabelas e guarda um baseline; a cada
escrita, compara o conteúdo atual contra o baseline (diff por `id`) e emite só os INSERT/UPDATE
necessários, dentro da MESMA transação Postgres que grava o restante do blob (atomicidade real:
Legal Deadline + evento de auditoria são persistidos juntos ou nenhum dos dois).

**Critérios fechados de fato, com teste real:**
- FK real `legal_deadlines.process_id → legal_processes(id)` e
  `legal_deadlines.responsible_user_id → app_users(id)`, ambas `ON DELETE RESTRICT` (nunca cascade
  destrutivo). Testado: processId/responsibleUserId inexistente é rejeitado tanto na validação de
  aplicação quanto (segunda linha de defesa) pela FK real, bypassando a aplicação.
- CHECK constraints reproduzindo os enums fechados de `originType`/`status` — testado bypassando a
  validação de aplicação diretamente contra o repository.
- Concorrência otimista POR LINHA (`version` própria em cada tabela, não apenas a `version` global do
  `app_store`) — testado com duas leituras concorrentes do mesmo Legal Deadline.
- Transação/rollback: falha simulada na gravação do evento de auditoria impede que o Legal Deadline
  correspondente seja persistido — nenhum dos dois, nunca estado parcial.
- `audit_log` append-only — múltiplas mutações no mesmo registro geram múltiplos eventos, nenhum é
  sobrescrito.
- `deletedAt` de usuário preservado através da ponte relacional; login continua rejeitando usuário
  inativo.
- Agenda, Atenção e Minha Semana continuam funcionando exatamente como antes, agora lendo da tabela
  relacional em vez do blob.
- RBAC/`scoped()`/segregação departamental (TI ≠ Jurídico) e "administrador técnico ≠ superusuário de
  conteúdo" preservados sem alteração de semântica.
- `npm run migrate:h1b:data`: importação H1A→H1B com `--dry-run` (relatório por coleção: total/válidos/
  duplicados/órfãos/enum inválido, nunca grava), importação real transacional e idempotente (recusa
  reimportar sem `--force`; com `--force`, `ON CONFLICT DO NOTHING` nunca duplica), aborta inteiramente
  (nenhum dado gravado) diante de qualquer inconsistência crítica (órfão, duplicado, enum inválido).
  Cutover: a importação real remove as 4 chaves do blob e grava o marcador de cutover
  (`data_migrations`, chave `h1b_core_relational_cutover`) na MESMA transação.
- `storage.init()`/`healthcheck()` (backend) também exigem a migration `004_h1b_core_relational` e as 4
  tabelas do núcleo relacional — schema incompatível/ausente falha explicitamente, nunca silenciosamente.
- **Migration de schema ≠ migração de dados (blocker P1 corrigido antes da homologação):** a migration
  004 aplicada (schema_migrations) NÃO significa que o cutover de dados já ocorreu — as 4 tabelas podem
  existir fisicamente, vazias, enquanto o blob ainda tem o dado real. `storage.init()` (a fachada em
  `storage/index.js`, chamada no boot real) valida ADICIONALMENTE o marcador de cutover e falha
  explicitamente (fail-closed, mensagem apontando para `npm run migrate:h1b:data`) se ele ainda não
  existe — nunca ativa a ponte relacional sobre tabelas vazias. Nenhum bootstrap automático de
  `app_users` acontece nesse meio-tempo (único caminho de população é o cutover real).
  `GET /api/health` (`schemaReady`) reflete o mesmo estado: um schema fisicamente presente cujo cutover
  ainda não ocorreu nunca é reportado como pronto. Testado com Postgres real: init() falha sem o
  marcador; app_users permanece vazio; as 4 coleções continuam no blob; após o cutover, init() passa e
  healthcheck reporta pronto; falha no meio da transação de cutover reverte tabelas relacionais, blob e
  marcador juntos (nunca estado parcial).

**O que H1B NÃO fecha (deliberadamente fora desta rodada):**
- Demais coleções (departments, financials, agenda, projetos, etc.) permanecem no documento JSONB único
  — só as 4 entidades do núcleo canônico foram normalizadas nesta rodada.
- `companyId`/`speId`/`scopeType` continuam dormentes (nunca populados por nenhuma rotina real) — as
  colunas existem e são nuláveis, mas nada os preenche ainda.
- `email` de `app_users` continua SEM constraint de unicidade — a regra vigente no runtime nunca foi de
  unicidade rígida (só bloqueia nova solicitação de registro; o seed já tinha dois usuários com o mesmo
  email) e H1B preserva esse comportamento deliberadamente, sem fechar esse gap silenciosamente. Ver
  `docs/DECISIONS.md`, PROD-H1B-01.
- H2–H11 permanecem inalterados (sessão/senha/MFA individual, rate limiting, hardening HTTP, backup/
  restore de produção, logging, incident response, retenção/legal hold, dependências, OAuth Calendar,
  deploy).

**Testes:** 29 em `tests/h1b-core-relational.test.js` (mais 1 "pulado explicitamente" sem
`TEST_DATABASE_URL`) + 11 testes puros de validação de `scripts/migrate-h1b-data.js` em
`tests/storage.test.js`. Total: 319 testes passam com Postgres real conectado (0 pulados); 280 (277 +
3 pulados explicitamente) sem Postgres disponível (fallback local). CI (Node 20.x/22.x) roda
`tests/h1b-core-relational.test.js` contra bancos Postgres isolados criados/derrubados pelo próprio teste
(evita colidir com os demais arquivos de teste rodando em paralelo no mesmo serviço `postgres:16`).

**Por que "aguardando homologação" e não "concluído":** mesma razão do H1A — implementação testada e
funcional, mas depende de revisão humana antes de qualquer autorização de uso; e a normalização relacional
cobre só o núcleo canônico definido nesta rodada, não o restante do modelo de dados.

## 19. Status do Hardening H2 (IMPLEMENTADO — AGUARDANDO HOMOLOGAÇÃO)

**Decisão relacionada:** `docs/DECISIONS.md`, PROD-H2-01.

**Arquitetura implementada (H2):** substitui integralmente o modelo de autenticação/sessão temporário —
senha global (`COEVO_DEMO_PASSWORD` comparada diretamente), código MFA global (`COEVO_MFA_CODE`) e sessão
em memória (`const sessions = new Map()`) — por identidade individual, persistente e verificável por
usuário. Reaproveita a MESMA tabela relacional `app_users` (H1B) — nenhuma segunda tabela de usuários —
acrescida por migração aditiva (`migrations/005_h2_auth_sessions.sql`, `ALTER TABLE ... ADD COLUMN IF NOT
EXISTS`, nunca remove/renomeia coluna existente) dos campos `password_hash`, `password_changed_at`,
`mfa_enabled`, `mfa_method`, `mfa_secret_encrypted`, `mfa_enrolled_at`, `failed_login_count`,
`locked_until`, `last_login_at`, `credentials_version`. Três tabelas novas — `auth_sessions`,
`auth_challenges`, `password_reset_tokens` — persistidas pela MESMA ponte relacional de
`storage/index.js` já usada por H1B (hidratação + diff + baseline dentro da mesma transação Postgres),
não uma arquitetura paralela.

**Senha:** `crypto.scrypt` (Node built-in, `N=16384, r=8, p=1`, salt de 16 bytes, formato
`scrypt$N$r$p$salt$hash` auto-descritivo), substituição deliberada de bcrypt/Argon2id para evitar nova
dependência com binding nativo — KDF de memória intensiva aceito pelo OWASP. Nunca texto puro, nunca
logada, nunca devolvida por nenhuma rota (`publicUser()` remove `passwordHash`/`mfaSecretEncrypted` de
qualquer resposta HTTP). Política mínima: 10 caracteres, rejeita repetição/sequência trivial; sem
rotação periódica obrigatória (só em: senha temporária, reset, comprometimento ou decisão administrativa).

**Senha temporária (`temporaryPassword`):** semântica agora REAL — força a rota de troca de senha
(`POST /api/auth/change-password`) antes de qualquer conteúdo de negócio, via o mesmo mecanismo de
"conta exige configuração" usado para o bootstrapping de MFA obrigatório (ver abaixo). A senha temporária
não pode ser reaproveitada como a senha permanente (rejeitada com 422 se idêntica).

**Reset de senha:** `POST /api/auth/forgot-password` gera um token opaco (CSPRNG, 32 bytes) e persiste
só o hash (SHA-256) em `password_reset_tokens`, com expiração e uso único (`usedAt`); resposta sempre
genérica (nunca revela se o e-mail existe). `POST /api/auth/reset-password` valida o token, define a
nova senha, incrementa `credentials_version` (revogando todas as sessões anteriores) e marca o token
usado. Este repositório não implementa envio de e-mail (fora de escopo sem um provedor real integrado) —
o endpoint de geração existe e está pronto para uma entrega futura.

**MFA:** TOTP individual (RFC 6238 — HMAC-SHA1, 6 dígitos, passo de 30s, janela de tolerância de ±1
passo), implementado com `node:crypto` (`createHmac`), sem nova dependência — algoritmo público e
padronizado, verificado byte a byte contra os 4 vetores de teste oficiais do RFC. Enrolamento em duas
etapas: `POST /api/auth/mfa/enroll` gera um segredo e um challenge de confirmação (nunca ativa MFA);
`POST /api/auth/mfa/confirm` só marca `mfa_enabled:true` após um código válido. O segredo é cifrado em
repouso (AES-256-GCM, chave derivada de `MFA_ENCRYPTION_KEY`, mesmo padrão de `COEVO_BACKUP_KEY`) e nunca
é devolvido por nenhuma rota após a confirmação; `encryptSecret()`/`decryptSecret()` falham explicitamente
(fail-fast) se a chave estiver ausente/curta — nunca grava o segredo em texto puro como alternativa.
`requireMfa()` (papel: diretoria/administrador/lider) é a MESMA regra já homologada antes de H2, reusada
sem alteração — não introduz uma nova política de negócio sem decisão prévia.

**Login (ordem exigida):** localizar usuário por e-mail → verificar `deletedAt` → verificar bloqueio
(`locked_until`) → verificar senha individual → se MFA ativo, emitir desafio individual (nunca a sessão
completa antes da confirmação) → confirmar MFA (`POST /api/auth/mfa/verify`) → só então criar a sessão
persistente. Um usuário cujo papel exige MFA mas ainda não o confirmou consegue autenticar (para poder
completar o próprio enrolamento), mas fica restrito por um gate de "conta exige configuração" a uma
lista mínima de rotas de autogestão (`change-password`, `mfa/enroll`, `mfa/confirm`, `logout`, `/api/me`)
— nenhuma rota de conteúdo de negócio — até concluir a senha/MFA pendentes (`ACCOUNT_SETUP_REQUIRED`).

**Sessão:** token opaco (CSPRNG, `crypto.randomBytes(32)`) devolvido ao cliente; o banco (`auth_sessions`)
grava só o hash (SHA-256 — deliberadamente não um KDF lento, dado que o token já tem 256 bits de entropia
própria, ao contrário de uma senha escolhida por humano). Expiração absoluta (`COEVO_SESSION_MS`, default
1h); sem idle timeout nesta rodada (simplificação documentada, item opcional do escopo). Revogação real:
logout revoga a sessão atual; logout-all revoga todas as sessões do usuário; troca/reset de senha
incrementam `credentials_version` do usuário, invalidando toda sessão emitida antes (comparação em
`getUser()`); inativação (`deletedAt`) invalida a sessão imediatamente, sem esperar expiração. Nunca
depende do cliente "esquecer" o token.

**Bloqueio por tentativas (não é H3):** `failed_login_count`/`locked_until` por CONTA — 5 tentativas
malsucedidas bloqueiam por 15 minutos; reseta ao primeiro login correto após o desbloqueio. Rate limiting
GLOBAL/por IP continua fora de escopo (H3, PG-10/PG-11).

**Auditoria:** `LOGIN_SUCCESS`, `LOGIN_FAILURE`, `MFA_CHALLENGE`, `MFA_SUCCESS`, `MFA_FAILURE`, `LOGOUT`,
`LOGOUT_ALL`, `PASSWORD_CHANGE`, `PASSWORD_RESET_REQUEST`, `PASSWORD_RESET_COMPLETE`, `ACCOUNT_LOCKED`,
`ACCOUNT_UNLOCKED`, `MFA_ENROLLED` — nunca senha, hash de senha, token bruto, segredo MFA ou código OTP
(testado explicitamente: `tests/h2-auth-sessions.test.js`, H2-S/T).

**Endpoints:** `POST /api/auth/login`, `POST /api/auth/mfa/verify` (renomeado de `/api/auth/mfa`),
`POST /api/auth/logout`, `POST /api/auth/logout-all`, `POST /api/auth/change-password`,
`POST /api/auth/forgot-password`, `POST /api/auth/reset-password`, `POST /api/auth/mfa/enroll`,
`POST /api/auth/mfa/confirm`, `POST /api/auth/mfa/disable`.

**Seed/dev:** fora de produção (`NODE_ENV !== 'production'`), usuários seed e usuários legados de teste
recebem uma senha/MFA de desenvolvimento pronta para uso (`temporaryPassword:false`) via
`migrateLegacyStore()`/`seedAuthFields()` — nunca em produção, onde o usuário seed nasce sem credencial
utilizável, exigindo o fluxo de reset de senha administrado.

**Fail-closed:** `storage/postgres-store.js` exige a migration `005_h2_auth_sessions` e as 3 tabelas
novas (`REQUIRED_MIGRATIONS`/`REQUIRED_CORE_TABLES`) — sem elas, `schemaReady:false` e `init()` falha
explicitamente; nunca cai de volta para sessão em memória/senha global/MFA global como alternativa.

**Testes:** 23 em `tests/h2-auth-sessions.test.js` (Postgres real, banco isolado próprio do arquivo, cria/
derruba automaticamente) cobrindo senha correta/incorreta, hash nunca exposto, senha temporária força
troca, MFA individual (segredo de A nunca valida B), código/challenge incorreto e expirado, challenge de
uso único, sessão persistida com token_hash (nunca o token bruto) em `auth_sessions`, sessão expirada,
logout/logout-all, troca/reset de senha revogando sessões anteriores, `deletedAt` invalidando sessão
imediatamente, `credentials_version` divergente invalidando sessão, bloqueio/desbloqueio por tentativas,
auditoria de login/MFA sem segredo, token de reset expirado/reutilizado, restart do processo (nova
instância de módulo, mesmo Postgres) e duas instâncias simultâneas compartilhando o mesmo banco
(sessão criada em uma validada pela outra; revogação em uma refletindo imediatamente na outra). As 3
suítes pré-existentes que exercitam login via HTTP (`security-integration.test.js`,
`security-integration-postgres.test.js`, `h1b-core-relational.test.js`) foram atualizadas para o novo
fluxo (`loginAs()` usa TOTP real, endpoint `/api/auth/mfa/verify`). Total: 342 testes passam com
Postgres real conectado (319 pré-H2 + 23 novos), 0 pulados.

**O que H2 NÃO fecha (deliberadamente fora desta rodada):** rate limiting global/por IP (H3), headers de
hardening HTTP/CSP/HSTS (H4), backup/restore de produção com RPO/RTO (H5), logging estruturado/
monitoramento (H6), incident response (H7), retenção/legal hold (H8), as 2 vulnerabilidades conhecidas de
dependências (H9), OAuth do Google Calendar (H10), infraestrutura de deploy (H11). RBAC/`scoped()`/
`allowedContent()`/segregação departamental e "administrador técnico ≠ superusuário de conteúdo"
permanecem inalterados — autenticação decide quem, autorização continua decidindo o quê.

**Por que "aguardando homologação" e não "concluído":** mesma razão do H1A/H1B — implementação testada e
funcional, mas depende de revisão humana antes de qualquer autorização de uso.

### Adendo ao H2 (revisão pós-PR #13): 5 blockers corrigidos antes do merge

Correção de blockers identificados na revisão técnica humana do PR #13 (`docs/DECISIONS.md`,
PROD-H2-01, adendo). Nenhum item abaixo fecha um critério adicional do gate além dos já fechados por H2
(PG-04 a PG-09) — são correções de correção técnica, não avanço de escopo.

- **Identidade de login única**: `app_users.email` nunca foi único (PROD-H1B-01, item 7) — login por
  `find(first-match)` sobre e-mail duplicado não é compatível com autenticação individual. Migração
  aditiva nova `migrations/006_h2_unique_login_identity.sql` acrescenta `login_identifier` (`UNIQUE NOT
  NULL`, backfill = id técnico existente). Login aceita `login` como identificador primário; `email`
  continua aceito só quando resolve para exatamente um usuário ativo, nunca escolhendo o primeiro
  registro em caso de ambiguidade (o mesmo vale para `forgot-password`).
- **Primeiro acesso/reset administrativo** (`POST /api/auth/users/:id/reset-token`): sem provedor de
  e-mail integrado, um usuário recém-aprovado não tinha caminho funcional para definir a própria senha
  em produção. Um operador com a mesma alçada de aprovação de cadastro (`allowed(user,'*','approve')`,
  nunca uma nova escalada) emite, por `userId` explícito, um token de uso único (mesmo mecanismo de
  `password_reset_tokens`) devolvido em texto puro uma única vez, para entrega operacional/fora de
  banda nesta fase.
- **`MFA_ENCRYPTION_KEY` validada no BOOT** (`validateAuthRuntimeConfig()`) quando `NODE_ENV=production`
  — antes, a ausência só era descoberta no primeiro enrolamento/validação de MFA real, tarde demais.
  Fora de produção continua degradando graciosamente (sem exigir a chave para testes que não usam MFA).
- **Anti-enumeração no login**: conta bloqueada respondia `423` (status distinto que revelava
  externamente que aquela conta existe e está bloqueada) — corrigido para o mesmo `401`/"Credenciais
  inválidas" de qualquer outra falha; auditoria interna continua distinguindo os casos normalmente.
- **TOTP verificado em teste automatizado contra os vetores oficiais do RFC 6238** (Apêndice B) —
  antes só verificado manualmente durante o desenvolvimento original de H2.

Testes: 352/352 com Postgres real (342 anteriores + 10 novos cenários cobrindo os 5 itens acima, em
`tests/core.test.js` e `tests/h2-auth-sessions.test.js`), 0 falhando, nenhum teste removido.

## 20. Status do Hardening H3 (IMPLEMENTADO — AGUARDANDO HOMOLOGAÇÃO)

**Decisão relacionada:** `docs/DECISIONS.md`, PROD-H3-01.

**Fecha:** PG-10 (fração de rate limiting por IP/global) e PG-11 (ausência de rate limiting em qualquer
rota). **Não fecha** PG-19, PG-20, PG-21, PG-22 (P0 restantes) nem qualquer P1/P2.

**Arquitetura implementada (H3):** proteção distribuída contra abuso/força bruta, complementar ao
bloqueio POR CONTA já fechado por H2 (`failed_login_count`/`locked_until`) — nunca o substitui.

- **Estado compartilhado via PostgreSQL**, nunca `new Map()` em memória — `migrations/
  007_h3_rate_limiting.sql` (aditiva, não altera 001-006) cria `rate_limit_buckets`
  (`bucket_key`/`scope`/`window_started_at`/`count`/`blocked_until`/`updated_at`). Camada isolada
  (`auth/rate-limit.js`, `storage/repositories/rate-limits-repository.js`), deliberadamente fora da
  ponte relacional de H1B/H2 — acessa o pool Postgres diretamente (`storage.getPool()`), porque o
  incremento atômico por linha sob concorrência exige uma única instrução SQL
  (`INSERT ... ON CONFLICT DO UPDATE`), não uma CAS de documento inteiro.
- **Janela fixa determinística**, hora sempre do servidor Postgres (`now()`), nunca do cliente.
- **Resolução segura de IP** (`auth/client-ip.js`, `resolveClientIp()`): `X-Forwarded-For` nunca confiado
  sem uma política explícita de proxy confiável (`TRUST_PROXY_HOPS`, mesmo modelo numérico do Express/
  nginx — padrão `0` ignora XFF por completo). Com `N` proxies confiáveis, o cliente é a entrada
  `chain.length - N` da cadeia — nunca a primeira entrada da esquerda (forjável por um atacante que já
  chega ao primeiro proxy confiável com um X-Forwarded-For pré-existente), nunca escolhida
  arbitrariamente por uma cadeia maior/menor que o esperado. A entrada final é validada como um IPv4/
  IPv6 sintaticamente correto (`node:net.isIP()`) antes de ser aceita. IPv4-mapped IPv6 normalizado. IP
  nunca exposto em resposta HTTP. **Correção pós-revisão técnica (PR #14, `docs/DECISIONS.md`,
  PROD-H3-01 adendo)**: a fórmula original (`chain.length - 1 - N`) estava desalinhada um salto para a
  esquerda — no caso mais comum (1 proxy confiável), caía incorretamente no IP do próprio proxy em vez
  do cliente, e com um X-Forwarded-For pré-forjado pelo atacante selecionava a entrada forjada em vez da
  real observada pelo proxy confiável, reabrindo o próprio bypass que esta proteção deveria impedir. O
  teste original partia da mesma premissa errada, por isso o CI verde não pegava o bug.
- **Toda chave de bucket é derivada (HMAC-SHA256, `RATE_LIMIT_HMAC_KEY`)** — nunca IP/e-mail/
  `login_identifier`/token em texto puro persistido (minimização LGPD). Mesma disciplina de
  `MFA_ENCRYPTION_KEY`: obrigatória (≥32 caracteres) em produção, fail-fast no boot
  (`validateAuthRuntimeConfig()`).
- **Rotas protegidas**: login (IP 30/10min + identidade 10/10min + combinado 8/10min), MFA verify (IP
  30/10min + challenge 10/10min, preservando o `attempts` por challenge já existente de H2),
  forgot-password (IP 10/15min + identidade 3/15min), reset-password (IP 10/15min + hash do token
  5/15min), reset-token administrativo (operador 10/15min + usuário-alvo 3/15min), MFA enroll/confirm/
  disable, change-password, logout-all e aprovação de cadastro (por `userId` autenticado). Política
  centralizada (`POLICIES` em `auth/rate-limit.js`), nenhum número solto espalhado pelas rotas.
- **Identidade canônica de rate limit por `userId`** (correção pós-revisão técnica, PR #14): o bucket de
  IP é sempre consumido primeiro; só então a identidade é resolvida para computar a chave de identidade/
  combinado — quando resolve para exatamente uma conta ativa, a chave é `user:${id}`, nunca o
  identificador bruto apresentado. Sem isso, `email` e `login_identifier` da MESMA conta (H2 permite os
  dois) alimentavam buckets diferentes, permitindo dobrar o teto de tentativas alternando qual
  identificador é apresentado. Anti-enumeração preservada (a resolução não muda a resposta externa).
- **429 genérico** ("Muitas tentativas. Tente novamente mais tarde.") com `Retry-After` quando aplicável
  — nunca revela contador, existência de conta ou motivo interno. Nenhum pacote de cabeçalhos
  `X-RateLimit-*` (fica para H4).
- **Fail-closed controlado**: falha do backend Postgres do limitador bloqueia (429) em vez de permitir
  passagem livre ou derrubar o processo. **Fail-closed em produção**: schema sem a migration
  `007_h3_rate_limiting`/tabela `rate_limit_buckets` impede o boot (`schemaReady:false`).
- **Fora de produção, fallback JSON desativa H3 por completo** (`rateLimit.backendAvailable()` verifica
  `storage.mode()==='postgres' && storage.getPool()!=null`) — nunca um segundo limitador em memória com
  garantias diferentes das de produção; produção já exige PostgreSQL por fail-fast desde H1A.
- **Limpeza oportunística** evita crescimento indefinido da tabela sem exigir cron externo.
- **Auditoria `RATE_LIMIT_TRIGGERED`** (correção pós-revisão técnica, PR #14 — pendente desde a decisão
  original): registrada apenas na transição exata em que um bucket passa a bloquear (`count === limit +
  1`, derivado do próprio contador atômico — nenhum estado extra), nunca em todo 429 subsequente dentro
  da mesma janela (evita flood da auditoria). Nunca contém IP/e-mail/login_identifier/senha/OTP/token/
  segredo MFA em texto puro. Falha ao gravar nunca impede a resposta 429 (auditoria é secundária —
  `auditRateLimitAndBlock()`, `server.js`, captura e descarta qualquer erro internamente). **Autoria
  corrigida em revisão subsequente** (3ª rodada do PR #14, `docs/DECISIONS.md` PROD-H3-01, 2º adendo):
  em `login`/`forgot-password`, a conta encontrada por e-mail/`login_identifier` é o ALVO da tentativa
  (usado só para computar a chave canônica do bucket — nunca o autor da requisição não autenticada) e
  passou a ser SEMPRE excluída de `responsible` nesses dois pontos, mesmo quando a conta resolve. Rotas
  já autenticadas (`change-password`, `logout-all`, `admin-reset-token`, MFA enroll/confirm/disable,
  aprovação de cadastro) continuam corretamente atribuindo o usuário autenticado como ator.
- **Correções incidentais na mesma rodada**: (1) login e MFA verify usavam `writeStore()` direto (em vez
  de `commitStore()`) no caminho de credencial incorreta — sob concorrência real contra a mesma conta,
  um `StoreConflictError` não tratado deixava a requisição sem resposta em vez de devolver 401/409;
  corrigido para `commitStore()`. (2) mesmo padrão encontrado e corrigido em MFA confirm (enrolamento).

**O que H3 NÃO fecha (deliberadamente fora desta rodada):** rate limiting na API geral fora das rotas de
autenticação sensíveis; cabeçalhos `X-RateLimit-*` (H4); headers HTTP de hardening geral (H4); as 2
vulnerabilidades altas conhecidas em `npm audit` (H9, inalteradas). Gate como um todo permanece **NO-GO
PARA PRODUÇÃO**.

**Testes:** 384/384 com Postgres real (374 da primeira rodada + 1 novo teste unitário em
`tests/core.test.js` — falha de auditoria nunca impede o bloqueio — + 7 novos testes de proxy
substituindo os 2 anteriores com premissa incorreta + 5 novos em `tests/h3-rate-limiting.test.js` —
identidade canônica por `userId`, auditoria `RATE_LIMIT_TRIGGERED` e a correção de autoria da 3ª
rodada), 0 falhando, nenhum teste removido.
Cobertura inclui: limites por IP/identidade/combinado no login; proteção por challenge e por IP no MFA
verify; forgot-password (resposta genérica preservada, e-mail ambíguo sem first-match); reset-token
administrativo (aprovador vs. operador sem permissão); reset-password (token inválido repetido vs. token
válido de uso único); multi-instância (contador compartilhado via Postgres, não reiniciado por
instância); restart do processo (bloqueio sobrevive); concorrência real (rajada simultânea nunca aceita
mais requisições que a política permite); anti-bypass (troca de User-Agent, X-Forwarded-For sem proxy
confiável configurado, restart, troca de instância); resolução de proxy corrigida (1 e 2 proxies, com e
sem entrada forjada, cadeia curta, IP sintaticamente inválido); identidade canônica (email/
login_identifier da mesma conta compartilham bucket); auditoria (`RATE_LIMIT_TRIGGERED` deduplicado,
sem dado bruto, falha não impede bloqueio, autoria nunca atribui a conta-alvo em rotas públicas e
atribui corretamente o usuário autenticado em rotas autenticadas).

**Por que "aguardando homologação" e não "concluído":** mesma razão do H1A/H1B/H2 — implementação
testada e funcional, mas depende de revisão humana antes de qualquer autorização de uso.

## 21. Status do Hardening H4 (IMPLEMENTADO — AGUARDANDO HOMOLOGAÇÃO)

**Decisão relacionada:** `docs/DECISIONS.md`, PROD-H4-01.

**Fecha:** PG-12 (headers de hardening HTTP) e PG-13 (CORS explícito). **Não fecha** PG-14 (CSRF,
permanece P2 condicional a uma futura migração de Bearer token para cookie — nenhuma ocorreu), nem
PG-15/PG-16/PG-17/PG-18/PG-19/PG-20/PG-21/PG-22/PG-23/PG-24/PG-25.

**Arquitetura implementada (H4):** camada centralizada (`applySecurityHeaders()`/`handlePreflight()` em
`server.js`), chamada uma única vez no topo de `handler()` — antes de qualquer roteamento estático,
preflight ou `/api/*` — via `res.setHeader()` (que se mescla automaticamente com os headers passados a
`res.writeHead()` por `json()`/`rateLimited()`/`staticFile()`); nenhuma rota relevante escapa dos
headers, sem espalhar `res.setHeader(...)` manualmente rota por rota.

- **CSP construída a partir de auditoria real do frontend** (não um wildcard genérico): `default-src
  'self'`, `img-src 'self'`, `font-src 'self'`, `connect-src 'self'` (nenhum CDN de terceiros é
  carregado pelo navegador; Google Calendar/Monday são chamados só server-side). `object-src 'none'`,
  `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'`. `script-src`/`style-src` precisam
  de `'unsafe-inline'` por dois motivos INDEPENDENTES e documentados: (1) `public/app.js` usa
  manipuladores de evento inline (`onclick=`/`onchange=`/etc.) extensivamente, gerados dinamicamente —
  eliminar exigiria migrar ~28 pontos de `innerHTML` para `addEventListener()`, um refactor estrutural
  fora do escopo desta rodada; (2) 5 barras de progresso com largura calculada em tempo de render usam
  `style="width:${x}%"`. Os demais usos de estilo/script inline ESTÁTICOS foram eliminados nesta mesma
  rodada: `public/status.html` teve seu `<style>`/`<script>` inline extraídos para
  `public/status.css`/`public/status.js`; 4 usos de `style="width:100%;margin-top:20px"` em
  `public/app.js` viraram a classe `.btn-block` (`public/styles.css`).
- **Defesa dupla contra clickjacking**: CSP `frame-ancestors 'none'` + `X-Frame-Options: DENY`.
- **HSTS só em produção** (`NODE_ENV==='production'`, `max-age=31536000`) — nunca em dev/test HTTP
  local; `includeSubDomains`/`preload` deliberadamente omitidos (sem decisão formal sobre topologia de
  subdomínios — HSTS é cacheado agressivamente pelo navegador, ativar sem certeza seria de fato
  irreversível na prática). Aplicado por AMBIENTE, nunca por inspeção do request/`X-Forwarded-Proto` —
  não reabre nem reaproveita `TRUST_PROXY_HOPS` (H3) para isso.
- **Referrer-Policy**: `strict-origin-when-cross-origin`. **Permissions-Policy**: nega explicitamente
  câmera/microfone/geolocalização/pagamento/USB/bluetooth/sensores/fullscreen/clipboard (nenhum usado
  pelo Patrono). `X-Content-Type-Options: nosniff` mantido globalmente. `Cross-Origin-Opener-Policy` e
  `Cross-Origin-Resource-Policy: same-origin` adicionados (coerentes com a política same-origin).
- **`Cache-Control: no-store`** em toda resposta JSON de API (`json()`/`rateLimited()`) — nunca cacheada,
  inclusive respostas de autenticação/sessão; assets estáticos mantêm o comportamento de cache padrão
  (`staticFile()` não foi alterado nesse aspecto).
- **MIME types corrigidos**: mapa explícito (`STATIC_MIME_TYPES`) substitui a cadeia ternária anterior
  sem ramos para `.json`/`.svg`/fontes — com `nosniff` global, um Content-Type incorreto ativamente
  quebra a renderização em vez de só ser impreciso.
- **CORS same-origin por padrão, allowlist explícita** (`CORS_ALLOWED_ORIGINS`, comma-separated, origens
  EXATAS scheme+host+porta) — nunca wildcard, nunca reflete a Origin recebida automaticamente. Matching
  sempre por igualdade exata via `URL` nativo (nunca substring/`endsWith` — `https://app.exemplo.com.
  evil.test` nunca casa com `https://app.exemplo.com`). `Origin: null` sempre negada por padrão.
  Preflight (`OPTIONS`) nunca alcança o roteador de negócio — sempre 204, com
  `Access-Control-Allow-Methods`/`-Headers` só quando a Origin é permitida. CORS nunca substitui
  autenticação: uma Origin permitida ainda exige Bearer token válido nas rotas autenticadas.
- **Integração com H3 preservada**: resposta 429 continua com `Retry-After` e todos os headers de H4.
- **Correção pós-implementação — normalização da allowlist CORS**: `CORS_ALLOWED_ORIGINS` passou a ser
  normalizada pelo MESMO helper usado para a Origin recebida (`normalizeCorsOrigin()`), eliminando um
  descompasso em que a configuração era guardada como string crua enquanto a comparação usava `URL`
  nativo — configurações com barra final, host em caixa alta ou porta padrão explícita passam a casar
  corretamente; uma entrada com path/query/hash é rejeitada por inteiro (fail-closed), nunca truncada
  silenciosamente. Em produção, uma entrada malformada em `CORS_ALLOWED_ORIGINS` agora interrompe o
  boot explicitamente (`validateAuthRuntimeConfig()`); fora de produção é apenas descartada. Ver
  `docs/DECISIONS.md`, PROD-H4-01 (correção pós-implementação), para o detalhamento completo.

**O que H4 NÃO fecha (deliberadamente fora desta rodada):** PG-14 (CSRF, continua condicional); refactor
de `onclick=`/etc. para `addEventListener()`; cabeçalhos `X-RateLimit-*` completos (H3/H4); qualquer
item de H5-H11. Gate como um todo permanece **NO-GO PARA PRODUÇÃO**.

**Testes:** 418/418 com Postgres real (384 anteriores + 23 do H4 original + 11 da correção de
normalização CORS, em `tests/h4-http-hardening.test.js` — CSP, HSTS, frame protection, Referrer-Policy,
Permissions-Policy, ausência de header Server/X-Powered-By, CORS same-origin/permitida/negada/ataque-de-
sufixo/Origin-null, preflight permitido/negado, auth+CORS, erros (401/404/403) com headers, healthcheck,
MIME types, um teste dedicado confirmando que o 429 de H3 preserva Retry-After + headers H4, e os novos
`[H4-CORS-NORM-*]` — unitários de `normalizeCorsOrigin()` e observáveis via servidor isolado para
trailing slash/caixa alta/porta padrão/rejeição de path/fail-fast e tolerância de boot), 0 falhando,
nenhum teste removido. O único teste deste arquivo que exige Postgres (429 de H3) é explicitamente
pulado sem `TEST_DATABASE_URL`, nunca fingindo cobertura que não existe; os demais 33 rodam idênticos em
ambos os backends (JSON fallback e Postgres), confirmando que os headers de segurança e a normalização
CORS nunca dependem do backend de persistência.

**Por que "aguardando homologação" e não "concluído":** mesma razão do H1A/H1B/H2/H3 — implementação
testada e funcional, mas depende de revisão humana antes de qualquer autorização de uso.

## 22. Status do Hardening H5 (IMPLEMENTADO PARCIALMENTE — PG-21 PERMANECE ABERTO)

**Decisão relacionada:** `docs/DECISIONS.md`, PROD-H5-01. **Runbook operacional:**
`docs/BACKUP_RESTORE_RUNBOOK.md`.

**Não fecha PG-21** — ver justificativa detalhada abaixo. **Não fecha** nenhum outro achado (PG-19,
PG-20, PG-22 permanecem exatamente como estavam).

### Matriz H5 — Backup/Restore (auditoria pré-implementação)

| Componente | Estado atual (antes de H5) | Risco | Controle implementado | Evidência/teste |
|---|---|---|---|---|
| Backup do PostgreSQL canônico | Só `POST /api/backup` — snapshot cifrado do documento JSON, sob demanda, nunca do PostgreSQL em si | Perda de dado sem backup real do banco canônico | `scripts/backup-postgres.js` — `pg_dump -Fc` real, automatizável (`npm run backup:postgres`), nunca depende só de HTTP | `tests/h5-backup-restore-postgres.test.js` (`[H5-real-A/B]`) |
| Formato/integridade do artefato | Nenhum backup real do Postgres existia para avaliar | Artefato corrompido/parcial aceito como válido | Custom format + smoke validation (`pg_restore --list`) + SHA-256 calculado e conferido no restore | `[H5-real-A]`, `[H5-real-G]` |
| Armazenamento offsite | Nenhum — `COEVO_BACKUP_KEY`/snapshot ficam onde o processo grava | Um incidente que destrua o filesystem também destrói o backup | Abstração de storage adapter (`backup/storage-adapter.js`) — `filesystem` só fora de produção, `s3` obrigatório em produção (fail-fast) | `[H5-factory-A/B]`; **s3 nunca exercitado contra bucket real (ver limitações)** |
| RPO/RTO | Nenhum definido | Sem meta objetiva de perda de dado/tempo de recuperação | RPO=6h, RTO=4h definidos e comprovados por restore real (`docs/BACKUP_RESTORE_RUNBOOK.md`, seções 2/10) | `[H5-real-F]`, `[H5-real-R]` |
| Restore | Bloqueado para PostgreSQL (`501 RESTORE_NOT_SUPPORTED_FOR_POSTGRES`) desde H1A | Nenhum caminho de disaster recovery validado | `scripts/restore-postgres.js` — `pg_restore` real, validado ponta a ponta | `[H5-real-C]` |
| Cross-environment restore | N/A (restore nem existia) | Restaurar staging/dev sobre produção por engano | Bloqueado por padrão; override explícito `RESTORE_ALLOW_CROSS_ENVIRONMENT=I_ACCEPT_THE_RISK` | `[H5-real-H/I]` |
| Restore em produção | N/A | Restore acidental sobre produção | Exige `RESTORE_CONFIRM_PRODUCTION=YES_I_UNDERSTAND` (string longa, nunca booleano trivial) | `[H5-real-J]` |
| Sobrescrita de banco já populado | N/A | Restore apaga dado mais recente silenciosamente | Exige `RESTORE_REPLACE=YES_REPLACE_TARGET_DATA` explícito | `[H5-real-K/L]` |
| Dados efêmeros pós-restore | N/A | Sessões/rate-limit de antes do incidente ressuscitadas cegamente | Política de revogação: `auth_sessions`/`auth_challenges`/`password_reset_tokens`/`rate_limit_buckets` truncadas após restore | `[H5-real-D]` |
| Evidência operacional | Nenhuma | Sem forma de saber se o último backup funcionou | Tabelas `backup_runs`/`restore_runs` (migration 008) — nunca segredo, sempre consultável | `[H5-real-B/E]` |
| Segredos em log de erro | `pg_dump`/`pg_restore` podem incluir a connection string na mensagem de erro | Vazamento de credencial em log | `backup/sanitize.js` — redação de `postgres://...`/`password=...` antes de logar/persistir | `[H5-sanitize-A]` |
| Criptografia do artefato | Nenhuma (Postgres não tinha backup próprio) | Artefato legível por qualquer um com acesso ao storage | `BACKUP_ENCRYPTION_KEY` opcional, AES-256-GCM, `encryptionKeyId` lógico no manifesto (nunca a chave) | `[H5-crypto-A/B/C/D]` |

### O que foi implementado

- **Backup real do PostgreSQL** via `pg_dump -Fc` (`scripts/backup-postgres.js`), nunca do snapshot JSON.
  Automatizável (`npm run backup:postgres`) — não depende de uma requisição HTTP feita por um usuário.
- **Manifesto** (`backup/manifest.js`) com `backupId`, timestamps, ambiente, versão do PostgreSQL, versão
  de migration aplicada, commit da aplicação, formato, criptografia (com `encryptionKeyId` lógico, nunca
  a chave), SHA-256, tamanho e referência ao objeto no storage — validado tanto na criação quanto no
  restore (nunca confia cegamente em metadata vinda de fora).
- **Storage adapter abstrato** (`backup/storage-adapter.js`) com dois providers: `filesystem` (stand-in
  explícito de desenvolvimento/teste, recusado em produção) e `s3` (S3-compatible via
  `@aws-sdk/client-s3`, único aceito em produção). Nenhum bucket real foi criado (item 53 do escopo H5).
- **Criptografia opcional** do artefato (AES-256-GCM, `BACKUP_ENCRYPTION_KEY`, independente de
  `COEVO_BACKUP_KEY`), com identificador lógico de chave preparando rotação futura sem invalidar backups
  antigos.
- **RPO=6h/RTO=4h**, definidos com justificativa e comprovados por execução real (ver
  `docs/BACKUP_RESTORE_RUNBOOK.md`).
- **Restore real** (`scripts/restore-postgres.js`) via `pg_restore`, nunca assume um banco "atual"
  implicitamente (`DATABASE_URL_TARGET` sempre explícita), com todas as guardas do escopo H5: integridade
  (tamanho + SHA-256, antes de qualquer ação no banco), validação de formato (`pg_restore --list`),
  bloqueio de cross-environment restore por padrão (override explícito e auditável), confirmação forte
  obrigatória para produção, bloqueio de sobrescrita silenciosa de banco já populado (`RESTORE_REPLACE`
  explícito), e revogação de dados efêmeros pós-restore (`auth_sessions`/`auth_challenges`/
  `password_reset_tokens`/`rate_limit_buckets` — nunca restaurados cegamente, ver
  `docs/DECISIONS.md`).
- **Evidência operacional durável**: `backup_runs`/`restore_runs` (migration 008), nunca um arquivo local
  paralelo — mesmo padrão arquitetural de `rate_limit_buckets` (H3).
- **Endpoints legados preservados**: `POST /api/backup`/`POST /api/backup/restore` continuam existindo
  (snapshot JSON administrativo), agora com comentários explícitos de que H5 é o mecanismo canônico —
  nunca duas implementações concorrentes fingindo a mesma garantia.

### Correção técnica pós-implementação (revisão técnica independente)

Uma revisão técnica independente do H5 original identificou 6 P1 corrigidos nesta mesma rodada, antes de
qualquer homologação:

1. **Credencial do PostgreSQL nunca em argv.** `pg_dump`/`pg_restore` recebiam `DATABASE_URL`/
   `DATABASE_URL_TARGET` completas (usuário:senha incluídos) como argumento de linha de comando —
   qualquer processo capaz de listar processos do sistema (`ps aux`, `/proc/<pid>/cmdline`) conseguiria
   ler a senha. Corrigido: `backup/pg-connection.js` parseia a connection string uma única vez; apenas
   host/porta/usuário/banco (não-segredo) viram argv, a senha vai exclusivamente via `PGPASSWORD` no
   `env` do processo filho (nunca em `process.env` global). Testado com senha contendo caracteres
   especiais (`@`, `:`, `/`, `%`) em backup/restore reais (`[H5-real-W]`).
2. **`BACKUP_ENCRYPTION_KEY` passou a ser OBRIGATÓRIA em produção.** Até existir validação real de
   SSE/KMS do provider de storage, um backup de produção sem criptografia application-side seria um
   artefato em texto claro — `scripts/backup-postgres.js` agora falha explicitamente (fail-fast) se
   `APP_ENVIRONMENT=production` e a chave estiver ausente/curta. Fora de produção continua opcional.
3. **`BACKUP_ENDPOINT` só aceita `https:` em produção.** Um storage S3-compatible customizado com
   endpoint `http:` em produção exporia as credenciais de acesso em texto claro — recusado
   explicitamente; fora de produção, endpoint HTTP local (MinIO/testes) continua permitido.
4. **Criptografia e upload/download S3 passaram a usar streaming REAL.** `backup/crypto.js` usava
   `fs.readFileSync()`/`fs.writeFileSync()` apesar do comentário original dizer "streaming" — corrigido
   para `createReadStream`/`createWriteStream` reais (formato de arquivo cifrado versionado: `versão(1)
   || iv(12) || ciphertext || tag(16)`, tag no final para permitir streaming de fato). O adapter `s3`
   usava `fs.readFileSync()` no upload e acumulava toda a resposta em um array de chunks no download —
   corrigido para `createReadStream`+`ContentLength` explícito (via `fs.statSync`, nunca lendo o
   arquivo) no upload, e `pipeline()` direto para o arquivo de destino no download.
5. **Nome real do banco no manifesto.** O manifesto registrava `database: 'postgres'` fixo — corrigido
   para `current_database()`, o nome real do banco de origem.
6. **RTO redigido como META (target), não como prova em escala.** O tempo de restore observado
   (< 1s) é do dataset SINTÉTICO de teste, não de um volume representativo de produção — a documentação
   (`docs/BACKUP_RESTORE_RUNBOOK.md`) e este documento passam a deixar isso explícito, e isso se torna
   mais um motivo (além do storage offsite real) para manter PG-21 aberto.

### Por que PG-21 permanece ABERTO (não fechado por intenção)

O escopo H5 (item 52) é explícito: "se offsite real não puder ser exercitado no CI por falta de
credencial... PG-21 só deve ser fechado se a arquitetura e configuração production-grade estiverem
completas E houver evidência suficiente do restore real" — caso contrário, registrar
"H5 IMPLEMENTADO PARCIALMENTE / PG-21 AINDA ABERTO" em vez de fechar falsamente. É exatamente o cenário
aqui: a arquitetura está completa e o restore real foi comprovado (ver seção acima e
`docs/BACKUP_RESTORE_RUNBOOK.md`, seção 10), mas o adapter `s3` — o único aceito em produção — nunca foi
exercitado contra um bucket real (testado apenas com um cliente S3 injetado,
`tests/h5-backup-restore.test.js`), porque nenhuma infraestrutura foi provisionada nesta rodada (item 53
do escopo H5 proibiu explicitamente criar bucket real/gerar custo). Sem essa validação, declarar PG-21
fechado seria declarar por intenção, não por comprovação. **Adicionalmente**: o RTO de 4h é uma meta
comprovada apenas com um dataset sintético pequeno, ainda não validada em volume representativo de
produção (ver correção 6 acima) — mais um motivo concreto para o gate permanecer aberto.

**Limitações registradas (ver também `docs/BACKUP_RESTORE_RUNBOOK.md`, seção 18):** adapter `s3` não
exercitado contra storage real; sem multipart upload; sem exclusão automática de backups expirados; sem
Object Lock/immutability configurado; sem agendamento de produção real (cron/scheduler — isso é H11);
RTO ainda não validado em volume representativo de produção.

### Terceira correção técnica pós-implementação: evidência operacional fail-closed

Uma revisão técnica adicional identificou que `backup_runs`/`restore_runs` podiam ser perdidos
silenciosamente (tracking fail-open) — um backup/restore de produção podia ser tratado como bem-sucedido
sem nenhuma linha de evidência durável. Corrigido (ver `docs/DECISIONS.md`, PROD-H5-01, segunda
correção, para o detalhamento completo):

- Backup em produção é **fail-closed** se `backup_runs` não puder nem ser iniciada — aborta ANTES do
  `pg_dump`.
- Dois erros dedicados (`backup/errors.js`) distinguem resultado da OPERAÇÃO de resultado da EVIDÊNCIA:
  `BackupTrackingError` (artefato já válido no storage, só o registro `completed` falhou — artefato
  nunca apagado) e `RestoreEvidenceError` (`pg_restore` já executado, só `insertRestoreRun()` falhou —
  `executionResult: 'success'|'failed'` explícito, nunca sugere reexecução).
- CLI usa exit code **2** para esses dois cenários (distinto do exit code 1 de falha real) — um
  scheduler externo nunca deve tratar "sucesso com evidência pendente" como "tente de novo".
- Falha de evidência sobre falha original nunca é escondida (ambas preservadas na mesma mensagem).
- Testado com PostgreSQL real: fail-closed em produção via banco sem migration 008; `BackupTrackingError`
  real via role com privilégio `INSERT`-only em `backup_runs`; `RestoreEvidenceError` via injeção de
  `runsRepositoryOverride` (mesmo padrão de injeção já usado para `s3Client`/`tempDir`).
- Não expande H6 — nenhum alerta/observabilidade implementado, apenas integridade do requisito já
  existente de evidência operacional durável.

### Testes

**485/485 passando** com Postgres real (478 anteriores + 7 novos em
`tests/h5-backup-restore-postgres.test.js` — `[H5-real-X/Y/Z/AA/AB/AC/AD]`: fail-closed de produção sem
`backup_runs`, tolerância explícita fora de produção, `BackupTrackingError` real via privilégio
restrito, `RestoreEvidenceError` para sucesso/falha via injeção de dependência, ausência de evidência
inventada quando nenhum banco é tocado, e verificação estática de que nenhum `catch(() => {})` de código
permanece sem justificativa), 0 falhando, nenhum teste removido. Sem `TEST_DATABASE_URL`: 358 passam +
7 pulados (inalterado — os novos testes são todos gated por Postgres real). `npm audit`: inalterado (2
vulnerabilidades altas conhecidas — H9).

**Por que "implementado parcialmente" e não "aguardando homologação" como H1A-H4:** as rodadas
anteriores completavam integralmente o critério de fechamento do(s) PG correspondente(s); H5 tem uma
dependência externa (storage offsite real) que este projeto não está autorizado a provisionar nesta
rodada — a diferença é registrada explicitamente, nunca escondida atrás de uma "homologação pendente"
que sugeriria que só falta revisão humana.

## 16. Decisão final atual

**NO-GO PARA PRODUÇÃO** — inalterado por esta rodada de hardening.

Após o H1A/H1B/H2/H3/H4/H5(parcial): **4 P0 abertos** (ausência de retenção/legal hold — H8, ausência de
incident response — H7, backup/restore de produção com offsite real ainda não validado — H5/PG-21,
ausência de infraestrutura de deploy como código — H11), **4 P1 abertos**, **4 P2 abertos** — 12 achados
abertos, **13 fechados** (PG-01 a PG-13, ver seções 17/18/19/20/21). Na matriz da seção 5, as linhas
"Persistência", "Sessões", "Autenticação (credenciais)", "Rate limiting" e "Headers HTTP" deixam de
bloquear; "Backup"/"Restore" avançaram substancialmente (mecanismo real, RPO/RTO comprovados) mas
continuam bloqueando até o storage offsite real ser exercitado; os demais 5 gates bloqueantes
(Logging/Monitoramento, Incident Response, Retenção/Legal Hold, Dependências, Deploy/Infra) permanecem
inalterados, mais o LGPD (P1, não bloqueante técnico mas pendente de decisão de negócio/jurídico).
Nenhum waiver foi emitido.
O Sprint 2 permanece concluído no escopo homologado (`docs/DECISIONS.md`, D2-CLOSE) — este documento não
o reabre nem contradiz; apenas formaliza que produção é um gate técnico/de negócio separado, ainda não
atendido, e que
o H1A/H1B/H2/H3/H4 avançaram critérios específicos de persistência/sessão/autenticação/rate limiting/
headers HTTP sem declarar o gate inteiro atendido, e H5 avançou substancialmente o mecanismo de
backup/restore sem ainda fechar PG-21 (pendência específica e documentada: storage offsite real).
