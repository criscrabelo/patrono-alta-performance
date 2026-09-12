# DECISIONS.md — Decisões de Arquitetura e Negócio

> Registro obrigatório por `docs/MASTER_HANDOFF.md` (v1.3), regra de uso e §29 "Checklist Claude Code".
> Este arquivo tem duas seções: **(1) Decision Backlog de negócio** (§27 da v1.3, verbatim, com status
> local) e **(2) Decisões técnicas de engenharia** tomadas na Fase 0 para viabilizar o Sprint 1, todas
> reversíveis e sem alterar regra de negócio.
>
> Regra de uso (§ da v1.3): quando houver conflito entre o código existente e a v1.3, ou dúvida sobre
> uma regra crítica, a dúvida é registrada aqui — nunca resolvida por improviso.

---

## 1. Decision Backlog de Negócio (MASTER_HANDOFF §27)

Nenhuma destas decisões foi tomada por este agente — são de responsabilidade do negócio/gestora,
conforme a v1.3. Nenhuma delas bloqueia o shell, a autenticação, o Design System ou a fundação
(MASTER_HANDOFF §9, "Regra de bloqueio por escopo"); cada uma bloqueia apenas o que está listado na
coluna "Bloqueia".

| # | Questão | Impacto | Responsável | Quando | Bloqueia | Status |
|---|---|---|---|---|---|---|
| D1 | Fonte/origem do Legal Deadline por tipo de processo/board no piloto | Prazo jurídico e Agenda | Negócio + Jurídico + TI | Antes do Sprint 2 | Piloto jurídico / Legal Deadline | **Pendente — bloqueia Sprint 2** |
| D2 | Fonte oficial de CPF/CNPJ | Matching, dedup, snapshot | Negócio | Antes de matching/dedup definitivo | Cadastro Mestre, views 360, snapshots | **Pendente** |
| D3 | Data owner por domínio | Nenhum campo crítico tem responsável definido | Negócio | Fase 1 | Governança de dados | **Pendente** |
| D4 | Fonte oficial do contato do cliente | Divergência CV × Sienge | Negócio | Fase 2 | Resolução de divergências | **Pendente** |
| D5 | Plano de saída de cada board Monday | Fonte transitória virando permanente | Negócio + TI | Fase 6 | Desativação de fonte | **Pendente** |
| D6 | Módulos e endpoints do Sienge disponíveis | Escopo financeiro | TI | Antes da Fase 6 | Governança Financeira | **Pendente** |
| D7 | Expectativa de freshness por fonte | Define "atrasado" | Negócio + TI | Fase 6 | Observabilidade | **Pendente** |
| D8 | Stack, hospedagem, banco | Base técnica | Engenharia | Início da Fase 0 | Não bloqueia negócio; ver ADR-001 | **Resolvido nesta execução — ver ADR-001** |
| D9 | Provedor de autenticação e MFA | Segurança | Engenharia | Início da Fase 0 | Não bloqueia negócio; ver ADR-002 | **Resolvido nesta execução — ver ADR-002** |
| D10 | Fornecedor de IA | Camada de IA | Engenharia + Compliance | Fase 7 | Nada no MVP | **Fora de escopo do Sprint 1** |

**Nenhuma destas decisões de negócio (D1–D7) foi inventada, adivinhada ou resolvida por conveniência
técnica nesta execução**, em conformidade com a regra explícita da v1.3 ("não invente prazo jurídico",
"não invente source of truth", "decisões críticas de negócio não podem ser inventadas").

---

## 2. ADRs de Engenharia — Fase 0 (Sprint 1)

