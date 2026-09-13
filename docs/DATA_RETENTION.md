# DATA_RETENTION.md — Política de Retenção de Dados

> Sprint 2, Hardening H8 (`docs/PRODUCTION_GATE.md`, PG-18/PG-19; `docs/DECISIONS.md`, PROD-H8-01).
> Este documento define a política de retenção por classe de dado, os mecanismos técnicos que a
> implementam (`retention/policy.js`, `retention/runner.js`, `scripts/run-retention.js`) e o modelo de
> legal hold que a excepciona (ver `docs/LEGAL_HOLD.md`).

## 1. Objetivo

Definir, por classe de dado tratada pelo Patrono, por quanto tempo o dado é retido, com que base, e como
(e se) ele é descartado — de forma auditável, nunca destrutiva por acidente, e nunca em violação a uma
obrigação de preservação (legal hold, incidente em investigação, processo jurídico em andamento).

**Aviso central desta política**: nenhum prazo abaixo é apresentado como uma exigência legal específica
("a LGPD exige N dias") sem uma base jurídica concreta identificada. Onde não existe uma norma setorial
ou contratual conhecida determinando um prazo, o valor é uma **POLÍTICA INTERNA PROPOSTA (DEFAULT /
PROPOSED INTERNAL POLICY)** — um ponto de partida operacional razoável, ajustável por configuração,
sujeito a revisão do time jurídico. Isso é deliberado: inventar uma obrigação legal inexistente seria tão
errado quanto ignorar uma real.

## 2. Princípios

- **Minimização**: só reter o necessário para a finalidade declarada de cada classe.
- **Necessidade/Finalidade**: cada classe abaixo declara para que serve a retenção (auditoria de
  segurança, evidência operacional, funcionamento técnico) — nunca "para sempre, por via das dúvidas".
- **Proporcionalidade**: prazo proporcional ao risco/valor probatório do dado (ex.: sessão expirada tem
  prazo curto; log de auditoria de segurança, mais longo).
- **Rastreabilidade**: toda execução de descarte automático gera evidência (`retention_runs`,
  eventos `RETENTION_*` em `audit_log`) — nunca um `DELETE` silencioso sem registro.
- **Descarte seguro**: descarte é sempre um `DELETE` transacional contra a linha elegível, nunca uma
  truncagem de tabela nem uma operação em lote sem filtro de elegibilidade.
- **Legal hold como exceção formal**: qualquer registro sob legal hold ativo (`docs/LEGAL_HOLD.md`) é
  **sempre** excluído do descarte automático, mesmo que tecnicamente elegível pelo prazo — nunca o
  contrário.

## 3. Matriz H8 — Classe de dado × retenção × legal hold

