# Observabilidade — Logging e Monitoramento Estruturado (Hardening H6)

Sprint 2, Hardening H6 (`docs/PRODUCTION_GATE.md`, PG-17; `docs/DECISIONS.md`, PROD-H6-01). Este
documento descreve o subsistema de observabilidade da aplicação: o que é logado, o que nunca é logado,
como correlacionar uma requisição, como health/readiness funcionam e como o alerta básico opera.

## 1. Objetivo

Dar visibilidade operacional real (erro capturado, requisição correlacionável, disponibilidade
verificável) sem: (a) acoplar a aplicação a um provedor de observabilidade pago específico, (b) virar um
segundo repositório de dado pessoal/segredo, (c) confundir log operacional com o `audit_log` de negócio
já existente (H2/H3).

## 2. Arquitetura — provider-neutro

Todo o subsistema é Node.js nativo: JSON estruturado em `stdout`/`stderr`, sem OpenTelemetry, sem SDK de
Datadog/New Relic/Sentry/Splunk/CloudWatch/Azure Monitor/Grafana Cloud. Três módulos:

- **`observability/redaction.js`** — sanitização defensiva (por nome de campo e por padrão em texto
  livre). Reaproveitado por `backup/sanitize.js` (H5) — não existem duas implementações divergentes.
- **`observability/logger.js`** — logger centralizado (`debug/info/warn/error/fatal`), schema fixo,
  serializador seguro de erro. Única porta de saída de evento estruturado da aplicação.
- **`observability/alert.js`** — webhook HTTPS genérico, com HMAC opcional, cooldown e anti-recursão.

Nenhum coletor/agregador real (ex.: um serviço de busca de logs) é provisionado nesta rodada — depende
de H11 (deploy/infraestrutura). Ver seção 11 (Limitações).

## 3. Esquema de log

Cada evento é exatamente **uma linha JSON**. Campos mínimos sempre presentes:

| Campo | Descrição |
|---|---|
| `timestamp` | UTC, ISO-8601, milissegundos (`new Date().toISOString()`) — nunca depende do timezone local do servidor |
| `level` | `debug\|info\|warn\|error\|fatal` |
| `event` | Nome estável do evento (ex.: `http_request_completed`) |
| `message` | Mensagem legível (por padrão, igual a `event`, salvo campos específicos) |
| `service` | `SERVICE_NAME` (padrão `patrono-alta-performance`) |
| `environment` | `NODE_ENV` |
| `component` | Subsistema de origem (`http`, `auth`, `monday`, `backup`, `restore`, `boot`, `process`, `health`, `alert`, `storage`) |

Campos condicionais, quando aplicável: `requestId`, `correlationId`, `method`, `route`, `statusCode`,
`durationMs`, `errorCode`, `applicationCommit`. Todo campo passado ao logger é redigido antes de sair —
mesmo que o chamador esqueça de sanitizar algo, o logger nunca deixa passar um valor cujo NOME de campo
pareça segredo (ver seção 5).

## 4. Níveis

- **DEBUG** — diagnóstico detalhado; desabilitado em produção por padrão. Ex.: `/api/health` de sucesso.
- **INFO** — evento operacional normal (requisição concluída, backup concluído, boot bem-sucedido).
- **WARN** — situação anormal recuperável (sincronização Monday com falha parcial).
- **ERROR** — operação falhou ou resposta HTTP 5xx.
- **FATAL** — a aplicação não pode iniciar ou continuar com segurança (config ausente, exceção não
  tratada).

`LOG_LEVEL` controla o piso mínimo emitido (padrão de produção: `info`, nunca `debug`). Um valor
inválido de `LOG_LEVEL` em produção usa o fallback seguro documentado (`info`) — nunca degrada
silenciosamente para `debug`. **4xx nunca é classificado automaticamente como ERROR** — um 401/403
esperado (credencial errada, sessão expirada) é um evento HTTP normal (INFO), não um erro operacional;
só 5xx vira ERROR.

## 5. Redaction — o que nunca é logado

`observability/redaction.js` aplica duas camadas sempre juntas:

1. **Por nome de campo** — qualquer chave que contenha (case-insensitive) `password`, `token`, `secret`,
   `key`, `authorization`, `cookie`, `mfa`, `totp`, `hmac`, `encryption`, `pgpassword`, `databaseurl`,
   `apikey`, `accesskey`, `privatekey`, `clientsecret`, `signature` é substituída por `[REDACTED]`
   inteiro — mesmo aninhada em um objeto.
2. **Por padrão no conteúdo de string** — connection string PostgreSQL (`postgres://user:pass@host/db`),
   `password=...`, cabeçalho `Bearer ...` embutidos em uma mensagem de erro livre.

