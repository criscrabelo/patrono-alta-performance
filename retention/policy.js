// Sprint 2, Hardening H8 (docs/PRODUCTION_GATE.md, PG-18/PG-19; docs/DECISIONS.md, PROD-H8-01): política
// de retenção centralizada — define as classes de dado, os defaults (política interna, nunca uma
// obrigação legal inventada) e resolve os overrides via env var. Este módulo NUNCA executa purge sozinho
// — apenas expõe a política para `retention/runner.js` e `retention/legal-hold.js` consultarem. Ver
// docs/DATA_RETENTION.md para o detalhamento completo de cada classe.
//
// Nenhum prazo abaixo é uma "obrigação legal" — são valores de POLÍTICA INTERNA PROPOSTA (DEFAULT /
// PROPOSED INTERNAL POLICY), ajustáveis por variável de ambiente, documentados como tal. Onde não existe
// uma exigência legal específica identificada, o valor é apenas um ponto de partida operacional
// razoável — nunca afirmamos "a LGPD exige N dias" sem uma base jurídica concreta.

// Versão da política — toda execução do runner registra este valor em `retention_runs.policy_version`,
// nunca um versionamento implícito. Atualizar aqui sempre que a política (defaults/classes) mudar.
const POLICY_VERSION = '2026-09-H8-v1';

// Classes mínimas de dado (item 5 do escopo) — deliberadamente não exaustivo.
const DATA_CLASSES = Object.freeze([
  'SECURITY_AUDIT',
  'BUSINESS_AUDIT',
  'AUTH_SESSION',
  'AUTH_RESET_TOKEN',
  'RATE_LIMIT',
  'BACKUP_METADATA',
  'RESTORE_METADATA',
  'INCIDENT_RECORD',
  'OPERATIONAL_LOG',
  'LEGAL_PROCESS',
  'LEGAL_DEADLINE',
  'INTEGRATION_CACHE',
  'TEMPORARY_ARTIFACT',
  'USER_ACCOUNT',
  'OTHER'
]);

// Classes cujo purge automático está de fato implementado nesta rodada (item 22 do escopo: começar por
// classes efêmeras, nunca legalProcesses/legalDeadlines/audit_log de negócio/contas de usuário/incident
// records sem uma política explícita e segura adicional). As demais classes aparecem na matriz de
// docs/DATA_RETENTION.md com método de descarte "não implementado nesta rodada".
const PURGEABLE_CLASSES = Object.freeze(['AUTH_SESSION', 'AUTH_RESET_TOKEN', 'RATE_LIMIT']);

// Defaults em DIAS (RATE_LIMIT em horas, por ser uma janela técnica muito mais curta) — política interna
// proposta, nunca uma obrigação legal. Cada valor é resolvido por `resolveRetentionValue()` abaixo, que
// aplica o override de ambiente quando presente.
const DEFAULT_RETENTION = Object.freeze({
  SECURITY_AUDIT: { envVar: 'RETENTION_SECURITY_AUDIT_DAYS', unit: 'days', default: 365 },
  BUSINESS_AUDIT: { envVar: 'RETENTION_BUSINESS_AUDIT_DAYS', unit: 'days', default: null }, // ver docs/DATA_RETENTION.md — sem purge automático nesta rodada
  AUTH_SESSION: { envVar: 'RETENTION_EXPIRED_SESSION_DAYS', unit: 'days', default: 7 },
  AUTH_RESET_TOKEN: { envVar: 'RETENTION_EXPIRED_SESSION_DAYS', unit: 'days', default: 7 },
  RATE_LIMIT: { envVar: 'RETENTION_RATE_LIMIT_HOURS', unit: 'hours', default: 24 },
  BACKUP_METADATA: { envVar: 'RETENTION_BACKUP_METADATA_DAYS', unit: 'days', default: 400 },
  RESTORE_METADATA: { envVar: 'RETENTION_RESTORE_METADATA_DAYS', unit: 'days', default: 400 },
  INCIDENT_RECORD: { envVar: 'RETENTION_INCIDENT_RECORD_DAYS', unit: 'days', default: 365 },
  OPERATIONAL_LOG: { envVar: 'RETENTION_OPERATIONAL_LOG_DAYS', unit: 'days', default: 90 }
});

function resolveRetentionValue(dataClass) {
  const config = DEFAULT_RETENTION[dataClass];
  if (!config) return null; // classe sem retenção automática definida (ex.: LEGAL_PROCESS, USER_ACCOUNT)
  const raw = process.env[config.envVar];
  if (raw === undefined || raw === '') return { value: config.default, unit: config.unit, source: 'default' };
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${config.envVar} inválida: "${raw}" — deve ser um inteiro positivo (${config.unit}).`);
  }
  return { value: parsed, unit: config.unit, source: 'env' };
}

function retentionMs(dataClass) {
  const resolved = resolveRetentionValue(dataClass);
  if (!resolved || resolved.value == null) return null;
  const msPerUnit = resolved.unit === 'hours' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return resolved.value * msPerUnit;
}

// Validação fail-safe (item 9 do escopo): chamada explicitamente pelo runner antes de executar em modo
// `execute` — nunca no boot do servidor (retenção não é um requisito de disponibilidade do app em si).
// Em produção, uma env var de retenção presente mas inválida nunca deve ser ignorada silenciosamente.
function validatePolicyForProduction() {
  const errors = [];
  for (const dataClass of Object.keys(DEFAULT_RETENTION)) {
    try {
      resolveRetentionValue(dataClass);
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (errors.length) {
    throw new Error(`Política de retenção inválida: ${errors.join(' | ')}`);
  }
}

module.exports = {
  POLICY_VERSION,
  DATA_CLASSES,
  PURGEABLE_CLASSES,
  DEFAULT_RETENTION,
  resolveRetentionValue,
  retentionMs,
  validatePolicyForProduction
};