| Classe | Fonte | Finalidade | Retenção padrão | Base da retenção | Pode expirar? | Legal Hold aplicável? | Método de descarte | Evidência |
|---|---|---|---|---|---|---|---|---|
| `SECURITY_AUDIT` | `audit_log` (ações sensíveis: login, MFA, sessão, legal hold, backup/restore, rate limit) | Investigação de segurança, accountability | 365 dias (`RETENTION_SECURITY_AUDIT_DAYS`) | Política interna proposta — nenhuma norma legal específica identificada nesta rodada | Sim (política), mas **purge automático NÃO implementado nesta rodada** | Sim (DATA_CLASS/GLOBAL) | Não implementado nesta rodada — ver §6 | — |
| `BUSINESS_AUDIT` | `audit_log` (ações de negócio: financeiro, jurídico, projetos) | Rastreabilidade de decisão de negócio | Sem prazo definido nesta rodada (`default: null`) | Decisão de negócio/jurídico pendente — nunca inventado | Não (nesta rodada) | Sim (DATA_CLASS/GLOBAL) | Não implementado nesta rodada — ver §6 | — |
| `AUTH_SESSION` | `auth_sessions` | Autenticação — sessão expirada/revogada não tem mais função técnica | 7 dias após expiração/revogação (`RETENTION_EXPIRED_SESSION_DAYS`) | Política interna — janela de tolerância operacional pós-expiração | Sim | Sim (ENTITY por `user:<id>`, DATA_CLASS, GLOBAL) | `DELETE` transacional, respeitando legal hold — **implementado** | `retention_runs` + `RETENTION_DRY_RUN`/`RETENTION_EXECUTED`/`RETENTION_ITEM_SKIPPED_LEGAL_HOLD` |
| `AUTH_RESET_TOKEN` | `password_reset_tokens` | Fluxo de redefinição de senha — token expirado/usado não tem mais função | 7 dias após expiração/uso (mesma env var de `AUTH_SESSION`) | Política interna | Sim | Sim (ENTITY por `user:<id>`, DATA_CLASS, GLOBAL) | `DELETE` transacional — **implementado** | idem |
| `RATE_LIMIT` | `rate_limit_buckets` | Janela técnica de proteção contra abuso — sem valor após a janela | 24 horas desde a última atualização (`RETENTION_RATE_LIMIT_HOURS`) | Janela técnica do próprio mecanismo (H3) | Sim | Sim (DATA_CLASS, GLOBAL — sem noção de ENTITY, chave é HMAC opaco) | `DELETE` transacional — **implementado** | idem |
| `BACKUP_METADATA` | `backup_runs` (H5) | Evidência operacional de execução de backup | 400 dias (`RETENTION_BACKUP_METADATA_DAYS`) | Política interna | Sim (política), purge não implementado nesta rodada | Sim | Não implementado nesta rodada | — |
| `RESTORE_METADATA` | `restore_runs` (H5) | Evidência operacional de execução de restore | 400 dias (`RETENTION_RESTORE_METADATA_DAYS`) | Política interna | Sim (política), purge não implementado nesta rodada | Sim | Não implementado nesta rodada | — |
| `INCIDENT_RECORD` | Registros de incidente (H7, `incidents/`) | Evidência/postmortem de incidente de segurança | 365 dias (`RETENTION_INCIDENT_RECORD_DAYS`) | Política interna | Sim (política), purge **deliberadamente não implementado** — incidentes são evidência sensível | Sim | **Nunca purgado automaticamente nesta rodada** (decisão explícita, ver §6) | — |
| `OPERATIONAL_LOG` | Log estruturado (H6, `observability/logger.js`) | Diagnóstico operacional | 90 dias (`RETENTION_OPERATIONAL_LOG_DAYS`) | Política interna | Sim (política) | Sim (em tese) | **Fora do controle desta aplicação** — log só existe no destino real de agregação (nenhum foi provisionado, PG-17 aberto); a retenção real é responsabilidade do coletor (H11) | — |
| `LEGAL_PROCESS` | `legal_processes` (núcleo jurídico) | Objeto de negócio principal — processo jurídico ativo | Sem prazo — vida útil do processo | Decisão de negócio/jurídico | Não | Sim | **Nunca purgado automaticamente** (fora de escopo desta rodada e de qualquer rodada futura sem decisão jurídica explícita) | — |
| `LEGAL_DEADLINE` | `legal_deadlines` | Prazo processual vinculado a um `LEGAL_PROCESS` | Sem prazo — vida útil do prazo/processo | Decisão de negócio/jurídico | Não | Sim | **Nunca purgado automaticamente** | — |
| `INTEGRATION_CACHE` | Cache de sincronização (ex.: Monday.com) | Performance/consistência de integração | Não formalizado nesta rodada | — | — | Sim (em tese) | Não implementado nesta rodada | — |
| `TEMPORARY_ARTIFACT` | Arquivo temporário gerado sob demanda (ex.: export PDF/PPTX) | Entrega pontual ao usuário | Não formalizado nesta rodada — hoje não persistido em disco entre requisições | — | — | Não aplicável | Não aplicável nesta rodada | — |
| `USER_ACCOUNT` | `app_users` | Identidade/autenticação do usuário | Sem prazo — vida útil do vínculo com a organização | Decisão de negócio/RH | Não | Sim | **Nunca purgado automaticamente** (inativação lógica via `deletedAt` já existe desde H1B; purge físico é uma decisão de negócio separada, fora de escopo) | — |
| `OTHER` | Classe residual — qualquer dado não mapeado explicitamente acima | — | Não definida | — | — | Sim (em tese) | Não implementado | — |

