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
| PG-04 | Sessão/Auth | Sessões em `Map()` em memória, perdidas a cada reinício do processo | Logout forçado de todos os usuários a cada deploy/restart; sem HA | **P1** | SIM | Sessão em armazenamento compartilhado (banco/cache), sobrevivendo a restart/múltiplas instâncias | Sessão válida sobrevive a um restart do processo | H2, PG-01 |
| PG-05 | Sessão/Auth | Não há `logout` que invalide a sessão no servidor | Token roubado continua válido até expirar mesmo após "logout" do usuário | **P1** | SIM | Endpoint de logout que remove a sessão do armazenamento server-side | Token usado após logout retorna 401 | H2 |
| PG-06 | Sessão/Auth | Não há revogação ativa de sessão (ex.: force-logout administrativo) | Sessão comprometida não pode ser encerrada remotamente | **P1** | SIM | Endpoint administrativo de revogação por usuário/sessão | Sessão revogada devolve 401 imediatamente | H2 |
| PG-07 | Sessão/Auth | Senha única compartilhada (`COEVO_DEMO_PASSWORD`) para todos os usuários | Sem responsabilização individual real por login; qualquer vazamento afeta todos | **P0** | SIM | Senha/hash por usuário (bcrypt/argon2), fluxo de cadastro/redefinição real | Login exige credencial própria por usuário, hash armazenado com salt | H2 |
| PG-08 | Sessão/Auth | Código de MFA único compartilhado (`COEVO_MFA_CODE`) | MFA não é MFA real — mesmo segundo fator para todos os usuários | **P0** | SIM | MFA individual por usuário, com fator separado e mecanismo aprovado para produção (a escolha concreta — TOTP, SMS, e-mail ou outro — fica para a implementação em H2, não homologada por este documento) | Cada usuário tem segredo/fator de MFA próprio, não reutilizável entre contas | H2 |
| PG-09 | Sessão/Auth | Nenhuma política de senha (comprimento, complexidade, rotação) | N/A hoje (não há senha por usuário); vira obrigatório ao resolver PG-07 | **P1** | SIM (condicionado a PG-07) | Definir política mínima de senha ao implementar PG-07 | Política documentada e validada no cadastro/redefinição | PG-07 |
| PG-10 | Sessão/Auth | Sem proteção a força bruta em `/api/auth/login`/`/api/auth/mfa` | Enumeração de credenciais/código por tentativa exaustiva | **P0** | SIM | Rate limiting + bloqueio progressivo por IP/conta | N tentativas falhas em janela de tempo bloqueiam/atrasam novas tentativas | H3 |
| PG-11 | Rate limiting | Nenhuma rota tem rate limiting (login, API geral, integrações) | Abuso, DoS de aplicação, força bruta | **P0** | SIM | Rate limiting global + reforçado em rotas sensíveis (login/MFA) | Rajada acima do limite recebe 429, sem afetar outros usuários | H3 |
| PG-12 | HTTP hardening | Ausência de CSP/HSTS/X-Frame-Options/Referrer-Policy/Permissions-Policy | Clickjacking, XSS com maior impacto, downgrade de protocolo | **P1** | SIM | Adicionar headers de hardening padrão (helmet-like, sem framework novo se possível) | Headers presentes e validados em resposta HTTP real | H4 |
| PG-13 | HTTP hardening | CORS não configurado explicitamente (same-origin implícito) | Comportamento não documentado; risco se um domínio de app separado for introduzido | **P2** | NÃO (aceitável enquanto for same-origin) | Documentar e, se necessário, configurar allowlist explícita | Política de CORS documentada e testada | H4 |
| PG-14 | HTTP hardening | Sem CSRF explícito (mitigado estruturalmente por Bearer token sem cookie) | Baixo hoje; se sessão migrar para cookie (PG-04), CSRF volta a ser relevante | **P2** | NÃO hoje / SIM se migrar para cookie | Reavaliar ao mudar modelo de sessão | Sem alteração enquanto o modelo for Bearer token puro | H2 (condicional) |
| PG-15 | Dependências | `npm audit`: 2 altas (`image-size`/`pptxgenjs`, DoS por parser) | Negação de serviço na geração de apresentações PPTX | **P1** | SIM | Avaliar migração/downgrade controlado de `pptxgenjs` com validação de exportação PPTX/PDF | Vulnerabilidade tratada ou mitigação/waiver formal registrado | H9 |
| PG-16 | Google Calendar | Sem OAuth real, sem token storage seguro | Bloqueia apenas a leitura real de Calendar (funcionalidade opcional) | **P2** | NÃO (feature opcional, adapter seguro por design) | Implementar OAuth mínimo + storage seguro de token quando priorizado | Fluxo de leitura real testado ponta a ponta sem expor token | H10 |
| PG-17 | Logging/Monitoramento | Nenhum logging estruturado, alerta ou monitoramento de produção | Incidente pode passar despercebido; sem visibilidade operacional | **P1** | SIM | Logging estruturado (sem PII/segredo) + alerta básico de erro/disponibilidade | Log de erro em produção é buscável e não contém segredo/PII | H6 |
| PG-18 | Auditoria | Eventos de auditoria não capturam IP/sessão/user-agent; sem rotação/retenção | Rastreabilidade incompleta para investigação; crescimento não controlado do arquivo | **P2** | NÃO (MVP aceitável) | Adicionar metadados de origem e política de retenção ao evoluir para produção | Auditoria permite reconstruir "quem, quando, de onde, o quê" | H8 |
| PG-19 | Retenção/Legal Hold | Nenhuma política de retenção/exclusão/legal hold definida para nenhuma entidade | Impossível responder a obrigação legal de retenção ou a um pedido de exclusão (LGPD) | **P0** | SIM | Definir política por tipo de dado (audit, Legal Deadline, documentos, backups) | Política documentada e aplicável tecnicamente (mesmo que manual no início) | H8 |
| PG-20 | Incident Response | Nenhum processo de resposta a incidente definido | Sem detecção/contenção/comunicação formal em caso de violação | **P0** | SIM | Checklist mínimo de IR (ver seção 8) | Checklist existe, tem responsável nomeado e canal de comunicação definido | H7 |
| PG-21 | Backup/Restore | Backup/restore só sob demanda via API; sem agendamento, offsite, RPO/RTO ou teste de restore evidenciado | Perda de dado sem recuperação viável em caso de incidente | **P0** | SIM | Backup agendado, offsite, com RPO/RTO definidos e teste de restore documentado | Restore de um backup real é executado e validado ao menos uma vez, com evidência | H5, PG-01 |
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
| Sessões | Em memória, sem logout/revogação server-side | SIM | Sessão persistida + logout/revogação funcionais |
| Autenticação (credenciais) | Senha e MFA únicos compartilhados | SIM | Credencial e MFA por usuário |
| Rate limiting | Inexistente | SIM | Rate limiting em rotas sensíveis e na API geral |
| Headers HTTP | Só `nosniff` | SIM | CSP/HSTS/X-Frame-Options/Referrer-Policy/Permissions-Policy presentes |
| CSRF | Mitigado estruturalmente (Bearer, sem cookie) | NÃO (hoje) | Reavaliar se o modelo de sessão mudar |
| Secrets | Server-side only, sem vazamento identificado | NÃO | Manter prática atual + revisão contínua |
| Backup | Sob demanda, sem agendamento/offsite/RPO/RTO | SIM | Backup agendado + offsite + RPO/RTO definidos |
| Restore | Endpoint existe, sem teste de restore evidenciado | SIM | Restore testado e documentado ao menos uma vez |
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
  Cutover: a importação real remove as 4 chaves do blob na mesma transação.
