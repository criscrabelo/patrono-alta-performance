// Sprint 2, Hardening H2 (docs/PRODUCTION_GATE.md; docs/DECISIONS.md, PROD-H2-01): repository para
// `auth_sessions` (migrations/005_h2_auth_sessions.sql) — substitui `sessions = new Map()`. Nunca
// persiste o token bruto, só `tokenHash`. `executor` é sempre um `pg` Pool ou Client já em transação.
function rowToSession(row) {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: row.created_at ? row.created_at.toISOString() : null,
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    lastSeenAt: row.last_seen_at ? row.last_seen_at.toISOString() : null,
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
    credentialsVersion: row.credentials_version,
    version: row.version
  };
}

async function list(executor) {
  const { rows } = await executor.query('SELECT * FROM auth_sessions ORDER BY created_at, id');
  return rows.map(rowToSession);
}

async function insert(executor, session) {
  await executor.query(
    `INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at, revoked_at, credentials_version, version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [session.id, session.userId, session.tokenHash, session.createdAt ?? null, session.expiresAt, session.lastSeenAt ?? null, session.revokedAt ?? null, session.credentialsVersion, session.version || 1]
  );
}

async function update(executor, session, expectedVersion) {
  const nextVersion = expectedVersion + 1;
  const { rowCount } = await executor.query(
    `UPDATE auth_sessions SET expires_at=$1, last_seen_at=$2, revoked_at=$3, credentials_version=$4, version=$6
     WHERE id=$5 AND version=$7`,
    [session.expiresAt, session.lastSeenAt ?? null, session.revokedAt ?? null, session.credentialsVersion, session.id, nextVersion, expectedVersion]
  );
  return rowCount > 0 ? nextVersion : null;
}

module.exports = { list, insert, update, rowToSession };
