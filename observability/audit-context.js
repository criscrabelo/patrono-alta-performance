// Sprint 2, Hardening H8 (docs/PRODUCTION_GATE.md, PG-18; docs/DECISIONS.md, PROD-H8-03): metadados
// operacionais mínimos para enriquecer eventos de `audit_log` (migrations/009_h8_retention_legal_hold.sql)
// sem nunca armazenar dado bruto sensível. Reaproveita `auth/client-ip.js` (H3) para resolver o IP real
// — nunca confia em X-Forwarded-For sem a mesma política de TRUST_PROXY_HOPS já usada pelo rate
// limiting.
const crypto = require('node:crypto');
const { resolveClientIp } = require('../auth/client-ip');

function isProduction() {
  return (process.env.NODE_ENV || 'development') === 'production';
}

function auditIpHmacKey() {
  return process.env.AUDIT_IP_HMAC_KEY;
}

// Item 24 do escopo: nunca hash simples sem segredo — sempre HMAC-SHA256 com chave server-side. Se o
// recurso está habilitado (a chave está definida) mas ausente em produção, falha explicitamente — nunca
// degrada silenciosamente para IP em texto puro nem para um hash sem segredo.
function pseudonymizeIp(ip) {
  if (!ip) return null;
  const key = auditIpHmacKey();
  if (!key) {
    if (isProduction()) {
      throw new Error('AUDIT_IP_HMAC_KEY é obrigatória em produção para pseudonimizar IP em auditoria (ou desabilite este recurso).');
    }
    return null; // fora de produção, sem chave configurada: simplesmente não inclui IP (nunca em texto puro).
  }
  return crypto.createHmac('sha256', key).update(ip).digest('hex');
}

// Item 25 do escopo: nunca o User-Agent completo/cru — apenas uma família/plataforma minimizada, sem
// fingerprinting (nunca versão exata de build, nunca string completa). Heurística simples e
// deliberadamente grosseira — não é um parser de UA completo, só o suficiente para diagnóstico
// operacional (ex.: "chrome/desktop", "safari/mobile", "bot/unknown").
const UA_FAMILY_PATTERNS = [
  [/edg\//i, 'edge'],
  [/chrome\//i, 'chrome'],
  [/firefox\//i, 'firefox'],
  [/safari\//i, 'safari'],
  [/curl\//i, 'curl'],
  [/bot|spider|crawler/i, 'bot']
];

function summarizeUserAgent(userAgent) {
  if (!userAgent || typeof userAgent !== 'string') return null;
  const family = UA_FAMILY_PATTERNS.find(([pattern]) => pattern.test(userAgent))?.[1] || 'other';
  const platformClass = /mobile|android|iphone/i.test(userAgent) ? 'mobile' : 'desktop';
  return `${family}/${platformClass}`;
}

// Ponto único de montagem do contexto de auditoria para uma requisição HTTP — usado pelas rotas
// sensíveis (ex.: legal hold) para enriquecer `audit()` sem duplicar essa lógica em cada rota.
function buildAuditContext(req) {
  const requestId = req?.requestId || null;
  let ipHmac = null;
  try {
    ipHmac = pseudonymizeIp(resolveClientIp(req));
  } catch (error) {
    // Nunca deixa uma falha de pseudonimização (ex.: chave ausente em produção) quebrar a rota de
    // negócio inteira — a auditoria em si continua sem o campo, e o chamador decide se isso é aceitável.
    ipHmac = null;
  }
  const userAgentSummary = summarizeUserAgent(req?.headers?.['user-agent']);
  return { requestId, sessionId: null, ipHmac, userAgentSummary };
}

module.exports = { pseudonymizeIp, summarizeUserAgent, buildAuditContext };
