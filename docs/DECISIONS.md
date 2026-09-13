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

**Implementado na Fase 1 do Sprint 2** (`docs/SPRINT2-PLANO.md`, `docs/DATA_MODEL.md`): enum de
`status`, regra de reabertura (via `PATCH` comum, sem status próprio) e `isLegalDeadlineOverdue()` como
função pura de atraso derivado — testados em `tests/core.test.js`/`tests/security-integration.test.js`.
A função ainda não é consumida por nenhuma view (isso permanece Fase 2, não iniciada).

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

## 1.2. Sprint 2 — Fase 4 — Decisões de Negócio (Homologadas em 12/09/2026)

> **Status geral desta seção:** rodada **estritamente documental**, em duas passagens. Na primeira
> passagem, todas as decisões abaixo foram registradas como propostas técnicas (nenhuma tratada como
> homologação automática). Nesta segunda passagem, **a Cristiane (Gestora + Jurídico) homologou
> explicitamente D4.1, D4.2, D4.3, D4.5, D4.6, D4.10, D4.11 e D4.15** (ver status individual de cada
> uma, abaixo) — D4.4, D4.8 e D4.9 já eram reafirmações de regra existente. D4.7 e D4.12 ficam fora de
> escopo/como instrumento técnico, respectivamente (ver seus status individuais). **Em nenhum momento,
> em nenhuma das duas passagens, código foi alterado** — `server.js`, `dashboard-service.js`,
> `dashboard-model.js`, frontend e persistência permanecem exatamente como consolidados ao final da Fase
> 3, commit `a425c2e`. A implementação funcional (Fase 4B) continua não iniciada e deve ocorrer em PR(s)
> separado(s) — ver D4.13.
>
> **Nota de nomenclatura:** os identificadores `D4.1`–`D4.15` abaixo pertencem a esta seção (decisões da
> **Fase 4 do Sprint 2**) e são independentes do item **`D4` do Decision Backlog global** (seção 1,
> "Fonte oficial do contato do cliente") — não confundir os dois namespaces.

### D4.1 — Google Calendar

> **Status:** **HOMOLOGADO — OPÇÃO B** (12/09/2026, Cristiane — Gestora + Jurídico)

**Já homologado antes desta rodada (não é esta decisão):** MASTER_HANDOFF §10 já registra Google
Calendar como integração `Leitura`, e a D1 (seção 1.1, "Regra oficial do MVP") já fixa "Google Calendar
não é fonte de Legal Deadline". Isso nunca esteve em aberto.

**Contexto.** O piloto pode se beneficiar de uma visualização complementar de compromissos no Google
Calendar. Qualquer desenho que exija escrita externa colide com a regra global do MASTER_HANDOFF §10
("nenhuma escrita externa no MVP") e precisaria de uma decisão própria para abrir exceção a essa regra.

**Opções analisadas:**
- **A — Não usar Google Calendar no piloto.** Zero integração.
- **B — Leitura/visualização apenas, sem escrita.** Patrono **lê** compromissos já existentes no Google
  Calendar do usuário e pode exibi-los em uma view complementar, lado a lado com a Agenda combinada
  (Legal Deadline + `store.agenda`) da Fase 3. Patrono **não cria**, **não atualiza** e **não remove**
  nenhum evento no Google Calendar do usuário. **Legal Deadline não é espelhado no Calendar nesta
  opção** — nenhum `originType`/`status` de Legal Deadline "entra" no Calendar, porque nada é escrito
  lá. Consistente com o modo `Leitura` já registrado no MASTER_HANDOFF §10 e com "nenhuma escrita
  externa no MVP".
- **C — Espelhamento Patrono → Google Calendar** (Patrono escreve eventos derivados de Legal Deadline no
  Calendar do usuário, sem que o Calendar possa editar o Legal Deadline de volta). **Não homologada para
  o piloto** — exige escrita externa, o que colide com "nenhuma escrita externa no MVP" (§10) e exigiria
  uma decisão própria abrindo exceção formal a essa regra. Fica registrada como **possibilidade futura**
  (ver subseção "Opção C — registrada apenas como proposta futura", abaixo), sujeita a nova decisão
  formal antes de qualquer implementação.
- **D — Integração bidirecional.** Não recomendada — permitiria o Calendar alterar o prazo jurídico, o
  que a D1 já proíbe explicitamente. Não homologada, não avaliada como candidata real nesta rodada.

**Decisão de negócio: HOMOLOGADA — Opção B.** Google Calendar no piloto será **leitura apenas**:

- Google Calendar é **opcional** (o piloto funciona integralmente sem ele).
- **Não é source of truth** de nada.
- **Não cria** Legal Deadline.
- **Não altera** Legal Deadline.
- **Não confirma** prazo.
- **Não calcula** prazo.
- **Não recebe escrita do Patrono** — nenhum evento é criado, atualizado ou removido no Google Calendar
  do usuário pelo Patrono.
- Patrono **apenas lê** compromissos que o usuário já autorizou o acesso, e os apresenta como informação
  complementar (ex.: ao lado da Agenda combinada da Fase 3).
- **Nenhum Legal Deadline será espelhado no Google Calendar no piloto** — a Opção C está fora do escopo
  homologado.

**O que isso implica tecnicamente para a Opção B (a única homologada):**
- Nenhuma regra de "o que entra no Calendar por `originType`/`status`" se aplica — Patrono não decide o
  que aparece no Calendar do usuário, porque não escreve nada lá; o Calendar mostra o que o próprio
  usuário já tem cadastrado nele, sem relação com `legalDeadlines`.
- Nenhuma regra de "criar evento quando Legal Deadline for criado", "atualizar quando `date` mudar",
  "remover quando `status` mudar" ou "refletir reabertura" se aplica a esta opção — essas regras
  pertencem exclusivamente ao desenho da Opção C, não homologada.
- Indisponibilidade da integração: ver D4.8 — afeta apenas a **visualização dos compromissos externos do
  Google** (pode ficar `unavailable`/`stale`/`partial`); nunca afeta Legal Deadline, Agenda, Atenção,
  confirmação, `status` ou `date` no Patrono.
- Revogação de acesso: se o usuário revogar o acesso do Patrono ao próprio Google Calendar, a
  visualização complementar simplesmente deixa de mostrar aqueles compromissos — não há nenhum evento
  do Patrono no Calendar do usuário para remover, porque nada foi escrito.

#### Opção C — registrada apenas como proposta futura (NÃO homologada para o piloto)

Caso uma decisão de negócio **futura e separada** venha a abrir exceção formal à regra "nenhuma escrita
externa no MVP" e homologar o espelhamento Patrono → Calendar, as regras abaixo ficam registradas como
ponto de partida técnico — mas **não valem para o piloto atual**, que opera sob a Opção B:

