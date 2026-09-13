# INTEGRATIONS.md — Integrações

> Regras oficiais: `docs/MASTER_HANDOFF.md` §10 (Integrações), §18 (Erros/Source Down), Anexo A
> (regras 3 e 14).

## Monday.com — único conector ativo no MVP

- **Papel:** Operacional/transitório (System of Record dos boards integrados durante o MVP; Patrono é
  identidade canônica e camada de governança — §9).
- **Modo:** Somente leitura. Nenhuma mutation é enviada ao Monday (`mondayQuery`/`fetchMondayBoard`
  fazem apenas `query`, nunca `mutation`).
- **Execução:** Exclusivamente server-side. `MONDAY_TOKEN` só existe em variável de ambiente, lido uma
  única vez no boot do processo (`server.js:11-17`) e nunca incluído em nenhuma resposta HTTP enviada ao
  navegador. Verificado nesta execução: nenhuma rota devolve `process.env.MONDAY_TOKEN`;
  `/api/monday/status` devolve apenas `configured: boolean` e a lista de boards/IDs, nunca o token.
- **Idempotência:** upsert por `(source === 'monday', externalId)` — registros existentes são
  atualizados (`version++`), nunca duplicados.
- **Preservação de origem:** cada registro sincronizado carrega `source: 'monday'`, `externalId`,
  `boardId`, `boardName`, `syncedAt` — nunca perdidos em atualização.

### Falha de fonte — preservação do último dado válido (P0 §18/§26)

Quando `fetchMondayBoard(board.id)` lança erro durante uma sincronização:

- O `catch` de cada board **não toca** nos registros já existentes daquele board — eles permanecem
  exatamente como estavam na última sincronização bem-sucedida.
- A execução (`mondayRuns`) registra o board como `status: 'error'` com a mensagem de erro, e a
  execução completa é marcada `partial` (HTTP 207) em vez de `completed` (HTTP 200) quando qualquer
  board falha.
- **Nenhum valor é convertido em zero ou removido.** Não há caminho de código em que uma falha de
  `fetchMondayBoard` apague ou zere um registro existente — o `catch` apenas empurra uma entrada de erro
  em `run.modules`, sem tocar em `collection(store, moduleName)`.

Isso está de acordo com a regra global "Falha de fonte ≠ ausência de dado" (Anexo A, regra 3) e "Falha
de fonte preserva o último dado válido com status e timestamp; nunca apaga nem converte em zero" (regra
14).

**Gap conhecido (não resolvido nesta execução):** o status de frescor (`stale`/Parcial/Indisponível) e o
timestamp da última tentativa hoje só existem no nível da **execução de sincronização** (`mondayRuns`),
não anexados a cada **registro individual**. Um registro específico não carrega, por si só, "última
tentativa de atualização" quando o board falha — apenas o histórico de execuções em `mondayRuns` permite
reconstruir isso. Recomendação de próximo passo: anexar `lastSyncAttemptAt`/`syncStatus` por registro
quando o volume de boards/registros justificar a granularidade.

### Google Drive, Google Calendar, Clicksign, CV, Sienge, demais plataformas

Não integrados nesta execução — corretamente fora do escopo do Sprint 1 (§10 os lista como leitura,
piloto opcional ou pós-MVP). `public/app.js` já exibe esses conectores como "Aguardando credencial" na
tela de Integrações, sem simular dados.

**Google Calendar, quando ativado:** é apenas view de leitura de compromissos, nunca fonte de prazo
jurídico (§10, §23). Nenhuma automação desta execução liga Legal Deadline a eventos de calendário.

### Google Calendar — decisão HOMOLOGADA: Opção B, leitura apenas (Sprint 2, Fase 4A)

**Status: opcional, não canônico, não SoT, não fonte de cálculo, não fonte de confirmação — ativação
HOMOLOGADA como Opção B (leitura apenas).** A Fase 4A (`docs/DECISIONS.md`, seção 1.2, D4.1) analisou as
opções e a Cristiane homologou, em 12/09/2026, a **Opção B**: Patrono **lê** a agenda pessoal do usuário
no Google Calendar (compromissos que o próprio usuário já tem lá) e pode exibi-los em uma view
complementar, lado a lado com a Agenda combinada da Fase 3. **Patrono não cria, não atualiza e não remove
nenhum evento no Google Calendar do usuário. Legal Deadline não é espelhado no Calendar.** Nenhum
`originType`/`status` de Legal Deadline "entra" no Calendar, porque nada é escrito lá.

A Opção C (espelhamento Patrono → Calendar, com escrita) **não foi homologada** — permanece registrada
apenas como possibilidade futura, condicionada a uma decisão de negócio própria que abra exceção formal à
regra "nenhuma escrita externa no MVP" (§10). As regras abaixo, portanto, só valeriam para essa eventual
Opção C futura, não para o piloto atual:
- `originType`: ambos poderiam aparecer, nunca sem identificação clara (`INTERNAL_CONTROL` nunca
  rotulado como prazo processual).