Fonte única desta matriz no código: `retention/policy.js` (`DATA_CLASSES`, `DEFAULT_RETENTION`,
`PURGEABLE_CLASSES`). Qualquer alteração de prazo ou de classe deve atualizar os dois em conjunto.

## 4. O que é efetivamente purgado nesta rodada (H8)

Apenas as **3 classes efêmeras** listadas em `PURGEABLE_CLASSES`: `AUTH_SESSION`, `AUTH_RESET_TOKEN`,
`RATE_LIMIT`. Esta é uma decisão deliberada de escopo (não uma limitação técnica): começar pelo dado que
não tem nenhum valor probatório/de negócio residual após expirar, antes de estender a automação a classes
sensíveis (auditoria de negócio/segurança, processos jurídicos, contas de usuário, registros de
incidente), que exigem uma política adicional explícita — de retenção mínima legal/contratual real,
aprovação formal e, no caso de auditoria, uma trilha de imutabilidade mais forte do que a existente hoje
(ver `docs/AUDIT.md`/seção 7 abaixo). **Por isso PG-19 permanece ABERTO** (ver `docs/PRODUCTION_GATE.md`,
seção 25): a política GLOBAL completa, cobrindo todas as classes, ainda não está formalmente definida.

## 5. Configuração (variáveis de ambiente)

Nenhuma é obrigatória para o boot do servidor — a retenção não é um requisito de disponibilidade do app
em si (mesmo padrão de backup/restore, H5). São lidas apenas por `retention/policy.js`, sob demanda, e
validadas explicitamente por `scripts/run-retention.js` antes de um `--execute` real.

| Variável | Classe | Unidade | Default | Obrigatória? |
|---|---|---|---|---|
| `RETENTION_SECURITY_AUDIT_DAYS` | `SECURITY_AUDIT` | dias | 365 | Não |
| `RETENTION_BUSINESS_AUDIT_DAYS` | `BUSINESS_AUDIT` | dias | sem default (purge não implementado) | Não |
| `RETENTION_EXPIRED_SESSION_DAYS` | `AUTH_SESSION`/`AUTH_RESET_TOKEN` | dias | 7 | Não |
| `RETENTION_RATE_LIMIT_HOURS` | `RATE_LIMIT` | horas | 24 | Não |
| `RETENTION_BACKUP_METADATA_DAYS` | `BACKUP_METADATA` | dias | 400 | Não |
| `RETENTION_RESTORE_METADATA_DAYS` | `RESTORE_METADATA` | dias | 400 | Não |
| `RETENTION_INCIDENT_RECORD_DAYS` | `INCIDENT_RECORD` | dias | 365 | Não |
| `RETENTION_OPERATIONAL_LOG_DAYS` | `OPERATIONAL_LOG` | dias | 90 | Não |
| `RETENTION_EXECUTE_CONFIRMATION` | — (confirmação de execução real) | string | vazio | Sim, em produção, apenas para `--execute` |
| `AUDIT_IP_HMAC_KEY` | Auditoria (PG-18) | string (≥ recomendável 32 chars) | vazio | Sim, em produção, apenas se IP pseudonimizado for exercitado |

Um valor inválido (não-inteiro/≤0) em qualquer uma dessas variáveis nunca é ignorado silenciosamente:
`resolveRetentionValue()` lança um erro explícito nomeando a variável, e `validatePolicyForProduction()`
agrega todos os erros de uma vez antes de permitir uma execução real (`--execute`) — falha segura
("fail-safe"), nunca um fallback silencioso para o default quando o operador já tentou configurar um
valor (mesmo padrão de falha explícita já usado em H2/H3/H5).

