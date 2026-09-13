// Sprint 2, Hardening H1B: repository para `audit_log` (migrations/004_h1b_core_relational.sql).
// Append-only — nunca há UPDATE/DELETE aqui, mesma garantia que já existia com `store.audit.push()` no
// JSONB (H1A). `responsible` continua sendo o nome de exibição do usuário (user.name), não uma FK —
// sem mudança de semântica em relação ao comportamento atual.
function rowToEvent(row) {
  return {
    id: row.id,
    action: row.action,
    entity: row.entity,
    entityId: row.entity_id,
    responsible: row.responsible,
    date: row.date ? row.date.toISOString() : null,
    reason: row.reason,
    before: row.before,
    after: row.after,
    correlationId: row.correlation_id
  };
}

async function list(executor) {
  const { rows } = await executor.query('SELECT * FROM audit_log ORDER BY date, id');
  return rows.map(rowToEvent);
}

// ON CONFLICT (id) DO NOTHING: idempotência defensiva (id é sempre um crypto.randomUUID() novo — a
// colisão é praticamente impossível — mas nunca falha a transação inteira por causa de um id repetido).
async function append(executor, event) {
  await executor.query(
    `INSERT INTO audit_log (id, action, entity, entity_id, responsible, date, reason, before, after, correlation_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (id) DO NOTHING`,
    [event.id, event.action, event.entity, event.entityId, event.responsible ?? null, event.date ?? new Date().toISOString(), event.reason ?? null, event.before ?? null, event.after ?? null, event.correlationId ?? null]
  );
}

module.exports = { list, append, rowToEvent };
