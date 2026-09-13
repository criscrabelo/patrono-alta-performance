# LEGAL_COMMITTEE_READINESS.md — Prontidão do Módulo Jurídico para o Comitê

> Rodada de fechamento para apresentação ao Comitê Jurídico (piloto controlado, não produção).
> Branch `claude/legal-committee-ready`, base `master` em `c3fbb1c750624dfb0428d94909a724c9f8de44f6`.
> Não toca H8/H9/H10/H11 (PR #19 do H8 permanece separado e intocado) nem qualquer código de
> Seller/Autopilot. **Produção continua NO-GO** — este documento não abre nem contradiz o gate de
> produção (`docs/PRODUCTION_GATE.md`).

## 1. Objetivo

Responder, de forma verificável, se uma gestora jurídica consegue abrir a plataforma amanhã, navegar
pelo módulo Jurídico e apresentar dados reais ao Comitê sem precisar justificar bug, tela quebrada ou
número inventado.

## 2. Auditoria pré-implementação (resumo)

Auditoria completa do módulo Jurídico existente, feita por leitura de `public/app.js`, `server.js`,
`dashboard-model.js`/`dashboard-service.js`, `docs/DATA_MODEL.md`/`docs/DECISIONS.md` (D1) e
`docs/PERMISSIONS.md`, antes de qualquer alteração de código. Achados principais:

- **Backend robusto e já homologado**: modelo LegalDeadline (estados persistidos vs. derivados, D1),
  RBAC/scope (`allowedInDepartment`/`allowedContent`/`scoped`), APIs de Agenda/Atenção/Minha Semana
  (`GET /api/agenda-items`, `/api/attention`, `/api/my-week`) e o dashboard configurável D1-compliant
  (`dashboard-model.js`/`dashboard-service.js`, id `legal`) já existiam, testados, mas **não estavam
  todos conectados a uma tela navegável**.
- **P0-DEMO crítico**: a tela padrão do Jurídico ("Painel Executivo Jurídico") **não usava** o dashboard
  D1-compliant — usava uma página legada (`legalDashboardPage()`) que calculava "prazo crítico"/"vencido"
  a partir de colunas brutas do Monday (`PRAZO FINAL`, `data6`/`data9`), exatamente a prática que D1
  proíbe. O dashboard correto (`/api/dashboards/legal`) existia e era testado, mas nunca era roteado.
- **P0-DEMO crítico**: "Atenção" e "Minha Semana" tinham API pronta e testada, mas **nenhuma tela** as
  consumia — não existiam como itens de menu navegáveis.
- **P0-DEMO crítico** (descoberto durante o ensaio real de navegação em browser, não hipotético): a tela
  padrão ao entrar era sempre "Painel Executivo COEVO" (dashboard corporativo, exige alçada global — só
  `diretoria`), mesmo para usuários `lider`/`colaborador`/`administrador` do departamento Jurídico —
  qualquer um desses perfis recebia um **erro puro (403) na primeira tela**, antes de conseguir navegar
  para qualquer lugar.
- **P1-DEMO**: "Comitê Jurídico" (item de menu antigo) sempre retornava 404 (sem board Monday
  configurado); o menu corporativo "Comitês & Reuniões" era um placeholder estático sem dado nenhum;
  `committee.css` existia mas nunca era referenciado em `index.html` nem usado por nenhuma função —
  100% código morto.
- **P1-DEMO**: 7 dos 14 módulos do submenu Jurídico não têm board Monday configurado nesta rodada
  (`contratos`, `administrativos`, `retomadas`, `riscos-regulatorio`, `recuperacao`, `fatos`, `comite`) —
  ao abrir, mostravam silenciosamente "0 registros" (indistinguível de um filtro zerado).
- **P2/P3**: paleta visual atual é teal/cyan (`--brand:#20b5c7`), não terracota/cobre/bege/champagne
  pedido no brief — ver seção 8 (não tratado nesta rodada, ver limitações).

## 3. Matriz de Prontidão do Jurídico

| Funcionalidade | Existe? | Funciona? | Dados reais? | Fonte | Problema | Severidade | Ação |
|---|---|---|---|---|---|---|---|
| Dashboard Jurídico | Sim | Sim (corrigido) | Sim | `legalDeadlines`/Monday `processos` | Usava cálculo de prazo a partir de coluna bruta do Monday (violava D1) | **P0-DEMO** | **Resolvido** — reroteado para o dashboard D1-compliant (`/api/dashboards/legal`) |
| Visão para Comitê | Não existia | Sim (novo) | Sim | `legalDeadlines`/processos, mesmos dados já carregados pelo Dashboard | Não existia | **P0-DEMO** | **Resolvido** — seção anexada ao Dashboard, sem nova página, sem chamada extra de API |
| Processos | Sim | Sim | Sim | Monday `processos` | Nenhum (módulo já sólido) | — | Nenhuma |
| Prazos | Não existia como tela | Sim (novo) | Sim | `legalDeadlines` (canônico) | Não existia tela; só API | **P0-DEMO** | **Resolvido** — nova tela dedicada |
| Agenda | Sim (reaproveitada) | Sim | Sim | `legalDeadlines` + `store.agenda` | Nenhum | — | Mantida no menu Utilitários existente (não duplicada) |
| Atenção | Não existia como tela | Sim (novo) | Sim | `legalDeadlines` | Não existia tela; só API | **P0-DEMO** | **Resolvido** — nova tela dedicada |
| Minha Semana | Não existia como tela | Sim (novo) | Sim | `legalDeadlines` + Google Calendar (read-only) | Não existia tela; só API | **P0-DEMO** | **Resolvido** — nova tela dedicada |
| Landing padrão para perfil não-diretoria | Quebrada | — | — | — | 403 puro na primeira tela para lider/colaborador/administrador | **P0-DEMO** | **Resolvido** — pouso seguro por departamento; item de menu bloqueado deixa de aparecer |
| Comitê Jurídico (item antigo) / Comitês & Reuniões | Sim | Não (404/placeholder) | Não | — | Item morto, `committee.css` órfão | **P1-DEMO** | Não resolvido nesta rodada (substituído pela Visão para Comitê no Dashboard) — ver seção 7 |
| Contratos/Administrativos/Retomadas/Riscos-regulatório/Recuperação/Fatos relevantes | Sim (menu) | Não (sem board) | Não | — | "0 registros" ambíguo | **P1-DEMO** | **Resolvido** — mensagem explícita "módulo ainda não integrado", nunca dado fictício |
| Honorários (extra/judicial), Notificações, Distratos, Compra e venda, Transferências | Sim | Sim | Sim | Monday | Nenhum | — | Fora do escopo do roteiro de amanhã, mas funcionais |
| Design visual (paleta) | Teal/cyan | Funcional | — | — | Não é terracota/cobre/bege pedido no brief | **P2** | Pós-Comitê — ver seção 8 |

## 4. O que foi corrigido (P0-DEMO)

1. **Dashboard Jurídico agora é o dashboard D1-compliant** (`dashboard-model.js`/`dashboard-service.js`,
   id `legal`) — `dashboardIdForScreen()` ganhou `juridico:'legal'`; `juridicoPage()` deixou de chamar
   `legalDashboardPage()` (cálculo de prazo a partir de coluna bruta do Monday) e passou a chamar
   `configuredDashboardPage()`. `legalDashboardPage()` permanece definida no arquivo (não removida, para
   não ampliar o diff), mas **nunca mais é invocada**.
2. **Seção "Visão para Comitê"** anexada ao próprio Dashboard Jurídico (`legalCommitteeSection()`) —
   reaproveita os mesmos widgets já carregados (`active-processes`, `legal-risk`, `legal-deadlines`),
   sem nenhuma chamada de API adicional. Mostra Processos ativos, Prazos vencidos, Prazos críticos (30
   dias) e a lista de prazos críticos/vencidos com responsável — nunca inventa "Fatos relevantes" (mostra
   texto explícito de que esse módulo não está integrado nesta rodada).
3. **Tela "Prazos"** (`legalDeadlinesPage()`) — nova, usa `GET /api/entities/legalDeadlines?paginated=1`
   (rota já existente, apenas enriquecida — ver seção 6). Filtros por status persistido
   (ativo/suspenso/cumprido/cancelado), tipo (`JUDICIAL_PROCESSUAL`/`INTERNAL_CONTROL`, rotulados "Prazo
   processual"/"Controle interno") e situação derivada (vencido/não vencido) — nunca persiste o derivado.
4. **Tela "Atenção"** (`legalAttentionPage()`) — nova, consome `GET /api/attention` (já existente),
   agrupando em Prazos vencidos / Prazos próximos (30 dias) / Requer revisão, com estado vazio elegante
   por grupo.
5. **Tela "Minha Semana"** (`legalMyWeekPage()`) — nova, consome `GET /api/my-week` (já existente),
   mostra a janela civil (segunda a domingo, `America/Sao_Paulo`) e avisa honestamente quando o Google
   Calendar não está configurado, sem nunca inventar evento.
6. **Landing padrão seguro** — `render()` verifica `hasGlobalScope()` (a partir de
   `permissions.scopes` já devolvido por `GET /api/me`, nunca uma lista de papéis duplicada no cliente)
   e reroteia lider/colaborador/administrador para o departamento do próprio usuário (ou "Alertas") em
   vez de tentar abrir "Painel Executivo COEVO", que exige alçada global. `canSeeScreen()` também deixa
   de mostrar esse item (e "Estratégia"/"Riscos", mesma regra) no menu para quem não pode abri-lo.
7. **Módulos sem fonte de dados** (`contratos`, `administrativos`, `retomadas`, `riscos-regulatorio`,
   `recuperacao`, `fatos`) agora mostram "Este módulo ainda não está integrado a uma fonte de dados nesta
   rodada. Nenhum registro fictício é exibido aqui." em vez de uma tabela silenciosamente vazia.
8. **Menu Jurídico reordenado**: Painel Executivo Jurídico → Processos → Prazos → Atenção → Minha
   Semana → (demais módulos, inalterados). "Comitê Jurídico" (item que sempre 404, redundante com a nova
   Visão para Comitê) foi removido do submenu; "Fatos relevantes" deixou de ser rotulado incorretamente
   como "Prazos" (apontava para um módulo Monday inexistente). Agenda **não foi duplicada** — continua
   acessível pelo item já existente em Utilitários.

## 5. Regressão encontrada e corrigida durante a validação

Ao enriquecer `GET /api/entities/legalDeadlines?paginated=1` com `process`/`responsibleUserId`/labels
(para a tela de Prazos), a primeira versão aplicou o mesmo enriquecimento também à listagem **não
paginada** (`GET /api/entities/legalDeadlines` sem `?paginated=1`), usada por chamadores pré-existentes
— isso convertia um campo ausente (`undefined`) em `null` explícito via `responsibleInfo()`, quebrando um
teste de regressão já homologado (`security-integration.test.js`, "PATCH de responsável: atribuição a
usuário INATIVO é rejeitada com 422, sem alterar o registro"). **Corrigido**: o enriquecimento agora só é
aplicado dentro do branch `?paginated=1`; a listagem simples voltou a devolver exatamente o objeto
`item` original, como antes. Confirmado com a suíte completa: 549/549 novamente, sem esse nem nenhum
outro efeito colateral.

## 6. Conformidade D1 (nunca prazo bruto do Monday vira prazo jurídico)

- `legalDeadlineRows()`/`isLegalDeadlineOverdue()`/`civilDateAfterDays()` continuam a única fonte de
  "vencido"/"crítico" em todo o sistema — nenhuma nova função deriva prazo de `PRAZO FINAL`/coluna bruta.
- `enrichedLegalDeadlineRows()` (novo, server.js) é uma projeção de leitura sobre `legalDeadlines` já
  existente (mesmos dados de `scopedLegalDeadlineRows()`/`legalDeadlineAgendaItems()`/
  `legalDeadlineAttentionItems()`) — nunca cria um novo cálculo de prazo, apenas reutiliza
  `legalDeadlineIntegrityFlag()`/`legalDeadlineConfirmationLabel()`/`legalDeadlineLabels()` já
  homologados.
- `LegalProcess 1:N LegalDeadline` preservado — `Prazos`/`Atenção`/`Minha Semana`/`Visão para Comitê`
  sempre mostram o `processId`/`process.title` relacionado, nunca um prazo solto sem processo.
- Labels "Prazo processual"/"Controle interno" (originType) e "Confirmado pelo Jurídico" (nunca
  "Comprovado documentalmente" sem `evidenceReference`) aparecem, pela primeira vez, em uma tela real —
  antes só existiam na resposta de API sem consumidor de UI.

## 7. Monday (leitura apenas) e source-down

- Nenhuma rota nova escreve no Monday — todas as telas novas leem exclusivamente de `legalDeadlines`
  (Postgres canônico) ou de `store.agenda`; o Google Calendar consultado por Minha Semana já era,
  e continua sendo, somente leitura (`docs/DECISIONS.md`, D4.1).
- Falha de sincronização do Monday nunca produz um "0" falso: os widgets do Dashboard usam o mesmo
  contrato `ready/empty/error/integration_pending` já existente (`dashboard-widgets.js`), que mostra
  "Dados não disponíveis"/"Não foi possível carregar" — nunca um zero silencioso. Confirmado no ensaio
  manual (campo "Última atualização" mostra "Dados não disponíveis" quando não há sincronização recente,
  nunca "0").
- Módulos sem board Monday mostram a mensagem explícita da seção 4, item 7 — nunca um "0 registros"
  ambíguo.

## 8. Limitações reais restantes (não resolvidas nesta rodada, deliberadamente)

- **"Comitê Jurídico" como módulo dedicado** (pauta, atas, decisões) não foi reconstruído — a Visão para
  Comitê no Dashboard cobre o essencial para a apresentação de amanhã (processos/prazos críticos e
  vencidos), mas não é um sistema de atas/decisões. `committee.css` permanece órfão (não removido, não
  ativado) — decisão de escopo, não esquecimento.
- **Paleta visual** continua teal/cyan, não a paleta terracota/cobre/bege/champagne mencionada no brief
  — um rebrand visual completo (~2.600 linhas de CSS em 7 arquivos) sob prazo de um dia é um risco maior
  do que o benefício; recomendado tratar como rodada própria, não às vésperas do Comitê.
- **Minha Semana** só mostra Legal Deadline atribuído a `responsibleUserId`; eventos manuais de Agenda
  (`store.agenda`) não entram (mesma limitação já documentada em `docs/DATA_MODEL.md` — `owner` é texto
  livre, sem id canônico de usuário).
- **Freshness por registro**: a idade da sincronização é rastreada por execução (`mondayRuns`), não por
  registro individual — um registro de um board que falha há dias continua exibido com seu último valor
  conhecido, sem um selo "desatualizado" no próprio registro (gap já documentado, não introduzido nem
  fechado nesta rodada).
- **`transferencia-intermediaria`** só existe se a env var `MONDAY_BOARD_TRANSFERENCIA_INTERMEDIARIA`
  estiver configurada no ambiente real — confirmar antes da apresentação, se esse módulo for necessário.

## 9. Testes

- **Baseline confirmado**: 549/549 antes de qualquer alteração (branch criada exatamente em
  `c3fbb1c750624dfb0428d94909a724c9f8de44f6`).
- **Final**: 549/549 (nenhum teste novo foi adicionado nesta rodada — mudança é de roteamento de
  frontend + enriquecimento aditivo de uma rota já testada; a suíte existente já cobre
  `GET /api/entities/legalDeadlines`, `/api/attention`, `/api/my-week`, `/api/dashboards/legal`, RBAC/
  scope de Legal Deadline). Zero regressões, zero cancelados, zero pulados. PostgreSQL real
  (`TEST_DATABASE_URL`), Node 20.x/22.x (mesma matriz de CI).
- `npm audit`: inalterado (2 vulnerabilidades altas conhecidas, `image-size`/`pptxgenjs` — H9, fora de
  escopo desta rodada).
- `docs/MASTER_HANDOFF.md`: sem diff contra `origin/master` (confirmado via `git diff --stat`).

## 10. Validação manual por navegador (Playwright, ambiente local efêmero)

Executada com dados reais criados via API (um processo Monday-sourced sintético + Legal Deadlines
reais, nunca fictícios na UI final — dados de teste descartados ao final da sessão, nunca commitados),
autenticado como usuário `colaborador` do departamento Jurídico (o perfil com MENOS alçada que ainda
acessa o módulo — o pior caso realista de RBAC):

- Login → Dashboard Jurídico: abre direto, sem 403, com "Visão para Comitê" visível e populada.
- Processos, Prazos, Atenção, Minha Semana: todas abrem sem erro de console/rede, com dados reais e
  labels corretos (D1: "Prazo processual"/"Controle interno", "Confirmado pelo Jurídico").
- Minha Semana: mostra apenas o item atribuído ao próprio usuário logado, dentro da semana civil corrente
  — confirma RBAC/`responsibleUserId` corretos.
- Contratos (módulo sem board): mostra a mensagem elegante de "não integrado", não um erro nem uma tabela
  vazia ambígua.
- Nenhum erro de JavaScript, nenhuma resposta HTTP ≥400 inesperada em nenhuma das telas acima.

## 11. Checklist manual final

- [x] login funciona
- [x] MFA funciona (testado com usuário `lider` MFA-obrigatório em validação separada)
- [x] abre ambiente Jurídico
- [x] Dashboard abre
- [x] Visão para Comitê aparece
- [x] Processos abre
- [x] Prazos abre
- [x] Agenda abre (item já existente em Utilitários, não duplicado, não alterado)
- [x] Atenção abre
- [x] Minha Semana abre
- [x] nenhum erro de frontend
- [x] nenhum 500
- [x] nenhum dado fictício
- [x] nenhum zero falso por source-down
- [x] LegalDeadline continua canônico
- [x] data do Monday não vira prazo automaticamente
- [x] responsável correto (`responsibleUserId`, "Responsável inativo" quando aplicável)
- [x] RBAC preservado (nenhuma rota de autorização alterada — apenas roteamento de frontend +
  enriquecimento aditivo de leitura)
- [x] scopes preservados (`scoped()`/`allowedInDepartment()` inalterados)
- [x] Calendar ausente comunicado honestamente ("não configurado nesta rodada")
- [x] `docs/MASTER_HANDOFF.md` intocado

## 12. Roteiro de navegação sugerido para o Comitê

1. Login com a conta do usuário Jurídico designado.
2. Pousa automaticamente no **Painel Executivo Jurídico** (ou em Alertas, se o perfil não tiver
   departamento Jurídico).
3. Rolar até **Visão para Comitê** — processos ativos, prazos vencidos e críticos, com responsável.
4. Clicar em **Processos** — mostrar busca/filtros/paginação.
5. Clicar em **Prazos** — mostrar status persistido vs. situação derivada, tipo (processual/controle
   interno), confirmação.
6. Clicar em **Atenção** — mostrar os três grupos (vencidos/próximos/requer revisão).
7. Clicar em **Minha Semana** — mostrar a janela da semana civil corrente.
8. Voltar ao Dashboard para encerrar a apresentação.

## 13. Decisão final

Continua **NO-GO para produção** (inalterado — este documento não é uma decisão de gate de produção,
é uma prontidão de piloto controlado para uma apresentação específica). PG-19/PG-18/PG-17/PG-20/PG-21
permanecem exatamente como estavam antes desta rodada (nenhum tocado). H8 (PR #19) permanece separado,
não mesclado, não tocado. Nenhum código de Seller/Autopilot existe neste repositório e nenhum foi
adicionado.
