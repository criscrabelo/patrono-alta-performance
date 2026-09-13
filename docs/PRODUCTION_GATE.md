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
| PG-01 | Persistência | `data/store.json` é a única persistência ativa; reescrita integral sem lock/transação a cada mutação | Corrupção sob concorrência, perda de durabilidade, sem escala horizontal | **P0** | SIM | Migrar para PostgreSQL (schema já preparado em `migrations/`), conectar `database.js` ao runtime | Runtime lê/escreve exclusivamente via banco transacional; testes de concorrência passam | H1 |
| PG-02 | Persistência | Nenhum lock/atomicidade entre leitura e escrita do JSON | Race condition (last-write-wins silencioso) sob requisições concorrentes | **P0** | SIM | Resolvido junto com PG-01 (transação de banco) | Nenhuma escrita concorrente perde dado sem detecção | H1 |
| PG-03 | Persistência | Sem versionamento de schema/migração automática no boot | Drift entre ambientes, deploy quebrado silenciosamente | **P1** | SIM | Rodar migrations no pipeline de deploy, não manualmente | Deploy falha explicitamente se a migration pendente não rodar | H1 |
| PG-04 | Sessão/Auth | Sessões em `Map()` em memória, perdidas a cada reinício do processo | Logout forçado de todos os usuários a cada deploy/restart; sem HA | **P1** | SIM | Sessão em armazenamento compartilhado (banco/cache), sobrevivendo a restart/múltiplas instâncias | Sessão válida sobrevive a um restart do processo | H2, PG-01 |
| PG-05 | Sessão/Auth | Não há `logout` que invalide a sessão no servidor | Token roubado continua válido até expirar mesmo após "logout" do usuário | **P1** | SIM | Endpoint de logout que remove a sessão do armazenamento server-side | Token usado após logout retorna 401 | H2 |
| PG-06 | Sessão/Auth | Não há revogação ativa de sessão (ex.: force-logout administrativo) | Sessão comprometida não pode ser encerrada remotamente | **P1** | SIM | Endpoint administrativo de revogação por usuário/sessão | Sessão revogada devolve 401 imediatamente | H2 |
| PG-07 | Sessão/Auth | Senha única compartilhada (`COEVO_DEMO_PASSWORD`) para todos os usuários | Sem responsabilização individual real por login; qualquer vazamento afeta todos | **P0** | SIM | Senha/hash por usuário (bcrypt/argon2), fluxo de cadastro/redefinição real | Login exige credencial própria por usuário, hash armazenado com salt | H2 |
| PG-08 | Sessão/Auth | Código de MFA único compartilhado (`COEVO_MFA_CODE`) | MFA não é MFA real — mesmo segundo fator para todos os usuários | **P0** | SIM | MFA por usuário (TOTP/SMS/e-mail individual) | Cada usuário tem segredo de MFA próprio, não reutilizável entre contas | H2 |
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
| PG-24 | LGPD | Monday.com e (futuramente) Google Calendar são suboperadores/subprocessadores sem lista/DPA documentado | Ausência de rastreabilidade de para onde dados pessoais trafegam | **P2** | NÃO (piloto), SIM (produção) | Documentar suboperadores e base legal de transferência | Lista de suboperadores mantida em `docs/SECURITY.md`/`docs/INTEGRATIONS.md` | — |
| PG-25 | Dependências | Sem `npm audit` como gate de CI (hoje é apenas informativo, `|| true`) | Nova vulnerabilidade alta/crítica pode entrar sem bloquear o merge | **P2** | NÃO (aceitável com revisão manual continuada) | Tornar `npm audit` bloqueante para novas vulnerabilidades altas/críticas além da já conhecida | CI falha em nova vulnerabilidade alta/crítica não registrada como waiver | H9 |

**Contagem:** P0 = 8 (PG-01, PG-02, PG-07, PG-08, PG-10, PG-11, PG-19, PG-20, PG-21, PG-22 — ver nota) · P1 = 6 · P2 = 5 · P3 = 0.

> Nota de contagem: PG-01/PG-02 são exibidos como dois achados por clareza de causa raiz, mas
> compartilham a mesma correção (H1); ao contá-los separadamente o total de P0 é **10** (PG-01, PG-02,
> PG-07, PG-08, PG-10, PG-11, PG-19, PG-20, PG-21, PG-22). Nenhum achado desta rodada foi classificado
> como P3 — não há "melhoria cosmética" pendente que já não esteja coberta por um P1/P2 real.

## 5. Matriz GO/NO-GO

| Gate | Status atual | Bloqueia produção? | Critério GO |
|---|---|---|---|
| Persistência | `data/store.json`, sem transação/lock | SIM | PostgreSQL conectado ao runtime, testado sob concorrência |
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

## 16. Decisão final atual

**NO-GO PARA PRODUÇÃO.**

10 achados P0 abertos (persistência, credenciais/MFA compartilhados, ausência de rate limiting, ausência
de retenção/legal hold, ausência de incident response, backup/restore não validado, ausência de
infraestrutura de deploy como código), mais 6 P1. Nenhum waiver foi emitido. O Sprint 2 permanece
concluído no escopo homologado (`docs/DECISIONS.md`, D2-CLOSE) — este documento não reabre nem contradiz
aquela decisão; apenas formaliza que produção é um gate técnico/de negócio separado, ainda não atendido.
