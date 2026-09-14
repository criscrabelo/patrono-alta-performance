#!/usr/bin/env node
// Sprint 2, Hardening H5 (docs/PRODUCTION_GATE.md, PG-21; docs/DECISIONS.md, PROD-H5-01): restore
// production-grade do PostgreSQL canônico. Nunca assume um banco "atual" implicitamente — exige
// DATABASE_URL_TARGET explícita; nunca sobrescreve dado em produção sem confirmação forte e explícita
// (item 26); nunca restaura um backup de outro ambiente sobre produção sem override auditável (item 15).
//
// Uso (restore a partir do storage offsite configurado):
//   DATABASE_URL_TARGET=... BACKUP_ID=bkp_... BACKUP_SOURCE_ENVIRONMENT=production \
//   RESTORE_TARGET_ENVIRONMENT=staging npm run restore:postgres
//
// Uso (restore a partir de um artefato local — testes/validação manual):
//   passar { localManifestPath, localArtifactPath } para runRestore() diretamente (ver
//   tests/h5-backup-restore-postgres.test.js).
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');

const { VALID_ENVIRONMENTS } = require('../backup/environment');
const { createStorageAdapter } = require('../backup/storage-adapter');
const { validateManifest } = require('../backup/manifest');
const backupCrypto = require('../backup/crypto');
const { sanitizeErrorMessage } = require('../backup/sanitize');
const runsRepository = require('../backup/runs-repository');
const { parsePostgresConnection, pgCliArgs, pgChildEnv } = require('../backup/pg-connection');
const { RestoreEvidenceError } = require('../backup/errors');
const logger = require('../observability/logger');

// Dados operacionais efêmeros (item 30-32 do escopo H5): após um disaster recovery, preferir REVOGAR
// sessões/desafios/tokens/buckets de rate limit em vez de restaurá-los cegamente. Nenhum deles é dado de
// negócio — reautenticar é mais seguro do que ressuscitar estado de segurança potencialmente obsoleto ou
// comprometido (a causa raiz do disaster recovery pode ter sido justamente um incidente de segurança).
// Decisão documentada em docs/DECISIONS.md (PROD-H5-01) e docs/BACKUP_RESTORE_RUNBOOK.md.
const EPHEMERAL_TABLES_TO_REVOKE = ['auth_sessions', 'auth_challenges', 'password_reset_tokens', 'rate_limit_buckets'];

function generateRestoreId() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `rst_${timestamp}_${crypto.randomBytes(4).toString('hex')}`;
}

function sha256OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function applicationCommit() {
  try {
    const { execFileSync } = require('node:child_process');
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8').trim();
  } catch { return null; }
}