- `status`: apenas `ativo` geraria/manteria evento; `suspenso`/`cumprido`/`cancelado` não gerariam evento
  novo.
- Conteúdo do evento: título neutro/mínimo (recomendação D4.7, preservada como referência — "Prazo
  jurídico — Patrono").
- Nenhum caminho de sincronização permitiria que o Calendar alterasse o Legal Deadline de volta.

**Para a Opção B homologada (a única em vigor):** indisponibilidade da leitura de Calendar nunca afeta o
Legal Deadline no Patrono nem esconde/zera nada — mesma regra de "falha de fonte preserva o último dado
válido" já aplicada ao Monday (D4.8, Anexo A regras 3/14); a indisponibilidade afeta apenas a
visualização complementar dos compromissos pessoais do Google.

### Google Calendar — implementação (Sprint 2, Fase 4B)

Implementado como **adapter somente leitura** (`googleCalendarStatus()`/`googleCalendarEvents()` em
`server.js`), servindo `GET /api/calendar/status` e `GET /api/calendar/events`. Nenhum método de escrita
da API do Google Calendar (criar/atualizar/remover evento) existe no código — verificado por teste
automatizado de código-fonte (`tests/core.test.js`), não apenas por revisão manual.

**Blocker técnico (não uma decisão de produto):** este ambiente não possui credenciais reais de OAuth do
Google (variáveis `GOOGLE_CALENDAR_CLIENT_ID`/`GOOGLE_CALENDAR_CLIENT_SECRET` ausentes). Por isso, a
ativação real da leitura (fluxo de consentimento OAuth, compromissos de verdade do usuário) permanece
bloqueada por design: `googleCalendarStatus()` devolve `status: 'not_configured'` (ou `'unavailable'` se
as variáveis existirem mas a conexão em si não estiver estabelecida) e `googleCalendarEvents()` sempre
devolve `events: []` — nunca uma simulação/mock de compromissos reais. Nenhuma das duas funções expõe
token/segredo em nenhuma circunstância (verificado por teste HTTP).

Consequência prática: a leitura real de agenda pessoal do Google só é possível quando (a) credenciais de
OAuth de app forem provisionadas neste ambiente e (b) um mecanismo seguro de armazenamento de token por
usuário for definido — nenhum dos dois foi resolvido nesta rodada; a interface (`configured`/`connected`/
`status`/`events`) já é o ponto de extensão para quando isso existir, sem exigir mudança de contrato para
quem já consome a rota hoje.

`GET /api/my-week` ("Minha Semana", D4.10) combina Legal Deadline (fonte canônica) com esta mesma leitura
do Calendar, sem misturar as duas fontes: eventos de Calendar entram como `entityType: 'calendarEvent'`
com `externalId` (nunca um id canônico Patrono), nunca viram Legal Deadline/Task, e a ausência/
indisponibilidade do Calendar nunca afeta os itens de Legal Deadline na mesma resposta.

## Regras de segurança de integração aplicadas

- **Menor privilégio:** o token Monday é único por ambiente, correspondente à finalidade de leitura dos
  boards do piloto jurídico; não há credencial compartilhada com outro domínio.
- **Sem escrita externa:** nenhuma rota deste repositório grava no Monday.
- **Sem segredo no frontend:** verificado por teste automatizado (`tests/core.test.js`, `.env.example`
  sem placeholders funcionais) e por inspeção manual de `public/app.js` — nenhuma referência a
  `MONDAY_TOKEN` ou a qualquer segredo fora de `process.env` no lado servidor.

## Próximos passos (fora do Sprint 1)

1. Anexar status de frescor por registro (`stale`/Parcial/Indisponível) em vez de apenas por execução.
2. **D1 (fonte/origem do Legal Deadline) foi HOMOLOGADA** — ver `docs/DECISIONS.md`, seção 1.1: nenhum
   board Monday preenche Legal Deadline automaticamente; somente `processos` participa do fluxo no
   piloto (D1.2), e mesmo assim apenas como referência/contexto, nunca como origem automática (D1.1).
   Monday permanece somente leitura e transitório, sem nenhuma mudança de papel por esta decisão.
3. Avaliar conector Google Drive como referência documental quando o piloto exigir Document/File
   Reference.
4. Corrigir, no Sprint 2, o uso de coluna bruta de data do Monday (`processDate()` em
   `dashboard-service.js`) em widgets de "prazo" do dashboard `legal` — deve passar a consultar
   `legalDeadlines`, nunca uma coluna de data do board `processos` diretamente (ver
   `docs/DATA_MODEL.md`, seção "D1 homologada").
