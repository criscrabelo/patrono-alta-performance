// Sprint 2, Hardening H8 (docs/PRODUCTION_GATE.md, PG-19; docs/DECISIONS.md, PROD-H8-02): modelo formal
// de legal hold — impede o descarte automático (retention/runner.js) de um escopo enquanto ativo. Fala
// diretamente com o pool Postgres (mesmo padrão de auth/rate-limit.js/backup/runs-repository.js) — nunca
// reaproveita a ponte de documento JSONB (readStore()/writeStore()), pois legal hold precisa de
// consistência real de linha sob concorrência, não de CAS de documento inteiro.
const crypto = require('node:crypto');

const SCOPE_TYPES = new Set(['GLOBAL', 'DATA_CLASS', 'ENTITY', 'INCIDENT', 'LEGAL_PROCESS']);

function validateScope(scopeType, scopeValue) {
  if (!SCOPE_TYPES.has(scopeType)) {
    throw new Error(`scopeType inválido: "${scopeType}". Valores aceitos: ${[...SCOPE_TYPES].join(', ')}.`);
  }
  if (scopeType === 'GLOBAL') {
    if (scopeValue != null) throw new Error('scopeValue deve ser omitido quando scopeType é GLOBAL.');
    return null;
  }
  if (!scopeValue || !String(scopeValue).trim()) {
    throw new Error(`scopeValue é obrigatório para scopeType "${scopeType}".`);
  }
  return String(scopeValue).trim();
}

function validateReason(reason) {
  const trimmed = String(reason || '').trim();
  if (!trimmed) throw new Error('reason é obrigatório e nunca pode ser vazio.');
  return trimmed;
}

// Cria um legal hold — ação sensível, sempre auditada pelo chamador (server.js: LEGAL_HOLD_CREATED).
async function createLegalHold(pool, { scopeType, scopeValue, reason, startedByUserId }) {
  const normalizedScopeValue = validateScope(scopeType, scopeValue);
  const normalizedReason = validateReason(reason);
  if (!startedByUserId) throw new Error('startedByUserId é obrigatório — legal hold nunca é anônimo.');

  const id = crypto.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO legal_holds (id, scope_type, scope_value, reason, status, started_by_user_id)
     VALUES ($1, $2, $3, $4, 'active', $5)
     RETURNING id, scope_type, scope_value, reason, status, started_at, started_by_user_id, released_at, released_by_user_id, release_reason, created_at, updated_at`,
    [id, scopeType, normalizedScopeValue, normalizedReason, startedByUserId]
  );
  return toLegalHoldView(rows[0]);
}

// Libera um legal hold — NUNCA deleta a linha (histórico permanente), só muda status/released_*.
async function releaseLegalHold(pool, { id, releasedByUserId, releaseReason }) {
  const normalizedReleaseReason = validateReason(releaseReason);
  if (!releasedByUserId) throw new Error('releasedByUserId é obrigatório.');

  const { rows } = await pool.query(
    `UPDATE legal_holds
     SET status = 'released', released_at = now(), released_by_user_id = $2, release_reason = $3, updated_at = now()
     WHERE id = $1 AND status = 'active'
     RETURNING id, scope_type, scope_value, reason, status, started_at, started_by_user_id, released_at, released_by_user_id, release_reason, created_at, updated_at`,
    [id, releasedByUserId, normalizedReleaseReason]
  );
  if (!rows.length) throw new Error('Legal hold não encontrado ou já liberado.');
  return toLegalHoldView(rows[0]);
}

// Consulta com filtros — nunca cruza escopo sem que o filtro explícito peça (item 17 do escopo: evitar
// vazamento cross-scope). Sem filtro, lista todos (rota já é restrita por RBAC em server.js).
async function listLegalHolds(pool, { status, scopeType, scopeValue } = {}) {
  const conditions = [];
  const params = [];
  if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
  if (scopeType) { params.push(scopeType); conditions.push(`scope_type = $${params.length}`); }
  if (scopeValue) { params.push(scopeValue); conditions.push(`scope_value = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT id, scope_type, scope_value, reason, status, started_at, started_by_user_id, released_at, released_by_user_id, release_reason, created_at, updated_at
     FROM legal_holds ${where} ORDER BY created_at DESC`,
    params
  );
  return rows.map(toLegalHoldView);
}

// Função central de aplicação do hold (item 18 do escopo) — SEMPRE consultada pelo runner ANTES de
// qualquer purge. Um hold GLOBAL ativo bloqueia tudo; um hold DATA_CLASS ativo bloqueia toda a classe;
// um hold ENTITY/INCIDENT/LEGAL_PROCESS ativo bloqueia apenas o escopo específico.
async function isUnderLegalHold(pool, { dataClass, entityScopeValue } = {}) {
  const { rows } = await pool.query(
    `SELECT 1 FROM legal_holds
     WHERE status = 'active' AND (
       scope_type = 'GLOBAL'
       OR (scope_type = 'DATA_CLASS' AND scope_value = $1)
       OR ($2::text IS NOT NULL AND scope_type IN ('ENTITY', 'INCIDENT', 'LEGAL_PROCESS') AND scope_value = $2)
     )
     LIMIT 1`,
    [dataClass, entityScopeValue || null]
  );
  return rows.length > 0;
}

function toLegalHoldView(row) {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeValue: row.scope_value,
    reason: row.reason,
    status: row.status,
    startedAt: row.started_at,
    startedByUserId: row.started_by_user_id,
    releasedAt: row.released_at,
    releasedByUserId: row.released_by_user_id,
    releaseReason: row.release_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = { createLegalHold, releaseLegalHold, listLegalHolds, isUnderLegalHold, SCOPE_TYPES };
