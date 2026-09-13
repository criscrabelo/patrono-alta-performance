// Sprint 2, Hardening H6 (docs/PRODUCTION_GATE.md, PG-17; docs/DECISIONS.md, PROD-H6-01): mecanismo de
// alerta neutro de provedor — um webhook HTTPS genérico, nunca acoplado a um SaaS pago específico. Ver
// docs/OBSERVABILITY.md para a lista de eventos alertáveis e as limitações explicitamente documentadas
// (cooldown apenas em memória/por instância; agregação real de múltiplas instâncias fica para H11).
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const logger = require('./logger');
const { redact, sanitizeString } = require('./redaction');

const LEVEL_RANK = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 200;
const DELIVERY_TIMEOUT_MS = 5000;
const DEFAULT_HTTP_5XX_THRESHOLD = 5;
const DEFAULT_HTTP_5XX_WINDOW_MS = 5 * 60 * 1000;
// Nenhum destes Maps pode crescer sem limite — rotas já são normalizadas (server.js), mas mesmo assim
// aplicamos um teto defensivo e evictamos a entrada mais antiga ao excedê-lo (best-effort, por
// instância — nunca um limite de segurança rígido, documentado em OBSERVABILITY.md).
const MAX_TRACKED_KEYS = 500;

// Envelope canônico do payload de alerta — NUNCA sobrescrito por `fields` (o chamador não deve poder
// falsificar o timestamp, o nível ou o requestId do alerta que ele mesmo está reportando).
const RESERVED_PAYLOAD_FIELDS = new Set(['timestamp', 'service', 'environment', 'level', 'event', 'message', 'requestId', 'correlationId']);

// Cooldown/dedup best-effort, em memória, por instância — nunca um controle de segurança crítico, e
// nunca uma garantia de deduplicação global entre múltiplas instâncias (documentado em OBSERVABILITY.md).
// Correção pós-H6 (revisão técnica final): só é marcado APÓS entrega bem-sucedida (ver notify()) — uma
// primeira tentativa que falha nunca deve suprimir um alerta futuro que nunca chegou a ser entregue.
const lastSentAt = new Map();

// Contadores de threshold de HTTP 5xx repetido, por chave (rota normalizada) — janela fixa: dentro da
// mesma janela o contador acumula; ao expirar, reinicia naturalmente (nunca persistido, best-effort por
// instância, nunca confundido com o rate limiting de H3).
const http5xxWindows = new Map();

function evictOldestIfOverCapacity(map) {
  if (map.size <= MAX_TRACKED_KEYS) return;
  const oldestKey = map.keys().next().value;
  if (oldestKey !== undefined) map.delete(oldestKey);
}

function configuredWebhookUrl() {
  return (process.env.ALERT_WEBHOOK_URL || '').trim();
}

function configuredMinLevel() {
  const raw = (process.env.ALERT_MIN_LEVEL || 'error').trim().toLowerCase();
  return LEVEL_RANK[raw] ? raw : 'error';
}

function configuredCooldownMs() {
  const raw = Number(process.env.ALERT_COOLDOWN_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_COOLDOWN_MS;
}

function configuredHttp5xxThreshold() {
  const raw = Number(process.env.HTTP_5XX_ALERT_THRESHOLD);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_HTTP_5XX_THRESHOLD;
}

function configuredHttp5xxWindowMs() {
  const raw = Number(process.env.HTTP_5XX_ALERT_WINDOW_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_HTTP_5XX_WINDOW_MS;
}

function isProduction() {
  return (process.env.NODE_ENV || 'development') === 'production';
}

function validateWebhookUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('ALERT_WEBHOOK_URL inválida (não é uma URL válida)');
  }
  if (isProduction() && parsed.protocol !== 'https:') {
    throw new Error('ALERT_WEBHOOK_URL deve usar HTTPS em produção');
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('ALERT_WEBHOOK_URL deve usar http/https');
  }
  return parsed;
}

function shouldSend(level) {
  const min = configuredMinLevel();
  return LEVEL_RANK[level] >= LEVEL_RANK[min];
}

function withinCooldown(key) {
  const cooldownMs = configuredCooldownMs();
  const last = lastSentAt.get(key);
  if (last == null) return false;
  return Date.now() - last < cooldownMs;
}

function markSent(key) {
  lastSentAt.set(key, Date.now());
  evictOldestIfOverCapacity(lastSentAt);
}

function buildPayload({ level, event, message, requestId, correlationId, fields }) {
  const payload = {
    timestamp: new Date().toISOString(),
    service: process.env.SERVICE_NAME || 'patrono-alta-performance',
    environment: process.env.NODE_ENV || 'development',
    level,
    event: sanitizeString(event),
    message: sanitizeString(message || event)
  };
  if (requestId) payload.requestId = sanitizeString(requestId);
  if (correlationId) payload.correlationId = sanitizeString(correlationId);
  // Nunca stack completa, corpo de requisição ou dado pessoal — apenas campos operacionais mínimos,
  // e ainda assim redigidos defensivamente antes de sair do processo. `fields` nunca pode sobrescrever
  // o envelope canônico acima (timestamp/service/environment/level/event/message/requestId/
  // correlationId) — despojado de qualquer chave reservada antes do merge.
  if (fields && typeof fields === 'object') {
    const safeFields = redact(fields);
    for (const [key, value] of Object.entries(safeFields)) {
      if (RESERVED_PAYLOAD_FIELDS.has(key)) continue;
      payload[key] = value;
    }
  }
  return payload;
}

