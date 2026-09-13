// Sprint 2, Hardening H1B: repository para `legal_deadlines` (migrations/004_h1b_core_relational.sql).
// FK real: process_id → legal_processes(id) ON DELETE RESTRICT; responsible_user_id → users(id) ON
// DELETE RESTRICT (nulável) — um Legal Deadline nunca pode apontar para processo/usuário inexistente;
// um usuário/processo referenciado nunca pode ser fisicamente apagado (só soft-delete via deletedAt,
// que a própria FK não impede).
function rowToDeadline(row) {
  return {
    id: row.id,
    processId: row.process_id,
    origin: row.origin,
    date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : row.date,
    originType: row.origin_type,
    status: row.status,
    responsibleUserId: row.responsible_user_id,
    department: row.department,
    companyId: row.company_id,
    speId: row.spe_id,
    scopeType: row.scope_type,
    version: row.version,
    createdAt: row.created_at ? row.created_at.toISOString() : null,
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
    deletedBy: row.deleted_by
  };
}

async function list(executor) {
  const { rows } = await executor.query('SELECT * FROM legal_deadlines ORDER BY created_at, id');
  return rows.map(rowToDeadline);
}

function params(deadline) {
  return [
    deadline.id, deadline.processId, deadline.origin, deadline.date, deadline.originType, deadline.status,
    deadline.responsibleUserId ?? null, deadline.department ?? null, deadline.companyId ?? null,
    deadline.speId ?? null, deadline.scopeType ?? null, deadline.createdBy ?? null, deadline.updatedBy ?? null,
    deadline.deletedAt ?? null, deadline.deletedBy ?? null
  ];
}

// Erros de FK (processo/usuário responsável inexistente) chegam aqui como `error.code === '23503'`
// (foreign_key_violation do Postgres) — traduzidos para uma mensagem clara em vez de vazar o erro cru
// do driver. A checagem de existência já acontece em validateLegalDeadline() antes de chegar aqui; esta
// é a segunda linha de defesa (integridade real no banco), nunca a primeira.
async function insert(executor, deadline) {
  try {
    await executor.query(
      `INSERT INTO legal_deadlines (id, process_id, origin, date, origin_type, status, responsible_user_id, department, company_id, spe_id, scope_type, created_by, updated_by, deleted_at, deleted_by, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [...params(deadline), deadline.version || 1]
    );
  } catch (error) {
    if (error && error.code === '23503') throw new Error('Legal Deadline referencia processId/responsibleUserId inexistente (violação de integridade referencial)');
    throw error;
  }
}

async function update(executor, deadline, expectedVersion) {
  const nextVersion = expectedVersion + 1;
  try {
    const { rowCount } = await executor.query(
      `UPDATE legal_deadlines SET process_id=$2, origin=$3, date=$4, origin_type=$5, status=$6, responsible_user_id=$7, department=$8, company_id=$9, spe_id=$10, scope_type=$11, created_by=$12, updated_by=$13, deleted_at=$14, deleted_by=$15, version=$17, updated_at=now()
       WHERE id=$1 AND version=$16`,
      [...params(deadline), expectedVersion, nextVersion]
    );
    return rowCount > 0 ? nextVersion : null;
  } catch (error) {
    if (error && error.code === '23503') throw new Error('Legal Deadline referencia processId/responsibleUserId inexistente (violação de integridade referencial)');
    throw error;
  }
}

module.exports = { list, insert, update, rowToDeadline };
