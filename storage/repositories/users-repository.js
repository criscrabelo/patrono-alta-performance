// Sprint 2, Hardening H1B/H2 (docs/PRODUCTION_GATE.md; docs/DECISIONS.md, PROD-H1B-01/PROD-H2-01):
// repository enxuto para a tabela `app_users` (migrations/004_h1b_core_relational.sql,
// migrations/005_h2_auth_sessions.sql, migrations/006_h2_unique_login_identity.sql; nome distinto de
// `users` porque 001_foundation.sql já criou uma tabela `users` incompatível, nunca usada pelo runtime).
// `executor` é sempre um `pg` Pool ou Client já em transação — este módulo nunca abre conexão própria,
// nunca decide se está dentro de uma transação (isso é responsabilidade de quem chama).
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
    version: row.version,
    // H2 revisão pós-PR #13 (docs/DECISIONS.md, PROD-H2-01): identidade TÉCNICA de login, separada e
    // estável — nunca o e-mail (que não é único). Ver migrations/006_h2_unique_login_identity.sql.
    loginIdentifier: row.login_identifier,
    // H2 — autenticação individual (nunca expostos em resposta HTTP; passwordHash/mfaSecretEncrypted
    // ficam só na memória do processo/servidor, nunca retornados por nenhuma rota).
    passwordHash: row.password_hash,
    passwordChangedAt: row.password_changed_at ? row.password_changed_at.toISOString() : null,
    mfaEnabled: row.mfa_enabled,
    mfaMethod: row.mfa_method,
    mfaSecretEncrypted: row.mfa_secret_encrypted,
    mfaEnrolledAt: row.mfa_enrolled_at ? row.mfa_enrolled_at.toISOString() : null,
    failedLoginCount: row.failed_login_count,
    lockedUntil: row.locked_until ? row.locked_until.toISOString() : null,
    lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
    credentialsVersion: row.credentials_version
  };
}

async function list(executor) {
  const { rows } = await executor.query('SELECT * FROM app_users ORDER BY created_at, id');
  return rows.map(rowToUser);
}

function h2Params(user) {
  return [
    user.passwordHash ?? null, user.passwordChangedAt ?? null, Boolean(user.mfaEnabled), user.mfaMethod ?? null,
    user.mfaSecretEncrypted ?? null, user.mfaEnrolledAt ?? null, user.failedLoginCount || 0, user.lockedUntil ?? null,
    user.lastLoginAt ?? null, user.credentialsVersion || 1
  ];
}

// `login_identifier` é NOT NULL/UNIQUE (migrations/006) — nunca inventa um valor de negócio: quando o
// chamador não define um explicitamente, usa o próprio `id` técnico (já único/estável), exatamente como
// o backfill da migration fez para os registros pré-existentes.
function loginIdentifierOf(user) { return user.loginIdentifier || user.id; }

async function insert(executor, user) {
  await executor.query(
    `INSERT INTO app_users (id, name, email, role, department, mfa, temporary_password, company_id, spe_id, deleted_at, version, login_identifier,
       password_hash, password_changed_at, mfa_enabled, mfa_method, mfa_secret_encrypted, mfa_enrolled_at, failed_login_count, locked_until, last_login_at, credentials_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, $13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
    [user.id, user.name, user.email, user.role, user.department ?? null, Boolean(user.mfa), Boolean(user.temporaryPassword), user.companyId ?? null, user.speId ?? null, user.deletedAt ?? null, user.version || 1, loginIdentifierOf(user),
      ...h2Params(user)]
  );
}

// CAS por linha: 0 linhas afetadas ⇒ conflito de concorrência (StoreConflictError, mapeado pelo
// chamador). `expectedVersion` é a versão lida na hidratação (baseline); a nova versão é sempre
// baseline+1, decidida aqui — nunca confiando em `user.version` vindo da memória.
//
// `login_identifier` NÃO é atualizável por aqui — é a identidade técnica fixa atribuída na criação
// (imutável nesta rodada; uma futura interface de nome de login amigável ficaria a cargo de uma rota
// dedicada com sua própria auditoria, fora de escopo desta correção).
async function update(executor, user, expectedVersion) {
  const nextVersion = expectedVersion + 1;
  const { rowCount } = await executor.query(
    `UPDATE app_users SET name=$1, email=$2, role=$3, department=$4, mfa=$5, temporary_password=$6, company_id=$7, spe_id=$8, deleted_at=$9, version=$20, updated_at=now(),
       password_hash=$10, password_changed_at=$11, mfa_enabled=$12, mfa_method=$13, mfa_secret_encrypted=$14, mfa_enrolled_at=$15, failed_login_count=$16, locked_until=$17, last_login_at=$18, credentials_version=$19
     WHERE id=$21 AND version=$22`,
    [user.name, user.email, user.role, user.department ?? null, Boolean(user.mfa), Boolean(user.temporaryPassword), user.companyId ?? null, user.speId ?? null, user.deletedAt ?? null,
      ...h2Params(user), nextVersion, user.id, expectedVersion]
  );
  return rowCount > 0 ? nextVersion : null;
}

module.exports = { list, insert, update, rowToUser };
