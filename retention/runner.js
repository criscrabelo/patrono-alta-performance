// Sprint 2, Hardening H8 (docs/PRODUCTION_GATE.md, PG-19; docs/DECISIONS.md, PROD-H8-01): runner de
// retenção — descarta dado efêmero elegível, respeitando legal hold, sempre com evidência
// (`retention_runs`). Modo padrão é DRY-RUN (nunca apaga nada); `execute` exige o flag/confirmação
// explícita definidos em `scripts/run-retention.js`. Cobre nesta rodada apenas as classes efêmeras
// citadas no escopo H8 (AUTH_SESSION, AUTH_RESET_TOKEN, RATE_LIMIT) — nunca `legalProcesses`/
// `legalDeadlines`/`audit_log` de negócio/contas de usuário/incident records, que exigiriam uma política
// adicional explícita fora do escopo desta rodada (ver docs/DATA_RETENTION.md).
const crypto = require('node:crypto');
const policy = require('./policy');
const legalHold = require('./legal-hold');
const auditRepository = require('../storage/repositories/audit-repository');

// Item 30 do escopo: eventos de auditoria do runner (SECURITY_AUDIT) são SEMPRE resumidos por
// classe/lote — nunca uma linha de audit_log por registro efetivamente apagado (isso ficaria só no
// resumo por classe abaixo). `responsible` é sempre um ator de sistema (nunca um usuário HTTP — o runner
// roda via CLI/cron, fora de qualquer requisição autenticada).
const RETENTION_AUDIT_ACTOR = 'system:retention-runner';

async function appendRetentionAuditEvent(pool, { action, runId, mode, reason, after }) {
  await auditRepository.append(pool, {
    id: crypto.randomUUID(),
    action,
    entity: 'retention_run',
    entityId: runId,
    responsible: RETENTION_AUDIT_ACTOR,
    date: new Date().toISOString(),
    reason,
    before: null,
    after,
    correlationId: runId
  });
}

// Cada classe define, sobre o alias `t` (a própria tabela), a expressão SQL de corte e, quando
// aplicável, a expressão do valor de escopo ENTITY correspondente (para checar hold por usuário) —
// sempre escritas explicitamente por classe, nunca por substituição genérica de string (frágil/
// propensa a erro). `RATE_LIMIT` não tem noção de "entidade" aplicável (bucket_key é um HMAC opaco) —
// só hold GLOBAL/DATA_CLASS se aplicam a ela.
const CLASS_TABLE = {
  AUTH_SESSION: {
    table: 'auth_sessions',
    cutoffExpr: 'GREATEST(t.expires_at, COALESCE(t.revoked_at, t.expires_at))',
    entityScopeExpr: "'user:' || t.user_id"
  },
  AUTH_RESET_TOKEN: {
    table: 'password_reset_tokens',
    cutoffExpr: 'GREATEST(t.expires_at, COALESCE(t.used_at, t.expires_at))',
    entityScopeExpr: "'user:' || t.user_id"
  },
  RATE_LIMIT: {
    table: 'rate_limit_buckets',
    cutoffExpr: 't.updated_at',
    entityScopeExpr: null
  }
};

// Conta elegíveis / sob hold / removíveis para UMA classe, sem tocar em nenhuma linha — usado tanto pelo
// dry-run quanto (antes de deletar) pelo execute.
async function inspectClass(pool, dataClass, { now }) {
  const config = CLASS_TABLE[dataClass];
  const cutoffMs = policy.retentionMs(dataClass);
  if (!config || cutoffMs == null) {
    return { dataClass, supported: false, eligible: 0, underHold: 0, removable: 0 };
  }

  const classHeld = await legalHold.isUnderLegalHold(pool, { dataClass });
  const cutoffIso = new Date(now.getTime() - cutoffMs).toISOString();

  const { rows: eligibleRows } = await pool.query(
    `SELECT count(*)::int AS count FROM ${config.table} t WHERE ${config.cutoffExpr} < $1`,
    [cutoffIso]
  );
  const eligible = eligibleRows[0].count;

  if (classHeld) {
    return { dataClass, supported: true, eligible, underHold: eligible, removable: 0, classHeld: true };
  }

  if (!config.entityScopeExpr) {
    return { dataClass, supported: true, eligible, underHold: 0, removable: eligible, classHeld: false };
  }

  const { rows: heldRows } = await pool.query(
    `SELECT count(*)::int AS count FROM ${config.table} t
     WHERE ${config.cutoffExpr} < $1
       AND EXISTS (SELECT 1 FROM legal_holds lh WHERE lh.status = 'active' AND lh.scope_type = 'ENTITY' AND lh.scope_value = ${config.entityScopeExpr})`,
    [cutoffIso]
  );
  const underHold = heldRows[0].count;
  return { dataClass, supported: true, eligible, underHold, removable: eligible - underHold, classHeld: false };
}