## 6. Não implementado nesta rodada (deliberadamente, não por omissão)

- Purge automático de `legalProcesses`/`legalDeadlines`: são o objeto de negócio principal do sistema —
  nunca teriam um prazo de expiração técnico sem uma decisão jurídica/de negócio explícita e uma política
  de arquivamento formal (fora do escopo de H8).
- Purge automático de `audit_log` de negócio (`BUSINESS_AUDIT`) ou de segurança (`SECURITY_AUDIT`): a
  auditoria é, ela mesma, a evidência usada para investigar incidentes/disputas — purgá-la
  automaticamente sem uma política de retenção mínima legal validada seria contraproducente. `SECURITY_AUDIT`
  já tem um default de política (365 dias) documentado na matriz, mas o **mecanismo de purge não foi
  implementado** — apenas a classe/prazo estão definidos, para quando essa decisão for tomada.
- Purge automático de contas de usuário (`USER_ACCOUNT`): já existe inativação lógica (`deletedAt`,
  H1B) — a exclusão física é uma decisão de negócio/RH separada, nunca automatizada por prazo.
- Purge automático de registros de incidente (`INCIDENT_RECORD`, H7): incidentes de segurança são, por
  definição, o tipo de evidência que mais provavelmente estará sob legal hold — automatizar seu descarte
  nesta rodada seria o oposto do objetivo do H8.
- Retenção de logs operacionais agregados (`OPERATIONAL_LOG`): depende de um agregador/coletor real, que
  ainda não foi provisionado (PG-17, H11) — a política está documentada (90 dias como proposta), mas não
  é "aplicada" por esta aplicação, porque o dado em si não vive persistido por ela.
- eDiscovery/DLP/WORM/immutable vault/object lock de storage externo: fora de escopo desta rodada e de
  qualquer rodada H8 futura sem uma decisão explícita de investir nessa infraestrutura (H11/PG-21).

## 7. Auditoria (PG-18) — o que mudou nesta rodada

Ver `docs/AUDIT.md` (seção correspondente, se existir) e `docs/SECURITY.md`. Resumo:

- `audit()` (server.js) ganhou um parâmetro opcional `context` (retrocompatível — nenhum dos ~50 pontos
  de chamada existentes foi obrigado a mudar) trazendo `requestId` (reaproveitado do H6, nunca um novo
  identificador paralelo), `sessionId` (reservado — ainda não populado, ver limitação abaixo),
  `ipHmac` (IP do requisitante pseudonimizado via HMAC-SHA256 com `AUDIT_IP_HMAC_KEY`, nunca em texto
  puro nem hash sem segredo) e `userAgentSummary` (família/plataforma minimizada, ex. `chrome/desktop`,
  nunca a string crua do `User-Agent`).
- Nesta rodada, esse enriquecimento foi aplicado às novas rotas de legal hold (`LEGAL_HOLD_CREATED`/
  `LEGAL_HOLD_RELEASED`) e aos eventos do runner de retenção (`RETENTION_*`). Os ~50 pontos de chamada de
  `audit()` já existentes (login, MFA, financeiro, jurídico, backup/restore, rate limit etc.) **continuam
  sem esse contexto** — retrofitá-los é um gap documentado, não uma correção de escopo desta rodada
  (seria uma expansão de superfície muito maior que o P0 real, PG-19).
- **Limitação documentada**: `sessionId` está sempre `null` nesta rodada — `getUser()` (server.js) hoje
  devolve apenas o usuário autenticado, não o id da sessão resolvida; popular esse campo exigiria alterar
  a assinatura de `getUser()` e todos os seus ~50 pontos de chamada, o que não foi feito para não expandir
  o escopo técnico de H8 além do necessário para as novas rotas.
