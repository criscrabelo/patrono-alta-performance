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
| D1 | Fonte/origem do Legal Deadline por tipo de processo/board no piloto | Prazo jurídico e Agenda | Negócio + Jurídico + TI | Antes do Sprint 2 | Piloto jurídico / Legal Deadline | **HOMOLOGADA — 12/09/2026 — ver seção 1.1** |
| D2 | Fonte oficial de CPF/CNPJ | Matching, dedup, snapshot | Negócio | Antes de matching/dedup definitivo | Cadastro Mestre, views 360, snapshots | **Pendente** |
| D3 | Data owner por domínio | Nenhum campo crítico tem responsável definido | Negócio | Fase 1 | Governança de dados | **Pendente** |
| D4 | Fonte oficial do contato do cliente | Divergência CV × Sienge | Negócio | Fase 2 | Resolução de divergências | **Pendente** |
| D5 | Plano de saída de cada board Monday | Fonte transitória virando permanente | Negócio + TI | Fase 6 | Desativação de fonte | **Pendente** |
| D6 | Módulos e endpoints do Sienge disponíveis | Escopo financeiro | TI | Antes da Fase 6 | Governança Financeira | **Pendente** |
| D7 | Expectativa de freshness por fonte | Define "atrasado" | Negócio + TI | Fase 6 | Observabilidade | **Pendente** |
| D8 | Stack, hospedagem, banco | Base técnica | Engenharia | Início da Fase 0 | Não bloqueia negócio; ver ADR-001 | **Resolvido nesta execução — ver ADR-001** |
| D9 | Provedor de autenticação e MFA | Segurança | Engenharia | Início da Fase 0 | Não bloqueia negócio; ver ADR-002 | **Resolvido nesta execução — ver ADR-002** |
| D10 | Fornecedor de IA | Camada de IA | Engenharia + Compliance | Fase 7 | Nada no MVP | **Fora de escopo do Sprint 1** |