- **originTypes que entrariam:** ambos poderiam aparecer, mas nunca sem identificação clara —
  `INTERNAL_CONTROL` nunca rotulado como prazo processual no evento (D4.5).
- **status que gerariam evento:** apenas `ativo`. `suspenso`/`cumprido`/`cancelado` não gerariam evento
  novo; um evento já existente referente a um prazo que mudou para um desses status seria
  removido/marcado como encerrado na próxima sincronização.
- **Quando `date` mudasse:** o evento seria atualizado para a nova data — nunca um segundo evento
  duplicado. Fonte canônica continuaria sendo `legalDeadlines`; o evento no Calendar seria sempre
  derivado, nunca editável a partir de lá.
- **Reabertura:** tratada como qualquer outra alteração do mesmo Legal Deadline (mesmo `id`) — o evento
  voltaria a existir/ficar ativo, nunca um evento novo.
- **Conteúdo sensível:** título neutro (ver D4.7 — recomendação preservada como referência futura, já que
  D4.7 fica fora do escopo funcional do piloto atual).
- **Nenhuma perda de informação canônica** em nenhum cenário — `legalDeadlines` continuaria sendo a fonte
  de verdade, sempre.

**Impactos (da Opção B homologada):** nova integração externa de escopo mínimo (leitura da agenda
pessoal do usuário, com consentimento OAuth do próprio usuário); nenhuma nova superfície de escrita.

