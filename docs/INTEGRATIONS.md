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