Nunca aparecem em log/alerta: `DATABASE_URL`/`DATABASE_URL_TARGET`, `PGPASSWORD`, `BACKUP_ENCRYPTION_KEY`,
`COEVO_BACKUP_KEY`, `MFA_ENCRYPTION_KEY`, `RATE_LIMIT_HMAC_KEY`, `ALERT_WEBHOOK_HMAC_KEY`,
`MONDAY_TOKEN`, `Authorization`/`Bearer`/`Cookie`/`Set-Cookie`, senha/hash/senha temporária, segredo/
código MFA, token de reset de senha, chaves de acesso S3, conteúdo integral de documento/corpo de
requisição.

Também: nenhuma mensagem/stack tem tamanho ilimitado (truncada em 2000 caracteres); quebras de linha
(`\r`/`\n`) são removidas de qualquer string logada — nunca é possível injetar uma segunda linha de log
a partir de um valor controlado pelo usuário.

## 6. Política de PII/LGPD

O log operacional **não é** um segundo repositório de dado pessoal. Por padrão, nunca são logados: nome
completo, CPF, RG, e-mail, telefone, endereço, conteúdo jurídico/processual, payload do Monday,
documentos, texto livre do usuário, IP em texto puro, User-Agent completo. Quando a identidade é
operacionalmente necessária, usa-se o `userId` interno — nunca o dado pessoal bruto. Isso é
estruturalmente garantido pelo access log HTTP nunca incluir o corpo/query string da requisição (ver
seção 8).

## 7. Logger ≠ `audit_log`

O logger de observabilidade (`observability/logger.js`) é estritamente técnico/operacional: erro,
disponibilidade, diagnóstico. O `audit_log` de negócio (H2/H3 — login, MFA, alteração de registro,
`RATE_LIMIT_TRIGGERED`) permanece o mecanismo de rastreabilidade legal/decisória; H8 poderá expandir
retenção/metadados desse audit trail. Os dois nunca são misturados no mesmo destino ou schema.

## 8. RequestId e correlação HTTP

Toda requisição HTTP recebe um `requestId` gerado no servidor (`crypto.randomUUID()`), exposto na
resposta via `X-Request-Id` — nunca confia cegamente em um identificador vindo do cliente. Todo log
emitido durante o processamento dessa requisição (erro de persistência, erro de readiness) carrega o
mesmo `requestId`, permitindo reconstruir requisição → processamento → resposta/erro sem payload
sensível.

Access log (`http_request_completed`): `requestId`, `method`, rota **normalizada** (segmentos que
parecem UUID ou id numérico viram `:id` — ex. `/api/legal/processes/:id`, nunca uma entrada nova por
requisição), `statusCode`, `durationMs`. Nunca inclui corpo, query string ou `Authorization`/`Cookie`.
Requisições de sucesso a `/api/health`/`/api/health/live`/`/api/health/ready` são registradas em DEBUG
(ruído de healthcheck periódico) — falhas continuam em WARN/ERROR normalmente.

## 9. Erros HTTP

5xx: `logger.error('http_request_completed', ...)` mais um evento dedicado quando a origem é conhecida
(`http_persistence_error`, `readiness_check_failed`), sempre com `requestId`/`route`/`errorCode`. Nunca
retorna stack ou detalhe interno ao cliente (a resposta HTTP permanece genérica); a stack, quando
existe, só aparece no log e nunca fora de produção (`logger.serializeError()`).

## 10. Health — liveness e readiness

- `GET /api/health` — endpoint legado, mantido por compatibilidade.
- `GET /api/health/live` — nunca toca storage/rede; só confirma que o processo responde. Sempre 200.
- `GET /api/health/ready` — reaproveita `storage.healthcheck()` (mesma função de H1A/H1B): `reachable`
  e `schemaReady`. **Nunca chama Monday/Google Calendar/S3** — integrações opcionais nunca tornam o
  núcleo jurídico "indisponível". Resposta mínima (`status`, `persistence`, `databaseReachable`,
  `schemaReady`) — nunca `DATABASE_URL`, host interno, bucket, stack ou detalhe sensível.

## 11. Alerta básico — `observability/alert.js`

Webhook HTTPS genérico, configurado via `ALERT_WEBHOOK_URL` (vazio = alerta desabilitado; a aplicação
continua funcionando normalmente, mas o monitoramento externo fica incompleto — nunca bloqueia o boot
por ausência). Em produção, se configurada, a URL **deve** ser `https:`.

- **Assinatura opcional** — `ALERT_WEBHOOK_HMAC_KEY` gera `X-Patrono-Signature: sha256=...` sobre o
  corpo exato enviado.
- **Payload mínimo, sempre redigido** — `timestamp, service, environment, level, event, message,
  requestId/correlationId` (quando presentes). Nunca stack completa, corpo de requisição ou dado
  pessoal.
- **Retry limitado** — até 3 tentativas com pequeno backoff; nunca retry infinito.
- **Nunca mascara o erro original** — uma falha ao entregar o alerta gera um evento
  `alert_delivery_failed` sanitizado, e nunca substitui/esconde o erro que motivou o alerta.
- **Nunca recursivo** — `alert_delivery_failed` jamais dispara, ele mesmo, outro alerta (testado
  explicitamente em `tests/h6-observability.test.js`).