async function purgeClass(pool, dataClass, { now }) {
  const config = CLASS_TABLE[dataClass];
  const inspection = await inspectClass(pool, dataClass, { now });
  if (!inspection.supported || inspection.classHeld || inspection.removable === 0) {
    return { ...inspection, deleted: 0 };
  }

  const cutoffMs = policy.retentionMs(dataClass);
  const cutoffIso = new Date(now.getTime() - cutoffMs).toISOString();

  let deleted;
  if (!config.entityScopeExpr) {
    const result = await pool.query(`DELETE FROM ${config.table} t WHERE ${config.cutoffExpr} < $1`, [cutoffIso]);
    deleted = result.rowCount;
  } else {
    const result = await pool.query(
      `DELETE FROM ${config.table} t
       WHERE ${config.cutoffExpr} < $1
         AND NOT EXISTS (SELECT 1 FROM legal_holds lh WHERE lh.status = 'active' AND lh.scope_type = 'ENTITY' AND lh.scope_value = ${config.entityScopeExpr})`,
      [cutoffIso]
    );
    deleted = result.rowCount;
  }
  return { ...inspection, deleted };
}

// Execução principal — sempre registra um `retention_runs` (item 30 do escopo), independentemente do
// modo. Nunca lança sem antes marcar o run como 'failed' com evidência do erro (sanitizado).
async function runRetention(pool, { mode = 'dry_run', classes = policy.PURGEABLE_CLASSES, now = new Date(), createdBy } = {}) {
  if (!['dry_run', 'execute'].includes(mode)) throw new Error(`mode inválido: "${mode}" (aceito: dry_run|execute).`);

  const runId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO retention_runs (id, mode, status, policy_version, created_by) VALUES ($1, $2, 'running', $3, $4)`,
    [runId, mode, policy.POLICY_VERSION, createdBy || null]
  );

  const summary = {};
  try {
    for (const dataClass of classes) {
      summary[dataClass] = mode === 'dry_run' ? await inspectClass(pool, dataClass, { now }) : await purgeClass(pool, dataClass, { now });
    }
    await pool.query(
      `UPDATE retention_runs SET status = 'completed', finished_at = now(), summary = $2 WHERE id = $1`,
      [runId, JSON.stringify(summary)]
    );

    // Um evento por classe com alguma linha sob hold (nunca um por registro) — permite auditar que o
    // legal hold de fato bloqueou o descarte, sem detalhar cada registro individual.
    const heldClasses = Object.entries(summary).filter(([, s]) => s.underHold > 0 || s.classHeld);
    for (const [dataClass, s] of heldClasses) {
      await appendRetentionAuditEvent(pool, {
        action: 'RETENTION_ITEM_SKIPPED_LEGAL_HOLD',
        runId,
        mode,
        reason: `policyVersion=${policy.POLICY_VERSION}; dataClass=${dataClass}`,
        after: { dataClass, underHold: s.underHold, classHeld: !!s.classHeld }
      });
    }

    await appendRetentionAuditEvent(pool, {
      action: mode === 'dry_run' ? 'RETENTION_DRY_RUN' : 'RETENTION_EXECUTED',
      runId,
      mode,
      reason: `policyVersion=${policy.POLICY_VERSION}`,
      after: { policyVersion: policy.POLICY_VERSION, classes, summary }
    });

    return { runId, mode, policyVersion: policy.POLICY_VERSION, summary };
  } catch (error) {
    await pool.query(
      `UPDATE retention_runs SET status = 'failed', finished_at = now(), error_code = $2, summary = $3 WHERE id = $1`,
      [runId, 'RETENTION_RUN_FAILED', JSON.stringify(summary)]
    ).catch(() => {});
    await appendRetentionAuditEvent(pool, {
      action: 'RETENTION_FAILED',
      runId,
      mode,
      reason: `policyVersion=${policy.POLICY_VERSION}; errorCode=RETENTION_RUN_FAILED`,
      after: { policyVersion: policy.POLICY_VERSION, message: error.message }
    }).catch(() => {});
    throw error;
  }
}

module.exports = { runRetention, inspectClass, purgeClass, CLASS_TABLE };