- `storage.init()`/`healthcheck()` também exigem a migration `004_h1b_core_relational` e as 4 tabelas do
  núcleo relacional — schema incompatível/ausente falha explicitamente, nunca silenciosamente.

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

**Testes:** 25 novos em `tests/h1b-core-relational.test.js` (mais 1 "pulado explicitamente" sem
`TEST_DATABASE_URL`) + 9 novos testes puros de validação de `scripts/migrate-h1b-data.js` em
`tests/storage.test.js`. Total: 314 testes passam com Postgres real conectado (0 pulados); 279 passam sem
Postgres disponível (3 pulados explicitamente — fallback local). CI (Node 20.x/22.x) roda
`tests/h1b-core-relational.test.js` contra bancos Postgres isolados criados/derrubados pelo próprio teste
(evita colidir com os demais arquivos de teste rodando em paralelo no mesmo serviço `postgres:16`).

**Por que "aguardando homologação" e não "concluído":** mesma razão do H1A — implementação testada e
funcional, mas depende de revisão humana antes de qualquer autorização de uso; e a normalização relacional
cobre só o núcleo canônico definido nesta rodada, não o restante do modelo de dados.

## 16. Decisão final atual

**NO-GO PARA PRODUÇÃO** — inalterado por esta rodada de hardening.

Após o H1A/H1B: **8 P0 abertos** (credenciais/MFA compartilhados, ausência de rate limiting, ausência de
retenção/legal hold, ausência de incident response, backup/restore de produção não validado — H5,
ausência de infraestrutura de deploy como código), **9 P1 abertos**, **5 P2** — 22 achados abertos, **3
fechados** (PG-01/PG-02/PG-03, ver seções 17/18). Na matriz da seção 5, a linha "Persistência" deixa de
bloquear; os demais 12 gates bloqueantes permanecem. Nenhum waiver foi emitido. O Sprint 2 permanece
concluído no escopo homologado (`docs/DECISIONS.md`, D2-CLOSE) — este documento não o reabre nem
contradiz; apenas formaliza que produção é um gate técnico/de negócio separado, ainda não atendido, e que
o H1A/H1B avançaram critérios específicos de persistência sem declarar o gate inteiro atendido.