- **Cooldown/dedup** — `ALERT_COOLDOWN_MS` (padrão 300000 = 5 min) por chave de evento, para nunca gerar
  uma tempestade de alertas repetidos durante uma indisponibilidade prolongada. **Em memória, por
  instância** — best-effort, nunca uma garantia de deduplicação entre múltiplas instâncias (isso
  dependeria de um agregador real — H11).
- **Nível mínimo** — `ALERT_MIN_LEVEL` (padrão `error`); eventos abaixo disso nunca disparam alerta,
  mesmo que fiquem no log.

### Eventos mínimos alertáveis

`app_start_failed`, `repeated_http_5xx`, `monday_sync_failed`, `backup_failed`/`backup_tracking_failed`,
`restore_failed`/`restore_evidence_failed`. Um evento FATAL isolado (exceção não tratada, falha de boot)
sempre é elegível a alerta imediato; um 5xx isolado passa pelo mesmo caminho de `repeated_http_5xx` com
o cooldown normal — não há um contador de limiar dedicado nesta rodada (documentado como simplificação
aceitável; um limiar explícito de "N erros em M minutos" pode ser adicionado depois, se necessário).

## 12. Catálogo de eventos (crítico/central)

| Evento | Nível | Componente | Alertável? | Campos principais |
|---|---|---|---|---|
| `http_request_completed` | DEBUG/INFO/ERROR | `http` | Só via `repeated_http_5xx` (5xx) | requestId, method, route, statusCode, durationMs |
| `http_persistence_error` | ERROR | `storage` | Não diretamente | requestId, route, errorCode |
| `readiness_check_failed` | ERROR | `health` | Não diretamente | requestId, errorCode |
| `app_started` | INFO | `boot` | Não | nodeVersion, port, persistence |
| `app_start_failed` | FATAL | `boot` | **Sim** | errorCode |
| `app_shutdown_started`/`completed` | INFO | `boot` | Não | signal |
| `uncaught_exception`/`unhandled_rejection` | FATAL | `process` | Via log FATAL | errorCode |
| `monday_sync_started`/`completed` | INFO | `monday` | Não | modulesRead |
| `monday_sync_failed` | WARN/ERROR | `monday` | **Sim** | modulesFailed |
| `backup_started`/`completed` | INFO | `backup` | Não | backupId, sizeBytes |
| `backup_failed`/`backup_tracking_failed` | ERROR | `backup` | **Sim** | backupId, errorCode |
| `restore_started`/`completed` | INFO | `restore` | Não | restoreId, backupId, durationMs |
| `restore_failed`/`restore_evidence_failed` | ERROR | `restore` | **Sim** | restoreId, errorCode |
| `alert_delivery_failed` | ERROR | `alert` | **Não** (anti-recursão) | originalEvent, errorCode |

## 13. Configuração (`.env.example`)

`LOG_LEVEL`, `LOG_FORMAT`, `SERVICE_NAME`, `ALERT_WEBHOOK_URL`, `ALERT_WEBHOOK_HMAC_KEY`,
`ALERT_MIN_LEVEL`, `ALERT_COOLDOWN_MS` — ver `.env.example` para os comentários completos de cada uma.

## 14. Troubleshooting

- **Não vejo eventos DEBUG em produção** — esperado; `LOG_LEVEL` padrão é `info`. Para depurar
  temporariamente, definir `LOG_LEVEL=debug` (nunca deixar assim permanentemente em produção).
- **Alerta não dispara** — verificar `ALERT_WEBHOOK_URL` configurada, `ALERT_MIN_LEVEL` compatível com o
  nível do evento, e se o mesmo evento não está em cooldown (`ALERT_COOLDOWN_MS`).
- **Preciso buscar um erro específico em produção** — hoje isso depende de onde o `stdout`/`stderr` do
  processo está sendo coletado (plataforma de deploy). Nenhum agregador foi configurado nesta rodada —
  ver seção 15.

## 15. Limitações e dependência de H11

- **Agregação/busca real de produção** — o formato (JSON estruturado, correlação por `requestId`,
  eventos estáveis) foi desenhado para ser indexável por qualquer coletor, mas **nenhum agregador real
  foi configurado ou exercitado nesta rodada**. Isso é a pendência explícita que mantém PG-17 aberto.
- **Destino de alerta real** — o mecanismo (`observability/alert.js`) foi testado de ponta a ponta
  contra um servidor HTTP local, mas nenhum `ALERT_WEBHOOK_URL` de produção real foi configurado.
- **Cooldown/dedup são por instância** — nunca uma garantia global entre múltiplas instâncias.
- **`scripts/health-probe.js` não foi criado nesta rodada** — não há, ainda, um agendador/monitor de
  uptime real (cron, plataforma de deploy) para conectá-lo; H11 decidirá a forma final.

Essas dependências ficam explicitamente para **H11** (deploy/infraestrutura como código).