**A D1 foi formalmente homologada pela Cristiane em 12/09/2026, conforme seção 1.1** — a única decisão
deste backlog resolvida até aqui, e resolvida pelo rito devido (levantamento técnico, análise de
alternativas, aprovação explícita da gestora/Jurídico), nunca por conveniência técnica. **As decisões
D2–D7 permanecem pendentes** e não podem ser resolvidas, presumidas ou implementadas por conveniência
técnica, em conformidade com a regra explícita da v1.3 ("não invente prazo jurídico", "não invente
source of truth", "decisões críticas de negócio não podem ser inventadas").

---

## 1.1. D1 — Decisão Homologada: Fonte/Origem do Legal Deadline

> **Status:** HOMOLOGADA / DECIDIDA
> **Data:** 12/09/2026
> **Aprovadora:** Cristiane Carneiro Rabelo (Gestora + Jurídico)
> **Responsáveis pela análise técnica:** Negócio + Jurídico + TI (conforme MASTER_HANDOFF §27)
> **Base da decisão:** levantamento técnico prévio (boards Monday configurados, `server.js`,
> `docs/DATA_MODEL.md`, `docs/INTEGRATIONS.md`, `docs/PERMISSIONS.md`), revisado e aprovado pela
> Cristiane antes deste registro.

### Decisão

No MVP/piloto jurídico, **nenhum Legal Deadline é criado ou confirmado automaticamente a partir do
Monday.** Todo Legal Deadline nasce de **registro humano autorizado**, realizado pelo Jurídico
diretamente na Patrono. O Monday continua sendo o System of Record operacional/transitório do Legal
Process (MASTER_HANDOFF §9), podendo fornecer contexto, referência e, futuramente, sugestões — mas
nunca cria, nunca confirma e nunca vira prazo jurídico oficial pela simples existência de uma coluna de
data. Isso vale para **qualquer** coluna de data do Monday, incluindo nominalmente `DATA` e
`CITAÇÃO/PROTOCOLO` do board `processos` — nenhuma delas é, por si só, evidência suficiente de prazo
processual.

### D1.1 — Origem do Legal Deadline: OPÇÃO A (aprovada)

Nenhum Legal Deadline nasce automaticamente do Monday. Todo registro exige ato humano autorizado do
Jurídico na Patrono, com `origin` preenchido por quem registra.

- **Alternativas rejeitadas:**
  - Opção B (uma coluna específica do Monday validada como origem confiável, sugerindo o prazo
    pendente de validação humana) — rejeitada para o MVP por exigir identificação prévia, pelo
    Jurídico, de qual coluna realmente representa um ato processual (não confirmado no levantamento).
  - Opção C (outra fonte jurídica homologada, ex.: push de tribunal) — rejeitada por não existir hoje
    nenhuma fonte desse tipo integrada ou disponível.
- **Consequência:** o Sprint 2 entrega Legal Deadline como registro manual, sem nenhuma sugestão
  automática a partir do Monday. Reavaliação futura da Opção B exige nova análise + homologação
  jurídica específica (não é assumida como próximo passo automático).

### D1.2 — Escopo dos boards no piloto: OPÇÃO A (aprovada)

Somente o board `processos` participa do fluxo de Legal Deadline no piloto do Sprint 2. Os boards
`notificacoes`, `distratos`, `unidades`, `compraVenda`, `transferenciaIntermediaria`, `honorarios` e o
módulo derivado `honorariosJudiciais` **não geram Legal Deadline** — permanecem como referência,
visualização, registro operacional ou financeiro, exatamente como hoje.

- **Consequência:** qualquer expansão futura de Legal Deadline para outro board exige, nesta ordem: (1)
  decisão de negócio, (2) identificação da coluna, (3) definição da origem, (4) definição da evidência,
  (5) homologação jurídica, (6) alteração formal desta D1 ou nova ADR. Nenhuma expansão é automática.

### D1.3 — `originType` obrigatório no Sprint 2: OPÇÃO A (aprovada)

Legal Deadline passa a exigir um campo `originType`, com um conjunto fechado de valores, para nunca
confundir prazo jurídico/processual com prazo interno de controle. Valores mínimos aprovados:

- `JUDICIAL_PROCESSUAL` — prazo relacionado a fato jurídico formal registrado pelo Jurídico (categoria A
  do levantamento: intimação, publicação, despacho, decisão, audiência, mandado, ciência formal).
- `INTERNAL_CONTROL` — prazo gerencial criado pelo próprio Jurídico para acompanhamento interno
  (categoria D do levantamento).

Nenhuma categoria jurídica adicional (administrativa, contratual) foi aprovada nesta rodada — o
levantamento não encontrou evidência de negócio suficiente para essas categorias em nenhum board hoje
configurado (ver D1.2). Caso o Jurídico identifique a necessidade dessas categorias no futuro, isso
exige nova decisão, não uma extensão silenciosa deste enum.

- **Consequência para views:** os dois tipos não podem receber a mesma semântica visual nem ser
  confundidos em nenhuma tela; devem ser filtráveis separadamente. Detalhamento técnico na seção "Plano
  do Sprint 2", abaixo, e em `docs/DATA_MODEL.md`.

### D1.4 — Evidência no MVP: OPÇÃO A, com qualificação (aprovada)

`evidenceReference` **não é** requisito técnico obrigatório para registrar ou confirmar um Legal
Deadline no MVP. Um prazo é considerado **"Confirmado pelo Jurídico"** quando: registrado por usuário
autorizado; vinculado a um Legal Process válido; com `date` válida; com `origin` obrigatório; com
`originType` válido (Sprint 2); dentro do escopo de autorização do usuário.

- **Regra de linguagem obrigatória (P0 de UX/copy para o Sprint 2):** na ausência de
  `evidenceReference`, nenhuma tela, rótulo ou mensagem do sistema pode sugerir "comprovação
  documental validada", "evidência documental conferida" ou "confirmação automática da fonte externa".
  A única semântica permitida é **"Confirmado pelo Jurídico"** — que descreve autoria/autorização do
  registro, nunca validação documental que não existe.
- **Evolução futura (não é requisito para iniciar o Sprint 2):** `evidenceReference` ligado a
  Document/File Reference (gap já registrado em `docs/DATA_MODEL.md`), quando essa entidade existir.

### Regra oficial do MVP (consolidada)

1. Monday não cria Legal Deadline. 2. Monday não confirma Legal Deadline. 3. Google Calendar não é fonte
de Legal Deadline (MASTER_HANDOFF §10/§23). 4. Legal Deadline nasce por registro humano autorizado. 5.
`processId` é obrigatório. 6. `date` é obrigatória. 7. `origin` é obrigatória. 8. `originType` será
obrigatório no Sprint 2. 9. Um Legal Process pode possuir N Legal Deadlines. 10. Novo fato gerador
(nova intimação/publicação/decisão/despacho/audiência/ato jurídico relevante) gera **novo** Legal
Deadline. 11. Alteração do mesmo fato gerador (correção de data, suspensão, cancelamento, reabertura)
preserva o **mesmo** registro e grava a alteração em histórico/auditoria. 12. Prazo suspenso não pode
aparecer como atraso normal. 13. Prazo cancelado não pode continuar sendo tratado como ativo. 14. Prazo
cumprido preserva histórico. 15. Reabertura preserva o ciclo anterior (ver "Status do Legal Deadline",
abaixo). 16. Nenhuma alteração apaga silenciosamente o valor anterior. 17. A Patrono MVP não calcula
prazo processual automaticamente. 18. Nenhuma engine de cálculo jurídico será criada no Sprint 2.

### Status do Legal Deadline — APROVADO para o Sprint 2

> **Status:** APROVADA / HOMOLOGADA PARA O SPRINT 2
> **Data:** 12/09/2026
> **Aprovadora:** Cristiane Carneiro Rabelo
> **Complemento da D1**, vinculado à modelagem de Legal Deadline do Sprint 2 — não é uma nova decisão
> arquitetural, segue o mesmo rito de homologação já registrado acima.

**Enum aprovado (fechado, nenhum outro valor no Sprint 2):** `ativo`, `suspenso`, `cumprido`,
`cancelado`. Nenhum status adicional foi aprovado nesta rodada.

**Regra de reabertura aprovada:** reabertura **não é** um quinto status. Quando um Legal Deadline
anteriormente `suspenso`, `cancelado` ou encerrado juridicamente for formalmente reaberto, conforme
regra de negócio aplicável:
- mantém o **mesmo `id`**;
- o `status` retorna para `ativo`;
- todo o estado anterior é preservado no histórico/auditoria (nunca apagado);
- a alteração registra motivo, responsável, data/hora e `before`/`after`, pelo mesmo mecanismo de
  auditoria já existente no motor genérico de entidades.
- A informação de que houve reabertura é recuperável pelo histórico de auditoria — não existe, nem
  pode ser criado, um valor de status `reaberto` persistido em nenhuma API.

**Regra de atraso aprovada — "vencido"/"atrasado"/"em atraso" NÃO é status:** é uma condição **derivada
de view**, nunca um valor persistido no campo `status`. Um Legal Deadline só pode ser exibido como
vencido/em atraso quando, simultaneamente: `status = ativo` **e** `date` é anterior à data atual. Como
consequência direta: `suspenso` nunca aparece como atraso normal; `cumprido` nunca aparece como atraso
ativo; `cancelado` nunca aparece como atraso ativo — independentemente do valor de `date` armazenado.
Isso evita divergência entre o `status` gravado e a data atual sendo interpretada de forma paralela e
inconsistente por cada view.

**Nada disto foi implementado nesta rodada.** Aplica-se apenas como especificação aprovada para a Fase 1
do Sprint 2 (`docs/SPRINT2-PLANO.md`) e para o modelo de dados (`docs/DATA_MODEL.md`).

### Novo fato gerador × alteração do mesmo prazo

- **Novo fato gerador** (nova intimação, nova publicação, nova decisão, novo despacho, nova audiência,
  novo ato jurídico relevante) → cria **novo** Legal Deadline (novo `id`, mesmo `processId`).
- **Alteração do mesmo fato gerador** (correção de data, suspensão, cancelamento, reabertura, mudança
  formal daquele mesmo prazo) → mantém o **mesmo** Legal Deadline (mesmo `id`) e registra a alteração
  via o mecanismo de auditoria já existente (`before`/`after`, nunca sobrescrita silenciosa).
- A distinção entre os dois casos, para um fato concreto, é uma decisão jurídica de quem registra —
  não uma regra que o sistema infere automaticamente.

### Responsabilidade

A definição jurídica da origem e natureza de um prazo (o que conta como fato gerador, o que distingue
prazo processual de prazo interno) pertence ao Jurídico. TI implementa, integra e futuramente automatiza
as regras homologadas — TI não decide sozinho se uma data representa prazo jurídico. Registro de Legal
Deadline continua sujeito integralmente ao RBAC e ao escopo já vigentes na v1.3 (nenhuma regra de
autorização é enfraquecida por esta decisão).

### Risco identificado e ação obrigatória para o Sprint 2

O levantamento técnico prévio identificou que `dashboard-service.js` (widgets `legal-deadlines` e
`legal-risk`/"Prazos críticos" do dashboard `legal`) calcula prazo diretamente de uma coluna bruta do
Monday (`processDate()`, que lê `CITAÇÃO/PROTOCOLO`/`DATA` do board `processos`), não da coleção
`legalDeadlines`. Isso viola a mesma regra que esta decisão formaliza — data bruta do Monday não é prazo
jurídico. **Corrigir isso é tarefa obrigatória do Sprint 2** (não implementada agora — ver "Plano do
Sprint 2"), com regra explícita: nenhuma view pode calcular ou apresentar "prazo jurídico" com lógica
própria paralela; `legalDeadlines` é a única fonte canônica.

### Impacto no Sprint 2

Habilita o início do Sprint 2 (MASTER_HANDOFF §24) estritamente no escopo já previsto: Legal Process +
Legal Deadline com listagem/filtros/detalhe/histórico, responsável, prazo com origem, leitura do Monday,
slice mínimo de Agenda/Atenção. Não introduz cálculo automático de prazo, engine jurídica, IA,
automações, nem escrita externa. Plano técnico detalhado em `docs/SPRINT2-PLANO.md` — **preparado, mas
o Sprint 2 não foi iniciado**; implementação de qualquer fase exige nova autorização explícita.

**Reversível.** Sim, mediante nova decisão de negócio homologada pela Cristiane/Jurídico — qualquer
mudança de origem, escopo de boards, ou dispensa da exigência de `originType` exige o mesmo rito de
homologação formal usado aqui, não uma alteração silenciosa de código.

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

**Atualização (rodada 2 de correções de segurança).** A revisão de código pediu integridade relacional:
o `processId` de um Legal Deadline precisa corresponder a um processo existente e dentro do escopo do
usuário. Isso levantou uma ambiguidade que precisava ser resolvida sem inventar uma terceira entidade —
ver ADR-004 abaixo.

---

### ADR-004 — Legal Deadline valida `processId` contra a coleção `processos`, não contra `legalProcesses`

**Contexto.** `ENTITY_MODULE_MAP` (adicionado no Sprint 1) reserva duas chaves que soam como "o
processo do piloto": `processos` (a coleção real, sincronizada do Monday, usada em toda a aplicação —
inclusive já referenciada por `project-service.js` para internalizações) e `legalProcesses` (reservada
para quando Legal Process tiver um ID Patrono canônico próprio, independente do Monday — gap documentado
em `docs/DATA_MODEL.md`). Nenhuma das duas é uma terceira entidade nova; a pergunta era qual delas usar
para validar a relação de um Legal Deadline com seu processo.

**Decisão.** `POST /api/entities/legalDeadlines` valida `input.processId` contra
`collection(store, 'processos')` — a coleção que de fato representa o Legal Process do piloto hoje,
population e usada pelo restante da aplicação. `legalProcesses` permanece reservada e **não é usada**
nesta validação, nem em nenhum outro código nesta execução.

**Justificativa.** `processos` é a única coleção que realmente contém dados de Legal Process no piloto
atual (via sincronização Monday) e já é o padrão usado em outro lugar do código
(`project-service.js`/rotas de projeto: `collection(store,'processos').some(item=>item.id===input.processId)`
para internalizações). Validar contra `legalProcesses` — hoje sempre vazia — rejeitaria **todo**
`processId` real, quebrando o próprio propósito da validação. Criar uma terceira entidade só para essa
validação seria exatamente o que a instrução desta rodada pediu para evitar.

**Consequência.** Quando o Legal Process ganhar um ID Patrono canônico independente do Monday (gap já
registrado em `docs/DATA_MODEL.md`), esta validação precisará ser revisada para apontar para essa nova
entidade — ou para ambas, durante uma transição. Fica registrado aqui para não ser esquecido.

**Reversível.** Sim — é uma única linha de `collection(store, 'processos')` no handler de criação.

---

### ADR-005 — Registros sincronizados do Monday recebem `department:'Jurídico'` explicitamente

**Contexto.** A correção de `scoped()` (rodada 2, ver `docs/SECURITY.md`/`docs/PERMISSIONS.md`) passou a
negar por padrão qualquer registro sem `department` — antes, ausência de `department` liberava o
registro para qualquer usuário autenticado, o que é o oposto do que a v1.3 pede. Isso teria, como efeito
colateral, bloqueado o próprio Jurídico de ver seus registros sincronizados do Monday, já que
`normalizeMondayItem()` nunca atribuía `department`.

**Decisão.** `normalizeMondayItem()` passa a atribuir `department: 'Jurídico'` a todo registro que
sincroniza, porque **todos** os boards em `MONDAY_BOARDS` pertencem ao Jurídico (processos,
notificações, distratos, honorários, unidades, compra e venda, transferência intermediária — não há
nenhum board de outro departamento nesta configuração).

**Justificativa.** É uma classificação verdadeira, não inventada — os próprios nomes e o propósito de
cada board em `MONDAY_BOARDS` já eram exclusivamente jurídicos antes desta execução; o código apenas
não declarava isso explicitamente no registro. Não há ambiguidade a resolver aqui.

**Consequência (desejada e testada).** Um usuário de TI (que também tem o módulo `juridico` liberado por
papel, ver `docs/PERMISSIONS.md`) deixa de conseguir ler/listar registros Jurídicos por meio de
`/api/entities/:type` ou `/api/legal/:module` — o que estava indevidamente liberado antes desta correção,
e é exatamente o cenário "TI tenta acessar Jurídico → bloqueado no backend" do Catálogo Global de
Regressão (§30).

**Reversível.** Sim — se um board de outro departamento for adicionado a `MONDAY_BOARDS` no futuro,
`normalizeMondayItem()` precisará receber o departamento correto por parâmetro em vez do valor fixo.

---

### ADR-006 — Isolamento de dados de teste via `COEVO_DATA_DIR` (variável de ambiente, opcional)

**Contexto.** A revisão de segurança pediu testes de integração HTTP reais, exercitando o `handler` real
contra um servidor real. `DATA_DIR`/`DB_FILE` eram caminhos fixos dentro do repositório
(`path.join(ROOT,'data')`) — testes que chamassem `handler` diretamente escreveriam na store real do
projeto (ainda que gitignored), o que é inaceitável para uma suíte de testes automatizada e repetível
em CI.

**Decisão.** `DATA_DIR` passa a respeitar `process.env.COEVO_DATA_DIR` quando definida, mantendo o
caminho padrão (`ROOT/data`) quando ausente. Somente `tests/security-integration.test.js` define essa
variável, apontando para um diretório temporário criado e removido pelo próprio teste
(`fs.mkdtempSync`/`fs.rmSync`).

**Justificativa.** Menor mudança possível para tornar os testes de integração seguros e repetíveis, sem
introduzir um framework de teste novo ou reestruturar `server.js`. Não afeta o comportamento em
produção/homologação, onde a variável nunca é definida.

**Reversível.** Sim — é uma única linha condicional; remover a variável de ambiente restaura o
comportamento anterior exatamente.

---

### ADR-007 — `/api/compliance` restrito a alçada global (`allowed(user,'*',...)`) até existir módulo/dono de negócio próprio

**Contexto.** A revisão de segurança (rodada 3) encontrou `GET`/`POST /api/compliance` sem NENHUMA
verificação de permissão — qualquer usuário autenticado lia e criava entradas de compliance. Não existe
um módulo `compliance` em `ROLES`, nem um dono de negócio definido para essa central de governança
(MASTER_HANDOFF trata compliance como parte da "Governança transversal", §3, ainda não implementada como
módulo próprio no MVP).

**Decisão.** Restringir `/api/compliance` (GET e POST) a `allowed(user,'*',...)` — hoje, apenas
`diretoria`/`administrador` — no mesmo padrão já usado para `/api/audit` e `/api/auth/requests`, em vez
de inventar um módulo de negócio (`ROLES.*.modules` incluindo `'compliance'`) sem que essa decisão de
escopo tenha sido pedida ou definida pelo negócio.

**Justificativa.** Deny-by-default: na ausência de uma decisão de negócio sobre quem deve acessar
compliance, a opção mais segura é restringir a quem já tem alçada plena, não inventar uma política
intermediária. Reaproveita um padrão de autorização já existente no código (`allowed(user,'*',...)`),
em vez de criar um mecanismo novo.

**Consequência.** Nenhum papel departamental (lider/colaborador) acessa `/api/compliance` até que uma
decisão de negócio defina o módulo/escopo correto — o que pode ser mais restritivo do que o desenho
final pretendido pela v1.3 quando o domínio de Compliance for implementado como módulo. Registrado aqui
para revisão quando essa decisão de negócio existir.

**Reversível.** Sim — trocar `allowed(user,'*',...)` por `allowed(user,'compliance',...)` e adicionar o
módulo a `ROLES` é a única mudança necessária.

**Atualizado pela ADR-013 (rodada 7).** A revisão final apontou que `allowed(user,'*',...)` inclui
`administrador` (que tem `modules:['*']`/`actions:['*']`), tornando o papel técnico uma autoridade de
CONTEÚDO de Compliance por um atalho indireto — exatamente o que o MASTER_HANDOFF §11 proíbe. ADR-013
substitui o mecanismo de autorização por `hasGlobalScope(user)` (deny-by-default: só `diretoria` hoje),
mantendo esta decisão (deny-by-default até uma decisão de negócio existir) como política provisória —
ADR-007 continua **pendente** quanto ao módulo/dono definitivo de Compliance; nada aqui a resolve.

---

### ADR-008 — Bloquear o motor genérico de entidades para tipos cuja fonte oficial é o Monday, reaproveitando `LEGAL_MODULES`

**Contexto.** A revisão de segurança (rodada 3, item 4) apontou que `POST`/`PATCH`/`DELETE`/`restore`
em `/api/entities/:type` permitiam criar, alterar, arquivar ou restaurar registros de tipos como
`processos`, `notificacoes`, `distratos` etc. — cuja fonte oficial durante o MVP é o Monday (§9 da
v1.3: "Monday é System of Record operacional/transitório para os boards integrados"). Isso permitiria
fabricar um "processo" local falso e depois relacioná-lo a um Legal Deadline, contornando a fonte
oficial.

**Decisão.** `rejectIfMondaySourced(type)` bloqueia POST/PATCH/DELETE/restore genéricos para qualquer
tipo presente em `LEGAL_MODULES` — o mesmo `Set` já usado como allowlist de `/api/legal/:module` (rodada
2), que por definição já é exatamente "os boards cuja fonte é o Monday". Apenas GET (leitura) permanece
liberado para esses tipos via o motor genérico. Nenhuma modelagem de "overlay" (campos próprios da
Patrono sobre o snapshot da fonte) foi criada nesta rodada — não há hoje nenhum caso de uso que exija
guardar dado próprio sobre um registro Monday-sourced fora do que a sincronização já grava.

**Justificativa.** Reaproveita uma estrutura de dados já correta (`LEGAL_MODULES`) em vez de duplicar a
lista de tipos Monday-sourced em um novo `Set`, reduzindo o risco de as duas listas divergirem no
futuro. Bloquear por completo (em vez de permitir PATCH parcial em "campos não protegidos") é a opção
mais simples e segura dado que, hoje, não existe nenhum campo desses tipos que a Patrono precise editar
independentemente do Monday.

**Consequência.** Se um caso de uso futuro exigir que a Patrono grave um campo próprio sobre um
registro Monday-sourced (por exemplo, uma observação interna sobre um processo), será necessário
desenhar um modelo de overlay (registro próprio relacionado por `externalId`/`id`, nunca sobrescrevendo
o snapshot da fonte) — não implementado nesta rodada, pois nenhum caso de uso concreto o exige ainda.

**Reversível.** Sim — é uma checagem isolada (`rejectIfMondaySourced`) nas quatro rotas; removê-la
restaura o comportamento anterior.

---

### ADR-009 — `requiresGlobalScope` como declaração explícita de autorização em dashboards corporativos sensíveis

**Contexto.** A revisão de segurança (rodada 4, item 1) apontou que o dashboard `executive` (Visão
Executiva/Centro de Comando) usava `module:'central'` como único controle de acesso — mas `central` é
módulo comum a `lider` e `colaborador`, não exclusivo de alçada executiva/global. Um papel departamental
alcançava dados consolidados de todos os departamentos (orçamento, agenda, decisões de comitê).

**Decisão.** Adicionar um campo de declaração explícita, `requiresGlobalScope: true`, à definição do
dashboard `executive` em `dashboard-model.js`. `server.js` verifica esse campo (via `hasGlobalScope(user)`)
tanto na listagem (`GET /api/dashboards`, através de `visibleDashboards()`) quanto no detalhe
(`GET /api/dashboards/:id`), além do gate de módulo já existente. Não foi criado um novo módulo em
`ROLES`, nem alterado o comportamento dos demais dashboards corporativos (`budget`, `strategy`,
`projects`, `risks`), que já são adequadamente restritos pelos próprios módulos (`orcamento`/
`estrategia`/`projetos`/`central`) — a revisão apontou apenas o `executive` como P0 concreto.

**Justificativa.** Um campo de declaração explícita, versionado junto da definição do dashboard, é mais
robusto do que uma lista externa de exceções (que poderia ser esquecida ao criar um dashboard novo) —
qualquer dashboard `scope:'corporate'` que precise de alçada global no futuro declara isso no próprio
objeto, tornando o requisito visível no mesmo lugar onde o dashboard é definido.

**Consequência.** Dashboards corporativos futuros que não declararem `requiresGlobalScope` continuam
dependendo apenas do gate de módulo — cabe a quem adicionar um novo dashboard sensível avaliar se precisa
dessa flag. Isso não é deny-by-default automático para todo `scope:'corporate'` futuro; é uma
convenção que exige atenção humana ao adicionar um dashboard novo, documentada em `docs/PERMISSIONS.md`.

**Reversível.** Sim — remover a flag e as duas checagens em `server.js` restaura o comportamento
anterior (módulo como único controle).

**Superado em parte pela ADR-010 (rodada 5).** A rodada 5 substituiu a declaração manual
`requiresGlobalScope` por uma regra automática (`dashboardRequiresGlobalScope()`) para qualquer
dashboard `scope:'corporate'` — a suposição acima, de que só `executive` precisava da flag, revelou-se
incorreta na revisão seguinte (`budget`/`strategy`/`projects`/`risks` também são `scope:'corporate'` e
ficavam sem a proteção). Este ADR permanece como registro histórico da decisão original; ADR-010 é a
decisão vigente.

### ADR-010 — Dashboards `scope:'corporate'` exigem alçada global automaticamente, com exceção só por flag explícita

**Contexto.** A rodada 5 apontou que a convenção da ADR-009 ("quem adicionar um dashboard corporativo
sensível declara `requiresGlobalScope`") não é deny-by-default: `budget`, `strategy`, `projects` e
`risks` já eram `scope:'corporate'` e não tinham a flag, ficando acessíveis a qualquer papel com o
módulo correspondente (ex.: `lider`, que tem o módulo `orcamento`).

**Decisão.** `dashboardRequiresGlobalScope(definition)` (`dashboard-model.js`) torna a exigência
automática: `definition.scope === 'corporate' && definition.allowDepartmentScope !== true`. A flag
manual `requiresGlobalScope` foi removida de `executive` (agora coberto pela regra automática, como os
demais dashboards corporativos). A única forma de um dashboard `scope:'corporate'` **não** exigir
alçada global é declarar `allowDepartmentScope:true` explicitamente — nenhum dashboard atual declara
essa exceção.

**Justificativa.** Depender de que cada pessoa lembre de marcar manualmente cada dashboard corporativo
sensível (ADR-009) é frágil por construção — a própria rodada 5 é a prova de que a convenção falhou na
prática. Inverter o padrão (exigir global por padrão para `scope:'corporate'`, com exceção só por
declaração explícita) é deny-by-default e não depende de disciplina humana ao adicionar um dashboard
novo.

**Consequência.** Nenhum dashboard `scope:'corporate'` futuro fica implicitamente aberto a papel
departamental só porque alguém esqueceu de marcar uma flag — o padrão seguro é o default. Se um
dashboard corporativo realmente precisar ser departamental no futuro (caso hoje inexistente), a decisão
de negócio correspondente deve declarar `allowDepartmentScope:true` no próprio objeto, documentando a
exceção no mesmo lugar onde o dashboard é definido.

**Reversível.** Sim — remover `dashboardRequiresGlobalScope()` e voltar à checagem manual de
`requiresGlobalScope` restaura o comportamento da ADR-009.

### ADR-011 — `administrador` deixa de ter alçada de negócio global (`scopes:['*']` → `scopes:[]`)

**Contexto.** MASTER_HANDOFF §11 define explicitamente: "Administrador técnico ≠ superusuário de
conteúdo". Antes da rodada 5, `ROLES.administrador` tinha `scopes:['*']`, e `scoped()` bypassava
incondicionalmente para `user.role === 'administrador'` — o papel técnico (destinado a gerenciar
sistema, usuários, integrações, segurança e configuração) herdava, na prática, acesso irrestrito a
conteúdo de qualquer departamento/empresa/SPE, exatamente o que a v1.3 proíbe.

**Decisão.** `ROLES.administrador.scopes` passou de `['*']` para `[]`. `scoped()` passou a usar
`hasGlobalScope(user)` (que lê `ROLES[user.role].scopes.includes('*')`) como única fonte de verdade
para o bypass de escopo, substituindo a checagem direta de `user.role`. `administrador` mantém
`modules:['*']`/`actions:['*']` — legítimos para as funções técnicas já existentes (auditoria, aprovação
de cadastro, backup) e para operar integrações (Monday) de qualquer departamento via
`allowedInDepartment()`, sem que isso implique acesso ao **conteúdo** sincronizado. `diretoria` continua
sendo a única alçada de negócio verdadeiramente global (`scopes:['*']`).

**Justificativa.** A separação entre "gate de módulo/ação" (`allowed()`, que lê `.modules`/`.actions`) e
"gate de escopo de conteúdo" (`scoped()`/`hasGlobalScope()`, que lê `.scopes`) já existia
arquiteturalmente no código — a correção não exigiu reorganização, apenas alinhar o dado (`scopes` do
papel `administrador`) e o bypass de `scoped()` à semântica que a v1.3 já define. Optou-se por manter o
nome do papel `administrador` (em vez de renomeá-lo) porque `modules:['*']`/`actions:['*']` já
correspondem exatamente ao conceito de "administrador técnico" do MASTER_HANDOFF — o problema estava
apenas em `scopes`, não no nome.

**Consequência.** Qualquer rota que dependia implicitamente de `administrador` ter acesso a conteúdo
departamental (via `scoped()`) passou a negar para esse papel, a menos que o registro específico esteja
no escopo dele (o que hoje nunca ocorre, já que `administrador` não tem `department` de negócio). Isso é
o comportamento correto e esperado — nenhuma rota do sistema depende de `administrador` ler conteúdo
jurídico/financeiro para suas funções técnicas legítimas.

**Reversível.** Sim — restaurar `scopes:['*']` e a checagem direta de `user.role === 'administrador'` em
`scoped()` reverte ao comportamento anterior (não recomendado, pois reabre a violação do MASTER_HANDOFF
§11).

**Complementado pela ADR-012 (rodada 6).** Esta ADR fechou a leitura (`scoped()`). A rodada 6 apontou que
a mutação (criação de conteúdo via `POST`, onde não há registro prévio para `scoped()` filtrar)
continuava aberta — ADR-012 é o complemento necessário para fechar o ciclo completo (leitura + mutação).

### ADR-012 — `allowedContent()`: administrador técnico não recebe autorização de mutação em módulos de conteúdo de negócio

**Contexto.** A ADR-011 (rodada 5) corrigiu a leitura de conteúdo por `administrador`, retirando
`scopes:['*']`. Mas `modules:['*']`/`actions:['*']` permaneceram intactos — necessários para as rotas
técnicas gated por `allowed(user,'*',ação)` (módulo literal `'*'`: auditoria, aprovação de cadastro,
backup). O problema: como `policy.modules.includes('*')` também torna `allowed(user, qualquerModulo,
ação)` verdadeiro, o mesmo wildcard "abria" qualquer módulo de CONTEÚDO de negócio (agenda, comitês,
orçamento, projetos, jurídico, TI) para `administrador` criar/alterar/arquivar/restaurar/exportar — sem
nenhum `scoped()` para impedir, já que um `POST` não tem registro anterior. A rodada 6 (item 3) apontou
isso concretamente em `POST /api/agenda`, `POST /api/committees`, `POST /api/entities/documentReferences`
e sub-recursos de projeto.

**Decisão.** `BUSINESS_CONTENT_MODULES` (`server.js`) é o conjunto explícito e nomeado dos módulos
operacionais/departamentais de negócio: `central`, `estrategia`, `projetos`, `agenda`, `comites`,
`orcamento`, `juridico`, `ti` — distintos das rotas técnicas de sistema/integração, que continuam
gated por `allowed(user,'*',ação)` (módulo literal, não um nome de `BUSINESS_CONTENT_MODULES`).
`allowedContent(user, module, action)` combina `allowedInDepartment()` (isolamento departamental, ADR
implícita na rodada 5/ADR desta mesma seção) com a negação explícita de `administrador` para qualquer
ação em um módulo de `BUSINESS_CONTENT_MODULES` — aplicada em toda rota de **mutação** de conteúdo
(todos os verbos exceto leitura, que `scoped()` já filtra corretamente desde a ADR-011).

**Justificativa.** Rejeitada a alternativa de reorganizar `ROLES.administrador.modules`/`.actions` para
deixarem de ser wildcards (ex.: enumerar explicitamente uma lista de módulos/ações técnicas) — isso
quebraria todo callsite que hoje verifica `allowed(user,'*',ação)` esperando o wildcard literal, exigindo
uma revisão maior do que o escopo desta rodada de fechamento pede ("não invente arquitetura grande").
Uma função de gate adicional, aplicada apenas nos callsites de mutação de conteúdo, é uma mudança mínima
e localizada que preserva 100% do comportamento técnico existente de `administrador` (nenhuma rota técnica
foi tocada) e fecha exatamente a lacuna apontada, sem reescrever o modelo de papéis.

**Consequência.** `administrador` perde a capacidade de criar/alterar/arquivar/restaurar/exportar
conteúdo de negócio em qualquer rota que use `BUSINESS_CONTENT_MODULES` — inclusive rotas onde isso
nunca havia sido testado antes (governança e configuração de projeto, importação de orçamento,
exportação de apresentações). Mantém integralmente as funções técnicas legítimas (auditoria, aprovação
de cadastro, backup, operação de integrações via `allowedInDepartment()`). `diretoria` não é afetada —
`allowedContent()` só nega explicitamente `user.role === 'administrador'`.

**Reversível.** Sim — remover a checagem de `BUSINESS_CONTENT_MODULES` em `allowedContent()` (ou
substituir os callsites de volta para `allowed()`/`allowedInDepartment()`) restaura o comportamento
anterior (não recomendado, pois reabre a violação do MASTER_HANDOFF §11 para mutação).

### ADR-013 — Compliance vira deny-by-default por `hasGlobalScope()`; auditoria técnica separa metadados de conteúdo auditado

**Contexto.** A revisão final da rodada 6 apontou dois últimos atalhos indiretos pelos quais
`administrador` (papel técnico, `modules:['*']`/`actions:['*']`) ainda alcançava conteúdo de negócio,
apesar das ADRs 011/012 já terem fechado leitura e mutação diretas:

1. `GET`/`POST /api/compliance` (ADR-007, rodada 3) usavam `allowed(user,'*',...)` como autorização —
   esse gate é verdadeiro para qualquer papel com `modules:['*']`, o que inclui `administrador` além de
   `diretoria`. `administrador` continuava lendo e criando conteúdo de Compliance.
2. `GET /api/audit` devolvia o evento de auditoria inteiro, incluindo `before`/`after` — que podem
   conter o snapshot completo de um registro jurídico/financeiro/pessoal. Um `administrador` sem acesso
   direto ao conteúdo ainda conseguia lê-lo indiretamente através do histórico de auditoria de qualquer
   outro usuário.

**Decisão.**
1. `GET`/`POST /api/compliance` trocaram `allowed(user,'*',...)` por `hasGlobalScope(user)` — que hoje
   só `diretoria` satisfaz (`administrador.scopes` é `[]` desde a ADR-011). Nenhum módulo/estrutura de
   Compliance foi criado; a política continua sendo deny-by-default enquanto ADR-007 (módulo/dono
   definitivo) permanecer pendente — só que agora corretamente restrita à alçada de NEGÓCIO global, não
   a qualquer papel com módulo wildcard.
2. Nova `sanitizeAuditEventForUser(user, event)`: separa AUDITORIA TÉCNICA (metadados — `id`, `action`,
   `entity`, `entityId`, `responsible`, `date`, `reason`, `correlationId`, sempre disponíveis a quem
   acessa `/api/audit`) de CONTEÚDO AUDITADO (`before`/`after`, o snapshot do registro). Só
   `hasGlobalScope(user)` recebe `before`/`after`; os demais (na prática, hoje, só `administrador` chega
   a essa rota) veem apenas os metadados técnicos.

**Justificativa.** Ambos os casos são a mesma classe de problema das ADRs 011/012 (papel técnico
recebendo conteúdo por um mecanismo que não distingue "tem módulo/ação" de "tem alçada de negócio"),
mas alcançados por rotas diferentes (`allowed(user,'*',...)` literal, e um campo de payload não
filtrado) — por isso corrigidos aqui como uma ADR própria, em vez de reabrir as anteriores. Nenhuma das
duas correções inventa estrutura nova: reaproveita `hasGlobalScope()` (já existente desde a ADR-011) e
adiciona uma única função de redação de payload, sem duplicar a lógica em múltiplos pontos.

**Consequência.** `administrador` perde acesso a `/api/compliance` (leitura e escrita) e deixa de ver
`before`/`after` em `/api/audit` — mantém integralmente a função técnica de auditoria (ver quem fez o
quê, quando, por quê) e as demais funções técnicas (backup, aprovação de cadastro, integrações). Nenhum
papel departamental (lider/colaborador) ganha ou perde acesso a Compliance (já eram negados antes, por
não terem `allowed(user,'*',...)`; continuam negados por não terem `hasGlobalScope()`).

**Reversível.** Sim — reverter `hasGlobalScope(user)` para `allowed(user,'*',...)` em `/api/compliance`,
e remover `sanitizeAuditEventForUser()` do mapeamento de `GET /api/audit`, restaura o comportamento
anterior (não recomendado, pois reabre os dois atalhos indiretos).

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