**Riscos (da Opção B homologada):** token/credencial de acesso de leitura ao Calendar do usuário precisa
do mesmo tratamento de segredo já exigido para o Monday (MASTER_HANDOFF §10, "Segredos de integração —
P0 de implementação"); a própria leitura de compromissos pessoais do usuário já é uma superfície de dado
a proteger, mesmo sendo apenas leitura.

### D4.2 — Regra de atribuição/responsável para "Minha Semana"

> **Status:** **HOMOLOGADO** (12/09/2026, Cristiane — Gestora + Jurídico)

**Contexto.** "Minha Semana" não pode ser implementada até existir uma regra confiável de "isto é meu" —
hoje `legalDeadlines` não tem nenhum campo de responsável/atribuição (ver D4.3).

**Opções:**
- **A — `responsible` como campo textual livre.** Mais rápido de implementar, mas sem integridade
  referencial: não há como saber se o texto corresponde a um usuário real do sistema, não é
  auditável de forma estruturada, não sobrevive a renomeação/desligamento de forma confiável, e não dá
  base para RBAC nem para notificação futura.
- **B — `responsibleUserId` canônico (referência a um `user.id` existente).** Integridade garantida por
  referência a um cadastro real; auditável; permite RBAC ("só o responsável e quem tem escopo vê");
  compatível com Agenda/Atenção (a mesma defesa em profundidade de `scopedLegalDeadlineRows()` pode
  incorporar esse campo); base sólida para notificação futura.
- **C — relação `Responsibility` separada** (entidade própria, já prevista como "Transversais" no
  MASTER_HANDOFF §6). Mais flexível para múltiplos responsáveis/papéis (ex.: responsável principal +
  participantes), mas é mais estrutura do que o MVP da Fase 4 provavelmente precisa agora.
- **D — `owner` herdado do Legal Process.** Simples, mas incorreto para o caso de negócio já identificado
  no plano (item D4.3, abaixo): "o prazo pode ter responsável diferente do responsável do processo".
- **E — combinação controlada** (ex.: `responsibleUserId` opcional no Legal Deadline, com fallback para o
  owner do Legal Process quando ausente).

**Comparação:**

| Critério | A (texto livre) | B (`responsibleUserId`) | C (`Responsibility`) | D (herda do processo) |
|---|---|---|---|---|
| Integridade referencial | Nenhuma | Sim (aponta para `user.id` real) | Sim | Sim (via processo) |
| Auditabilidade | Fraca (texto pode divergir do histórico) | Forte (mesmo mecanismo de `audit()` já existente) | Forte | Forte, mas não distingue prazo×processo |
| RBAC | Não dá base nenhuma | Base direta (`scoped()`/comparação de `userId`) | Base direta, mais estrutura | Já herdado, sem novo controle |
| Troca de responsável | Edição de texto, sem histórico estruturado | `PATCH` auditado, com `before`/`after` | `PATCH`/novo registro de responsabilidade, auditado | Não se aplica (segue o processo) |
| Desligamento de usuário | Texto "morto", sem sinalização | `responsibleUserId` aponta para usuário inativo → sinalizável (ver D4.11) | Igual a B | Segue o processo, mesmo problema no nível do processo |
| Múltiplos responsáveis | Ambíguo (vírgula em texto?) | Não suporta nativamente (1 campo) | Suporta nativamente | Não se aplica |
| Compatível com Agenda/Atenção (Fase 3) | Fraco (comparação de texto) | Direto (comparação de `userId`) | Direto | Direto (herdado) |
| Uso futuro em notificação | Fraco | Bom (endereçável por `userId`) | Bom | Depende do processo ter 1 responsável claro |
| Risco de inconsistência | **Alto** (erro de digitação, nome duplicado, apelido) | Baixo | Baixo | Baixo, mas modela errado o caso de negócio |

**Decisão de negócio: HOMOLOGADA — Opção B (`responsibleUserId` canônico)**, identidade por referência a
um `user.id` existente — nunca texto livre (Opção A rejeitada). Não implementar ainda nesta rodada
(documental); desenho detalhado de campo/validação em D4.3.

### D4.3 — Legal Deadline precisa de responsável próprio?

> **Status:** **HOMOLOGADO** (12/09/2026, Cristiane — Gestora + Jurídico)

**Contexto.** Hoje `legalDeadlines` não tem nenhum campo de responsável — nem obrigatório, nem opcional,
nem herdado. MASTER_HANDOFF §6/§7 já prevê "Cada Legal Deadline pode possuir Responsibility", mas isso
nunca foi implementado nem homologado com o desenho concreto.

**Possibilidades levantadas:**
1. Responsável obrigatório (bloqueia criação sem ele).
2. Responsável opcional.
3. Herda do responsável do Legal Process (sem campo próprio no prazo).
4. Prazo pode ter responsável diferente do responsável do processo (campo próprio, independente).
5. Múltiplos responsáveis.
6. Responsável principal + participantes.

**Decisão de negócio: HOMOLOGADA.** Regras aprovadas:
- `legalDeadlines` poderá possuir `responsibleUserId`.
- Campo **opcional** no MVP — não trava a criação de Legal Deadline em fluxos onde o Jurídico ainda não
  decidiu quem acompanha aquele prazo especificamente.
- Quando preenchido, **deve referenciar um usuário existente e ativo** — mesma classe de validação de
  integridade já aplicada a `processId` (rejeitar referência a um registro que não existe/não está
  ativo). Uma nova atribuição exige usuário ativo no momento da atribuição.
- **Pode ser diferente do responsável do Legal Process** (possibilidade 4 das levantadas) — resolve o
  caso de negócio onde quem acompanha o processo como um todo não é necessariamente quem precisa cumprir
  um prazo específico.
- **Somente 1 responsável principal no MVP** — sem múltiplos responsáveis/participantes nesta fase
  (rejeita as possibilidades 5/6).
- **Não herdar automaticamente** o responsável do Legal Process — atribuição sempre explícita.
- **Não inferir** pelo criador do registro, nem pelo líder do departamento, nem por qualquer heurística.
- **Toda alteração de responsável deve ser auditada** pelo mesmo mecanismo de `audit()` já existente
  (`before`/`after`, `reason`).
- **Histórico não pode ser apagado** — mesmo que o `responsibleUserId` aponte depois para um usuário
  inativo (ver D4.11).

Não implementar ainda nesta rodada (documental) — fica autorizado para a Fase 4B.

### D4.4 — Semântica de "Confirmado pelo Jurídico"

> **Status:** HOMOLOGADO (a regra de linguagem já é D1.4; esta seção apenas formaliza os casos de borda
> explicitamente pedidos nesta rodada, sem alterar a regra já aprovada)

A D1.4 (seção 1.1, acima) já homologou a regra: a existência de um Legal Deadline válido, registrado por
usuário autorizado do Jurídico, **é suficiente** para a plataforma apresentar **"Confirmado pelo
Jurídico"** — isso nunca significa `evidenceReference`, prova documental, documento anexado, validação
judicial ou validação externa.

**PODE exibir:** "Confirmado pelo Jurídico" — para qualquer Legal Deadline que atenda D1.4 (registrado
por usuário autorizado, vinculado a Legal Process válido, `date`/`origin`/`originType` válidos, dentro do
escopo do usuário).

**NÃO PODE exibir sem `evidenceReference` estruturado** (que continua não implementado, D1.4): "Comprovado
documentalmente", "Documento validado", "Evidência confirmada", "Fonte oficial comprovada" — nenhuma
variação dessas frases, em nenhuma tela, mesmo que `evidenceReference` venha a existir futuramente sem
que a UI seja revisada para essa nova semântica.

**Casos de borda (fechados agora, formalizando o que a D1.4 já implica):**
- **Registro legado `requires_review`** (`dataIntegrity === 'requires_review'`, Fase 2/3): **não pode**
  exibir "Confirmado pelo Jurídico" — falta `originType`/`status` válidos, um dos requisitos da própria
  D1.4. Deve exibir "Requer revisão" (ver D4.6) até ser revisado/classificado manualmente.
- **`INTERNAL_CONTROL`:** pode exibir "Confirmado pelo Jurídico" normalmente — a D1.4 não distingue por
  `originType`, só por autoria/autorização do registro.
- **`suspenso`:** continua "Confirmado pelo Jurídico" (o registro continua válido; suspensão é um estado
  do prazo, não uma revogação da autoria) — mas a tela deve deixar claro que o estado atual é "Suspenso"
  (D4.6), nunca sugerir que o prazo está ativo.
- **`cumprido`:** idem — "Confirmado pelo Jurídico" continua válido; estado atual é "Cumprido".
- **`cancelado`:** idem — "Confirmado pelo Jurídico" descreve a autoria do registro histórico, não que o
  prazo continua vigente; estado atual é "Cancelado", deixado claro na mesma tela.
- **Prazo reaberto:** "Confirmado pelo Jurídico" permanece válido (mesmo registro, mesma autoria original);
  o histórico de reabertura (motivo, responsável, data) fica disponível via o mesmo mecanismo de
  auditoria já existente (Fase 1/2/3), nunca substituindo a informação de confirmação original.

**Decisão de negócio:** já **HOMOLOGADA** pela D1.4; esta seção é esclarecimento técnico dos casos de
borda, não uma nova decisão — mas fica sujeita à revisão da Cristiane se algum caso de borda acima for
julgado incorreto.

### D4.5 — Labels de apresentação para `originType`

> **Status:** **HOMOLOGADO** (12/09/2026, Cristiane — Gestora + Jurídico)

**Contexto.** O enum técnico (`JUDICIAL_PROCESSUAL`/`INTERNAL_CONTROL`, D1.3) não muda — esta decisão é
só sobre o texto exibido ao usuário.

**Opções levantadas:**
- `JUDICIAL_PROCESSUAL` → "Prazo processual" ou "Prazo jurídico/processual".
- `INTERNAL_CONTROL` → "Controle interno" ou "Prazo interno de controle".

**Decisão de negócio: HOMOLOGADA.**

- `JUDICIAL_PROCESSUAL` → **"Prazo processual"**
- `INTERNAL_CONTROL` → **"Controle interno"**

Não altera nenhum enum/valor técnico persistido — é puramente de apresentação (mesmo princípio já usado
no plano do Sprint 2 desde a Fase 2/3: INTERNAL_CONTROL nunca é rotulado como prazo processual).

### D4.6 — Labels de apresentação para `status` e condições derivadas

> **Status:** **HOMOLOGADO** (12/09/2026, Cristiane — Gestora + Jurídico)

**Persistidos (enum fechado, D1/Fase 1 — inalterado por esta decisão):** `ativo`, `suspenso`, `cumprido`,
`cancelado`.

**Derivados de view (Fase 2/3 — nunca persistidos, inalterado por esta decisão):** `overdue`/vencido,
`upcoming`/próximo, `requires_review`.

**Labels homologadas:**

| Valor técnico | Label em português (HOMOLOGADA) |
|---|---|
| `ativo` | Ativo |
| `suspenso` | Suspenso |
| `cumprido` | Cumprido |
| `cancelado` | Cancelado |
| `OVERDUE` (derivado) | Vencido |
| `UPCOMING` (derivado) | Próximo |
| `REQUIRES_REVIEW` (derivado) | Requer revisão |

**Confirmação (já garantida pelo código, reafirmada aqui):** `OVERDUE`, `UPCOMING` e `REQUIRES_REVIEW`
continuam sendo apenas condições/categorias derivadas de view — nenhum dos três é ou pode se tornar um
quinto valor do campo `status` persistido; são categorias calculadas em tempo de leitura por
`isLegalDeadlineOverdue()`/`civilDateAfterDays()`/`legalDeadlineIntegrityFlag()` (Fase 2/3), nunca
gravadas.

**Decisão de negócio: HOMOLOGADA** — a tabela de labels acima, e a regra técnica de que nada disso vira
status persistido (já homologada desde a D1/"Status do Legal Deadline").

### D4.7 — Conteúdo sensível em eventos de Calendar

> **Status:** **FORA DO ESCOPO FUNCIONAL DO PILOTO ATUAL** (12/09/2026 — consequência direta de D4.1
> homologar a Opção B)

**Justificativa:** a D4.1 homologou a Opção B (Google Calendar somente leitura) — o Patrono **não
escreverá eventos** no Google Calendar no piloto atual. Como não há evento derivado de Legal Deadline
sendo criado, a pergunta "qual conteúdo/título esse evento deveria ter" não se aplica hoje.

**Opções analisadas (mantidas apenas como referência para uma eventual Opção C futura):**
- **A — Título completo do processo.** Máxima utilidade, máxima exposição de dado jurídico em um app de
  terceiros.
- **B — Número do processo.** Exposição intermediária.
- **C — Título neutro** (descrição genérica sem identificar o processo/parte).
- **D — Apenas "Prazo jurídico — Patrono".** Mínima exposição possível.
- **E — Configurável por nível de confidencialidade.** Mais flexível, mais manutenção.

**Recomendação técnica preservada para o futuro:** minimização de dados — **Opção D** ("Prazo jurídico —
Patrono"), com o detalhe sensível permanecendo exclusivamente no Patrono. Se, no futuro, uma decisão de
negócio separada homologar a Opção C de D4.1 (espelhamento com escrita), esta recomendação (D) deve ser
revisitada e homologada formalmente **antes** de qualquer escrita externa — nunca implementada por
conveniência de UX sem essa homologação.

**Decisão de negócio:** **FORA DE ESCOPO** para o piloto atual (nenhuma homologação necessária enquanto
D4.1 permanecer na Opção B).

### D4.8 — Fallback quando a integração de Calendar está indisponível

> **Status:** **HOMOLOGADO** (herda a regra global já aprovada; aplicado à Opção B homologada em D4.1)

Esta não é uma decisão nova — é a aplicação, à integração de Calendar, da regra global já homologada em
MASTER_HANDOFF Anexo A (regras 3 e 14) e já implementada para o Monday (`docs/INTEGRATIONS.md`, "Falha de
fonte — preservação do último dado válido"): **"Falha de fonte ≠ ausência de dado"** e **"falha de fonte
preserva o último dado válido com status e timestamp; nunca apaga nem converte em zero"**.

Aplicado ao Calendar (Opção B — leitura apenas, D4.1): se a integração estiver indisponível, o Patrono
**continua funcionando normalmente**. Nenhum Legal Deadline pode desaparecer, mudar `status`, mudar
`date`, perder a confirmação ("Confirmado pelo Jurídico") ou ser marcado como inexistente por causa
disso — Legal Deadline, Agenda e Atenção (Fase 3) nunca dependem do Calendar para existir ou ser exibidos
no próprio Patrono. A indisponibilidade afeta **apenas a visualização dos compromissos pessoais externos
do Google** dentro dessa view complementar, que deve sinalizar `unavailable`/`stale`/`partial` (mesma
semântica de source-down já usada para o Monday), nunca mostrar zero por indisponibilidade.

**Decisão de negócio:** já coberta pela regra global homologada (Anexo A); nenhuma homologação nova
necessária para este ponto específico, apenas confirmação de que a Fase 4 não criará uma exceção.

### D4.9 — Confirmação: nenhuma automação jurídica, mesmo na Fase 4

> **Status:** HOMOLOGADO (reafirma regras já vigentes; nenhuma decisão nova)

Confirmado documentalmente, sem ambiguidade, que a Fase 4 (nem em sua implementação funcional futura,
Fase 4B) introduzirá:

- cálculo automático de prazo;
- interpretação automática de intimação;
- criação automática de Legal Deadline;
- mudança automática de `status` jurídico;
- reabertura automática;
- confirmação automática;
- decisão jurídica por IA.

Isso já é regra vigente — D1 ("Regra oficial do MVP", itens 17–18: "a Patrono MVP não calcula prazo
processual automaticamente"; "nenhuma engine de cálculo jurídico será criada no Sprint 2"), MASTER_HANDOFF
§13 (Patrono IA) e §14 (Automações), e Anexo A. Qualquer automação futura — mesmo que pareça pequena ou
conveniente — **exigirá uma nova decisão formal**, com o mesmo rito de homologação da D1, nunca uma
introdução silenciosa via código.

**Decisão de negócio:** já **HOMOLOGADA** (reafirmação de regra existente).

### D4.10 — "Minha Semana": escopo, se vier a ser implementada

> **Status:** **HOMOLOGADO** (12/09/2026, Cristiane — Gestora + Jurídico)

**Contexto.** Depende de D4.2/D4.3 (regra de atribuição/responsável, já homologadas nesta rodada) —
`responsibleUserId` é a base que permite definir "meus itens" com integridade.

**Princípio arquitetural (não é decisão de negócio, é consequência inegociável):** "Minha Semana" é
**VIEW**, nunca source of truth — reúne, sem duplicar, Legal Deadlines atribuídos e Agenda Events
atribuídos ao usuário logado, e eventualmente Tasks no futuro. **Legal Deadline ≠ Task** — nenhuma Task é
criada automaticamente a partir de um Legal Deadline (D4.9 já proíbe isso).

**Decisão de negócio: HOMOLOGADA.** Janela temporal: **semana civil atual, segunda-feira a domingo, fuso
`America/Sao_Paulo`** — mesmo padrão de data civil já usado em todo o Sprint 2
(`todayCivilDate()`/`civilDateAfterDays()`, sem conversão para UTC). **Não** usar janela móvel de
"próximos 7 dias corridos".

"Minha Semana" deve reunir, quando implementada (Fase 4B):
- Legal Deadlines atribuídos ao usuário (via `responsibleUserId`, D4.2/D4.3);
- Agenda Events atribuídos ao usuário;
- Tasks, somente se essa entidade vier a existir futuramente (nenhuma Task é criada agora nem
  automaticamente).

Não implementar ainda nesta rodada (documental) — fica autorizado para a Fase 4B.

### D4.11 — Responsável desligado/desativado/fora de escopo

> **Status:** **HOMOLOGADO** (12/09/2026, Cristiane — Gestora + Jurídico)

**Contexto.** Com `responsibleUserId` homologado em D4.2/D4.3, é preciso decidir o que acontece quando
esse usuário é desativado, muda de departamento, perde escopo, ou deixa a empresa.

**Princípio inegociável (consequência de regras já homologadas):** nunca apagar histórico. O Legal
Deadline continua existindo, com todo seu histórico de auditoria intacto, independentemente do que
aconteça com o usuário que já foi responsável por ele. O prazo **não desaparece**.

**Decisão de negócio: HOMOLOGADA.**
- `responsibleUserId` histórico **permanece** no registro/no evento de auditoria — nunca é removido
  retroativamente.
- Um novo responsável **deve ser atribuído formalmente**, por operação auditada (mesmo mecanismo de
  `PATCH` auditado de D4.3) — **nunca reatribuído automaticamente por heurística**.
- Enquanto não houver reatribuição, a view (Agenda/Atenção/detalhe) **sinaliza "Responsável inativo"** —
  nunca esconde o prazo, nunca finge que ele não tem mais responsável definido, e nunca o trata como
  "sem dono" de forma equivalente a nunca ter tido um.

Não implementar ainda nesta rodada (documental) — fica autorizado para a Fase 4B.

### D4.15 — Visibilidade de `cumprido`/`cancelado`/`suspenso` na Agenda operacional

> **Status:** **HOMOLOGADO** (12/09/2026, Cristiane — Gestora + Jurídico) — fecha o ponto levantado em
> D4.14 item 11 da rodada documental anterior

**Contexto.** A Agenda combinada da Fase 3 (`GET /api/agenda-items`) hoje lista todo Legal Deadline
autorizado, independentemente de `status`. Faltava decisão de negócio sobre se `cumprido`/`cancelado`
devem continuar aparecendo na Agenda do dia a dia por padrão.

**Decisão de negócio: HOMOLOGADA.**
- `cumprido` e `cancelado` **não aparecem por padrão** na Agenda operacional (a view do dia a dia,
  `GET /api/agenda-items`).
- Ambos **permanecem disponíveis** em histórico/filtro/consulta — nunca apagados, nunca escondidos de
  forma permanente; um filtro explícito (ex.: incluir encerrados) continua podendo trazê-los de volta.
- Continuam **acessíveis no detalhe** (`GET /api/entities/legalDeadlines/:id/detail`) conforme a mesma
  autorização já vigente — esta regra é apenas sobre a listagem operacional padrão, não sobre acesso.
- `suspenso` **também não aparece como prazo ativo/vencido** na Agenda operacional (consistente com a
  regra já vigente de que `suspenso` nunca é atraso — D1/Fase 1).
- **Esta regra é apenas de apresentação/filtro padrão** — não altera o registro canônico, não apaga
  nada, não muda `status`, e não afeta `GET /api/attention` (que já só traz categorias `OVERDUE`/
  `UPCOMING`/`REQUIRES_REVIEW`, nunca `cumprido`/`cancelado`/`suspenso` como tal).

Implementação (filtro padrão da Agenda operacional excluindo `cumprido`/`cancelado`/`suspenso`, mantendo
os já disponíveis via `?paginated=1&status=...` na listagem) fica para a Fase 4B — não implementada nesta
rodada documental.

### D4.12 — Checklist de homologação formal do piloto (Sprint 2)

> **Status:** PROPOSTA TÉCNICA (o checklist em si não é uma "decisão de negócio" a homologar — é o
> instrumento que a Cristiane usa para homologar o piloto; fica sujeito a ajuste antes de ser aplicado)

Critérios objetivos mínimos, alinhados a MASTER_HANDOFF §32 ("Checklist de Homologação") e §30
("Checklist QA"):

1. Legal Deadline canônico funcionando (Fase 1) — ✅ implementado e testado.
2. `originType` obrigatório (D1.3/Fase 1) — ✅ implementado e testado.
3. `status` como enum fechado (Fase 1) — ✅ implementado e testado.
4. Reabertura auditada, mesmo `id` (Fase 1) — ✅ implementado e testado.
5. Atraso como condição derivada, nunca persistida (Fase 1) — ✅ implementado e testado.
6. Dashboard jurídico sem prazo bruto do Monday (Fase 2) — ✅ implementado e testado.
7. Listagem/filtro de Legal Deadline (Fase 2) — ✅ implementado e testado.
8. Detalhe/histórico de Legal Deadline (Fase 2) — ✅ implementado e testado.
9. Agenda/Atenção sem duplicidade de Legal Deadline (Fase 3) — ✅ implementado e testado.
10. `companyId`/`speId` respeitados em toda view (Fases 2/3) — ✅ implementado e testado.
11. TI sem acesso a conteúdo jurídico (Fases 1–3) — ✅ implementado e testado.
12. Administrador técnico sem conteúdo jurídico automático (Fases 1–3) — ✅ implementado e testado.
13. Monday sem criar/confirmar prazo (D1, Fases 1–3) — ✅ implementado e testado.
14. DATA/CITAÇÃO do Monday nunca geram prazo (Fases 2/3, regressão obrigatória testada) — ✅ implementado
    e testado.
15. CI verde (Node 20.x/22.x) no head homologado — ✅ confirmado nas Fases 1–3.
16. Testes de regressão verdes (nenhum teste removido entre fases) — ✅ confirmado (196 testes ao final
    da Fase 3).
17. Documentação atualizada (`docs/SPRINT2-PLANO.md`, `docs/QA.md`, `docs/DATA_MODEL.md`) — ✅ atualizada
    a cada fase.
18. Nenhum P0 aberto no escopo entregue (Fases 1–3) — ✅ confirmado a cada fase, sem P0 residual.
19. P1 conhecidos classificados — ✅ ver `docs/SECURITY.md`/`docs/PERMISSIONS.md` ("Pendências
    conhecidas"/"P0 conhecidos e ainda abertos") — nenhum bloqueia o escopo já entregue (Fases 1–3).
20. Decisão formal sobre Calendar (D4.1) — ✅ **HOMOLOGADA** (Opção B, leitura apenas).
21. Decisão formal sobre responsável (D4.2/D4.3) — ✅ **HOMOLOGADA** (`responsibleUserId` opcional).
22. Decisão formal sobre Minha Semana (D4.10) — ✅ **HOMOLOGADA** (semana civil, `America/Sao_Paulo`).
23. Decisão formal sobre copy de confirmação (D4.4/D4.5/D4.6) — ✅ **HOMOLOGADA** (D4.4 via D1.4; D4.5/
    D4.6 — labels — homologadas nesta rodada).

**Itens 1–23: todos satisfeitos.** Itens 1–19 pelo escopo já entregue nas Fases 1–3; itens 20–23 pela
homologação de negócio registrada nesta rodada (D4.1, D4.2/D4.3, D4.5, D4.6, D4.10, D4.11, D4.15). **Isto
marca apenas a homologação documental das decisões — não marca a implementação funcional da Fase 4B
como concluída** (ver D4.13): nenhum código foi alterado, `responsibleUserId`/leitura de Calendar/Minha
Semana continuam não implementados.

### D4.13 — Matriz GO / NO-GO para a implementação funcional da Fase 4 (Fase 4B)

> **Status:** PROPOSTA TÉCNICA (a matriz em si não é uma decisão de negócio — é o instrumento de
> avaliação; o resultado abaixo reflete as homologações desta rodada)

| Condição | GO | NO-GO | Situação nesta rodada |
|---|---|---|---|
| Google Calendar (D4.1) | Opção homologada (A, B, ou C com exceção formal à regra de não-escrita) | Nenhuma opção homologada, ou D homologada sem fundamento arquitetural registrado | ✅ GO — Opção B homologada |
| Responsável do Legal Deadline (D4.2/D4.3) | Modelo (`responsibleUserId` ou equivalente) homologado, com regra de integridade definida | Responsável permanece indefinido, ou modelo escolhido é campo textual livre sem plano de migração | ✅ GO — `responsibleUserId` opcional homologado |
| Minha Semana (D4.10) | Janela temporal homologada, dependência de D4.3 já resolvida | Depende de responsável ainda pendente, ou janela temporal não definida | ✅ GO — semana civil homologada |
| Exposição de dado sensível em Calendar (D4.7) | Política de título/conteúdo homologada | Continua indefinida, mas Calendar já foi ativado (nunca aceitável) | ✅ GO — fora de escopo (Opção B não escreve eventos); recomendação preservada para uma futura Opção C |
| Source of truth | Confirmado: `legalDeadlines` continua único, nada muda | Qualquer desenho em que Calendar/Minha Semana vira fonte de dado | ✅ GO — confirmado, sem exceção |
| Regra de deleção/suspensão do responsável (D4.11) | Definida (sinalização "Responsável inativo", nunca exclusão de histórico) | Indefinida | ✅ GO — homologada |
| Visibilidade cumprido/cancelado (D4.15) | Definida (não aparecem por padrão na Agenda operacional, permanecem em histórico/filtro) | Indefinida | ✅ GO — homologada |
| Testes esperados | Cenários de teste da Fase 4B já esboçados em `docs/QA.md` ("QA planejado — Fase 4") | Nenhum critério de aceite/teste esperado definido antes de codificar | ✅ GO — 23 cenários já esboçados |

**Resultado desta rodada:** **GO DOCUMENTAL para iniciar a implementação da Fase 4B.** Todas as decisões
de negócio necessárias (D4.1, D4.2/D4.3, D4.5, D4.6, D4.10, D4.11, D4.15) foram homologadas pela
Cristiane.

**O que "GO DOCUMENTAL" significa — e o que NÃO significa:**
- Significa apenas que **as decisões de negócio/UX necessárias foram fechadas** e a implementação
  funcional da Fase 4B pode ser **planejada e iniciada**.
- **NÃO** significa deploy autorizado.
- **NÃO** significa produção autorizada.
- **NÃO** significa escrita externa autorizada (D4.1 homologou explicitamente a Opção B — leitura
  apenas; qualquer escrita externa, incluindo uma futura Opção C de Calendar, exige nova decisão formal
  própria, fora do escopo desta homologação).
- **NÃO** significa que a Fase 4B já foi implementada — nenhum código foi alterado nesta rodada.
- A Fase 4B (implementação funcional de `responsibleUserId`, leitura de Calendar, "Minha Semana") **deve
  ser planejada e implementada em PR separado**, seguindo o mesmo rito de revisão de segurança, testes e
  CI já usado nas Fases 1–3.

### D4.14 — Decisões que exigem homologação da responsável de negócio (Cristiane)

> **Status desta rodada: todos os 12 itens abaixo foram homologados** pela Cristiane (Gestora +
> Jurídico) em 12/09/2026. Lista mantida para registro/auditoria do rito de homologação.

1. Usar ou não Google Calendar no piloto (D4.1) — **RESOLVIDO: usar, Opção B (leitura apenas)**.
2. Se usar Calendar: somente leitura ou espelhamento com escrita (D4.1) — **RESOLVIDO: somente leitura
   (Opção B); espelhamento com escrita (Opção C) não homologado, fica como possibilidade futura sujeita a
   nova decisão formal**.
3. Quais `originType` vão ao Calendar, e com qual tratamento por `status` (D4.1) — **RESOLVIDO: não se
   aplica na Opção B homologada** (Patrono não escreve nada no Calendar; essa pergunta só valeria para
   uma futura Opção C).
4. Título do evento no Calendar: neutro/mínimo ou com identificação do processo (D4.7) — **RESOLVIDO:
   fora de escopo funcional do piloto atual** (consequência de D4.1 ser Opção B); recomendação de
   minimização ("Prazo jurídico — Patrono") preservada como referência para uma eventual Opção C futura.
5. Responsável do Legal Deadline: obrigatório ou opcional (D4.3) — **RESOLVIDO: opcional no MVP**.
6. Modelo de campo: `responsibleUserId` ou outra abordagem (D4.2/D4.3) — **RESOLVIDO: `responsibleUserId`
   canônico, referenciando um `user.id` existente e ativo**.
7. "Minha Semana": semana civil ou janela móvel de próximos 7 dias (D4.10) — **RESOLVIDO: semana civil,
   segunda-feira a domingo, fuso `America/Sao_Paulo`**.
8. Copy de confirmação: aprovar a semântica "Confirmado pelo Jurídico" e os casos de borda (D4.4) —
   **RESOLVIDO: aprovado, sem alteração de regra** (requires_review não exibe; INTERNAL_CONTROL/suspenso/
   cumprido/cancelado/reaberto continuam exibindo, com o estado atual sempre visível na mesma tela).
9. Label de `INTERNAL_CONTROL` na UI (D4.5) — **RESOLVIDO: "Controle interno"**.
10. Labels de `status`/derivados em português (D4.6) — **RESOLVIDO: tabela homologada tal como proposta**
    (Ativo/Suspenso/Cumprido/Cancelado; Vencido/Próximo/Requer revisão).
11. Se prazo `cumprido`/`cancelado` continua visível na Agenda histórica, ou é ocultado por padrão (D4.15,
    nova decisão desta rodada) — **RESOLVIDO: não aparecem por padrão na Agenda operacional; permanecem
    disponíveis em histórico/filtro/consulta e no detalhe**.
12. Regra de usuário inativo/desligado como responsável (D4.11) — **RESOLVIDO: sinalização "Responsável
    inativo" até reatribuição formal; histórico nunca apagado**.

**Nenhum item permanece pendente desta lista.** Todas as 12 decisões estão homologadas — a implementação
funcional correspondente (Fase 4B) foi concluída (ver seção 1.3 abaixo e `docs/SPRINT2-PLANO.md`).

---

## 1.3. Encerramento do Sprint 2 — Decisão D2-CLOSE

### D2-CLOSE — Encerramento formal do Sprint 2

**Status: HOMOLOGADO** (decisão de encerramento, não uma decisão de negócio sobre regra jurídica —
registrada nesta seção por ser o mesmo namespace de decisões de governança do Sprint 2, distinto da
numeração D1/D4 já homologada, que permanece inalterada).

**Conteúdo da decisão:**

1. O Sprint 2 está **concluído no escopo homologado** — Fases 1, 2, 3, 4A e 4B entregues e mergeadas na
   master (`3eff813a6e5a9996a10164b33f10d00c087161c2`, PR #8, squash de
   `d2f7ac8afc3c9a38b809bc5d6215942a33d47e1e`).
2. Os gaps aceitos ao encerrar (Agenda Events manuais fora de Minha Semana; ausência de operação de
   "desatribuir" responsável; Google Calendar sem OAuth real) **permanecem registrados** como itens
   diferidos/bloqueados por dependência externa ou de negócio — não como falha do Sprint 2 (ver
   `docs/SPRINT2-PLANO.md`, seção "Encerramento do Sprint 2").
3. O Google Calendar real **permanece bloqueado** por ausência de credenciais de OAuth e de um mecanismo
   seguro de armazenamento de token por usuário neste ambiente — não resolvido por esta decisão, nem por
   nenhuma decisão anterior do Sprint 2.
4. **Esta decisão não autoriza produção, deploy, nem qualquer escrita externa.** Produção depende de um
   gate técnico/de negócio separado (ver `docs/SECURITY.md`, "Riscos residuais após o Sprint 2").
5. **O próximo Sprint (Sprint 3) requer autorização explícita e separada** para iniciar — esta decisão de
   encerramento não inicia, planeja em código, nem abre trabalho do Sprint 3. As frentes futuras sugeridas
   (ver `docs/SPRINT2-PLANO.md`, "Transição para o próximo Sprint") são propostas de priorização, não
   compromissos assumidos.

Esta decisão não altera nenhuma decisão D1/D4 já homologada — apenas registra o encerramento formal do
Sprint 2 como um todo, reconciliando o que já estava disperso entre `docs/SPRINT2-PLANO.md`, `docs/QA.md`
e o estado real consolidado na master.

---

## 1.4. Gate de Produção — Decisão PROD-GATE-01

### PROD-GATE-01 — Abertura formal do Gate de Produção

**Status: EM AVALIAÇÃO / NO-GO ATUAL**

**Conteúdo da decisão:**

1. O Sprint 2 está encerrado (D2-CLOSE) e concluído no escopo homologado — esta decisão não reabre nem
   contradiz aquela.
2. **Produção não está autorizada.** O gate técnico formal de produção — auditoria completa, achados
   classificados P0/P1/P2/P3, matriz GO/NO-GO e plano de hardening — está documentado em
   `docs/PRODUCTION_GATE.md`. Estado atual: **NO-GO para produção**, com 10 achados P0, 10 P1 e 5 P2 abertos,
   nenhum waiver concedido.
3. Os critérios objetivos de GO/NO-GO, o processo de waiver e a ordem proposta de hardening (H1–H11)
   estão definidos em `docs/PRODUCTION_GATE.md` — esta decisão não os duplica, apenas os referencia como
   fonte de autoridade sobre o estado do gate.
4. **A implementação do hardening (H1–H11) exige PR(s) separado(s)** desta rodada, cada um com testes
   próprios — nenhuma correção de código foi feita nesta decisão, que é estritamente documental/de
   diagnóstico.
5. **O Sprint 3 funcional é independente deste gate** — nem o inicia, nem depende dele para ser
   autorizado a começar (podem correr em paralelo, sujeitos cada um à sua própria autorização), mas
   nenhum deploy de produção pode ocorrer enquanto este gate permanecer NO-GO.

Esta decisão não altera nenhuma decisão D1/D4/D2-CLOSE já homologada.

---

## 1.5. Hardening H1A — Decisão PROD-H1-01

### PROD-H1-01 — Persistência PostgreSQL como fonte canônica do runtime

**Status: IMPLEMENTADO / AGUARDANDO HOMOLOGAÇÃO** (ver `docs/PRODUCTION_GATE.md`, seção 17, para o
detalhamento técnico completo — esta decisão não o duplica, apenas registra o que foi decidido).

**Conteúdo da decisão:**

1. **PostgreSQL passa a ser a persistência canônica** quando `DATABASE_URL` está configurada — toda a
   aplicação lê/escreve exclusivamente através de `storage/` (`readStore()`/`writeStore()`), nunca
   diretamente em `fs`/`pg`.
2. **JSON é somente fallback local explícito**, permitido apenas fora de produção. Em
   `NODE_ENV=production` sem `DATABASE_URL` (ou com Postgres inalcançável/schema incompatível), o
   processo falha ao iniciar (fail-fast) — nunca opera silenciosamente em modo arquivo.
3. **Nenhuma dual-write**: um único backend ativo por processo, decidido uma vez no boot.
4. **Importação de JSON para Postgres é um processo separado e explícito** (`scripts/import-data.js`,
   com `--dry-run`), nunca automática, nunca apaga o arquivo de origem.
5. **Migrations são versionadas** (`schema_migrations`, `npm run migrate`), determinísticas e
   append-only — nenhuma migration histórica (001/002) foi alterada.
6. **Transações e concorrência otimista real** foram implementadas e testadas contra um PostgreSQL de
   teste isolado — conflito de concorrência responde HTTP 409, nunca sobrescreve silenciosamente.
7. **Arquitetura de PONTE, não normalização relacional**: a store inteira continua como um único
   documento JSONB (`app_store`). Nenhuma FK relacional real foi criada. A normalização progressiva por
   entidade (`users`, `legalProcesses`, `legalDeadlines`, `audit`, nesta ordem, com FK real) é **H1B**,
   deliberadamente **não iniciada** por esta decisão.
8. **Esta decisão não fecha o Gate de Produção** (`docs/DECISIONS.md`, PROD-GATE-01) — apenas os
   critérios PG-01/PG-02/PG-03 de `docs/PRODUCTION_GATE.md` são atualizados para "fechado". O gate como
   um todo permanece **NO-GO PARA PRODUÇÃO**.

Esta decisão não altera D1/D4/D2-CLOSE/PROD-GATE-01 já homologadas — apenas registra o avanço específico
do H1A dentro do gate de produção já aberto.

---

## 1.6. Hardening H1B — Decisão PROD-H1B-01

### PROD-H1B-01 — Normalização relacional progressiva do núcleo canônico

**Status: IMPLEMENTADO / AGUARDANDO HOMOLOGAÇÃO** (ver `docs/PRODUCTION_GATE.md`, seção 18, para o
detalhamento técnico completo — esta decisão não o duplica, apenas registra o que foi decidido).

**Conteúdo da decisão:**

1. **`users`, `legalProcesses` (=`store.records.processos`), `legalDeadlines`
   (=`store.records.legalDeadlines`) e `audit` (=`store.audit`) passam a ter tabela relacional própria**
   (`app_users`, `legal_processes`, `legal_deadlines`, `audit_log` —
   `migrations/004_h1b_core_relational.sql`, nesta ordem, exatamente como definido em PROD-H1-01/item 7).
   Deixam de ser canônicas dentro do documento JSONB `app_store` a partir do momento em que
   `npm run migrate:h1b:data` roda.
2. **FK real**: `legal_deadlines.process_id → legal_processes(id)` e
   `legal_deadlines.responsible_user_id → app_users(id)`, ambas `ON DELETE RESTRICT` — nunca cascade
   destrutivo, preserva histórico (um usuário/processo referenciado nunca pode ser fisicamente apagado;
   inativação continua sendo só `deletedAt`, que a FK não impede).
3. **Sem dual-write**: as 4 coleções nunca são serializadas dentro do blob depois de migradas — a ponte
   relacional (`storage/index.js`) remove essas chaves do documento a cada escrita. `npm run
   migrate:h1b:data` também as remove explicitamente do blob existente, na mesma transação que popula as
   tabelas (cutover).
4. **Sem fallback tabela→JSONB**: se a tabela existe e a migration `004_h1b_core_relational` está
   registrada, ela é a única fonte — uma falha de leitura/escrita relacional nunca cai silenciosamente de
   volta para o blob.
5. **Concorrência otimista por linha**: cada tabela tem sua própria coluna `version`; o Legal Deadline
   não depende mais apenas da `version` global do `app_store` para detectar conflito — duas edições
   concorrentes do MESMO Legal Deadline colidem (409); edições concorrentes de deadlines diferentes
   continuam adicionalmente protegidas pela `version` global do blob (efeito colateral aceito do desenho
   — não um requisito relaxado).
6. **Transação real**: mutação de uma das 4 entidades e o evento de auditoria correspondente são
   persistidos na MESMA transação Postgres que atualiza o restante do blob — tudo ou nada.
7. **`email` de `app_users` continua SEM constraint de unicidade.** A regra vigente no runtime nunca foi
   de unicidade rígida (só bloqueia nova solicitação de registro, comparação case-insensitive, sem checar
   apenas usuários ativos) — e o seed atual já tem dois usuários (`usr-diretoria`/`usr-juridico`)
   compartilhando o mesmo email. Impor `UNIQUE(email)` agora quebraria esse dado existente e mudaria uma
   regra de negócio sem homologação explícita. Registrado aqui como gap preexistente e conhecido, não
   fechado por H1B — decisão de segurança/produto pendente para rodada futura (fora do escopo H1B/H2–H11
   definido nesta rodada).
8. **`companyId`/`speId`/`scopeType` continuam dormentes** — as colunas existem (nuláveis) nas novas
   tabelas, mas nenhuma rotina real as popula ainda; nenhuma mudança de comportamento de `scoped()`.
9. **Migração de dados H1A→H1B é um processo separado e explícito** (`scripts/migrate-h1b-data.js`, `npm
   run migrate:h1b:data`), com `--dry-run` (relatório por coleção, nunca grava), transacional, idempotente
   (`--force` para reimportar sem duplicar), e que aborta inteiramente diante de qualquer inconsistência
   crítica (órfão de `processId`/`responsibleUserId`, duplicado, enum inválido) — nunca grava dado
   parcial.
10. **Runbook de deploy obrigatório, nesta ordem**: (a) `npm run migrate` (aplica
    `004_h1b_core_relational`); (b) `npm run migrate:h1b:data` (extrai as 4 coleções do `app_store`
    existente para as tabelas relacionais, com `--dry-run` disponível antes); só então (c) subir o
    processo normalmente. **O runtime não depende apenas do operador seguir essa ordem** (correção da
    revisão final do H1B, ver item 12 abaixo): "migration de SCHEMA" (passo (a), `schema_migrations`) é
    DIFERENTE de "migração de DADOS" (passo (b)) — um marcador explícito e persistente
    (`data_migrations`, chave `h1b_core_relational_cutover`, gravado por `scripts/migrate-h1b-data.js` na
    MESMA transação que popula as tabelas e corta o blob) registra que o cutover de fato ocorreu.
    `storage.init()` (a fachada em `storage/index.js`, chamada no boot real) falha explicitamente
    (fail-closed) se o backend é PostgreSQL e esse marcador ainda não existe — nunca ativa a ponte
    relacional sobre tabelas vazias enquanto o blob ainda tem o dado real, mesmo que o passo (a) já tenha
    rodado.
11. **Esta decisão não fecha o Gate de Produção nem declara H1 integralmente concluído** — apenas
    os critérios PG-01/PG-02/PG-03 de `docs/PRODUCTION_GATE.md` ganham uma camada adicional de rigor (FK
    real para o núcleo canônico). Demais entidades permanecem no documento JSONB único (H1A). O gate como
    um todo permanece **NO-GO PARA PRODUÇÃO**. H2–H11 não foram alterados por esta decisão.
12. **Correção de revisão final (blocker P1 corrigido antes da homologação)**: a versão original desta
    decisão dependia apenas do runbook documentado (item 10) para a ordem migrate→migrate:h1b:data — sem
    nenhuma checagem em runtime. Corrigido para o mecanismo fail-closed descrito no item 10: o marcador
    de cutover em `data_migrations` é a fonte de verdade real (não uma contagem de linhas em `app_users`,
    que poderia estar vazia por outro motivo), e `GET /api/health` (`schemaReady`) reflete o mesmo estado
    — um schema fisicamente presente cujo cutover ainda não ocorreu nunca é reportado como pronto.
    `scripts/migrate-h1b-data.js` também teve `hasCriticalIssues()` corrigido: `processesReport.invalid`/
    `auditReport.invalid` já eram calculados mas nunca entravam na decisão de abortar o `--dry-run`/
    importação real — corrigido para depender só da validação já conhecida, nunca de uma constraint SQL
    posterior detectar algo que o relatório já sabia.

Esta decisão não altera D1/D4/D2-CLOSE/PROD-GATE-01/PROD-H1-01 já homologadas — apenas registra o avanço
específico do H1B dentro do gate de produção já aberto.

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