async function resolveArtifact({ workDir, localManifestPath, localArtifactPath, backupId, backupSourceEnvironment, storageAdapter }) {
  if (localManifestPath && localArtifactPath) {
    const manifest = JSON.parse(fs.readFileSync(localManifestPath, 'utf8'));
    return { manifest, artifactPath: localArtifactPath };
  }
  if (!backupId) throw new Error('BACKUP_ID (ou localManifestPath/localArtifactPath) é obrigatório para localizar o backup a restaurar.');
  if (!backupSourceEnvironment) throw new Error('BACKUP_SOURCE_ENVIRONMENT é obrigatória para localizar o backup no storage offsite.');
  const manifestObjectKey = `${backupSourceEnvironment}/${backupId}.manifest.json`;
  const manifestPath = path.join(workDir, 'manifest.json');
  await storageAdapter.getObject(manifestObjectKey, manifestPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const artifactPath = path.join(workDir, path.basename(manifest.storageObjectKey));
  await storageAdapter.getObject(manifest.storageObjectKey, artifactPath);
  return { manifest, artifactPath };
}

async function targetHasExistingData(client) {
  const { rows } = await client.query("SELECT to_regclass('schema_migrations') AS reg");
  if (!rows[0].reg) return false;
  const { rows: countRows } = await client.query('SELECT COUNT(*)::int AS count FROM schema_migrations');
  return countRows[0].count > 0;
}

async function revokeEphemeralState(client) {
  const revoked = [];
  for (const table of EPHEMERAL_TABLES_TO_REVOKE) {
    const { rows } = await client.query('SELECT to_regclass($1) AS reg', [table]);
    if (rows[0].reg) {
      await client.query(`TRUNCATE ${table}`);
      revoked.push(table);
    }
  }
  return revoked;
}

async function smokeValidateTargetData(client) {
  const counts = {};
  for (const table of ['app_users', 'legal_processes', 'legal_deadlines', 'audit_log']) {
    const { rows } = await client.query('SELECT to_regclass($1) AS reg', [table]);
    if (!rows[0].reg) { counts[table] = null; continue; }
    const { rows: countRows } = await client.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
    counts[table] = countRows[0].count;
  }
  const { rows: migrationRows } = await client.query('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').catch(() => ({ rows: [] }));
  return { rowCounts: counts, latestMigration: migrationRows[0]?.version || null };
}

async function runRestore(options = {}) {
  const startedAt = new Date().toISOString();
  const restoreId = generateRestoreId();
  logger.info('restore_started', { component: 'restore', restoreId });
  const databaseUrlTarget = options.databaseUrlTarget || process.env.DATABASE_URL_TARGET;
  if (!databaseUrlTarget) throw new Error('DATABASE_URL_TARGET é obrigatória — restore nunca assume um banco "atual" implicitamente.');

  const targetEnvironment = options.targetEnvironment || process.env.RESTORE_TARGET_ENVIRONMENT;
  if (!targetEnvironment || !VALID_ENVIRONMENTS.includes(targetEnvironment)) {
    throw new Error(`RESTORE_TARGET_ENVIRONMENT inválida ou ausente (valores aceitos: ${VALID_ENVIRONMENTS.join(', ')}).`);
  }

  backupCrypto.validateBackupEncryptionKeyIfPresent();

  // `options.runsRepositoryOverride` é injetável (opcional) para permitir testar deliberadamente uma
  // falha na GRAVAÇÃO de evidência (`restore_runs`) sem depender de restrição de privilégio real — ao
  // contrário de `backup_runs` (tabela pré-existente, cujo dono é sempre o superusuário de migração),
  // `restore_runs` é recriada pelo PRÓPRIO `pg_restore` (com `--no-owner`, o papel conectado se torna o
  // dono da tabela restaurada) — um dono sempre tem privilégio pleno sobre seus próprios objetos, então
  // não há como restringir via GRANT/REVOKE uma falha de INSERT realista para este caminho específico.
  // Mesmo padrão de injeção de dependência já usado para `s3Client`/`tempDir` neste módulo.
  const runsRepo = options.runsRepositoryOverride || runsRepository;

  const workDir = fs.mkdtempSync(path.join(options.tempDir || os.tmpdir(), 'patrono-restore-'));
  fs.chmodSync(workDir, 0o700);

  let targetClient = null;
  try {
    const storageAdapter = (options.localManifestPath && options.localArtifactPath)
      ? null
      : createStorageAdapter({ environment: options.backupSourceEnvironment || process.env.BACKUP_SOURCE_ENVIRONMENT, provider: options.storageProvider, s3Client: options.s3Client });

    const { manifest, artifactPath } = await resolveArtifact({
      workDir,
      localManifestPath: options.localManifestPath,
      localArtifactPath: options.localArtifactPath,
      backupId: options.backupId || process.env.BACKUP_ID,
      backupSourceEnvironment: options.backupSourceEnvironment || process.env.BACKUP_SOURCE_ENVIRONMENT,
      storageAdapter
    });

    const manifestErrors = validateManifest(manifest);
    if (manifestErrors.length) throw new Error(`Manifesto de backup inválido, restore recusado: ${manifestErrors.join('; ')}`);

    // Integridade ANTES de qualquer ação no banco (item 41): tamanho e hash do artefato baixado devem
    // bater exatamente com o manifesto — mismatch bloqueia o restore incondicionalmente.
    const actualSize = fs.statSync(artifactPath).size;
    if (actualSize !== manifest.sizeBytes) {
      throw new Error(`Tamanho do artefato (${actualSize} bytes) não confere com o manifesto (${manifest.sizeBytes} bytes) — restore recusado.`);
    }
    const actualSha256 = await sha256OfFile(artifactPath);
    if (actualSha256 !== manifest.sha256) {
      throw new Error('SHA-256 do artefato não confere com o manifesto — artefato corrompido ou adulterado, restore recusado.');
    }

    // Cross-environment restore (item 15): por padrão, só um backup do MESMO ambiente do alvo pode ser
    // restaurado; qualquer divergência exige um override explícito e auditável.
    if (manifest.environment !== targetEnvironment) {
      const override = options.allowCrossEnvironment || process.env.RESTORE_ALLOW_CROSS_ENVIRONMENT;
      if (override !== 'I_ACCEPT_THE_RISK') {
        throw new Error(
          `Restore cross-environment bloqueado por padrão: backup é de "${manifest.environment}", alvo é "${targetEnvironment}". ` +
          `Defina RESTORE_ALLOW_CROSS_ENVIRONMENT=I_ACCEPT_THE_RISK explicitamente para prosseguir.`
        );
      }
    }

    // Confirmação forte obrigatória para qualquer restore visando produção (item 26) — string longa e
    // intencional, nunca um booleano trivial como "true".
    if (targetEnvironment === 'production') {
      const confirmation = options.confirmProduction || process.env.RESTORE_CONFIRM_PRODUCTION;
      if (confirmation !== 'YES_I_UNDERSTAND') {
        throw new Error('Restore para produção exige RESTORE_CONFIRM_PRODUCTION=YES_I_UNDERSTAND explicitamente definida.');
      }
    }

    let restorableArtifactPath = artifactPath;
    if (manifest.encrypted) {
      const currentKeyId = backupCrypto.currentEncryptionKeyId();
      if (!currentKeyId) throw new Error('Backup está cifrado mas BACKUP_ENCRYPTION_KEY não está configurada neste ambiente de restore.');
      if (currentKeyId !== manifest.encryptionKeyId) {
        throw new Error(`Chave de criptografia atual (encryptionKeyId=${currentKeyId}) não corresponde à usada no backup (${manifest.encryptionKeyId}).`);
      }
      const decryptedPath = path.join(workDir, 'restored.dump');
      await backupCrypto.decryptFile(artifactPath, decryptedPath);
      restorableArtifactPath = decryptedPath;
    }

    // Smoke validation do formato (item 43) — nunca assume que um arquivo íntegro em hash é
    // necessariamente um archive pg_restore válido (ex.: cifrado com a chave errada teria hash correto do
    // arquivo cifrado, mas o conteúdo decifrado poderia ser lixo se algo mais tivesse dado errado).
    await execFileAsync('pg_restore', ['--list', restorableArtifactPath]);

    targetClient = new Client({ connectionString: databaseUrlTarget });
    targetClient.on('error', (error) => { console.error(`[restore-postgres] erro de conexão (não fatal): ${error.message}`); });
    await targetClient.connect();

    const hasExistingData = await targetHasExistingData(targetClient);
    const replaceFlag = options.replace || process.env.RESTORE_REPLACE;
    if (hasExistingData && replaceFlag !== 'YES_REPLACE_TARGET_DATA') {
      throw new Error('Banco de destino já contém dados. Restaurar por cima exige RESTORE_REPLACE=YES_REPLACE_TARGET_DATA explicitamente definida.');
    }

    // Correção pós-H5 (revisão técnica independente): nunca passa DATABASE_URL_TARGET completa como argv
    // — host/porta/usuário/banco vão como flags de CLI (não-segredo), a senha só via `PGPASSWORD` no
    // `env` do processo filho.
    const targetConnection = parsePostgresConnection(databaseUrlTarget);
    const targetChildEnv = pgChildEnv(targetConnection);
    const restoreArgs = pgCliArgs(targetConnection, ['--no-owner', '--no-privileges']);
    if (hasExistingData && replaceFlag === 'YES_REPLACE_TARGET_DATA') restoreArgs.push('--clean', '--if-exists');
    restoreArgs.push(restorableArtifactPath);
    await execFileAsync('pg_restore', restoreArgs, { env: targetChildEnv });

    const revokedTables = await revokeEphemeralState(targetClient);
    const smoke = await smokeValidateTargetData(targetClient);

    const completedAt = new Date().toISOString();
    const commit = applicationCommit();
    const report = {
      restoreId, backupId: manifest.backupId, startedAt, completedAt, targetEnvironment, result: 'success',
      durationMs: Date.parse(completedAt) - Date.parse(startedAt),
      revokedEphemeralTables: revokedTables, smoke, manifest, evidenceRecorded: false
    };

    // Correção pós-H5 (revisão técnica independente): o `pg_restore` JÁ FOI EXECUTADO neste ponto — o
    // restore em si é um sucesso independentemente do que acontecer aqui. Se `insertRestoreRun()`
    // falhar, NUNCA tentamos reexecutar o restore (seria destrutivo/desnecessário) — lançamos um erro
    // DEDICADO (`RestoreEvidenceError`) distinguindo claramente "resultado da execução" (sucesso) de
    // "resultado do registro de evidência" (falhou), com o relatório completo anexado.
    try {
      await runsRepo.insertRestoreRun(targetClient, {
        restoreId, backupId: manifest.backupId, targetEnvironment, result: 'success',
        applicationCommit: commit, operatorIdentity: options.operatorIdentity || process.env.RESTORE_OPERATOR || null,
        startedAt
      });
      report.evidenceRecorded = true;
    } catch (evidenceError) {
      logger.error('restore_evidence_failed', { component: 'restore', restoreId, backupId: manifest.backupId, errorCode: 'RESTORE_EVIDENCE_FAILED', error: logger.serializeError(evidenceError) });
      throw new RestoreEvidenceError(
        `Restore concluído com SUCESSO (restoreId=${restoreId}, backupId=${manifest.backupId}), mas o ` +
        `registro de evidência (restore_runs) falhou: ${sanitizeErrorMessage(evidenceError.message)}. ` +
        `NÃO reexecute o restore — ele já foi aplicado ao banco de destino. Reconcilie a evidência manualmente.`,
        { restoreId, backupId: manifest.backupId, targetEnvironment, executionResult: 'success', report, cause: evidenceError }
      );
    }

    logger.info('restore_completed', { component: 'restore', restoreId, backupId: manifest.backupId, durationMs: report.durationMs });
    return report;
  } catch (error) {
    // `RestoreEvidenceError` já representa o estado final correto (execução bem-sucedida, evidência não
    // registrada) — nunca reprocessar aqui embaixo (marcaria incorretamente como "failed" um restore que
    // na verdade teve sucesso, ou tentaria gravar evidência duas vezes).
    if (error instanceof RestoreEvidenceError) throw error;

    const sanitizedMessage = sanitizeErrorMessage(error.message);
    logger.error('restore_failed', { component: 'restore', restoreId, errorCode: 'RESTORE_FAILED', error: logger.serializeError(error) });
    if (targetClient) {
      // Um banco de destino JÁ foi tocado (conexão estabelecida) quando este erro ocorreu — tentamos
      // registrar a falha em `restore_runs`. Se ESSA gravação também falhar, nunca escondemos nenhum dos
      // dois problemas: o erro original do restore E a falha de evidência são preservados juntos.
      try {
        await runsRepo.insertRestoreRun(targetClient, {
          restoreId, backupId: options.backupId || process.env.BACKUP_ID || 'unknown', targetEnvironment: targetEnvironment || 'unknown',
          result: 'failed', applicationCommit: applicationCommit(), operatorIdentity: options.operatorIdentity || process.env.RESTORE_OPERATOR || null,
          errorMessage: sanitizedMessage, startedAt
        });
      } catch (evidenceError) {
        logger.error('restore_evidence_failed', { component: 'restore', restoreId, errorCode: 'RESTORE_FAILURE_EVIDENCE_FAILED', error: logger.serializeError(evidenceError) });
        const wrapped = new RestoreEvidenceError(
          `Restore FALHOU (${sanitizedMessage}) e o registro dessa falha em restore_runs também falhou: ` +
          `${sanitizeErrorMessage(evidenceError.message)}. Nenhuma tentativa adicional de restore foi feita.`,
          { restoreId, targetEnvironment, executionResult: 'failed', cause: evidenceError }
        );
        wrapped.originalErrorMessage = sanitizedMessage;
        throw wrapped;
      }
    }
    // Se `targetClient` é null, a falha ocorreu ANTES de qualquer conexão com o alvo (ex.: hash
    // inválido, manifesto inválido, confirmação de produção ausente) — não há registro em `restore_runs`
    // porque nenhum banco de destino foi tocado; isso é o comportamento esperado, nunca uma evidência
    // "inventada" ou uma falha de rastreamento.
    const wrapped = new Error(sanitizedMessage);
    wrapped.restoreId = restoreId;
    throw wrapped;
  } finally {
    // Silencioso intencionalmente: encerrar a conexão é limpeza de recurso, não uma operação cujo
    // resultado afete a evidência operacional (já tratada explicitamente acima, nos dois ramos success/
    // failure) — uma falha aqui não teria mais nada de útil para reportar além do que já foi.
    if (targetClient) await targetClient.end().catch(() => {});
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  runRestore()
    .then(report => {
      console.log(`Restore concluído: ${report.restoreId} (backup ${report.backupId}, ${report.durationMs}ms)`);
      process.exitCode = 0;
    })
    .catch(error => {
      if (error instanceof RestoreEvidenceError) {
        // Código de saída DISTINTO (2) de uma falha real de restore (1). Quando executionResult é
        // 'success', o restore JÁ FOI APLICADO — um scheduler/operador nunca deve reexecutar
        // automaticamente a partir deste sinal.
        console.error(`AVISO: ${sanitizeErrorMessage(error.message)}`);
        console.error(`Resultado real da execução: ${error.executionResult || 'desconhecido'}. NÃO reexecutar automaticamente.`);
        process.exitCode = 2;
        return;
      }
      console.error('Falha ao executar restore:', sanitizeErrorMessage(error.message));
      process.exitCode = 1;
    });
}

module.exports = { runRestore, generateRestoreId, EPHEMERAL_TABLES_TO_REVOKE };
