// Sprint 2, Hardening H2 (docs/PRODUCTION_GATE.md; docs/DECISIONS.md, PROD-H2-01): repository para
// `auth_challenges` (migrations/005_h2_auth_sessions.sql) — challenge de MFA pendente de confirmação no
// login, ou de enrolamento de MFA pendente de confirmação. Nunca armazena o OTP, só a referência ao
// fluxo pendente (`type`, expiração, tentativas) — `secretEncrypted` só é usado para
// `type:'totp-enrollment'` (o segredo TOTP ainda não confirmado, cifrado em repouso).
function rowToChallenge(row) {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    secretEncrypted: row.secret_encrypted || null,
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    usedAt: row.used_at ? row.used_at.toISOString() : null,
    attempts: row.attempts,
    createdAt: row.created_at ? row.created_at.toISOString() : null,
    version: row.version
  };
}

async function list(executor) {
  const { rows } = await executor.query('SELECT * FROM auth_challenges ORDER BY created_at, id');
  return rows.map(rowToChallenge);
}

async function insert(executor, challenge) {
  await executor.query(
    `INSERT INTO auth_challenges (id, user_id, type, secret_encrypted, expires_at, used_at, attempts, created_at, version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [challenge.id, challenge.userId, challenge.type, challenge.secretEncrypted ?? null, challenge.expiresAt, challenge.usedAt ?? null, challenge.attempts || 0, challenge.createdAt ?? null, challenge.version || 1]
  );
}

async function update(executor, challenge, expectedVersion) {
  const nextVersion = expectedVersion + 1;
  const { rowCount } = await executor.query(
    `UPDATE auth_challenges SET used_at=$1, attempts=$2, version=$5
     WHERE id=$3 AND version=$4`,
    [challenge.usedAt ?? null, challenge.attempts || 0, challenge.id, expectedVersion, nextVersion]
  );
  return rowCount > 0 ? nextVersion : null;
}

module.exports = { list, insert, update, rowToChallenge };