- Nunca são armazenados: IP em texto puro, `User-Agent` completo, `Authorization`, `Cookie`, token de
  sessão, ou qualquer payload sensível dentro de `retention_runs.summary`/eventos `RETENTION_*` (testado
  em `tests/h8-retention-legal-hold.test.js`).
- `BUSINESS_AUDIT` (ações de negócio) e `SECURITY_AUDIT` (login/MFA/sessão/legal hold/rate limit/
  backup-restore) continuam gravados na mesma tabela `audit_log` — a distinção nesta rodada é apenas
  conceitual/documental (ver matriz acima), não uma separação física de tabela. Nenhuma mudança de
  imutabilidade: `audit_log` já era (e continua sendo) append-only por construção — a aplicação nunca
  executa `UPDATE`/`DELETE` contra ela (não há nenhum código de rota que o faça). Não há hash-chain nem
  WORM/blockchain nesta rodada — gap documentado, não implementado.

## 8. Backup ≠ Legal Hold ≠ Retenção (distinções que nunca devem ser confundidas)

- **Backup** (H5) existe para **recuperação de desastre** — restaurar o sistema a um estado operacional
  anterior. Um backup antigo pode (e deve) expirar pela sua própria política de retenção operacional
  (`RETENTION_BACKUP_METADATA_DAYS` cobre apenas o metadado de execução, `backup_runs` — não o conteúdo
  do backup em si, que é gerido pelo storage local/offsite de H5, fora do escopo desta política).
- **Legal Hold** (`docs/LEGAL_HOLD.md`) existe para **preservar evidência/dado do titular** por exigência
  jurídica/investigativa — é uma exceção que **bloqueia** o descarte, nunca um mecanismo de recuperação.
- Um `restore` (H5) que traz de volta dados de um backup anterior **nunca reativa silenciosamente** uma
  política de retenção já expirada sobre esses dados — ou seja, dado restaurado que já deveria ter sido
  purgado não deveria ser tratado como "novo" para fins de contagem de prazo. Esta rodada **não
  implementa** uma reconciliação automática desse cenário (seria complexidade desproporcional ao escopo
  de H8) — fica documentado como uma dependência futura de H11/storage lifecycle, a ser tratada junto
  com PG-21.
- A retenção definida aqui **não alcança backups já gerados** (arquivos/objetos de storage externo) — o
  ciclo de vida de um backup físico (expiração no S3, lifecycle rules, object lock) é uma responsabilidade
  de infraestrutura (H11) e do storage escolhido, não desta aplicação. Ver PG-21.

## 9. Aprovação e revisão periódica

Esta política (prazos e classes) é proposta e implementada nesta rodada sob responsabilidade técnica.
**Não substitui** uma revisão formal do time jurídico/DPO da COEVO — em particular sobre `BUSINESS_AUDIT`,
`INCIDENT_RECORD`, `LEGAL_PROCESS`/`LEGAL_DEADLINE` e `USER_ACCOUNT`, onde pode existir uma obrigação
contratual ou regulatória específica ainda não identificada nesta rodada. Recomenda-se revisão desta
política a cada 12 meses ou a qualquer mudança relevante de escopo de negócio/regulatório, e sempre que
uma nova classe de dado for introduzida no sistema.

## 10. Referências

- `retention/policy.js` — fonte única de classes/defaults/versão de política (`POLICY_VERSION`).
- `retention/runner.js` — mecanismo de inspeção/purge, sempre com evidência.
- `retention/legal-hold.js` — modelo de legal hold (ver `docs/LEGAL_HOLD.md`).
- `scripts/run-retention.js` — CLI de execução (dry-run por padrão).
- `migrations/009_h8_retention_legal_hold.sql` — schema (`legal_holds`, `retention_runs`, colunas novas
  de `audit_log`).
- `docs/LEGAL_HOLD.md`, `docs/PRODUCTION_GATE.md` (seção 25), `docs/DECISIONS.md` (PROD-H8-01/02/03).
