# Estado Atual da Demo — Patrono Alta Performance

> **Fotografia operacional — não é especificação, não é arquitetura, não é decisão de produção.**
> Este documento existe para responder uma pergunta só: *"como está o ambiente de demonstração agora?"*
> Ele é atualizado a cada rodada de estabilização/correção da demo; documentos históricos (Sprint 1,
> `docs/handoff-codex/`, `docs/STATUS-HOMOLOGACAO.md`) **não são reescritos** — permanecem como registro
> do que eram nas fases anteriores.
>
> **Proveniência dos dados abaixo:** fatos de **código** (correções, testes, arquivos) foram verificados
> diretamente neste repositório. Fatos de **infraestrutura/operação** (RAM do Postgres, status do Fly,
> run id e volumes da última sincronização) são os reportados pelo operador do ambiente — eu não tenho
> acesso de rede ao Fly nem à demo publicada a partir deste ambiente de execução, então não os
> reexecutei/reverifiquei eu mesmo. Onde isso importa, está dito explicitamente.

## 1. Escopo

- **Ambiente:** demo/staging — **não é produção**. Existe para uma apresentação específica ao Comitê
  Jurídico, não para uso operacional real da COEVO.
- **Referência temporal:** esta fotografia reflete o estado relatado em setembro/2026, após a
  integração completa do catálogo Monday (35 boards) e a estabilização de infraestrutura descrita nas
  seções 4–5.
- **Branch:** `claude/demo-staging-deploy` — todo o trabalho desta rodada (e das anteriores de
  estabilização da demo) vive exclusivamente aqui. `master` não foi tocada por nenhuma dessas rodadas.
- **Relação com `docs/MASTER_HANDOFF.md`:** o Handoff Master v1.3 continua sendo a especificação
  arquitetural oficial e congelada do produto. Nada neste documento a substitui, contradiz ou reabre —
  este documento é puramente operacional (infraestrutura, estado de sincronização, pendências visuais
  de um ambiente temporário), nunca uma decisão de arquitetura.
- **Relação com `docs/DEMO_DEPLOY.md`:** aquele documento é o **roteiro** (como provisionar/subir o
  ambiente do zero). Este é a **fotografia** do que já está provisionado e rodando.

## 2. Infraestrutura

| Item | Estado reportado |
|---|---|
| App Fly | `patrono-legal-demo` |
| Banco Fly | `patrono-legal-demo-db` |
| Papel do banco | `primary` |
| Health checks | 3/3 passing (no estado validado) |
| `auto_stop_machines` | `false` |
| `auto_start_machines` | `true` |
| `min_machines_running` | `1` |
| Produção | continua **NO-GO** (`docs/PRODUCTION_GATE.md`) |

**Observações de estabilidade:**
- `auto_stop_machines`/`min_machines_running` foram alterados de `"stop"`/`0` para `false`/`1`
  especificamente porque o Fly autostopou a máquina no meio de uma sincronização real via SSH — autostop
  mede tráfego HTTP, não sessões SSH/scripts em execução (decisão registrada em `docs/DECISIONS.md`,
  PROD-DEMO-01). Reverter para os valores de custo mínimo é seguro fora de janelas de
  sincronização/apresentação (ver seção 8).
- `GET /api/health/live` permanece **liveness puro** — não depende do banco/persistência, nunca reporta
  falha por causa do Postgres estar indisponível.
- `GET /api/health/ready` continua **dependente da persistência/schema** — reporta corretamente quando o
  banco ou o schema não estão prontos.

## 3. Integração Monday

- **Workspace:** Jurídico, id `1678965`.
- **Catálogo:** **35 boards habilitados** (`legal-source-catalog.js` — fonte única de verdade, também
  usada por `MONDAY_BOARDS` em `server.js`, pelo menu Jurídico em `public/app.js` e pelos widgets do
  Dashboard em `dashboard-service.js`).
