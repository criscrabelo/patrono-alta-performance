// Correção pós-H5 (docs/DECISIONS.md, PROD-H5-01): erros dedicados para distinguir "a operação em si
// (backup/restore) falhou" de "a operação teve sucesso, mas o registro de EVIDÊNCIA operacional
// (backup_runs/restore_runs) falhou" — dois cenários com implicações completamente diferentes que
// nunca podem ser tratados pelo mesmo caminho de código (um retry ingênuo do segundo cenário poderia
// reexecutar um `pg_restore` desnecessária ou perigosamente).

// Lançado quando o artefato de backup foi gerado e enviado ao storage com sucesso, mas
// `markBackupRunCompleted()` falhou — o backup em si é válido (o artefato + manifesto existem no
// storage), só a linha `backup_runs` não pôde ser atualizada para `status='completed'`. Nunca apagar o
// artefato nem tentar "corrigir" automaticamente — a reconciliação (atualizar backup_runs manualmente,
// ou aceitar a lacuna) é uma decisão operacional humana.
class BackupTrackingError extends Error {
  constructor(message, { manifest, cause } = {}) {
    super(message);
    this.name = 'BackupTrackingError';
    this.code = 'BACKUP_COMPLETED_BUT_TRACKING_FAILED';
    this.manifest = manifest || null;
    this.cause = cause || null;
  }
}

// Lançado quando `pg_restore` já foi executado (com sucesso ou falha) e a tentativa de gravar
// `restore_runs` falhou. NUNCA deve levar a uma reexecução automática de `pg_restore` — o restore em si
// já aconteceu (ou já falhou definitivamente); só a evidência dessa execução não foi persistida.
class RestoreEvidenceError extends Error {
  constructor(message, { restoreId, backupId, targetEnvironment, executionResult, report, cause } = {}) {
    super(message);
    this.name = 'RestoreEvidenceError';
    this.code = 'RESTORE_COMPLETED_BUT_EVIDENCE_NOT_RECORDED';
    this.restoreId = restoreId || null;
    this.backupId = backupId || null;
    this.targetEnvironment = targetEnvironment || null;
    // 'success' | 'failed' — o resultado REAL da execução do restore, independente do sucesso/falha do
    // registro de evidência.
    this.executionResult = executionResult || null;
    this.report = report || null;
    this.cause = cause || null;
  }
}

module.exports = { BackupTrackingError, RestoreEvidenceError };