Decisões técnicas locais e reversíveis, permitidas pela v1.3 (§27, linhas D8/D9: "Não bloqueia decisão
de negócio; deve estar definido antes da implementação estrutural/de autenticação").

### ADR-001 — Manter a stack existente (Node.js nativo + `data/store.json`) como base da Fase 0, com PostgreSQL como caminho de migração já preparado

**Contexto.** O repositório já possui uma implementação funcional em Node.js 20+ (`http` nativo, sem
framework), persistência local em `data/store.json`, RBAC, auditoria, MFA de homologação e integração
Monday server-side. Existem migrations SQL (`migrations/001_foundation.sql`,
`migrations/002_projects_recovery.sql`) e cliente `pg` já presentes, mas desconectados do runtime das
APIs (confirmado em `docs/handoff-codex/16-PENDENCIAS-E-DEBITO-TECNICO.md`).

**Decisão.** Não reescrever a aplicação nem trocar de stack nesta execução. Reaproveitar o núcleo
existente como Fase 0/Fundação, tratando `data/store.json` como persistência interina de homologação —
já documentada como tal — e mantendo o caminho de migração para PostgreSQL como próximo passo técnico,
não como bloqueio do Sprint 1.

**Justificativa.** O Handoff Master v1.3 é explícito: "não quero redesenhar a Patrono", "preserve o que
funciona quando compatível", "decisões técnicas locais e reversíveis seguem boas práticas sem parar o
desenvolvimento". Reescrever a stack neste momento violaria a ordem de trabalho pedida (auditar →
alinhar → fundação → Sprint 1) e o critério de sucesso declarado.

**Consequência.** `data/store.json` continua sem controle de concorrência/transação real — risco já
registrado como P0 técnico em `docs/handoff-codex/16-PENDENCIAS-E-DEBITO-TECNICO.md` e mantido como
pendência de infraestrutura (ver `docs/SECURITY.md`), não como bloqueio de negócio. A migração para
PostgreSQL permanece o próximo passo técnico recomendado antes de dados reais em produção/escala.

**Reversível.** Sim — a camada de acesso a dados (`readStore`/`writeStore`) já é isolada em funções
próprias, o que facilita a substituição futura por um repositório transacional sem reescrever as rotas.

---

### ADR-002 — Manter autenticação própria (login + senha de ambiente + MFA por desafio) como base da Fase 0, corrigida para exigir MFA por papel

**Contexto.** A aplicação já implementa login por e-mail/senha comparada a uma variável de ambiente
(`COEVO_DEMO_PASSWORD`), desafio de MFA (`COEVO_MFA_CODE`) e sessões em memória com TTL configurável.
Um provedor de identidade corporativo (IdP/SSO) ainda não foi contratado nem definido pelo negócio.

**Decisão.** Manter o mecanismo de autenticação próprio como base da Fase 0, com as correções de
segurança já aplicadas nesta execução (ver `docs/SECURITY.md` e "P0 corrigidos" no relatório final):
MFA obrigatório por papel privilegiado (não pela flag do cadastro) e nenhuma dependência de bypass por
prefixo de usuário. Não substituir por um IdP externo nesta execução — ausência de decisão de negócio
sobre o provedor não bloqueia a Fase 0 (§27, linha D9), mas a integração com IdP corporativo (Google
Workspace/Azure AD/Okta) é o próximo passo recomendado antes de produção com usuários externos ao núcleo
atual.

**Justificativa.** Autenticação já funcional e testada; trocar de provedor agora pausaria o Sprint 1
para uma decisão de fornecedor que a v1.3 explicitamente não exige antes da Fase 0 (D9 "não bloqueia
decisão de negócio; deve estar definido antes da implementação de autenticação" — a implementação já
existe e será adaptada, não recriada do zero).

**Consequência.** Senha ainda é global (compartilhada por todos os usuários), não individual —
pendência E de `docs/SEGURANCA-CORRECOES.md`, registrada como P1 em `docs/SECURITY.md`. MFA agora é
obrigatório por papel (corrigido nesta execução), mas o código de segundo fator continua global
(`COEVO_MFA_CODE`), não por usuário/dispositivo.

**Reversível.** Sim — a troca por um IdP externo exigiria adaptar `getUser()`/`sessions` para validar
tokens de um provedor OIDC, sem alterar o modelo de RBAC (`ROLES`/`allowed()`), que é independente do
mecanismo de autenticação.

---

### ADR-003 — Modelar Legal Deadline como coleção própria via motor genérico de entidades (`/api/entities/legalDeadlines`), sem pipeline automático de origem

**Contexto.** MASTER_HANDOFF §6 exige que `Legal Deadline` seja "objeto de domínio com identidade
própria", nunca um campo de data do processo, mas também proíbe explicitamente qualquer motor de cálculo
automático de prazo no MVP, e a fonte/origem por tipo de processo/board está em Decision Backlog (D1),
bloqueada até antes do Sprint 2.

