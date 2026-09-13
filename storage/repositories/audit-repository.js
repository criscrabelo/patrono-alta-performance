// Sprint 2, Hardening H1B: repository para `audit_log` (migrations/004_h1b_core_relational.sql).
// Append-only — nunca há UPDATE/DELETE aqui, mesma garantia que já existia com `store.audit.push()` no
// JSONB (H1A). `responsible` continua sendo o nome de exibição do usuário (user.name), não uma FK —
// sem mudança de semântica em relação ao comportamento atual.
//
// Sprint 2, Hardening H8 (docs/PRODUCTION_GATE.md, PG-18; migrations/009_h8_retention_legal_hold.sql):
// `request_id`/`session_id`/`ip_hmac`/`user_agent_summary` são colunas ADITIVAS e NULLABLE — eventos
// antigos (e a maioria dos eventos de negócio existentes, que ainda não passam `context` para audit())
// simplesmente têm esses campos `null`, nunca quebrando a leitura/escrita já existente.
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
    correlationId: row.correlation_id,
    requestId: row.request_id,
    sessionId: row.session_id,
    ipHmac: row.ip_hmac,
    userAgentSummary: row.user_agent_summary
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
    `INSERT INTO audit_log (id, action, entity, entity_id, responsible, date, reason, before, after, correlation_id, request_id, session_id, ip_hmac, user_agent_summary)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (id) DO NOTHING`,
    [
      event.id, event.action, event.entity, event.entityId, event.responsible ?? null, event.date ?? new Date().toISOString(), event.reason ?? null, event.before ?? null, event.after ?? null, event.correlationId ?? null,
      event.requestId ?? null, event.sessionId ?? null, event.ipHmac ?? null, event.userAgentSummary ?? null
    ]
  );
}

module.exports = { list, append, rowToEvent };
