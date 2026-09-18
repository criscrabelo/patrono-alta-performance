# Auditoria Corporativa e Plano Mestre de Finalização — Patrono Alta Performance

> Rodada **estritamente documental**. Nenhum código foi alterado, nenhuma migration rodada, nenhum
> deploy realizado.
>
> **Nota de reconciliação (importante, leia antes do resto):** esta auditoria foi iniciada criando
> `claude/demo-staging-deploy` a partir de `master` (`cf1c9181...`), porque no início desta sessão a
> branch não existia no remoto (`git ls-remote` não a listava). No meio da auditoria, antes de publicar o
> resultado, uma nova verificação mostrou que **a branch já existia no remoto com 8 commits reais**,
> produzidos em paralelo por outro trabalho: infraestrutura de demonstração (`Dockerfile`, `fly.toml`,
> `docs/DEMO_DEPLOY.md`), o próprio `docs/DEMO_CURRENT_STATE.md` (que a primeira leitura desta auditoria
> havia registrado como inexistente — estava certo para `master`, errado para esta branch), correções de
> estabilidade (crash de sync Monday/Postgres, autostop do Fly, reconciliação de CAS) e ampliação do
> catálogo Monday de 7 para 35 boards (`legal-source-catalog.js`). Este documento foi **corrigido para
> refletir o estado real da branch no commit `3c4c8616d4ce4acd9d9d1441970e92c30d086a61`** ("Docs —
> consolidar estado atual da demo"), não mais o estado de `master`. Os pontos corrigidos estão marcados
> explicitamente onde aparecem, em vez de reescritos silenciosamente. A leitura original (baseada em
> `master`) foi preservada, sem descarte, na branch lateral `claude/demo-staging-deploy-mine` — não houve
> `force-push` sobre o trabalho que já existia no remoto.
>
> Auditoria feita por leitura direta de código, execução real de `npm test`/`npm audit` **contra o
> commit `3c4c861`**, e leitura de toda a documentação em `docs/` e `docs/handoff-codex/`.
>
> **Nota de nomenclatura:** o nome no código, no `package.json` e na interface é **"COEVO Alta
> Performance"**. "Patrono Alta Performance" (usado neste documento por seguir o pedido) é o nome do
> produto em `docs/MASTER_HANDOFF.md` — a renomeação do código/UI está registrada como decisão
> pendente/deferida em `docs/DECISIONS.md`, não como uma inconsistência acidental.

---

## 1. Executive Summary

**Estágio real:** esta é uma plataforma corporativa **em construção incremental**, não uma plataforma
corporativa completa com um piloto jurídico. O que existe hoje é, com folga, o **piloto do módulo
Jurídico** (Legal Process + Legal Deadline, Sprint 2, formalmente encerrado em escopo homologado) mais
uma **fundação técnica muito madura** (autenticação individual, MFA, RBAC de 4 dimensões, auditoria,
backup/restore, observabilidade, rate limiting, hardening HTTP) construída através de 7+ rodadas de
correção de segurança e 7 "Hardenings" (H1–H7) documentados com rigor incomum — cada um com decisão,
implementação, teste real e um item específico que o mantém formalmente "aberto" até prova concreta
(nunca fechado por intenção).

**O que já está sólido:**
- RBAC/autorização server-side: 38 correções de P0 numeradas e testadas em 7 rodadas, segregação
  Jurídico×TI, "administrador técnico ≠ superusuário de conteúdo" aplicada em toda superfície de API.
- Autenticação individual (scrypt) + MFA individual (TOTP/RFC 6238) + sessões persistidas em PostgreSQL,
  com logout/logout-all/revogação reais.
- Persistência: PostgreSQL conectado ao runtime (H1A) com núcleo relacional (`users`, `legalProcesses`,
  `legalDeadlines`, `audit`) com FK real e concorrência otimista testada (H1B).
- Rate limiting distribuído (H3), hardening HTTP completo — CSP/HSTS/X-Frame-Options/Referrer-Policy (H4).
- Backup/restore real contra PostgreSQL (`pg_dump`/`pg_restore`), logging estruturado com redação de
  segredos, e um processo de resposta a incidentes documentado ponta a ponta — cada um com exatamente
  **um** item pendente que o bloqueia de fechar (armazenamento externo real, agregador de log real,
  canal/responsável nomeado real, respectivamente) — nenhum fechado por afirmação, todos por evidência.
- Suíte de testes: **454 testes nesta execução, contra `3c4c861`** (447 passando, 7 pulados por ausência
  de PostgreSQL no ambiente desta auditoria — comportamento documentado, não falha), CI configurado para
  Node 20.x/22.x.
- Módulo Jurídico: Processos Judiciais, Notificações, Honorários (extrajudicial e judicial), Distratos,
  Transferência Intermediada, Prazos (Legal Deadline) e Atenção/Minha Semana são reais, com dado
  sincronizado do Monday (agora **35 boards habilitados**, não mais 7 — ver correção abaixo), filtros
  server-side, paginação e trilha de auditoria.
- **Correção (ver Nota de reconciliação acima): já existe um ambiente de demonstração real provisionado**
  (Fly, app `patrono-legal-demo` + Postgres `patrono-legal-demo-db`, 1 GB de RAM após correção de
  instabilidade), com `Dockerfile`/`fly.toml`/`docs/DEMO_DEPLOY.md` versionados nesta branch. **Isto não
  fecha H11/PG-22** — o próprio `docs/DEMO_DEPLOY.md` declara explicitamente que é um ambiente temporário
  de demonstração, não uma decisão de infraestrutura de produção, e `docs/PRODUCTION_GATE.md` continua
  listando H11 como aberto.

**O que é demo/piloto controlado:** a fundação inteira está classificada pelo próprio projeto como
"aguardando homologação" — implementada e testada tecnicamente, mas sem assinatura formal de negócio, e
o gate de produção do próprio projeto (`docs/PRODUCTION_GATE.md`) está, na data desta auditoria,
**NO-GO**, com 4 P0 e 4 P1 abertos por decisão/infraestrutura (não por falta de código).

**O que é placeholder** (linguagem honesta no próprio código, nunca dado fictício apresentado como real):
Têmis, Ivo, Documentos, Lixeira, Central de Inconsistências, e — **corrigido na reconciliação desta
auditoria** — só **4 dos ~33 módulos do menu Jurídico realmente não têm fonte** (`Contratos`,
`Riscos/Regulatório`, `Recuperação` como item de menu Monday, `Fatos Relevantes`), mais o item `Comitê`
como entrada de menu (removido de propósito por ser 404 legado). Os outros ~28 — incluindo Processos
Administrativos, BOs, Audiências, Processos de Parceiros, Retomadas, Protestos, Cessão de Direitos,
Análise Jurídica, os três tipos de contrato de prestador/ADM/obra, Cartório/Prefeitura, Procurações,
Convenções, Proposta de Terreno, Rocsil, FGlass/Tetus, as 3 fontes de Entrega de Chaves, Pesquisas,
Acessos, Contas a Pagar, Sócio e Melhorias — **têm board Monday real, habilitado, sincronizado e ligado à
tela genérica** (`legal-source-catalog.js` → `server.js` → `public/app.js`), como a primeira versão desta
auditoria deveria ter confirmado e não confirmou (ver seção 2, letra B, para a matriz corrigida módulo a
módulo). Continuam placeholder, à parte do Jurídico: praticamente todo o menu de TI além do
dashboard-raiz, e as três telas do dashboard corporativo (`strategy`, `risks`, e — mais relevante —
`projects`, cujo dashboard executivo está 100% `integration_pending` mesmo a API de projetos sendo real).

**O que não existe de forma alguma:** Grupo VELKOR (nenhuma linha de código, nenhuma referência em
nenhum arquivo `.js`/`.css` do frontend — grep vazio para "VELKOR", "Soluções Imobiliárias", "Seguros",
"Correspondente Bancário", "VELKOR Finance", "Conselho"), Patrono IA/Têmis/Ivo funcionais (zero endpoint,
zero integração — por **decisão explícita registrada**, não esquecimento), Comitês como sistema real
(pauta/ata/decisão) — existe apenas uma seção de dashboard chamada "Visão para Comitê", entidades
Person/Organization/Contract/Document/Financial Obligation, cadastro de Empresa/SPE (`companyId`/`speId`
existem no schema, dormentes — ver CFA-13), infraestrutura de deploy **de produção** (a de demonstração
já existe nesta branch — `Dockerfile`/`fly.toml`/`docs/DEMO_DEPLOY.md`, app Fly `patrono-legal-demo`
provisionado —, mas é declarada explicitamente como não-produção), um ambiente de **staging durável e
reutilizável** para todo o produto (dev/staging/produção como infraestrutura segregada real), PWA (sem
manifest, sem service worker).

**Principais blockers (produção):** persistência ✅ resolvida; sessões/autenticação ✅ resolvida;
headers/CSP ✅ resolvido; rate limiting ✅ resolvido — o que resta é majoritariamente
**operacional/infraestrutural, não de código de negócio**: retenção/legal hold (H8, não iniciado), 2
vulnerabilidades altas de dependência sem correção (`pptxgenjs`/`image-size`, H9 não iniciado),
armazenamento externo real de backup (H5 parcial), agregador de log real (H6 parcial),
canal/responsável de incidente nomeado (H7 parcial), e **infraestrutura de deploy de produção como
código** (H11, PG-22) — que agora tem um ponto de partida real e testado em ambiente de demonstração
(`Dockerfile`/`fly.toml` desta branch), mas que os próprios documentos do projeto (`docs/DEMO_DEPLOY.md`)
tratam explicitamente como não-equivalente a uma decisão de infraestrutura de produção.

**Produção: NO-GO**, confirmado pelo próprio gate do projeto e reconfirmado por esta auditoria — nenhum
achado desta rodada muda esse veredito, mas dois achados novos (seção 3) mereciam estar no mesmo nível
de rigor.

**Caminho crítico:** (1) decidir formalmente se o Sprint 3 abre com foco em fechar H8/H9/H11 (produção do
que já existe) ou em expandir escopo (TI/Executivo/VELKOR) — este documento recomenda **fechar antes de
expandir**; (2) contratar/provisionar infraestrutura real (Postgres gerenciado, storage externo, canal de
alerta, hospedagem) — nenhum desses é um problema de código; (3) só então autorizar uma nova onda de
módulos de negócio.

---

## 2. Matriz de Módulos

Convenção de status (obrigatória, conforme solicitado):
`1` Funcional e validado · `2` Funcional, mas pendente de QA visual · `3` Parcialmente funcional ·
`4` Estrutura preparada/placeholder · `5` Bloqueado por integração externa · `6` Não implementado ·
`7` Com bug · `8` Descontinuado/não deve existir.

**Nota sobre "QA visual":** o repositório não declara nenhuma ferramenta de teste E2E/browser em
`package.json` (nenhum Playwright/Cypress/Percy como dependência). Toda a suíte automatizada de 454
testes (nesta branch) é unitária ou HTTP direto (`node:test` + `http.createServer`). **Correção:** houve,
sim, uma sessão real de validação por navegador com Playwright, mas **ad-hoc/efêmera** — não commitada
como dependência nem repetível em CI (`docs/LEGAL_COMMITTEE_READINESS.md`, seção 10: login, Dashboard,
Processos, Prazos, Atenção, Minha Semana, Contratos, todos abertos manualmente num navegador real, com
usuário `colaborador`, sem erro de console/rede). Por isso, o módulo Jurídico central tem, sim, uma
validação visual real registrada — mas **pontual e não automatizada**, não uma suíte E2E que rode a cada
mudança. Os demais módulos (TI, Executivo, Administração) não têm nenhuma validação visual registrada,
automatizada ou manual. Uma segunda rodada de revisão humana ocorreu para a
selo apenas para as telas revisadas naquela rodada — indicado abaixo como "2*".

### A. Executivo / Diretoria

| Módulo | Status | Dados | QA | Prioridade | Dependência | Esforço |
|---|---|---|---|---|---|---|
| Painel Executivo COEVO (`executive`) | 3 | Real (financeiro+Monday) + seed (agenda) misturados sem aviso visual | Não | P1 | Dados de agenda reais | M |
| Indicadores corporativos (`department-summary`, `budget-comparison`) | 3 | Real | Não | P2 | — | S |
| Cards departamentais | 3 | Real | Não | P2 | — | S |
| Orçamento consolidado (`budget` dashboard) | 3 | Jurídico real; TI provisório | Não | P1 | Orçamento real de TI | M |
| Composição por departamento | 3 | Real | Não | P2 | — | S |
| Decisões e compromissos (`decision-list`) | **4 (corrigido de bug para placeholder honesto)** | Vazio (coleção `committees` sem dado real) | Não | P2 | Ver achado CFA-01 | S |
| Filtros (competence/period/departments) | 3 | — | Não | P2 | — | S |
| Drilldowns (`openDashboardDrilldown`) | 2 | Real (Jurídico) | Não | P2 | — | S |
| Widgets em `integration_pending` (strategy/risks/parte de projects) | 4 | Nenhum | N/A | P2 | Fonte de dado a definir | L |
| Permissões de Diretoria (`dashboardRequiresGlobalScope`) | 1 | — | Sim (teste HTTP real) | — | — | — |
| Risco de agregação incorreta cross-empresa/SPE | 1 (corrigido) | — | Sim | — | — | — |
| Próximos compromissos (`upcoming-deadlines`) | **2 (corrigido nesta branch)** | Real (agenda), agora com filtro por data civil | Não | — | Ver achado CFA-02 | — |
| Centro de Comando (nome do MASTER_HANDOFF) | 6 | — | — | P3 | Decisão de rebranding de tela | S |
| Minha Semana (existe, mas só sob Jurídico) | 3 | Real | Não | P2 | Mover/duplicar para Executivo | S |
| Estratégia & Projetos (`strategy`) | 4 | Nenhum | N/A | P2 | Fonte de indicadores estratégicos | L |
| Decisões & Aprovações (como conceito do MASTER_HANDOFF) | 6 | — | — | P2 | Modelagem de `Decision`/`Approval` | L |
| Performance (Executivo) | 6 | — | — | P3 | — | M |
| Agenda (Executivo) | 4 | Seed/provisório (2 compromissos) | Não | P1 | Ver achado CFA-03 | S |
| Relatórios | 6 | — | — | P3 | — | L |

### B. Jurídico

> **Correção material desta seção (reconciliação pós-entrega, 2ª rodada):** a primeira versão desta
> matriz subestimou gravemente o Jurídico. Confirmado por leitura direta de `legal-source-catalog.js`,
> `public/app.js` (`LEGAL_MODULES`, `DEPARTMENT_MODULES`, `LEGAL_MODULES_WITHOUT_SOURCE`) e `server.js`
> (`MONDAY_BOARDS = Object.fromEntries(enabledMondaySources()...)`, `LEGAL_MODULES = new
> Set([...Object.keys(MONDAY_BOARDS), 'honorariosJudiciais'])`): **as 35 fontes do catálogo (34
> habilitadas + 1 duplicata desabilitada) estão TODAS ligadas**, de ponta a ponta, ao menu visível
> (`DEPARTMENT_MODULES.Jurídico`), ao allowlist do backend (`/api/legal/:module`) e à tela genérica real
> de listagem/filtro (`legalDetailPage()`/`legalTable()`), que busca dado real via
> `GET /api/legal/<key>`. **Apenas 5 itens do menu genuinamente não têm fonte** — confirmado por não
> existirem no catálogo: `contratos`, `riscos-regulatorio`, `recuperacao` (o item de menu; o projeto
> estratégico de Recuperação de Crédito em si é outra coisa, com API própria), `fatos`, e o item `comite`
> (removido do menu visível de propósito, por ser 404 legado — `LEGAL_MODULES_WITHOUT_SOURCE` no código).
> Isso muda a classificação de ~28 linhas abaixo, de "não implementado"/"placeholder" para "real, com dado
> sincronizado, pendente apenas de QA visual por módulo" (status `2`). **O que não mudou:** nenhum desses
> 28 módulos tem tela especializada própria (usam a mesma tela genérica de filtro/tabela); nenhum teve QA
> visual manual dedicada (a rodada de `docs/LEGAL_COMMITTEE_READINESS.md` cobriu só um subconjunto,
> marcado `2*` abaixo); a sincronização real reportada (`docs/DEMO_CURRENT_STATE.md`) confirma "35 boards
> processados, 0 falhas", mas só documenta o **volume de registros de 11 dos 35 boards** como amostra —
> para os demais, "sem falha" não é o mesmo que "confirmei o volume exato", e isso está anotado onde
> relevante.

| Módulo | Status | Dados | QA | Prioridade | Dependência | Esforço |
|---|---|---|---|---|---|---|
| Visão Jurídica (dashboard `legal`) | 2* | Real | Manual (comitê) | P2 | — | S |
| Processos Judiciais | 2* | Real (Monday, 273→280 registros entre snapshots) | Manual (comitê) | P2 | — | S |
| Processos Administrativos | **2 (corrigido de placeholder)** | Real — board `5877003779` habilitado, sincronizado, tela genérica | Não | P2 | — | S |
| Processos de Parceiros | **2 (corrigido de não implementado)** | Real — board `6342187473` | Não | P2 | — | S |
| Boletim de Ocorrência | **2 (corrigido de não implementado)** | Real — board `18378845322` | Não | P2 | — | S |
| Audiências | **2 (corrigido de não implementado)** | Real — board `18422526820` | Não | P2 | — | S |
| Prazos (Legal Deadline) | 2* | Real, canônico, com histórico/auditoria | Sim (unit+HTTP) | P2 (QA visual) | — | S |
| Atenção | 2* | Real | Sim (unit+HTTP) | P2 (QA visual) | — | S |
| Minha Semana | 2* | Real (Legal Deadline; Calendar bloqueado) | Sim (adapter) | P2 (QA visual) | H10 (OAuth Google) para Calendar | S |
| Notificações Clientes | 2* | Real (Monday, 1.074→1.129 registros entre snapshots) | Manual (comitê) | P2 | — | S |
| Notificações (Empresas) | **2 (corrigido de não implementado)** | Real — board `6814664713` | Não | P2 | — | S |
| Contratos (menu genérico) | 4 (confirmado sem fonte) | Nenhum — não existe no catálogo | N/A | P1 | Board Monday dedicado / entidade `Contract` | M |
| Demandas Jurídicas (conceito MASTER_HANDOFF, sem módulo de menu correspondente) | 6 | — | — | P3 | Modelagem | L |
| Protestos | **2 (corrigido de não implementado)** | Real — board `7787216106` | Não | P2 | — | S |
| Cessão de Direitos — Bella Vida | **2 (corrigido — item ausente da 1ª versão desta matriz)** | Real — board `6157336222` | Não | P2 | — | S |
| Transferência Intermediada | 2* | Real (Monday, 25 registros) | Manual | P2 | — | S |
| Recuperação de Crédito (item de menu Monday) | 4 (confirmado sem fonte) | Nenhum — não existe no catálogo | N/A | P2 | — | S |
| Recuperação de Crédito (projeto estratégico, `/api/projects`) | **5** | Estrutura real (governança/API), indicadores financeiros bloqueados | Não | P1 | Sienge (financeiro) | L |
| Distratos e Desistências | 2* | Real (Monday, board `18404493605`, 38→48 registros entre snapshots) | Manual | P2 | — | S |
| Retomadas | **2 (corrigido — tem board PRÓPRIO, não é "não separado de Distratos")** | Real — board `18413057491`, distinto do de Distratos | Não | P2 | — | S |
| Entrega de Chaves — Carpe Diem | 2* | Real (Monday, board `18410779605`, 112→135 registros entre snapshots) | Manual | P2 | — | S |
| Entrega de Chaves — Vita Village | **2 (corrigido — item ausente da 1ª versão desta matriz)** | Real — board `6012535974`, 116 registros no snapshot da demo | Não | P2 | — | S |
| Entrega de Chaves — Aurora Residence | **2 (corrigido — item ausente da 1ª versão desta matriz)** | Real — board `6689135722`, 290 registros no snapshot da demo | Não | P2 | — | S |
| Duplicata Entrega de Chaves Carpe Diem | **8 (desabilitada por decisão, não é gap)** | `enabled:false` no catálogo — sem conteúdo exclusivo identificado | N/A | — | — | — |
| Regularização Imobiliária → Cartório e Prefeitura | **2 (corrigido de não implementado)** | Real — board `5831481667` | Não | P2 | — | S |
| Regularização Imobiliária → Procurações | **2 (corrigido de não implementado)** | Real — board `6022129654` | Não | P2 | — | S |
| Regularização Imobiliária → Alterações Convenções de Condomínio | **2 (corrigido de não implementado)** | Real — board `9099172459` | Não | P2 | — | S |
| Regularização Imobiliária → Proposta de Terreno | **2 (corrigido de não implementado)** | Real — board `5800554561` | Não | P2 | — | S |
| Honorários Extrajudiciais | 2* | Real (Monday, 894→917 registros entre snapshots) | Manual | P2 | — | S |
| Honorários Judiciais | 2* | Real (derivado de `HONORÁRIOS EFETIVADOS`) | Manual | P2 (sem filtros equivalentes ao extrajudicial) | — | S |
| Compra e Venda / Contratos para Clientes (dado) | 2* | Real (Monday, board `5821473011`, 1.404→1.430 registros entre snapshots) | Manual | P2 | — | S |
| Personalização (unidades — módulo Jurídico) | **2 (corrigido — havia sido confundido com preferência de dashboard, item distinto)** | Real — board `6035477812` | Não | P2 | — | S |
| Personalização de dashboard (preferência de widget, distinto do módulo acima) | 1 | — | Sim (HTTP) | — | — | — |
| Análise Jurídica | **2 (corrigido de não implementado)** | Real — board `5877009296` | Não | P2 | — | S |
| Contratos Prestadores de Serviço | **2 (corrigido de não implementado)** | Real — board `7602547683` | Não | P2 | — | S |
| ADM Contratos Prestadores | **2 (corrigido de não implementado)** | Real — board `8734722297`, 457 registros no snapshot da demo | Não | P2 | — | S |
| Obra — Contrato de Prestação de Serviço | **2 (corrigido de não implementado)** | Real — board `5800267760`, 459 registros no snapshot da demo | Não | P2 | — | S |
| Contrato de SCP/SPE (item de menu Monday) | **2 (corrigido de não implementado)** | Real — board `5800443639` | Não | P2 | — | S |
| SCP/SPE (segregação de escopo por empresa/SPE no schema — achado distinto do item acima) | 4 (dormente) | `companyId`/`speId`/`scopeType` existem nas tabelas relacionais, nunca populados por nenhuma rotina real — ver CFA-13 | N/A | P1 | Decisão de negócio (D3, cadastro de Empresa/SPE) | L |
| Rocsil | **2 (corrigido de não implementado)** | Real — board `9775979756` | Não | P2 | — | S |
| FGlass e Tetus Locação | **2 (corrigido de não implementado)** | Real — board `4957387842` | Não | P2 | — | S |
| Pesquisas | **2 (corrigido de não implementado)** | Real — board `9535379620` | Não | P2 | — | S |
| Pesquisas Vitor | **2 (corrigido — item ausente da 1ª versão desta matriz)** | Real — board `8352118420` | Não | P2 | — | S |
| Acessos (módulo Jurídico — controle de acessos, Monday) | **2 (corrigido — havia sido confundido com fila de aprovação de usuários, módulo distinto)** | Real — board `7377724937` | Não | P2 | — | S |
| Acessos/Aprovação de usuários (Administração — achado distinto do item acima) | 3 | Real (fila de aprovação) | Sim (HTTP) | P2 | UI de gestão completa | M |
| Contas a Pagar | **2 (corrigido de não implementado)** | Real — board `5876625743` | Não | P2 | — | S |
| Sócio — Gilmar Arantes | **2 (corrigido — item ausente da 1ª versão desta matriz, rotulado genericamente "Sócios")** | Real — board `8725280592` | Não | P2 | — | S |
| Melhorias — Notificações Clientes | **2 (corrigido de não implementado)** | Real — board `18427640622` | Não | P2 | — | S |
| Fatos Relevantes | 4 (confirmado sem fonte) | Nenhum — não existe no catálogo, mensagem honesta na UI | N/A | P2 | Board Monday | M |
| Riscos/Regulatório | 4 (confirmado sem fonte) | Nenhum — não existe no catálogo, mensagem honesta na UI | N/A | P2 | Modelagem de risco | M |
| Comitê (item de menu dedicado, removido da navegação visível) | **8** | — | — | P2 | Já removido do menu por 404; ver achado CFA-04 | S |
| Comitê (seção embutida no dashboard) | 2* | Real (Legal Deadline + processos) | Manual (comitê real, 12/09) | P2 | — | S |
| Têmis (assistente IA) | 4 | Nenhum, por decisão | N/A | — (fora de escopo) | AI_GOVERNANCE.md | — |
| Integração Monday (Jurídico) | 1 | Real, ativo, **35 boards habilitados** (corrigido de 7) | Sim | — | — | — |

### C. Tecnologia / TI

| Módulo | Status | Dados | QA | Prioridade | Dependência | Esforço |
|---|---|---|---|---|---|---|
| Painel Executivo TI (`ti` dashboard) | 3 | Orçamento real; demais widgets `integration_pending` | Não | P1 | Sistema de projetos/chamados de TI | L |
| Projetos (TI, `ti-projects` widget) | 4 | `integration_pending` | N/A | P2 | Sistema de projetos de TI | M |
| Chamados (`ti-tickets` widget e menu `ti-chamados`) | 4 | `integration_pending` / stub de menu | N/A | P1 | Sistema de chamados (ITSM) | L |
| Sistemas & Licenças (`ti-sistemas`, `ti-licencas`) | 4 | Nenhum | N/A | P2 | CMDB | L |
| Infraestrutura (`ti-infraestrutura`) | 4 | Nenhum | N/A | P2 | CMDB | L |
| Segurança (`ti-seguranca`, menu) | 4 | Nenhum | N/A | P2 | — | M |
| Governança de TI (`ti-governanca`) | 4 | Nenhum | N/A | P2 | — | M |
| IA & Automações (`ti-ia`) | 4 | Nenhum, por decisão | N/A | — | AI_GOVERNANCE.md | — |
| Fornecedores (`ti-fornecedores`) | 4 | Nenhum | N/A | P3 | — | M |
| Indicadores (`ti-progress`, `ti-quality`) | 4 | `integration_pending` | N/A | P2 | Roadmap/CMDB reais | M |
| Próximos compromissos (`ti-deadlines`) | **7 (bug confirmado)** | Real (agenda), sem filtro passado/futuro | Não | **P1** | Ver achado CFA-02 | S |
| Orçamento TI | 3 | Provisório (cadastro de homologação, não planilha oficial) | Não | P1 | Fonte oficial de orçamento TI | M |
| CTAs quebrados em TI | 6 (nenhum encontrado) | — | — | — | Ver seção 10 | — |
| Ivo (assistente IA de TI) | 4 | Nenhum, por decisão | N/A | — | AI_GOVERNANCE.md | — |
| Performance (TI) | 6 | — | — | P3 | — | M |
| Comitê TI | 6 | — | — | P3 | Generalizar mecanismo do Comitê Jurídico | M |

### D. Engenharia / Obras

| Módulo | Status | Dados | QA | Prioridade | Dependência | Esforço |
|---|---|---|---|---|---|---|
| Painel Executivo Engenharia/Obras (`engineering`) | **5** | 100% `integration_pending` (confirmado em código: todos os 4 widgets) | N/A | P2 | Sienge | XL |
| Indicadores/progresso/orçamento/riscos/qualidade | 5 | Idem acima | N/A | P2 | Sienge | XL |
| Navegação/permissões | 3 | O item de menu departamental existe (`dashboardRequiresGlobalScope`/`allowedInDepartment` cobrem `engineering` como módulo genérico `central`) | Não | P3 | — | S |
| Telas específicas de obra (fora do dashboard) | **não mapeado nesta rodada** | — | — | — | Auditoria dedicada recomendada | — |

> Nota de honestidade: esta auditoria confirmou por código que o *dashboard* de Engenharia/Obras existe
> e está 100% em `integration_pending`. Não foi feita uma varredura exaustiva de telas de menu
> específicas de Engenharia além do dashboard — o item "Telas específicas de obra" acima está marcado
> como não mapeado em vez de presumido ausente ou presente.

### E. Estratégia & Metas

| Item | Status | Dados | QA | Prioridade | Dependência | Esforço |
|---|---|---|---|---|---|---|
| Existência real (dashboard `strategy`) | 4 | 100% `integration_pending` (confirmado em código) | N/A | P2 | Fonte de dado estratégico | L |
| CRUD de metas | 6 | — | — | P2 | Modelagem (`Objective`/`Goal`) | L |
| Indicadores/progresso/responsáveis | 6 | — | — | P2 | — | L |
| Integração com Projetos | 6 | — | — | P3 | — | M |
| Permissões | 1 (herdada) | — | — | — | `dashboardRequiresGlobalScope` já cobre | — |
| Trilha de auditoria | 1 (herdada, quando houver dado) | — | — | — | — | — |

### F. Projetos

| Item | Status | Dados | QA | Prioridade | Dependência | Esforço |
|---|---|---|---|---|---|---|
| Portfólio (`/api/projects`, tela de portfólio) | 2 | Real | Não | P2 | — | S |
| Projeto individual (detalhe) | 2 | Real | Não | P2 | — | S |
| Responsáveis / meta / baseline | 3 | Parcial (governança sim; metas financeiras não) | Não | P2 | — | M |
| Indicadores/progresso/riscos/marcos/ações | 3 | API real; UI **predominantemente de leitura** (achado CFA-05) | Não | **P1** | — | M |
| Gráficos/resultados | 4 | Não confirmados nesta rodada | N/A | P2 | Verificação dirigida | M |
| Dashboard executivo de Projetos (`projects` dashboard) | **7 (bug/gap confirmado)** | `integration_pending` mesmo com API real (achado CFA-06) | N/A | **P1** | Conectar dashboard a `/api/projects` | M |
| Projeto "Aumento da Recuperação de Crédito" | 5 | Estrutura real; financeiro bloqueado por Sienge | Não | P1 | Sienge | L |
| Links com módulos de origem | 3 | Parcial (Legal Deadline↔Processo sim; recuperação↔processo pendente) | Não | P2 | — | M |
| Botões/navegação | 2 | Sem CTA morto encontrado | — | — | — | — |

### G. Orçamento

| Item | Status | Dados | QA | Prioridade | Dependência | Esforço |
|---|---|---|---|---|---|---|
| Dados por departamento | 3 | Jurídico real; TI provisório | Não | P1 | Fonte oficial de TI | M |
| Consolidado (`budget` dashboard) | 3 | Ver acima | Não | P1 | — | M |
| Fontes/saldo/forecast/execução | 3 | Jurídico: real (planilha); forecast é valor informado, não algoritmo | Não | P2 | — | M |
| Filtros/permissões | 1 | — | Sim (HTTP) | — | — | — |
| Risco de totalização errada | 1 (mitigado) | — | Sim | — | Correção pós-PR#5 (`scopedRecordList`) | — |
| Valores nulos | 1 (tratado) | `financeRows()` usa `Number.isFinite` explicitamente, nunca converte ausência em zero | — | — | — | — |
| Importação de orçamento (CSV) | 2 | Real, com bloqueio de escopo cross-departamento | Sim (HTTP) | — | RFC 4180 não implementado no parser (achado CFA-07) | S |
| Drilldown | 2 | Real (Jurídico) | Não | P2 | — | S |

### H. Indicadores & Relatórios

| Item | Status | Dados | QA | Prioridade | Dependência | Esforço |
|---|---|---|---|---|---|---|
| Telas existentes | 4 | Menu "Indicadores"/"Relatórios" cai no placeholder genérico | N/A | P2 | Definição de escopo de negócio | L |
| Widgets | 3 | Ver seção A/dashboards | — | — | — | — |
| Relatórios reais | 6 | — | — | P2 | — | L |
| Exportações (PPTX/PDF de apresentações) | **5 (dependência de risco)** | Real (`pptxgenjs`/`pdfkit`), mas com 2 vulnerabilidades altas não corrigidas | Sim (auditado) | **P1** | H9 (correção/downgrade de dependência) | M |
| Filtros/memória de cálculo | 1 | Todo widget carrega `memory()` com fonte/competência/regra/registros | — | — | — | — |
| Estado vazio | 1 | `empty`/`integration_pending`/`error`/`forbidden`/`loading` são estados de primeira classe, com rótulo e sem dado fictício | — | — | — | — |
| Dados inventados | 1 (não encontrado) | Nenhum dado fictício encontrado em nenhuma tela | — | — | — | — |

### I. Comitês & Reuniões

| Item | Status | Dados | QA | Prioridade | Dependência | Esforço |
|---|---|---|---|---|---|---|
| Navegação para Comitê (item de menu dedicado) | **8 (descontinuado)** | — | — | P2 | Removido por ser 404; ver CFA-04 | — |
| Comitê por departamento (Jurídico) | 2* | Real (seção "Visão para Comitê") | Manual (12/09) | P2 | — | S |
| Comitê por departamento (TI, Conselho VELKOR) | 6 | — | — | P3 | Generalizar mecanismo do Jurídico | M |
| Pauta | 6 | — | — | P3 | Modelagem (`Agenda Item`/`Meeting`) | L |
| Apresentação executiva (export) | 2 | Real, auditado | Sim | P1 (vulnerabilidade da lib) | H9 | — |
| Atas | 6 | — | — | P3 | Modelagem `Meeting`/`Document` | L |
| Decisões (registro formal) | 4 | Coleção `committees` existe e é gravável (`POST /api/committees`), mas sem UI de captura de decisão estruturada | N/A | P1 | Ver achado CFA-01 (decision-list) | M |
| Compromissos | 3 | Ver Agenda | — | — | — | — |
| Agenda (do comitê) | 4 | Seed/provisório | N/A | P2 | — | S |
| Filtros/exportação | 2 | Export real (ver acima) | — | — | — | — |
| Origem dos dados | 1 (transparente) | Toda seção mostra `memory()`/fonte | — | — | — | — |
| Estados vazios | 1 | — | — | — | — | — |
| Histórico | 4 | Estrutura preparada (`store.committees` é histórico bruto), sem UI de consulta histórica dedicada | N/A | P2 | — | M |

### J. IA & Inteligência

| Item | Status | Dados | QA | Prioridade | Dependência | Esforço |
|---|---|---|---|---|---|---|
| Tela IA (`ia`, cards estáticos) | 4 | Nenhum | N/A | — (fora de escopo por decisão) | `docs/AI_GOVERNANCE.md` | — |
| Têmis | 4 | Nenhum | N/A | — | idem | — |
| Ivo | 4 | Nenhum | N/A | — | idem | — |
| Contexto real / permissões / segregação departamental | 6 | — | — | — | Nenhuma IA implementada para avaliar | — |
| Recomendações / ações críticas / confirmação humana | 6 | — | — | — | idem | — |
| Dados sensíveis / auditabilidade / risco de alucinação | 6 | — | — | — | idem | — |

### K. Governança

| Item | Status | Dados | QA | Prioridade | Dependência | Esforço |
|---|---|---|---|---|---|---|
| Auditoria & Compliance (tela `logs`) | 2 | Real (`/api/audit`), redação de `before`/`after` por alçada | Sim (HTTP) | — | — | — |
| Compliance (`/api/compliance`) | 3 | API real, restrita a alçada global; **sem tela de frontend dedicada** | N/A | P2 | ADR-007 (dono/módulo definitivo pendente) | M |
| Riscos | 4 | Apenas sub-seção dentro do projeto de Recuperação, vazia | N/A | P2 | Modelagem de `Risk` transversal | L |
| Central de Inconsistências | 4 | Placeholder explícito | N/A | P2 | — | L |
| Integrações | 3 | Ver seção S | — | — | — | — |
| Logs | 2 | Real, estruturado (H6) | Sim (33/33) | P1 | Agregador real (H6 parcial) | — |
| Trilha de auditoria | 1 | Append-only, testado | Sim | — | — | — |
| Decisões (como registro de governança) | 4 | Ver Comitês | — | — | — | — |
| Acessos | 3 | Fila de aprovação real; sem CRUD completo de usuário na UI | Sim (HTTP) | P2 | UI de administração de usuários | M |
| Eventos/erros | 2 | Reais via `observability/logger.js`, sem agregador de produção | — | P1 | H6/H11 | — |
| Segregação de funções | 1 | "Administrador técnico ≠ superusuário de conteúdo" — testado extensivamente (7 rodadas) | Sim | — | — | — |

### L. Utilitários

| Item | Status | Dados | QA | Prioridade | Dependência | Esforço |
|---|---|---|---|---|---|---|
| Agenda | 4 | Seed/provisório (2 compromissos) | N/A | P1 | Ver CFA-02/CFA-03 | S |
| Calculadora | 2 | Funcional (rótulos/labels confirmados), utilitário autocontido | Não | P3 | — | — |
| Documentos | 4 | Placeholder explícito | N/A | P2 | Entidade `Document`/`File Reference` (não existe) | L |
| Lixeira | 4 | Placeholder explícito (soft-delete/`deletedAt` existe no backend, sem UI de restauração/consulta) | N/A | P2 | — | M |
| Meu Perfil | **não confirmado nesta rodada** | — | — | — | Endpoints de troca de senha/MFA existem no backend (H2); UI dedicada não foi localizada pelos agentes desta auditoria — recomenda-se verificação dirigida | S |
| Configurações | 4 | Placeholder (cai no genérico) | N/A | P2 | — | M |

### M. Administração

| Item | Status | Dados | QA | Prioridade | Dependência | Esforço |
|---|---|---|---|---|---|---|
| Usuários & Permissões (cadastro) | 3 | Real (fila de solicitação/aprovação) | Sim (HTTP) | P2 | UI de gestão completa (editar/inativar) | M |
| Aprovação | 1 | Real, testado | Sim | — | — | — |
| RBAC / scopes | 1 | Muito maduro — 4 dimensões, 7 rodadas de correção | Sim | — | — | — |
| Departamentos | 3 | Real (Jurídico/TI); sem tela de CRUD de departamento | Sim (backend) | P2 | — | M |
| Roles | 4 | Definidos em código (`ROLES`), sem UI de administração de papéis | N/A | P2 | — | M |
| Inativação | 1 (backend) | `deletedAt`, revoga sessão | Sim | P2 (sem UI dedicada) | — | S |
| Reset de senha | 1 (backend) | Fluxo real (token único, sem e-mail integrado — entrega fora de banda) | Sim | P1 | Provedor de e-mail real | M |
| MFA | 1 (backend) | TOTP individual, real | Sim | P2 (sem UI de gestão administrativa de MFA de terceiros) | — | M |
| Configuração (ambiente/segredos) | 1 (via env/CLI) | — | — | — | Sem UI — correto para segredos | — |
| Backup & Restauração | 3 | Mecanismo real e testado (H5); sem UI de acompanhamento além de `docs`/scripts | Sim (18/18) | P1 | H5 parcial (offsite real) | — |
| Logs/auditoria | 2 | Ver Governança | — | — | — | — |
| Ambientes & Empresas | 6 | — | — | P1 | Cadastro de empresa/SPE (D3 pendente) | L |
| Perfis & Permissões (tela) | 6 | — | — | P2 | — | M |
| Parâmetros & Catálogos | 6 | — | — | P3 | — | M |

### N. Autenticação e Segurança

| Item | Status | Evidência | Prioridade |
|---|---|---|---|
| Login | 1 (técnico) — aguardando homologação de negócio | H2, testado | — |
| MFA | 1 (técnico) — aguardando homologação | TOTP/RFC 6238, testado contra vetores oficiais | — |
| Sessões | 1 (técnico) | `auth_sessions` (Postgres), sobrevive a restart | — |
| Expiração | 1 | `SESSAO_*`/`credentials_version` | — |
| Logout / logout-all | 1 | Testado, revoga no servidor | — |
| Reset de senha | 1 (backend) | Token único; falta provedor de e-mail real | P1 |
| Lockout | 1 | `failed_login_count`/`locked_until`, anti-enumeração (mesmo `401` para bloqueada) | — |
| Rate limiting | 1 | H3, distribuído via Postgres, testado | — |
| CORS | 1 | H4, allowlist explícita, `Origin: null` sempre negado | — |
| CSP | 1 | H4, auditada a partir do frontend real | — |
| Headers | 1 | HSTS/X-Frame-Options/Referrer-Policy/Permissions-Policy | — |
| Secrets | 1 | Nunca no frontend/log — verificado por teste automatizado + varredura manual | — |
| User enumeration | 1 (corrigido) | Resposta genérica em forgot-password; 401 uniforme para conta bloqueada | — |
| Sessão persistente | 1 | Postgres, não mais `Map()` em memória | — |
| RBAC | 1 | Muito maduro | — |
| IDOR/BOLA | 1 (testado extensivamente) | `scoped()` deny-by-default, 7 rodadas de correção, testes dedicados | — |
| Technical admin ≠ content superuser | 1 | `allowedContent()` nega `administrador` em todo módulo de negócio, incl. leitura de `before`/`after` em auditoria | — |
| Scopes (módulo/ação/registro) | 1 | — | — |
| Departamento | 1 | `allowedInDepartment()` | — |
| Empresa/SPE | **4 (dormente)** | Colunas existem, nunca populadas — nenhuma regra quebra, mas a segregação não está em uso real | P1 |
| CSRF | **6 (explicitamente não fechado)** | PG-14 — mitigado estruturalmente (Bearer sem cookie), mas sem proteção dedicada; reavaliar se migrar para cookie | P2 |
| Auditoria | 1 | Append-only, testado | — |
| Vulnerabilidades de dependência | **7 (aberto)** | 2 altas em `pptxgenjs`/`image-size`, sem correção compatível | **P1** |
| Bypass de desenvolvimento (`usr-*`) | **não confirmado nesta rodada** | Testes confirmam que retorna 401; guarda exata (ex.: `NODE_ENV==='test'`) não foi lida linha-a-linha nesta auditoria — recomenda-se confirmação dirigida antes de tratar como fechado | P1 (verificação) |

### O. Banco e Persistência

| Item | Status | Evidência |
|---|---|---|
| PostgreSQL | 1 (técnico) — aguardando homologação | H1A, conectado ao runtime, fail-fast em produção sem `DATABASE_URL` |
| Migrations | 1 | 8 migrations, `schema_migrations`, testado |
| Schema | 1 | `app_store` (JSONB, ponte) + núcleo relacional (`app_users`/`legal_processes`/`legal_deadlines`/`audit_log`) |
| `app_store` (documento único) | 1 (arquitetura de ponte, deliberada) | Demais coleções (departments, financials, agenda, projetos, comitês, compliance) seguem no blob — declarado, não escondido |
| Entidades normalizadas | 3 | Só 4 do núcleo; resto no blob (H1B, deliberadamente incremental) |
| CAS/concorrência | 1 | Otimista por linha, testado com leituras concorrentes reais e 2 requisições HTTP `PATCH` simultâneas |
| Retry | 4 (não avaliado como retry de aplicação; ver observability/alert.js para retry de webhook) | — |
| Transações | 1 | Mutação + evento de auditoria persistidos juntos ou nenhum, testado com falha simulada |
| Relacionamentos/FK | 1 | `ON DELETE RESTRICT`, nunca cascade destrutivo, testado bypassando a aplicação |
| Dados órfãos | 1 (prevenido) | FK real rejeita; scripts de migração abortam por completo diante de órfão crítico |
| Fallback JSON | 1 (comportamento correto fora de produção) | `data/store.json`, nunca usado em produção (fail-fast) |
| Ambiente local | 1 | — |
| Staging | 6 | Não existe como infraestrutura separada | 
| Produção | 6 | Não provisionada | 
| Saúde do banco | 1 | `GET /api/health/ready` |
| Tabela órfã | **7 (achado)** | `users`/`audit_events` de `001_foundation.sql` nunca usadas pelo runtime (H1B criou `app_users`/`audit_log` em vez de reaproveitar) — achado CFA-08 |

### P. Infraestrutura

| Item | Status | Evidência |
|---|---|---|
| Dockerfile | **3 (corrigido)** | **Existe** nesta branch (`Dockerfile`, `.dockerignore`) — escopo explícito de demonstração, wrapper padrão Node 20/`npm ci`, nunca validado com `docker build .` dentro deste ambiente (sandbox bloqueia pull do Docker Hub — `docs/DEMO_DEPLOY.md`, seção 6.1) |
| fly.toml / config de deploy | **3 (corrigido)** | **Existe** (`fly.toml`), mas explicitamente declarado como não-produção pelo próprio `docs/DEMO_DEPLOY.md` |
| App hospedado | **3 (corrigido)** | App de demonstração `patrono-legal-demo` provisionado (reportado pelo operador, não verificado por rede a partir deste ambiente de auditoria) |
| Banco em produção | 6 | Não provisionado — o banco existente (`patrono-legal-demo-db`) é de demonstração, não de produção |
| Healthchecks | 1 | `/api/health`, `/api/health/live`, `/api/health/ready` — implementados e testados |
| Liveness/readiness | 1 | Distintos corretamente (liveness nunca toca storage) |
| Autostop | 6 | Não aplicável (sem infraestrutura) |
| Deploy | 6 | Não existe pipeline de deploy, só CI de teste |
| Rollback | 4 | Rollback de **dado** implementado (rename de schema); rollback de **versão de aplicação** não tem runbook nem mecanismo, por não haver infraestrutura de deploy |
| Logs | 2 | Estruturados, sem coleta centralizada real |
| Secrets | 1 | Via `process.env`, nunca no código/log |
| Escalabilidade | 4 | Scheduler do Monday em processo único, não pronto para múltiplas instâncias (achado histórico, ainda válido) |
| Single point of failure | 7 (conhecido) | Scheduler único; estado de cooldown de alerta em memória por instância |
| Staging x Produção | 6 | Nenhuma separação de infraestrutura existe |

### Q. Observabilidade

| Item | Status | Evidência |
|---|---|---|
| Logs estruturados | 1 | JSON, schema fixo, testado (H6, 33/33) |
| requestId | 1 | `crypto.randomUUID()`, exposto via `X-Request-Id` |
| Correlação | 1 | `requestId` propagado em todo log da requisição |
| Alertas | 3 | Mecanismo real (webhook HMAC, cooldown, threshold de 5xx); **nenhum destino real configurado** |
| HTTP 5xx | 1 | Threshold real (não alerta em 500 isolado), testado |
| uncaughtException/unhandledRejection | 1 | Capturados, nível FATAL, alertável |
| Monday scheduler | 2 | Eventos de sync logados; sem alerta dedicado além do padrão `monday_sync_failed` |
| Banco | 1 | Erros de persistência logados com `requestId`/`errorCode` |
| Incident response | 3 | Processo completo documentado e testado; sem canal/responsável real parametrizado |
| Capacidade real de investigação | **5** | Bloqueada por ausência de agregador de produção (H6 parcial) e de infraestrutura (H11) |

### R. Backup / Restore

| Item | Status | Evidência |
|---|---|---|
| pg_dump / pg_restore | 1 | Reais, testados (H5, 18/18) |
| Encryption | 1 | AES-256-GCM, chave nunca logada |
| Manifests | 1 | SHA-256, integridade verificada |
| S3 | **5** | Adapter implementado, **nunca exercitado contra bucket real** (só cliente injetado em teste) |
| Offsite | **5** | Idem — bloqueado por infraestrutura, não por código |
| RPO | 1 (definido) | 6h |
| RTO | 3 (definido, não provado em escala) | 4h — demonstrado em dataset sintético, não em escala de produção |
| Evidência | 1 | `docs/BACKUP_RESTORE_RUNBOOK.md`, restauração real documentada |
| Restore real | 1 (mecanismo) / 5 (offsite) | Mecanismo local: real e testado. Offsite: nunca testado |

### S. Integrações

| Integração | Classificação exigida | Evidência |
|---|---|---|
| Monday | **Ativa** | Leitura, idempotente, agendada, server-side only, token nunca exposto (35 boards habilitados nesta branch, corrigido de 7) |
| Sienge | **Não implementada** | Nenhum cliente/API; todo campo financeiro dependente aparece como "Aguardando integração" |
| CV / Construtor de Vendas | **Não implementada** | "Aguardando credencial" na UI; campos que citam CV vêm do Monday, não de integração direta |
| Clicksign | **Não implementada** | "Aguardando credencial" na UI |
| Google Calendar | **Bloqueada** (por credencial) | Adapter somente-leitura implementado e testado; sem `GOOGLE_CALENDAR_CLIENT_ID/SECRET` reais |
| E-mail | **Não implementada** | Sem provedor integrado; reset de senha usa entrega manual de token |
| Google Drive | **Preparada** (spec), **não implementada** (código) | Citada em MASTER_HANDOFF; zero código |
| APIs futuras (OneDrive/SharePoint/WhatsApp) | **Não implementada** | Fora de escopo, apenas mencionadas na spec |

### T. UX / Interface / Navegação

Ver seção 10 (consolidação) e achados CFA-01/CFA-02/CFA-03/CFA-04/CFA-09/CFA-10.

### U. PWA / Mobile / iPad / iPhone

| Item | Status | Evidência |
|---|---|---|
| Manifest | **6** | Não existe `manifest.json` em `public/` |
| Service worker | **6** | Nenhuma referência a `serviceWorker`/`sw.js` |
| Installability | **6** | Sem `<link rel="manifest">`, sem `theme-color`, sem `apple-touch-icon` |
| Ícones | 6 | Não avaliado — não há manifest para os declarar |
| Standalone | 6 | Não existe |
| Cache/offline | 6 | Nenhum |
| Viewport | 1 | Presente e correto em `index.html`/`status.html` |
| Navegação móvel (drawer/hambúrguer) | 2 | Implementada (`toggleMobileMenu()`), sem QA visual formal |
| Tabelas em mobile | 2 | CSS responsivo real (múltiplos breakpoints), sem QA visual formal |
| Filtros em mobile | 2 | Overlay dedicado (`toggleMobileDateFilters()`), sem QA visual formal |
| iPad/iPhone | **não testado nesta rodada** | Nenhum teste em dispositivo real ou emulado foi executado |

**Conclusão desta letra:** aplicativo web responsivo real; **zero capacidade PWA**. Marcar como
pendente, conforme instruído.

### V. Documentação e Handoff

| Documento | Estado |
|---|---|
| README | Presente, aponta corretamente para a documentação |
| MASTER_HANDOFF.md | Presente, v1.3, coerente internamente, mas **divergente da implementação real em escopo** (a implementação não segue a navegação do §5; isso é esperado em construção incremental, não um erro do documento) |
| DEMO_CURRENT_STATE.md | **Presente** nesta branch (`claude/demo-staging-deploy`, `3c4c861`) — corrigido após a Nota de reconciliação. A leitura inicial desta auditoria, contra `master`, havia confirmado corretamente sua ausência ali; ele existe apenas na branch de trabalho, o que é coerente com seu próprio propósito declarado ("fotografia operacional" da demo) |
| DEMO_DEPLOY.md | **Presente** nesta branch — roteiro de deploy do ambiente de demonstração, complementar ao anterior |
| DECISIONS.md | Presente, extremamente detalhado (2158 linhas), com ADRs e decisões de negócio homologadas com data/aprovador |
| QA.md | Presente, catálogo de testes muito completo e rastreável por rodada de hardening |
| SECURITY.md | Presente, auditoria rota-a-rota completa, 38 correções numeradas |
| PRODUCTION_GATE.md | Presente, matriz GO/NO-GO, 25 achados PG-01..25, atualizado a cada hardening |
| OBSERVABILITY.md | Presente, completo |
| BACKUP_RESTORE_RUNBOOK.md | Presente, completo, com procedimento operacional |
| INCIDENT_RESPONSE.md | Presente, completo (SEV/categorias/papéis/runbooks/tabletop) |
| PERMISSIONS.md | Presente, log histórico de 38 correções de RBAC |
| DATA_MODEL.md | Presente, mapeia entidades do MASTER_HANDOFF contra implementação real, honesto sobre gaps |
| ARCHITECTURE.md / ARQUITETURA.md | Ambos presentes — **não duplicados**: um é o rastreamento técnico atual, outro é o esboço arquitetural original (pré-implementação) |
| LEGAL_COMMITTEE_READINESS.md | Presente, é o documento mais recente e mais operacional (base do commit atual) |
| SPRINT2-PLANO.md | Presente, plano + fechamento do Sprint 2 |
| PROJETO-RECUPERACAO-CREDITO.md | Presente |
| MATRIZ-RASTREABILIDADE.md | Presente, mas **desatualizada** (linguagem de estágio anterior ao Sprint 1 formal) |
| INVENTARIO.md | Presente, é a fotografia do estado herdado (pré-projeto) |
| SEGURANCA-CORRECOES.md | Presente, histórico — a maioria dos itens já superada por H1–H7, exceto os 4 sinalizados na seção 8 |
| `docs/handoff-codex/` (18 documentos) | Presente — **coleção paralela e desatualizada** (fotografia de 09/08/2026), pré-data toda a fundação de Sprint 1/2/hardening. Ver achado CFA-11. |
| Handoff de TI | **Não localizado como documento dedicado** — recomenda-se confirmação |
| Inconsistências históricas | Documentadas nesta seção acima; nenhuma contradição não explicada permanece |

### Contagem determinística da Matriz de Módulos (obrigatória, não aproximada)

Extraída programaticamente das tabelas desta seção 2 (letras A–V), lendo a segunda coluna (Status) de
cada linha de dado — não estimada, não arredondada. Método: cada linha cuja coluna "Status" começa por um
dígito `1`–`8` (ignorando `**`/`*` de formatação) entra na contagem abaixo; as demais são tratadas à
parte, nunca somadas ao total, pelos dois motivos possíveis:

**A. 288 linhas de dado no total da seção 2**, divididas em três grupos que não se misturam:

1. **253 linhas classificáveis no esquema `1`–`8`** (letras A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P,
   Q, R) — soma exatamente igual ao total deste grupo:

   | Status | 1 — Funcional e validado | 2 — Funcional, QA visual pendente | 3 — Parcialmente funcional | 4 — Placeholder/estrutura preparada | 5 — Bloqueado por integração externa | 6 — Não implementado | 7 — Com bug | 8 — Descontinuado |
   |---|---|---|---|---|---|---|---|---|
   | Linhas | 69 | 61 | 32 | 41 | 8 | 34 | 5 | 3 |

   **69+61+32+41+8+34+5+3 = 253.** (Para comparação: antes da correção do Jurídico nesta 2ª rodada, a
   contagem de `2` era ~33 e a de `4`/`6` somava ~87 só nessa letra — a diferença de ~28 linhas que
   migraram de `4`/`6` para `2` é exatamente a correção descrita na letra B.)

2. **8 linhas na letra S (Integrações)** — por instrução original desta auditoria, classificadas na
   taxonomia própria pedida (ativa/parcial/preparada/bloqueada/não implementada), não no esquema `1`–`8`
   de módulo/tela. Não somadas ao grupo acima por serem uma categoria estrutural diferente (integração,
   não módulo/tela).

3. **23 linhas na letra V (Documentação)** — descrevem o estado de um arquivo de documentação (presente/
   ausente/desatualizado), não o status funcional de um módulo/tela. Também não somadas ao grupo 1.

**B. 4 linhas explicitamente não classificáveis nesta rodada** (evidência insuficiente, marcadas como tal
em vez de presumidas em qualquer direção — nunca contadas em nenhum status acima):

| Letra | Item | Motivo de não classificar |
|---|---|---|
| D | Telas específicas de obra (fora do dashboard de Engenharia) | Não mapeado nesta rodada — só o dashboard foi confirmado por código |
| L | Meu Perfil | Nenhum agente desta auditoria confirmou uma tela dedicada; endpoints de troca de senha/MFA existem no backend |
| N | Bypass de desenvolvimento (`usr-*`) | Testes confirmam que retorna 401; a guarda exata (`NODE_ENV`?) não foi lida linha a linha |
| U | iPad/iPhone | Nenhum teste em dispositivo real ou emulado foi executado nesta auditoria |

**288 = 253 + 8 + 23 + 4.** Esta é a contagem oficial desta auditoria — qualquer número diferente citado
em texto solto neste documento (por exemplo, no resumo executivo) deve ser lido como aproximação de
prosa, e esta tabela prevalece em caso de conflito.

---

## 3. Achados P0

### CFA-P0-01 — Infraestrutura de deploy de **produção** como código continua inexistente (equivale a PG-22) — **correção: já existe infraestrutura de demonstração, mas não a fecha**
- **Módulo:** Infraestrutura (P).
- **Descrição (corrigida após a reconciliação com o estado real de `claude/demo-staging-deploy`):** esta
  branch já contém `Dockerfile`, `.dockerignore` e `fly.toml`, e um roteiro de deploy documentado
  (`docs/DEMO_DEPLOY.md`) — usados para provisionar um app Fly real de demonstração
  (`patrono-legal-demo`). **Isto não fecha PG-22/H11.** O próprio `docs/DEMO_DEPLOY.md` declara
  explicitamente: "Isto NÃO é uma decisão de infraestrutura de produção (...) H11 continua aberto", e o
  `Dockerfile` nunca teve seu `docker build .` validado dentro de nenhum ambiente de execução usado neste
  projeto (bloqueio de rede do sandbox para pull de imagens do Docker Hub — risco considerado baixo pelo
  próprio autor, mas não verificado).
- **Causa:** infraestrutura de produção (ambientes segregados, banco gerenciado de produção, domínio,
  observabilidade real) nunca foi desenhada como decisão formal — apenas um ambiente único e temporário
  de demonstração.
- **Impacto:** o deploy de demonstração já é reprodutível para aquele fim específico; **um deploy de
  produção real continua sem infraestrutura como código dedicada**, sem separação de ambientes
  (dev/staging/produção como infraestrutura, não apenas como conceito) e sem validação de build local.
- **Evidência:** `git diff` entre `master` (`cf1c918`) e `claude/demo-staging-deploy` (`3c4c861`) mostra
  `Dockerfile`/`.dockerignore`/`fly.toml`/`docs/DEMO_DEPLOY.md` como novos; `docs/PRODUCTION_GATE.md`
  continua listando H11/PG-22 como aberto, sem nenhuma atualização que o feche.
- **Correção recomendada:** (1) rodar `docker build .` localmente para validar o `Dockerfile` fora deste
  sandbox; (2) decidir formalmente se os artefatos de demonstração servem de ponto de partida para H11 ou
  se produção exige um desenho próprio (múltiplos ambientes, banco gerenciado dedicado, domínio).
- **Correção recomendada:** construir infraestrutura como código (contêiner + config de hospedagem),
  healthcheck já existe e pode ser reaproveitado.
- **Dependências:** decisão de provedor de hospedagem e de banco gerenciado.
- **Esforço:** M.

### CFA-P0-02 — Retenção / legal hold inexistente (equivale a PG-19)
- **Módulo:** Governança / LGPD.
- **Descrição:** nenhuma política de retenção, descarte ou legal hold definida para nenhuma entidade
  (auditoria, Legal Deadline, documentos, backups).
- **Impacto:** impossibilidade de responder a uma obrigação legal de retenção ou a um pedido de exclusão
  (LGPD).
- **Evidência:** `docs/PRODUCTION_GATE.md` PG-19, confirmado sem mitigação nesta auditoria.
- **Correção recomendada:** política por tipo de dado (H8), decisão de negócio, não apenas técnica.
- **Dependências:** decisão jurídica/negócio.
- **Esforço:** M (decisão) + S (implementação técnica).

### CFA-P0-03 — Resposta a incidentes sem canal/responsável real (equivale a PG-20)
- **Módulo:** Governança / Segurança.
- **Descrição:** processo de incident response completo e testado, mas `INCIDENT_PRIMARY_CHANNEL`,
  `INCIDENT_SECONDARY_CHANNEL`, `INCIDENT_SECURITY_CONTACT`, `INCIDENT_PRIVACY_CONTACT` seguem vazios,
  corretamente (nenhum valor foi inventado).
- **Impacto:** sem parametrização real, um incidente real não tem para onde escalar.
- **Correção recomendada:** decisão operacional pré-produção — nomear responsáveis e canal.
- **Esforço:** XS (é decisão, não código).

### CFA-P0-04 — Backup sem armazenamento externo real testado (equivale a PG-21)
- **Módulo:** Backup/Restore (R).
- **Descrição:** mecanismo `pg_dump`/`pg_restore` real e testado; adapter `s3` nunca foi exercitado
  contra um bucket real.
- **Impacto:** perda de dado sem recuperação viável se o único disco local falhar.
- **Correção recomendada:** provisionar bucket real e executar o teste de restore a partir dele.
- **Dependências:** infraestrutura de armazenamento de objeto.
- **Esforço:** S (uma vez que exista o bucket).

> As demais entradas de PG-01 a PG-25 já fechadas (H1A–H4) não são repetidas aqui — ver seção 8.

---

## 4. Achados P1

### CFA-02 — `ti-deadlines` não filtra por data (confirma o achado apontado) — `upcoming-deadlines` (Executivo) **já corrigido nesta branch**
- **Módulo:** C. TI (`ti-deadlines`, ainda aberto) e A. Executivo (`upcoming-deadlines`, já corrigido).
- **Descrição, confirmada tecnicamente por leitura direta do código em `3c4c861`:**
  - `dashboard-service.js:122` (TI): `const events = (store.agenda || []).filter(event => event.department === 'TI' || event.department === 'Tecnologia'); widgets['ti-deadlines'] = events.length ? ready(...) : empty(...)` — **continua filtrando apenas por departamento, nunca por data.** Um compromisso já ocorrido em janeiro aparece igual a um de dezembro, sob o rótulo "Próximos compromissos". **Ainda aberto — P1, já registrado pelo próprio projeto** em `docs/DEMO_CURRENT_STATE.md`/`docs/QA.md` ("mesma classe de bug do item 2 acima — não corrigido nesta rodada").
  - `upcoming-deadlines` (Executivo) — **já corrigido nesta branch:** passou a usar
    `deps.upcomingAgendaItems(store.agenda)` (filtro por data civil, mesma convenção `America/Sao_Paulo`
    já usada em Legal Deadline) em vez de `store.agenda` cru, e cada evento passou a receber um `target`
    real via `agendaEventTarget()` só quando de fato representa um Comitê. Confirmado em teste dedicado
    (`tests/legal-ui-p0.test.js`, citado em `docs/QA.md`, achado "Evento histórico de 12/08/2026 não deve
    mais aparecer como próximo/upcoming").
- **Impacto (residual, só em `ti-deadlines`):** um usuário do Painel de TI pode ver eventos passados
  listados como "próximos compromissos".
- **Correção recomendada:** replicar em `dashboard-service.js:122` o mesmo padrão já aplicado ao bloco
  `executive` (`deps.upcomingAgendaItems()`).
- **Esforço:** S.

### CFA-03 — Agenda (Executivo/Utilitários) exibe dado de seed sem indicação visual de que é provisório
- **Módulo:** A. Executivo / L. Utilitários.
- **Descrição:** `docs/handoff-codex/15-DADOS-REAIS-X-PROVISORIOS.md` confirma que a Agenda tem apenas
  2 compromissos de seed/local, não dado de negócio real sincronizado. Diferente dos widgets jurídicos
  (que mostram "Aguardando integração"/"Integração pendente" quando não há fonte), a Agenda não tem
  nenhum estado visual distinto para "isto é dado de demonstração" — ela aparece com o mesmo estado
  `ready` de qualquer dado real.
- **Impacto:** viola diretamente a regra do próprio pedido ("nenhum dashboard pode aparentar possuir dado
  real quando é seed/mock").
- **Correção recomendada:** ou (a) marcar visualmente registros de agenda como demonstrativos até existir
  fonte real, ou (b) mover para o estado `pending`/`integration_pending` até haver uma fonte de agenda
  real definida (cadastro manual homologado, Google Calendar, etc.).
- **Esforço:** S.

### CFA-05 — UI de Projetos é predominantemente de leitura apesar de a API suportar CRUD completo
- **Módulo:** F. Projetos.
- **Descrição:** confirmado em `docs/handoff-codex/16-PENDENCIAS-E-DEBITO-TECNICO.md` ("CRUD de Projetos
  existe na API, mas a UI é predominantemente de leitura") e consistente com o volume de rotas reais
  documentado em `docs/SECURITY.md` (target/approval-rules/recovery-settings/actions/milestones/risks
  etc., todas com RBAC testado).
- **Impacto:** capacidade técnica não exposta ao usuário — trabalho de backend/segurança "parado" sem
  valor de produto entregue.
- **Correção recomendada:** priorizar a superfície de escrita da UI de Projetos no próximo ciclo,
  reaproveitando rotas já testadas.
- **Esforço:** M.

### CFA-06 — Dashboard executivo de Projetos desconectado da API real de Projetos
- **Módulo:** A. Executivo / F. Projetos.
- **Descrição:** `dashboard-model.js` define o dashboard `projects` com 3 widgets
  (`projects-progress`, `projects-risk`, `projects-table`). `dashboard-service.js:113-114` só tem um
  branch genérico (`else`) para qualquer `id` fora de `executive`/`legal`/`ti`/`engineering`/`budget` —
  e esse branch marca **todos os widgets como `pending()`**, mesmo o `projects` dashboard, apesar de
  `/api/projects` ser uma API real, testada e com dado (`project-service.js`, portfólio real).
- **Impacto:** a Diretoria vê "integração pendente" num dashboard cujos dados de origem já existem e são
  reais — informação enganosa por omissão (mostra menos do que existe).
- **Correção recomendada:** implementar um branch dedicado `else if (id === 'projects')` em
  `dashboard-service.js`, análogo ao de `legal`/`ti`, que leia `ensureProjectStore()`/`projectSummary()`.
- **Esforço:** M.

### CFA-12 — 2 vulnerabilidades de dependência de severidade alta, sem correção compatível
- **Módulo:** H. Indicadores & Relatórios / Segurança (equivale a PG-15).
- **Descrição:** `npm audit` (executado nesta auditoria) confirma 2 altas: `image-size` (DoS por loop
  infinito em parsers ICNS/JXL/HEIF) e `pptxgenjs` (dependência transitiva do mesmo pacote). Correção
  disponível exige downgrade major (`pptxgenjs@2.2.0`), potencialmente incompatível com o uso atual
  (`^4.0.1`).
- **Impacto:** negação de serviço na geração de apresentações PPTX, uma funcionalidade já usada
  (exportação de apresentações de comitê).
- **Correção recomendada:** avaliar migração controlada com validação de exportação PPTX/PDF (H9), ou
  waiver formal explícito enquanto não migrado.
- **Esforço:** M (downgrade com revalidação) ou S (waiver formal).

### CFA-13 — `companyId`/`speId`/`scopeType` dormentes — segregação de empresa/SPE não está em uso real
- **Módulo:** N. Segurança / B. Jurídico (SCP/SPE).
- **Descrição:** as colunas existem, são testadas estruturalmente (deny-by-default quando presentes),
  mas **nada no sistema as popula** hoje — não há cadastro de empresa/SPE, nem fluxo que atribua esses
  valores a um registro real.
- **Impacto:** a segregação por empresa/SPE que o MASTER_HANDOFF exige (§9, §11) é apenas teórica até que
  exista um cadastro real — o risco de "vazamento entre empresas" citado no seu pedido (item K.
  Governança) não pode ser testado de ponta a ponta hoje porque não há dado de mais de uma empresa/SPE
  real para testar.
- **Correção recomendada:** decisão de negócio D3 (data owner) e desenho de cadastro de Empresa/SPE.
- **Esforço:** L.

### CFA-14 — Reset de senha sem provedor de e-mail real
- **Módulo:** M. Administração / N. Segurança.
- **Descrição:** `POST /api/auth/forgot-password` gera token real, mas sua entrega depende de um
  provedor de e-mail não integrado — hoje o fluxo operacional depende de um administrador gerar um
  token de uso único manualmente (`POST /api/auth/users/:id/reset-token`).
- **Impacto:** onboarding/recuperação de senha não é self-service; depende de intervenção humana.
- **Correção recomendada:** integrar um provedor de e-mail transacional.
- **Esforço:** M.

### CFA-15 — Sem tooling de QA visual/E2E
- **Módulo:** Testes (seção 11).
- **Descrição:** o `package.json` não declara nenhuma dependência de teste E2E/browser (nenhum
  Playwright/Cypress/Puppeteer). Toda a suíte é `node:test` unitário/HTTP.
- **Impacto:** nenhuma tela foi validada automaticamente quanto a renderização real, responsividade ou
  regressão visual — a única validação visual até hoje foi manual, na rodada do Comitê Jurídico.
- **Correção recomendada:** introduzir ao menos um smoke E2E cobrindo o fluxo Jurídico (login → dashboard
  → processo → detalhe) antes de qualquer expansão de escopo.
- **Esforço:** M.

---

## 5. Achados P2

### CFA-01 — `decision-list` (Painel Executivo COEVO / Dashboard Estratégico) sem destino real — **já corrigido na camada de renderização nesta branch; o que resta é lacuna de dado, não bug de UX**
- **Módulo:** A. Executivo — widget `decision-list` (`dashboard-model.js:27`, `dashboard-service.js:60`).
- **Descrição original (verificada primeiro contra `master`):** o componente genérico `list()`
  (`public/dashboard-widgets.js`) só adicionava `onclick` quando a linha tinha `target`, mas **sempre**
  renderizava `<button>` com o texto "Abrir" mesmo sem destino — um botão visualmente clicável e sem ação.
- **Correção — já aplicada nesta branch (`claude/demo-staging-deploy`, `3c4c861`):** `list()` agora calcula
  `target` e, quando ausente, renderiza o `<button>` com o atributo `disabled` e **sem** o texto "Abrir" —
  o mesmo tratamento vale para `decision-list` e para qualquer outro widget de lista sem destino. Ou seja,
  **o problema de "botão parece clicável mas não faz nada" já não existe mais na camada de renderização
  genérica.**
- **O que permanece aberto (já registrado pelo próprio projeto em `docs/DEMO_CURRENT_STATE.md`, seção
  7):** os registros de `store.committees` continuam sem um campo `target`/`value` — então, quando a
  coleção deixar de estar vazia, o widget mostrará os itens corretamente como `disabled` (honesto), mas
  ainda **sem navegação para o comitê correspondente** — uma lacuna de funcionalidade, não mais um risco
  de UX enganosa.
- **Evidência:** `public/dashboard-widgets.js` (`list()`, diff `cf1c918→3c4c861`); `dashboard-service.js:60`
  (fonte de dados, inalterada); `docs/DEMO_CURRENT_STATE.md`, seção 7, item "Widget 'Decisões'".
- **Correção recomendada (residual):** mapear cada comitê para `{ label, date, target: 'comites' }` (ou
  rota equivalente) em `dashboard-service.js:60`.
- **Esforço:** XS.

### CFA-04 — Item de menu "Comitê Jurídico" descontinuado, CSS órfão preservado
- **Módulo:** I. Comitês.
- **Descrição:** o item de menu dedicado ao Comitê Jurídico foi removido por apontar para uma tela
  404/placeholder morta; `public/committee.css` (7.342 bytes) não é referenciado por nenhum HTML/JS hoje.
  Já documentado e intencional (`docs/LEGAL_COMMITTEE_READINESS.md:39,59,144`).
- **Classificação exigida:** `8` Descontinuado/não deve existir — para o item de menu antigo.
- **Correção recomendada:** remover `public/committee.css` do repositório (ou confirmar formalmente que
  fica como referência histórica) e a função morta `legalDashboardPage()` em `app.js:86-92`.
- **Esforço:** XS.

### CFA-07 — Parser de importação de CSV de orçamento não implementa RFC 4180
- **Módulo:** G. Orçamento.
- **Descrição:** confirmado em `docs/handoff-codex/16-PENDENCIAS-E-DEBITO-TECNICO.md`. Não reverificado
  linha a linha nesta auditoria (achado herdado, não novo).
- **Impacto:** campos com vírgula/aspas/quebra de linha dentro de um valor podem ser interpretados
  incorretamente.
- **Esforço:** S.

### CFA-08 — Tabela órfã `users`/`audit_events` de `001_foundation.sql`
- **Módulo:** O. Banco e Persistência.
- **Descrição:** H1B criou `app_users`/`audit_log` em vez de reaproveitar as tabelas originais de
  `001_foundation.sql`, deixando as antigas fisicamente presentes no schema, nunca lidas/escritas pelo
  runtime atual.
- **Impacto:** confusão futura para quem inspecionar o banco diretamente; nenhum risco funcional hoje.
- **Correção recomendada:** migration de limpeza (`DROP TABLE`) quando o H1B for homologado.
- **Esforço:** XS.

### CFA-09 — `barList()` tem risco estrutural de renderizar botão sem ação (não manifestado hoje) — já rastreado pelo próprio projeto
- **Módulo:** T. UX/Interface.
- **Descrição:** `public/app.js:368` (nesta branch — código idêntico ao de `master`, só deslocado) —
  `function barList(items,total,clickModule='')` sempre renderiza um `<button>` por item; o atributo
  `onclick` só é adicionado quando `clickModule` é uma string não vazia. **Todos os pontos de chamada
  atuais** passam um módulo válido (`'processos'`/`'honorarios'`/`'compra-venda'`) — hoje não há nenhum
  botão morto renderizado por esta função.
- **Confirmação independente:** este mesmo achado já está registrado por quem trabalhou nesta branch, em
  `docs/DEMO_CURRENT_STATE.md`, seção 7: *"`barList()`: botões sem `clickModule` ficam sem `onclick` mas
  também sem `disabled` — ainda parecem interativos (P2)"* — a leitura de código desta auditoria chegou
  independentemente à mesma conclusão. **Diferente de `decision-list`/`upcoming-deadlines` (CFA-01/CFA-02),
  este item ainda não recebeu a correção genérica de `disabled` que já foi aplicada a `list()` em
  `public/dashboard-widgets.js`** — seria natural aplicar o mesmo padrão aqui.
- **Impacto:** risco latente — qualquer chamada futura que omita o terceiro argumento produzirá um botão
  visualmente idêntico a um clicável, sem nenhuma ação.
- **Correção recomendada:** renderizar `<button ... ${clickModule?'':'disabled'}>` (mesmo padrão já usado
  em `dashboard-widgets.js`) em vez de omitir apenas o `onclick`.
- **Esforço:** XS.

### CFA-10 — Nomenclatura inconsistente: botão "Ver contratos →" abre drilldown de "compra-venda"
- **Módulo:** B. Jurídico / T. UX.
- **Descrição:** `app.js:338` — o CTA rotulado "Ver contratos →" chama
  `openDashboardDrilldown('compra-venda')`, não o módulo `contratos` (que é, aliás, um dos módulos sem
  fonte de dado — ver matriz). Funcionalmente não quebra nada (o drilldown de compra-venda é real), mas
  o rótulo não corresponde ao módulo de menu "Contratos".
- **Correção recomendada:** renomear o rótulo do widget para "Ver compra e venda →", ou reconciliar os
  dois conceitos (Contratos vs. Compra e Venda) numa decisão de produto.
- **Esforço:** XS.

### CFA-16 — IDs de board do Monday com fallback hardcoded no backend
- **Módulo:** S. Integrações.
- **Descrição:** `server.js` define `MONDAY_BOARDS` com IDs reais de board como fallback quando a
  variável de ambiente correspondente não está definida — já documentado como débito técnico conhecido
  em `docs/handoff-codex/16-PENDENCIAS-E-DEBITO-TECNICO.md`, confirmado nesta auditoria.
- **Impacto:** baixo (sobrescrevível por env var), mas um valor específico de cliente vive no código-fonte
  versionado.
- **Correção recomendada:** exigir a variável de ambiente sem fallback embutido, ou documentar
  explicitamente por que o fallback é aceitável.
- **Esforço:** XS.

### CFA-17 — Import morto (`PROJECT_ID`) em `server.js`
- **Módulo:** Código / dívida técnica.
- **Descrição:** `PROJECT_ID` é desestruturado de `require('./project-service')` em `server.js` e nunca
  mais referenciado.
- **Impacto:** nenhum — apenas ruído.
- **Esforço:** XS.

### CFA-18 — Dois usuários seed com o mesmo e-mail
- **Módulo:** N. Segurança / M. Administração.
- **Descrição:** `usr-diretoria`/`usr-juridico` compartilham e-mail; login resolve para o primeiro por
  `created_at`/`id` desde a correção do H1B. Aceito pela gestão como limitação de cadastro conhecida
  (`docs/PERMISSIONS.md`).
- **Impacto:** baixo, mas ainda não é a identidade única por login ideal fora do ambiente de
  homologação/seed.
- **Esforço:** S.

---

## 6. Achados P3

- **CFA-19** — Nomes internos ainda misturam conceito de "painel genérico" e "tela dedicada" (achado
  herdado de `docs/handoff-codex/16`, não reverificado a fundo nesta rodada).
- **CFA-20** — Arquivos CSS minificados em uma linha dificultam manutenção (`app.js` também é escrito em
  estilo de linha única por função — decisão de estilo do projeto, não um bug).
- **CFA-21** — Ausência de geração automática de documentação de API (`docs/handoff-codex/16`).
- **CFA-22** — Honorários judiciais não têm filtros equivalentes aos extrajudiciais (achado herdado,
  ainda válido pela leitura desta auditoria da matriz de módulos).
- **CFA-23** — Nenhuma verificação de acessibilidade formal (WCAG) foi executada — os elementos `aria-*`
  encontrados são extensos e bem aplicados, mas não substituem uma auditoria dedicada (contraste,
  navegação por teclado ponta a ponta, leitor de tela real).
- **CFA-24** — "Rocsil"/"FGlass"/"Tetus" (fornecedores citados no pedido original) não têm nenhuma
  referência encontrada no código atual — recomenda-se confirmar com o negócio se ainda são relevantes
  antes de qualquer modelagem.

---

## 7. Integrações

| Integração | Status | Modo | Segredo exposto? | Observação |
|---|---|---|---|---|
| Monday.com | **Ativa** | Leitura, agendada | Não (verificado por teste + varredura) | **35 boards habilitados** (corrigido de 7 — `legal-source-catalog.js`, workspace Jurídico), sincronização idempotente, falha preserva último dado válido, subitems ainda fora de escopo |
| Google Calendar | **Bloqueada por credencial** | Leitura (Opção B homologada) | Não (nunca há token no código, testado) | Adapter e contrato testados; ativação real depende de OAuth do Google |
| Sienge | **Não implementada** | — | N/A | Sem cliente/API; todo dado financeiro dependente aparece como indisponível, nunca como zero |
| CV (Construtor de Vendas) | **Não implementada** | — | N/A | "Aguardando credencial"; campos que citam CV vêm do Monday |
| Clicksign | **Não implementada** | — | N/A | "Aguardando credencial" |
| Google Drive | **Preparada (spec) / não implementada (código)** | — | N/A | Zero código; citada apenas no MASTER_HANDOFF |
| E-mail (transacional) | **Não implementada** | — | N/A | Bloqueia self-service de reset de senha |
| OneDrive/SharePoint/Outlook/WhatsApp | **Não implementada** | — | N/A | Fora de escopo, apenas mencionadas na spec |

---

## 8. Segurança e Produção

### Estado H1–H11

| Hardening | Estado | Bloqueia produção? |
|---|---|---|
| H1A — Persistência PostgreSQL | **Implementado e testado** — aguardando homologação | Não (fechado tecnicamente) |
| H1B — Normalização relacional do núcleo | **Implementado e testado** — aguardando homologação | Não (fechado tecnicamente) |
| H2 — Autenticação/MFA/sessões individuais | **Implementado e testado** — aguardando homologação | Não (fechado tecnicamente) |
| H3 — Rate limiting | **Implementado e testado** (rotas sensíveis) | Não (fechado para o escopo mínimo) |
| H4 — Hardening HTTP (CSP/HSTS/CORS) | **Implementado e testado** | Não (fechado) |
| H5 — Backup/restore | **Parcial** — mecanismo real testado; storage offsite real pendente | **Sim**, até offsite real ser validado |
| H6 — Observabilidade | **Parcial** — logger/alerta reais testados; agregador/destino real pendente | **Sim**, até agregação real |
| H7 — Incident response | **Parcial** — processo completo testado; canal/responsável real pendente | **Sim**, até parametrização real |
| H8 — Retenção/legal hold | **Não iniciado** | **Sim** |
| H9 — Dependências (`pptxgenjs`/`image-size`) | **Não iniciado** | **Sim** |
| H10 — OAuth Google Calendar real | **Não iniciado** (opcional) | Não (funcionalidade opcional) |
| H11 — Deploy/infraestrutura como código | **Não iniciado** | **Sim** |

**Nenhum destes estados foi assumido — todos vêm diretamente de `docs/PRODUCTION_GATE.md` e foram
reconfirmados nesta auditoria por leitura de código (`npm audit` real, busca por `Dockerfile`/`fly.toml`,
leitura de `observability/`, `backup/`).**

### Matriz GO/NO-GO (reconfirmada)

**Produção: NO-GO.** 4 P0 abertos (retenção/legal hold, incident response parametrizado, backup offsite
real, deploy como código), 4 P1 abertos (dependências, agregação de log real, 2× LGPD), 4 P2. Nenhum
waiver foi emitido.

**Homologação:** já ocorreu para o escopo do piloto Jurídico (Sprint 2, formalmente fechado,
`docs/SPRINT2-PLANO.md`) e para a apresentação ao Comitê Jurídico
(`docs/LEGAL_COMMITTEE_READINESS.md`, 12/09/2026). **Não ocorreu** para nenhum outro escopo (TI além da
segregação, Executivo, VELKOR, Estratégia, Engenharia).

**Demo:** apta — é exatamente o que já foi feito (apresentação real ao Comitê Jurídico com dados reais
sob controle).

---

## 9. Dados e Fontes

| Classe | Módulos |
|---|---|
| **Real (sincronizado)** | **Corrigido nesta reconciliação — 34 fontes Monday habilitadas (35 do catálogo, 1 duplicata desabilitada), não 8.** Processos Judiciais, Notificações Clientes, Distratos, Retomadas, Protestos, Cessão de Direitos (Bella Vida), Honorários Extrajudiciais, Honorários Judiciais (derivado), Compra e Venda, Transferência Intermediada, Personalização (unidades), Processos Administrativos, Boletim de Ocorrência, Audiências, Processos de Parceiros, Análise Jurídica, Contratos Prestadores de Serviço, ADM Contratos Prestadores, Obra — Contrato de Prestação de Serviço, Contrato de SCP/SPE, Proposta de Terreno, Procurações, Alterações Convenções de Condomínio, Cartório e Prefeitura, Notificações (Empresas), Rocsil, FGlass e Tetus Locação, Entrega de Chaves (Carpe Diem, Vita Village, Aurora Residence), Pesquisas, Pesquisas Vitor, Acessos, Contas a Pagar, Melhorias — Notificações Clientes, Sócio — Gilmar Arantes — todos via Monday, todos ligados à tela genérica (`legalDetailPage()`), nenhum com QA visual individual confirmado (ver seção 2, letra B) |
| **Real (persistido nativamente)** | Legal Deadline, usuários, sessões, auditoria, backups (metadados) |
| **Real, planilha (não automática)** | Orçamento Jurídico (`Orcamento_JURIDICO_2026.xlsx`, snapshot manual) |
| **Provisório/cadastro de homologação** | Orçamento de TI |
| **Seed/demonstrativo** | Agenda (2 compromissos) — **sem indicação visual disso na tela** (achado CFA-03) |
| **Estrutura real, sem dado** | Comitês/decisões (coleção existe, vazia), Casos/negociações/tratativas de recuperação de crédito, metas de recuperação |
| **Derivado (calculado em leitura)** | Status/escopo/polo/tipo de processo (regex sobre campo Monday), atraso de Legal Deadline (`isLegalDeadlineOverdue()`) |
| **Pendente de integração (explícito na UI, nunca zero)** | Todo dado financeiro de recuperação de crédito, Engenharia/Obras, Estratégia, Sistemas/Chamados de TI |
| **Não integrado / não existe** | Sienge, CV/Clicksign diretos, IA/Têmis/Ivo/OpenAI, VELKOR (qualquer dado), Pessoa/Organização/Contrato/Documento como entidades |
| **MongoDB** | Não existe em nenhuma camada — apenas PostgreSQL é usado/preparado |

**Nenhum dashboard apresenta seed/mock como se fosse dado real, com exceção do achado CFA-03 (Agenda)**,
que deve ser tratado como um achado de UX, não como dado fabricado deliberadamente.

---

## 10. UX e Navegação

**Positivo, confirmado por leitura completa do frontend:**
- Nenhum `alert()`/`confirm()` encontrado em `public/app.js` — nenhum CTA "morto" com pop-up genérico.
- Todo módulo sem fonte real usa linguagem explícita e honesta ("não está integrado a uma fonte de dados
  nesta rodada. Nenhum registro fictício é exibido aqui.") em vez de dado fictício ou tela em branco
  ambígua.
- `aria-*` usado extensivamente (labels, `aria-live`, `aria-pressed`, `aria-expanded`, `role="dialog"`,
  foco gerenciado em diálogos/drawers, `Escape` fecha diálogos/painéis).
- Estados de widget de primeira classe: `loading`/`empty`/`error`/`forbidden`/`integration_pending` —
  nunca um estado ambíguo entre "vazio de verdade" e "falha".

**Achados negativos (já detalhados nas seções 3-6):** CFA-01 (decision-list — já corrigido na
renderização; resta lacuna de destino), CFA-02 (`ti-deadlines` ainda sem filtro de data;
`upcoming-deadlines` já corrigido nesta branch), CFA-03 (Agenda seed sem aviso visual), CFA-04
(Comitê Jurídico como item de menu, descontinuado, CSS órfão), CFA-09 (barList risco estrutural
latente), CFA-10 (rótulo "Ver contratos" leva a "compra-venda").

**Navegação estrutural:** a navegação real (`CORPORATE_MENU`/`DEPARTMENT_MODULES` em `app.js`) **diverge
estruturalmente** da navegação-alvo do `MASTER_HANDOFF.md` §5 — usa suas próprias seções (INÍCIO /
GESTÃO / INTELIGÊNCIA / GOVERNANÇA / UTILITÁRIOS / ADMINISTRAÇÃO) e inclui um departamento
(Engenharia/Obras) que nem consta na lista de "ambientes" do MASTER_HANDOFF. Isso não é um erro por si
só — é esperado em construção incremental — mas é uma divergência que deveria ser resolvida
(reconciliar o documento ou a implementação) antes de declarar qualquer fase "finalizada".

**Breadcrumb/retorno/sidebar:** presentes e funcionais nos módulos reais do Jurídico
(`Jurídico → Contratos → Contrato X`, conforme o padrão do MASTER_HANDOFF §5), não verificados fora
dele por não haver telas reais suficientes para testar o padrão em outros ambientes.

---

## 11. Testes

**Execução real nesta auditoria, contra `3c4c861` (`claude/demo-staging-deploy`), sem PostgreSQL
disponível neste ambiente**:
```
tests 454
pass 447
fail 0
skipped 7
```
(Contra `master`/`cf1c918`, antes da reconciliação, a mesma execução dava 429/422/7 — a diferença de 25
testes vem exatamente dos dois arquivos novos desta branch, `tests/legal-source-catalog.test.js` e
`tests/legal-ui-p0.test.js`, que cobrem o catálogo de 35 boards e as 3 correções de CTA descritas em
CFA-01/CFA-02.)

Os 7 pulados são explicitamente gated por `TEST_DATABASE_URL` (H1B/H2/H3/H4/H5/Postgres, storage) — não
são falhas. **Isto não contradiz os "549 testes" mencionados em `docs/LEGAL_COMMITTEE_READINESS.md`**:
vários arquivos de teste (H1B, H2, H5-postgres, security-integration-postgres) só registram sua bateria
completa de casos quando um PostgreSQL de teste está acessível; sem ele, cada um desses arquivos aparece
como um único teste "pulado explicitamente" em vez de dezenas — comportamento documentado pelo próprio
projeto (`docs/QA.md`), não uma regressão.

**`npm audit`:** 2 altas, 0 críticas (`image-size`/`pptxgenjs`, ver CFA-12).

**Cobertura por domínio (qualitativa):** RBAC/autorização — muito ampla (mais de 100 testes HTTP
dedicados a permissão/escopo através das 7 rodadas de segurança); Legal Deadline — muito ampla (ciclo de
vida completo, D1 e Fase 4B); Backup/Restore — ampla, com evidência de restauração real; Observabilidade
— ampla (33 testes dedicados); Incident Response — testes de infraestrutura do processo (criação de
registro), não de um incidente real; **catálogo/sincronização Monday e estabilidade de conexão** — ampla
(`tests/legal-source-catalog.test.js`, 16 testes: integridade do catálogo, `MONDAY_BOARDS` derivado sem
lista paralela, paginação/upsert/idempotência do `runMondaySync()`, `pool.on('error')`, retry com
backoff, reconciliação de conflito de CAS); **correções de CTA/data do Painel Executivo** — coberta
(`tests/legal-ui-p0.test.js`, 9 testes: target/`disabled` de `decision-list` e do roteamento de Comitê,
`upcomingAgendaItems()` — exclusão de evento passado, imunidade a fuso, não-mutação do array —, e
`moduleCount` dinâmico das Integrações).

**Correção sobre a versão anterior deste documento:** eu havia afirmado que os achados de CTA/data
(CFA-01/CFA-02) não tinham teste dedicado — **isso estava errado**. `tests/legal-ui-p0.test.js` cobre
exatamente os dois casos que **já foram corrigidos** nesta branch (`decision-list`/`upcoming-deadlines`),
com teste de regressão real. O que continua **sem teste dedicado** é apenas o que continua **aberto**:
`ti-deadlines` (CFA-02, residual) e `barList()` (CFA-09) — nenhum teste falha hoje para eles porque
ninguém escreveu um ainda, não porque o comportamento esteja correto.

**Pontos sem cobertura:**
- Nenhum teste E2E/browser automatizado e repetível em CI (ver CFA-15) — houve uma sessão real de
  validação por navegador (Playwright, ad-hoc) para o núcleo do módulo Jurídico, não repetida para os
  ~28 módulos jurídicos recém-reclassificados nesta reconciliação (seção 2, letra B) nem para os demais
  ambientes.
- Nenhum teste de acessibilidade automatizado (axe-core ou equivalente).
- Nenhum teste de carga/concorrência em escala de produção (a concorrência testada é de 2 requisições
  simultâneas, suficiente para provar o mecanismo, não para provar comportamento sob carga real).
- Nenhum teste dos módulos genuinamente "não implementados" (`contratos`, `riscos-regulatorio`,
  `recuperacao`, `fatos` — não pode haver, por definição, já que não têm fonte).
- `ti-deadlines` (CFA-02, residual) e `barList()` (CFA-09) permanecem sem teste de regressão dedicado.

**QA visual:** nenhuma automatizada; uma rodada manual documentada ocorreu para os módulos Jurídicos
apresentados ao Comitê (12/09/2026).

---

## 12. Infraestrutura

| Ambiente | Estado |
|---|---|
| Demo/local | Funcional — `npm start`, PostgreSQL local opcional (fallback JSON fora de produção) |
| Demo/Fly (`claude/demo-staging-deploy`) | **Provisionado** (corrigido nesta reconciliação) — app `patrono-legal-demo` + Postgres `patrono-legal-demo-db` (1 GB RAM), `Dockerfile`/`fly.toml` versionados, roteiro em `docs/DEMO_DEPLOY.md`. **Escopo explicitamente temporário/único-propósito** (apresentação ao Comitê Jurídico) — não é um ambiente de staging reutilizável para o produto inteiro, nem foi criado como tal |
| Staging (durável, reutilizável) | **Não existe** — o que existe é o ambiente de demonstração acima, de propósito único |
| Produção | **Não provisionada** — nem banco de produção, nem hospedagem definitiva, nem domínio |

`Dockerfile`/`.dockerignore`/`fly.toml` **existem** nesta branch (correção sobre a leitura inicial desta
auditoria, que os buscou em `master` e não os encontrou lá — ver Nota de reconciliação). O `Dockerfile`
nunca teve `docker build .` executado neste ambiente de auditoria (bloqueio de rede para Docker Hub).
O único pipeline de CI existente é `.github/workflows/ci.yml`, que roda `npm ci` + `npm test` (+
`npm audit` informativo) em Node 20.x/22.x — **continua sem nenhum job de deploy automatizado**; o
deploy do ambiente de demonstração foi manual, via `flyctl`, por um operador humano.

---

## 13. Documentação

Ver seção 2, letra V, para o detalhamento completo por documento. Resumo: a documentação deste projeto é
**excepcionalmente rigorosa e rastreável** para o escopo já entregue (Jurídico + fundação) — muito acima
do padrão usual para um projeto neste estágio. Os gaps de documentação reais são: (1)
`docs/handoff-codex/` é uma coleção paralela e desatualizada (09/08/2026) que, se lida sem notar a data,
pode ser confundida com o estado atual — recomenda-se marcá-la explicitamente como histórica ou
arquivá-la; (2) `MATRIZ-RASTREABILIDADE.md` está desatualizada em relação ao rigor de `SECURITY.md`/
`PRODUCTION_GATE.md`/`QA.md`. (`docs/DEMO_CURRENT_STATE.md` **existe** nesta branch — a leitura inicial
desta auditoria contra `master` havia corretamente confirmado sua ausência ali, mas essa observação não
se aplica a `claude/demo-staging-deploy`; corrigido em toda a seção 2, letra V.)

---

## 14. Plano Mestre de Finalização

### ONDA 0 — P0 / Estabilidade
- **Objetivo:** fechar os quatro P0 que hoje bloqueiam produção, todos operacionais/decisórios, não de
  código novo de negócio.
- **Itens:** CFA-P0-01 (infra como código), CFA-P0-02 (retenção/legal hold — decisão + implementação
  mínima), CFA-P0-03 (parametrizar canal/responsável de incidente), CFA-P0-04 (backup offsite real).
- **Pré-requisitos:** decisão de provedor de hospedagem e de armazenamento de objeto; nomeação de
  responsáveis de incidente; decisão jurídica de política de retenção.
- **Critérios de aceite:** os 4 itens da matriz GO/NO-GO (seção 8) mudam de "Sim" para "Não" na coluna
  "Bloqueia produção?", com evidência real (não por afirmação).
- **Riscos:** todos dependem de decisão/contratação externa ao time técnico — podem ser o gargalo real de
  tempo, não o código.
- **Esforço:** M (agregado).

### ONDA 1 — Núcleo corporativo funcional
- **Objetivo:** corrigir os bugs/gaps confirmados nesta auditoria antes de qualquer expansão de escopo.
- **Itens:** CFA-01, CFA-02, CFA-03, CFA-05, CFA-06, CFA-12 (dependência), CFA-13 (decisão de negócio
  necessária antes de codificar), CFA-14.
- **Pré-requisitos:** nenhum além de aprovação para tocar em código de produto (não muda schema nem
  infraestrutura).
- **Critérios de aceite:** os 6 achados de código têm teste de regressão dedicado; `npm audit` sem altas
  não tratadas ou com waiver formal.
- **Riscos:** baixo — mudanças pontuais e bem localizadas.
- **Esforço:** M (agregado).

### ONDA 2 — Departamentos
- **Objetivo:** decidir e, se autorizado, começar a preencher TI (Chamados/Sistemas/Ativos) e/ou
  Engenharia/Obras com dado real, respeitando a mesma disciplina do Jurídico (nunca dado fictício).
- **Itens:** conectar dashboard `projects` à API real (parte de CFA-06), avaliar Sienge para
  Engenharia/Obras e Recuperação de Crédito.
- **Pré-requisitos:** decisão de negócio sobre qual departamento entra primeiro; levantamento técnico do
  Sienge (D6, ainda pendente).
- **Critérios de aceite:** ao menos um módulo de TI ou Engenharia sai de "placeholder" para "funcional"
  com dado real, seguindo o mesmo padrão de honestidade de fonte já usado no Jurídico.
- **Riscos:** repetir o padrão do Jurídico dá disciplina, mas exige o mesmo nível de rigor de RBAC — não
  cortar caminho.
- **Esforço:** L–XL, dependendo do departamento escolhido.

### ONDA 3 — Integrações externas
- **Objetivo:** Sienge (financeiro/obras) e, secundariamente, e-mail transacional (para reset de senha
  self-service) e OAuth real do Google Calendar.
- **Pré-requisitos:** D6 (endpoints do Sienge confirmados), decisão de provedor de e-mail, credenciais
  OAuth do Google.
- **Critérios de aceite:** ao menos uma integração nova ativa em modo leitura, com o mesmo padrão de
  "falha de fonte preserva o último dado válido" já usado no Monday.
- **Riscos:** Sienge é a maior incógnita técnica do projeto — nenhum endpoint foi confirmado ainda.
- **Esforço:** L.

### ONDA 4 — UX/Mobile/PWA
- **Objetivo:** fechar CFA-04/CFA-09/CFA-10 (limpeza de UX), avaliar PWA (manifest + service worker
  básico) e rodar uma auditoria de acessibilidade formal (WCAG).
- **Pré-requisitos:** nenhum técnico crítico.
- **Critérios de aceite:** manifest + ícone + installability básica funcionando; relatório de
  acessibilidade sem item crítico aberto.
- **Riscos:** baixo.
- **Esforço:** M.

### ONDA 5 — Segurança / Gate de produção
- **Objetivo:** H9 (dependências) e reavaliação de CSRF (PG-14) se o modelo de sessão mudar.
- **Pré-requisitos:** ONDA 0 concluída.
- **Critérios de aceite:** `npm audit` limpo ou com waiver formal aprovado; CSRF reavaliado e decidido.
- **Riscos:** downgrade de `pptxgenjs` pode quebrar exportação — exige revalidação funcional completa.
- **Esforço:** M.

### ONDA 6 — Homologação final
- **Objetivo:** repetir, para cada onda anterior liberada, o mesmo rito de homologação já usado no Sprint
  2 (`docs/HOMOLOGACAO.md`) — nunca presumir "pronto" sem os critérios formais.
- **Pré-requisitos:** ONDAS 0-5 com seus critérios de aceite atendidos.
- **Critérios de aceite:** aceite formal da Gestora e dos responsáveis de negócio de cada frente liberada.
- **Riscos:** pressa em pular esta etapa é o risco mais provável, dado o histórico de rigor do projeto.
- **Esforço:** S (processo), mas não deve ser comprimido.

### ONDA 7 — Produção
- **Objetivo:** ir a produção com o escopo então liberado.
- **Pré-requisitos:** todos os 14 critérios do `MASTER_HANDOFF.md` §33 (Go-Live Gate) e a matriz GO/NO-GO
  da seção 8 deste documento com "Não" em toda a coluna "Bloqueia produção?".
- **Critérios de aceite:** smoke test pós-deploy, plano de rollback testado, autorização explícita de
  negócio.
- **Riscos:** nenhum atalho deve ser tomado — o próprio projeto já demonstrou disciplina rara em não
  fechar um achado sem evidência; manter esse padrão é o maior ativo deste projeto.
- **Esforço:** M (execução), assumindo que as ondas anteriores foram cumpridas.

---

## 15. Caminho Crítico

O que realmente impede encerrar o Patrono, em ordem de dependência real:

1. **Decisão de infraestrutura** (provedor de hospedagem + banco gerenciado + armazenamento de objeto) —
   sem isso, ONDA 0 inteira trava, e nada mais pode ir a produção.
2. **Nomeação de responsáveis operacionais** (incidente, retenção/legal hold) — decisão de negócio pura,
   sem custo técnico, mas sem ela H7/H8 não fecham.
3. **Levantamento técnico do Sienge (D6)** — bloqueia toda a frente financeira: Recuperação de Crédito,
   Engenharia/Obras, Orçamento consolidado real.
4. **Decisão sobre CPF/CNPJ e contato do cliente (D2/D4, ainda pendentes)** — bloqueia qualquer matching/
   deduplicação/Cadastro Mestre futuro, embora não bloqueie o que já existe.
5. Só depois disso faz sentido priorizar TI/Engenharia/VELKOR como novo escopo de produto.

---

## 16. Critérios de "PATRONO FINALIZADO"

Definição objetiva, para este documento:

- Nenhum achado classificado como P0 nesta auditoria ou em `docs/PRODUCTION_GATE.md` permanece aberto
  sem waiver formal.
- Nenhum P1 essencial ao escopo liberado permanece aberto sem waiver formal.
- Todo módulo classificado nesta auditoria como "placeholder" (`4`) ou "não implementado" (`6`) está
  **explicitamente marcado como tal na interface** (nunca removido silenciosamente do menu sem
  explicação, nem apresentado como funcional) — ou foi de fato implementado com dado real.
- Integrações críticas ao escopo liberado estão ativas (não apenas "preparadas").
- Segurança validada: os 14 itens do Go-Live Gate (`MASTER_HANDOFF.md` §33) atendidos para o escopo
  liberado.
- Backup/restore validado incluindo armazenamento externo real.
- QA: suíte automatizada verde + ao menos um smoke E2E por fluxo crítico + revisão visual documentada.
- Mobile: navegação móvel testada em dispositivo real (não apenas CSS responsivo revisado em código).
- Documentação: `docs/DEMO_CURRENT_STATE.md` (já existe nesta branch) mantido vivo a cada rodada de
  estabilização; `docs/handoff-codex/` arquivado ou atualizado para não confundir leitor futuro.
- Handoff: papéis operacionais (infraestrutura, incidente, backup, dado) nomeados e documentados com
  nome real, não campo vazio.
- Produção aprovada formalmente pela Gestora, com autorização explícita registrada (mesmo padrão já
  usado para D1/D4.x neste projeto).

---

## 17. Critérios de GO/NO-GO

| Ambiente | Critério | Estado atual |
|---|---|---|
| **Demo** | Dado real controlado, apresentação supervisionada, sem exposição pública | **GO** — já demonstrado (Comitê Jurídico, 12/09/2026) e com ambiente Fly real provisionado (`patrono-legal-demo`, corrigido nesta reconciliação) |
| **Staging** (durável, reutilizável por todo o produto) | Ambiente separado provisionado, dado demonstrativo/anonimizado, CI verde, uso contínuo | **NO-GO** — o que existe é um ambiente de demonstração de propósito único, não um staging reutilizável; nada aqui contradiz o achado original, apenas precisa a distinção |
| **Produção** | Todos os 14 critérios do Go-Live Gate + matriz da seção 8 sem bloqueio | **NO-GO** — 4 P0 abertos, confirmado nesta auditoria e reafirmado explicitamente pelo próprio `docs/DEMO_DEPLOY.md`/`docs/DEMO_CURRENT_STATE.md` ("produção continua NO-GO") |

---

## Anexo — Confirmação da branch e working tree

- Branch de trabalho: `claude/demo-staging-deploy`. **Nota de reconciliação:** criada inicialmente a
  partir de `master` nesta sessão (a branch remota parecia não existir no momento da primeira checagem);
  ao ser descoberta a divergência com o remoto real (8 commits, `3c4c861`), esta auditoria foi corrigida
  para refletir o estado real dessa branch, sem force-push — a leitura original baseada em `master` foi
  preservada em `claude/demo-staging-deploy-mine`.
- `master` e `docs/MASTER_HANDOFF.md`: **intocados**, confirmado antes e depois da reconciliação.
- Nenhuma migration executada, nenhum dado alterado, nenhum deploy realizado por esta auditoria.
- O commit `3c4c861` (base real desta auditoria após a correção) já continha, por trabalho de terceiros
  anterior a esta sessão, os artefatos de infraestrutura de demonstração descritos ao longo deste
  documento — nada disso foi produzido por esta auditoria, apenas lido e incorporado à análise.
