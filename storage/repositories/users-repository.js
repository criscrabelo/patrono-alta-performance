// Sprint 2, Hardening H1B (docs/PRODUCTION_GATE.md; docs/DECISIONS.md, PROD-H1B-01): repository enxuto
// para a tabela `app_users` (migrations/004_h1b_core_relational.sql; nome distinto de `users` porque
// 001_foundation.sql já criou uma tabela `users` incompatível, nunca usada pelo runtime). `executor` é
// sempre um `pg` Pool ou Client já em transação — este módulo nunca abre conexão própria, nunca decide
// se está dentro de uma transação (isso é responsabilidade de quem chama).
function rowToUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    department: row.department,
    mfa: row.mfa,
    temporaryPassword: row.temporary_password,
    companyId: row.company_id,
    speId: row.spe_id,
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
    version: row.version
  };
}

async function list(executor) {
  const { rows } = await executor.query('SELECT * FROM app_users ORDER BY created_at, id');
  return rows.map(rowToUser);
}

// Seed idempotente — só popula usuários cujo id ainda não existe (nunca sobrescreve dado real já
// persistido), mesmo padrão de `bootstrapIfEmpty()` do app_store em H1A.
async function bootstrapSeed(executor, users) {
  for (const user of users || []) {
    await executor.query(
      `INSERT INTO app_users (id, name, email, role, department, mfa, temporary_password, company_id, spe_id, deleted_at, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1)
       ON CONFLICT (id) DO NOTHING`,
      [user.id, user.name, user.email, user.role, user.department ?? null, Boolean(user.mfa), Boolean(user.temporaryPassword), user.companyId ?? null, user.speId ?? null, user.deletedAt ?? null]
    );
  }
}

async function insert(executor, user) {
  await executor.query(
    `INSERT INTO app_users (id, name, email, role, department, mfa, temporary_password, company_id, spe_id, deleted_at, version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [user.id, user.name, user.email, user.role, user.department ?? null, Boolean(user.mfa), Boolean(user.temporaryPassword), user.companyId ?? null, user.speId ?? null, user.deletedAt ?? null, user.version || 1]
  );
}

// CAS por linha: 0 linhas afetadas ⇒ conflito de concorrência (StoreConflictError, mapeado pelo
// chamador). `expectedVersion` é a versão lida na hidratação (baseline); a nova versão é sempre
// baseline+1, decidida aqui — nunca confiando em `user.version` vindo da memória (nenhuma rota hoje
// mutila um usuário existente, mas o repository fica pronto para quando isso existir).
async function update(executor, user, expectedVersion) {
  const nextVersion = expectedVersion + 1;
  const { rowCount } = await executor.query(
    `UPDATE app_users SET name=$1, email=$2, role=$3, department=$4, mfa=$5, temporary_password=$6, company_id=$7, spe_id=$8, deleted_at=$9, version=$10, updated_at=now()
     WHERE id=$11 AND version=$12`,
    [user.name, user.email, user.role, user.department ?? null, Boolean(user.mfa), Boolean(user.temporaryPassword), user.companyId ?? null, user.speId ?? null, user.deletedAt ?? null, nextVersion, user.id, expectedVersion]
  );
  return rowCount > 0 ? nextVersion : null;
}

module.exports = { list, bootstrapSeed, insert, update, rowToUser };
