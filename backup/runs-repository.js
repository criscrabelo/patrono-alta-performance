// Sprint 2, Hardening H5 (docs/PRODUCTION_GATE.md, PG-21; docs/DECISIONS.md, PROD-H5-01): acesso às
// tabelas operacionais `backup_runs`/`restore_runs` (migrations/008_h5_backup_restore_runs.sql). Recebe o
// client/pool `pg` já conectado — nunca abre conexão própria, mesmo padrão de `storage/repositories/*.js`.
async function insertBackupRunStarted(client, { backupId, environment, storageProvider }) {
  await client.query(
    `INSERT INTO backup_runs (backup_id, status, environment, storage_provider, started_at)
     VALUES ($1, 'started', $2, $3, now())`,
    [backupId, environment, storageProvider || null]
  );
}

async function markBackupRunCompleted(client, { backupId, storageObjectKey, format, sizeBytes, sha256, encrypted, encryptionKeyId, postgresVersion, migrationVersion, applicationCommit }) {
  await client.query(
    `UPDATE backup_runs SET status='completed', completed_at=now(), storage_object_key=$2, format=$3,
       size_bytes=$4, sha256=$5, encrypted=$6, encryption_key_id=$7, postgres_version=$8,
       migration_version=$9, application_commit=$10
     WHERE backup_id = $1`,
    [backupId, storageObjectKey, format, sizeBytes, sha256, Boolean(encrypted), encryptionKeyId || null, postgresVersion || null, migrationVersion || null, applicationCommit || null]
  );
}

async function markBackupRunFailed(client, { backupId, errorMessage }) {
  await client.query(
    `UPDATE backup_runs SET status='failed', completed_at=now(), error_message=$2 WHERE backup_id = $1`,
    [backupId, errorMessage]
  );
}

async function insertRestoreRun(client, { restoreId, backupId, targetEnvironment, result, applicationCommit, operatorIdentity, errorMessage, startedAt }) {
  await client.query(
    `INSERT INTO restore_runs (restore_id, backup_id, target_environment, result, application_commit, operator_identity, error_message, started_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
    [restoreId, backupId, targetEnvironment, result, applicationCommit || null, operatorIdentity || null, errorMessage || null, startedAt]
  );
}

async function latestBackupRun(client) {
  const { rows } = await client.query(`SELECT * FROM backup_runs ORDER BY started_at DESC LIMIT 1`);
  return rows[0] || null;
}

async function latestCompletedBackupRun(client) {
  const { rows } = await client.query(`SELECT * FROM backup_runs WHERE status='completed' ORDER BY completed_at DESC LIMIT 1`);
  return rows[0] || null;
}

module.exports = {
  insertBackupRunStarted, markBackupRunCompleted, markBackupRunFailed,
  insertRestoreRun, latestBackupRun, latestCompletedBackupRun
};
