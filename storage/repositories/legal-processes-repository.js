// Sprint 2, Hardening H1B: repository para `legal_processes` (migrations/004_h1b_core_relational.sql).
// Fonte canônica do que o runtime chama `store.records.processos` — populada pelo sync Monday
// (server.js, runMondaySync/rota manual de sync), nunca criada pela API genérica de entidades
// (rejectIfMondaySourced() já bloqueia isso no nível de rota, inalterado por H1B).
function rowToProcess(row) {
  return {
    id: row.id,
    source: row.source,
    externalId: row.external_id,
    module: row.module,
    boardId: row.board_id,
    boardName: row.board_name,
    department: row.department,
    title: row.title,
    group: row.group,
    columns: row.columns || {},
    columnsByTitle: row.columns_by_title || {},
    createdAt: row.created_at_source ? row.created_at_source.toISOString() : null,
    syncedAt: row.synced_at ? row.synced_at.toISOString() : null,
    classification: row.classification,
    companyId: row.company_id,
    speId: row.spe_id,
    scopeType: row.scope_type,
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
    version: row.version
  };
}

async function list(executor) {
  const { rows } = await executor.query('SELECT * FROM legal_processes ORDER BY created_at, id');
  return rows.map(rowToProcess);
}

function params(process) {
  return [
    process.id, process.source, process.externalId ?? null, process.module ?? null,
    process.boardId ?? null, process.boardName ?? null, process.department ?? null, process.title ?? null,
    process.group ?? null, JSON.stringify(process.columns ?? {}), JSON.stringify(process.columnsByTitle ?? {}),
    process.classification ?? null, process.companyId ?? null, process.speId ?? null, process.scopeType ?? null,
    process.createdAt ?? null, process.syncedAt ?? null, process.deletedAt ?? null
  ];
}

async function insert(executor, process) {
  await executor.query(
    `INSERT INTO legal_processes (id, source, external_id, module, board_id, board_name, department, title, "group", columns, columns_by_title, classification, company_id, spe_id, scope_type, created_at_source, synced_at, deleted_at, version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [...params(process), process.version || 1]
  );
}

async function update(executor, process, expectedVersion) {
  const nextVersion = expectedVersion + 1;
  const { rowCount } = await executor.query(
    `UPDATE legal_processes SET source=$2, external_id=$3, module=$4, board_id=$5, board_name=$6, department=$7, title=$8, "group"=$9, columns=$10, columns_by_title=$11, classification=$12, company_id=$13, spe_id=$14, scope_type=$15, created_at_source=$16, synced_at=$17, deleted_at=$18, version=$20, updated_at=now()
     WHERE id=$1 AND version=$19`,
    [...params(process), expectedVersion, nextVersion]
  );
  return rowCount > 0 ? nextVersion : null;
}

module.exports = { list, insert, update, rowToProcess };