**Decisão.** Adicionar `legalDeadlines` ao motor genérico de entidades já existente
(`/api/entities/:type`, com versionamento, exclusão lógica, restauração e auditoria automáticos),
mapeado ao módulo RBAC `juridico`. A criação exige `processId`, `origin` e `date` (bloqueio obrigatório
por regra do QA §30, caso 8: "Prazo sem origem identificada bloqueado para homologação"). Nenhum job de
sincronização preenche esta coleção automaticamente a partir do Monday nesta execução — isso exigiria
antecipar a decisão D1, o que a v1.3 proíbe explicitamente.

**Justificativa.** Esqueleto suficiente para a Fase 0/Sprint 1 ("preparar arquitetura/modelagem... não
invente a fonte definitiva" — instrução do usuário; MASTER_HANDOFF §24, "Sprint 1: esqueleto das
entidades do piloto"). Reaproveita o motor de CRUD/versionamento/auditoria já existente em vez de criar
um subsistema novo, reduzindo superfície e risco.

**Consequência.** Sem D1 resolvida, Legal Deadline não é populado automaticamente a partir de nenhum
board Monday — cadastro manual por usuário autorizado é o único caminho disponível na Fase 0, como a
própria v1.3 permite ("a data deve vir de fonte validada ou ser registrada por usuário autorizado,
sempre com origem identificada").

**Reversível.** Sim — quando D1 for decidida, um job de sincronização por board pode ser adicionado sem
alterar o esquema da entidade.

---

## 3. Conflitos entre código existente e MASTER_HANDOFF v1.3

| Conflito | Onde | Resolução aplicada |
|---|---|---|
| Nome do produto no código/UI é "COEVO Alta Performance"; a v1.3 chama a plataforma de "Patrono Alta Performance" | `package.json`, `README.md`, `public/index.html`, textos da UI | **Não renomeado nesta execução.** Renomear a marca/nome de produto na UI é uma mudança perceptível ao usuário final e não crítica para a fundação técnica; registrado aqui em vez de decidido silenciosamente. Recomendação: tratar como item de UX/produto a confirmar com a gestora antes de expor a marca "Patrono" ao usuário final. |
| `docs/handoff-codex/01-RESUMO-EXECUTIVO.md` afirma que "Patrono Alta Performance" é "nomenclatura legada" | `docs/handoff-codex/01-RESUMO-EXECUTIVO.md` | Essa afirmação é de uma auditoria anterior (09/08/2026), **anterior** ao Handoff Master v1.3 (12/09/2026), que agora é a fonte de autoridade e usa "Patrono" como nome oficial do produto. `docs/handoff-codex/` é mantido como fotografia histórica do repositório, não como fonte de verdade sobre nomenclatura atual — a v1.3 prevalece. |
| `ROLES` não inclui papel `administrador` no seed atual (apenas `diretoria`, `lider`, `colaborador`) | `server.js` (`seed.users`) | Nenhuma ação nesta execução — v1.3 não define usuários hardcoded ("nomes acima são referências organizacionais, nunca regras de autorização hardcoded"); o papel `administrador` já existe em `ROLES` e é suportado pelo motor de permissões, apenas não há usuário seed com esse papel. Não é conflito de regra, é dado de cadastro — fora do escopo de decisão técnica. |
| `docs/handoff-codex/` descreve módulos e nomes de tela distintos da navegação final da v1.3 (§5) | `docs/handoff-codex/06-TELAS-E-MODULOS.md` | Não resolvido nesta execução — a navegação final da v1.3 é **target-state** (§5, §93), e a v1.3 é explícita que módulos não implementados não devem virar telas vazias. A reestruturação de navegação para bater com §5 fica registrada como próximo passo, não implementada no Sprint 1 (que não pede reestruturação de navegação, apenas fundação). |

---

## 4. Registro de decisões futuras

Qualquer nova dúvida sobre conflito entre código e MASTER_HANDOFF v1.3, ou nova decisão técnica
reversível, deve ser adicionada como uma nova entrada nas seções acima — nunca resolvida silenciosamente
dentro do código.