- **Duplicata desabilitada:** 1 board (Entrega de Chaves Carpe Diem, id `18428261720`) permanece
  explicitamente desabilitado no catálogo — sem conteúdo exclusivo identificado que o justifique como
  fonte separada.
- **Modo:** somente leitura. `mondayQuery()`/`fetchMondayBoard()` só enviam operações GraphQL `query`,
  nunca `mutation` — verificado por teste automatizado de código-fonte
  (`tests/legal-source-catalog.test.js`), não apenas por revisão manual.
- **Subitems:** **ainda não integrados.** As queries de sincronização buscam apenas os itens de nível
  superior de cada board (`items_page`); os boards "Subelementos de..." não têm fonte própria no
  Patrono. Por isso, **não se declara "100% de tudo do Monday"** enquanto isso não for resolvido.
- **`LegalDeadline`:** **zero criação automática** a partir de dados do Monday, em qualquer board.
  `LegalDeadline` continua sendo uma entidade canônica própria (Postgres), preenchida manualmente; datas
  do Monday (ex.: "PRAZO FINAL" de Notificações Clientes) aparecem apenas como contexto/referência
  operacional, nunca como prazo judicial confirmado. Regra D1 (`docs/DECISIONS.md`, seção 1.1)
  inalterada.

## 4. Última sincronização validada

**Reportado pelo operador do ambiente** (não reexecutado por mim nesta rodada):

- Run id: `95f2d2cf-3c53-415c-aa70-5d308421a14b`
- Status geral: `completed`
- Falhas: `0`
- 35 boards habilitados processados com status `OK`

**Principais volumes reportados** (amostra, não a lista completa dos 35 boards):

| Board | Registros |
|---|---|
| Processos Judiciais | 280 |
| Notificações Clientes | 1.129 |
| Honorários Extrajudiciais | 917 |
| Contratos para Clientes / Compra e Venda | 1.430 |
| Distratos e Desistências | 48 |
| Análise Jurídica | 411 |
| ADM Contratos Prestadores | 457 |
| Obra Contrato Prestação de Serviço | 459 |
| Entrega de Chaves — Carpe Diem | 135 |
| Entrega de Chaves — Vita Village | 116 |
| Entrega de Chaves — Aurora Residence | 290 |

## 5. Estabilidade

**Problema observado (RAM de 256 MB):** durante a sincronização completa dos 35 boards, o Postgres do
Fly com 256 MB de RAM mostrou instabilidade real:
- `recovery mode`;
- "the database system is not yet accepting connections";
- timeouts de conexão;
- health checks críticos.

**Correção aplicada:** aumento da RAM do Postgres para **1024 MB (1 GB)**. Após o aumento, a
sincronização completa (35 boards) concluiu sem essas falhas (ver seção 4).

**Estado saudável final:** 1 vCPU compartilhada, 1024 MB RAM, papel `primary`, 3/3 health checks
passing no estado validado.

**Não reduzir a RAM de volta para 256 MB sem repetir um teste de carga real** (sincronização completa
dos 35 boards) — a instabilidade é reproduzível, registrada como condição explícita de reversibilidade
em `docs/DECISIONS.md` (PROD-DEMO-01).

**Correções técnicas de código já estabilizadas nesta branch** (detalhe completo nos commits da branch
`claude/demo-staging-deploy` e em `docs/DECISIONS.md`, PROD-DEMO-01):
- `pool.on('error', ...)` registrado no pool do PostgreSQL (client ocioso perdendo conexão não derruba
  mais o processo).
- `client.on('error', ...)` registrado também no client checked-out de `withTransaction()` (mesma
  classe de crash, client em uso durante uma transação).
- Retry com backoff limitado para erros transitórios de conexão (nunca em loop indefinido).
- Reconciliação de conflito de CAS após erro ambíguo de conexão: relê o estado canônico do banco,
  reaplica **só o board corrente** de forma idempotente, nunca faz overwrite às cegas, nunca duplica.
