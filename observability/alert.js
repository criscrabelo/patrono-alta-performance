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

// Cooldown/dedup best-effort, em memória, por instância — nunca um controle de segurança crítico, e
// nunca uma garantia de deduplicação global entre múltiplas instâncias (documentado em OBSERVABILITY.md).
const lastSentAt = new Map();

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
  // e ainda assim redigidos defensivamente antes de sair do processo.
  if (fields && typeof fields === 'object') Object.assign(payload, redact(fields));
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

    markSent(key);
    await deliverWithRetry(parsedUrl, bodyString, signature);
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

function _resetCooldownForTests() {
  lastSentAt.clear();
}

module.exports = { notify, _resetCooldownForTests, validateWebhookUrl, shouldSend, configuredCooldownMs };