function sign(bodyString) {
  const key = process.env.ALERT_WEBHOOK_HMAC_KEY;
  if (!key) return null;
  const digest = crypto.createHmac('sha256', key).update(bodyString).digest('hex');
  return `sha256=${digest}`;
}

function deliverOnce(parsedUrl, bodyString, signature) {
  return new Promise((resolve, reject) => {
    const transport = parsedUrl.protocol === 'https:' ? https : http;
    const headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(bodyString) };
    if (signature) headers['x-patrono-signature'] = signature;
    const req = transport.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: 'POST',
        headers,
        timeout: DELIVERY_TIMEOUT_MS
      },
      (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error(`webhook respondeu status ${res.statusCode}`));
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout ao entregar alerta')));
    req.on('error', reject);
    req.end(bodyString);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deliverWithRetry(parsedUrl, bodyString, signature) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await deliverOnce(parsedUrl, bodyString, signature);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) await delay(RETRY_BASE_DELAY_MS * attempt);
    }
  }
  throw lastError;
}

// notify() NUNCA lança — uma falha ao entregar o alerta jamais deve mascarar/substituir o erro original
// que motivou o alerta, nem derrubar o processo. Também nunca dispara um segundo alerta a partir de uma
// falha de entrega (isso seria recursão de alerta, explicitamente proibida).
async function notify({ level, event, message, requestId, correlationId, fields, dedupKey, isDeliveryFailureEvent } = {}) {
  try {
    if (!level || !LEVEL_RANK[level]) return { sent: false, reason: 'invalid_level' };
    if (!shouldSend(level)) return { sent: false, reason: 'below_min_level' };

    const webhookUrl = configuredWebhookUrl();
    if (!webhookUrl) return { sent: false, reason: 'no_webhook_configured' };

    const key = dedupKey || event;
    if (withinCooldown(key)) return { sent: false, reason: 'cooldown' };

    let parsedUrl;
    try {
      parsedUrl = validateWebhookUrl(webhookUrl);
    } catch (err) {
      logger.error('alert_delivery_failed', { component: 'alert', errorCode: 'invalid_webhook_url', error: logger.serializeError(err) });
      return { sent: false, reason: 'invalid_webhook_url' };
    }

    const payload = buildPayload({ level, event, message, requestId, correlationId, fields });
    const bodyString = JSON.stringify(payload);
    const signature = sign(bodyString);

    // Correção pós-H6 (revisão técnica final, PR #17): o cooldown só é marcado APÓS confirmação de
    // entrega bem-sucedida — antes disso, uma primeira tentativa que falha (todas as `MAX_ATTEMPTS`
    // retries) nunca deve deixar o cooldown "ativo" para um alerta que nunca chegou a sair.
    await deliverWithRetry(parsedUrl, bodyString, signature);
    markSent(key);
    return { sent: true };
  } catch (err) {
    // Nunca re-alertar sobre a própria falha de entrega de alerta.
    if (!isDeliveryFailureEvent) {
      logger.error('alert_delivery_failed', {
        component: 'alert',
        originalEvent: event,
        error: logger.serializeError(err)
      });
    }
    return { sent: false, reason: 'delivery_failed' };
  }
}

// Threshold real de HTTP 5xx repetido (item 4 da correção pós-H6, PR #17) — antes disso, TODO primeiro
// 5xx chamava notify() diretamente, e o cooldown só deduplicava os seguintes; isso não era um
// threshold, era apenas anti-tempestade de um alerta já disparado. Agora: um 500 isolado nunca alerta;
// só ao atingir HTTP_5XX_ALERT_THRESHOLD ocorrências dentro de HTTP_5XX_ALERT_WINDOW_MS o alerta
// `repeated_http_5xx` é emitido (uma vez); a janela então reinicia naturalmente. Estado em memória, por
// instância, best-effort — nunca persistido, nunca confundido com o rate limiting de H3 (auth/
// rate-limit.js), que é um controle de segurança real e distribuído via PostgreSQL.
function recordHttp5xxAndMaybeNotify({ key, route, statusCode, requestId }) {
  const now = Date.now();
  const threshold = configuredHttp5xxThreshold();
  const windowMs = configuredHttp5xxWindowMs();

  let entry = http5xxWindows.get(key);
  if (!entry || now - entry.windowStart >= windowMs) {
    entry = { windowStart: now, count: 0, alerted: false };
    http5xxWindows.set(key, entry);
    evictOldestIfOverCapacity(http5xxWindows);
  }
  entry.count += 1;

  if (entry.count < threshold || entry.alerted) return { thresholdReached: false, count: entry.count };

  entry.alerted = true;
  notify({
    level: 'error',
    event: 'repeated_http_5xx',
    message: `HTTP 5xx repetido em ${route} (${entry.count} ocorrências na janela)`,
    requestId,
    dedupKey: `http5xx:${key}`,
    fields: { route, statusCode, count: entry.count, thresholdMs: windowMs }
  });
  return { thresholdReached: true, count: entry.count };
}

function _resetCooldownForTests() {
  lastSentAt.clear();
  http5xxWindows.clear();
}

// Exposto só para o teste de item 5 (limite de estado em memória) verificar que os Maps internos nunca
// crescem sem limite — nunca usado fora de testes.
function _stateSizesForTests() {
  return { cooldownKeys: lastSentAt.size, http5xxKeys: http5xxWindows.size };
}

module.exports = {
  notify,
  recordHttp5xxAndMaybeNotify,
  _resetCooldownForTests,
  _stateSizesForTests,
  MAX_TRACKED_KEYS,
  validateWebhookUrl,
  shouldSend,
  configuredCooldownMs,
  configuredHttp5xxThreshold,
  configuredHttp5xxWindowMs
};
