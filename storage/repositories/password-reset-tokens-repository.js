// Sprint 2, Hardening H2 (docs/PRODUCTION_GATE.md; docs/DECISIONS.md, PROD-H2-01): repository para
// `password_reset_tokens` (migrations/005_h2_auth_sessions.sql). Uso único (`usedAt`), expiração, nunca
// o token bruto — só `tokenHash`.
function rowToToken(row) {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: row.created_at ? row.created_at.toISOString() : null,
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    usedAt: row.used_at ? row.used_at.toISOString() : null,
    version: row.version
  };
}

async function list(executor) {
  const { rows } = await executor.query('SELECT * FROM password_reset_tokens ORDER BY created_at, id');
  return rows.map(rowToToken);
}

async function insert(executor, token) {
  await executor.query(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, created_at, expires_at, used_at, version)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [token.id, token.userId, token.tokenHash, token.createdAt ?? null, token.expiresAt, token.usedAt ?? null, token.version || 1]
  );
}

async function update(executor, token, expectedVersion) {
  const nextVersion = expectedVersion + 1;
  const { rowCount } = await executor.query(
    `UPDATE password_reset_tokens SET used_at=$1, version=$3
     WHERE id=$2 AND version=$4`,
    [token.usedAt ?? null, token.id, nextVersion, expectedVersion]
  );
  return rowCount > 0 ? nextVersion : null;
}

module.exports = { list, insert, update, rowToToken };