- Persistência por board/lote na sincronização (nunca uma única escrita gigante ao final).

## 6. Segurança e governança

- **Auth/MFA/RBAC:** preservados, sem alteração em nenhuma rodada de estabilização da demo.
- **`master`:** permanece separada e intocada — todo trabalho de demo/staging vive em
  `claude/demo-staging-deploy`.
- **Produção:** continua **NO-GO** (`docs/PRODUCTION_GATE.md`) — nada nas rodadas de demo altera esse
  gate.
- **Monday:** zero mutation, em qualquer board, em qualquer rodada.
- **CAS (compare-and-swap) do PostgreSQL:** preservado — nunca removido ou contornado; a reconciliação
  de conflito (seção 5) relê e reaplica, nunca ignora o CAS.
- **`LegalDeadline`:** zero criação automática a partir do Monday (seção 3).

## 7. Limitações e pendências

**Integrações:**
- Subitems do Monday continuam fora do escopo integrado (seção 3).
- Sienge, CV (Construtor de Vendas) e Clicksign continuam pendentes onde já documentado em
  `docs/INTEGRATIONS.md` — sem mudança nesta rodada.
- Google Calendar com OAuth real continua pendente (credenciais de app ausentes neste ambiente) —
  `docs/INTEGRATIONS.md`.

**Pendências visuais de QA (correção de código aplicada; PASS visual real no ambiente publicado ainda
não confirmado — ver `docs/QA.md`, seção "Rodada DEMO/STAGING"):**
1. Card/evento "Comitê Executivo mensal" — CTA "Abrir" agora condicionado a destino real; roteamento
   `comite:<departamento>` reaproveita a tela de Comitês já existente.
2. Evento histórico de 12/08/2026 não deve mais aparecer como "próximo/upcoming" — filtro por data
   civil (`America/Sao_Paulo`) aplicado.
3. Tela Integrações — contagem de boards agora dinâmica (`state.mondayStatus.moduleCount`), não mais
   hardcoded.

**Achados adicionais de CTA reportados, ainda não corrigidos (fora do escopo das 3 correções acima —
reportados para decisão, não corrigidos automaticamente):**
- Widget "Próximos compromissos" do Painel de TI (`ti-deadlines`) tem a mesma classe de bug do item 2
  acima — não corrigido nesta rodada (P1).
- `barList()` (`public/app.js`): botões sem `clickModule` ficam sem `onclick` mas também sem
  `disabled` — ainda parecem interativos (P2).
- Widget "Decisões" (`decision-list`, Painel Executivo): linhas de `store.committees` sem
  `target`/`value` — hoje vazio por padrão (sem CTA quando populado) (P2).

**Não homologado / não declarado nesta rodada** (para evitar qualquer leitura excessiva do que foi
feito):
- **Não** se declara "100% de tudo do Monday" — subitems ficam de fora.
- **Não** se declara Google Calendar completo.
- **Não** se declara Sienge/CV/Clicksign completos.
- **Não** se declara produção liberada.

## 8. Procedimento antes de nova apresentação

Checklist operacional curto (execução manual pelo operador — nada aqui é automatizado):

- [ ] App Fly `patrono-legal-demo` está `started` (não dormindo).
- [ ] Banco Fly `patrono-legal-demo-db` está `primary`.
- [ ] 3/3 health checks passing.
- [ ] Sincronização Monday recente (verificar `mondayRuns`/último run id — seção 4).
- [ ] Última sincronização com `0` falhas (ou falhas conhecidas e explicadas, nunca ignoradas).
- [ ] Teste visual real do módulo Jurídico (login, Dashboard, Processos, Comitês, Integrações) — não
      basta o PASS técnico da suíte automatizada (ver `docs/QA.md`).
- [ ] **Não** reduzir a RAM do Postgres sem repetir um teste de carga real (seção 5).
- [ ] **Não** fazer merge desta branch em `master` sem revisão explícita e autorizada.
