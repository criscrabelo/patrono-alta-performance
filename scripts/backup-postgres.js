#!/usr/bin/env node
// Sprint 2, Hardening H5 (docs/PRODUCTION_GATE.md, PG-21; docs/DECISIONS.md, PROD-H5-01): backup
// production-grade do PostgreSQL canônico. Nunca depende só de `POST /api/backup` — invocável por
// cron/scheduler externo (`npm run backup:postgres`), idempotente (cada execução gera um backupId único,
// nunca sobrescreve um backup anterior), e nunca declara sucesso sem o upload offsite confirmado.
//
// Uso: DATABASE_URL=... npm run backup:postgres
// Variáveis relevantes: ver .env.example (seção H5) e docs/BACKUP_RESTORE_RUNBOOK.md.
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');

const { resolveAppEnvironment, isProductionEnvironment } = require('../backup/environment');
const { createStorageAdapter } = require('../backup/storage-adapter');
const { buildManifest } = require('../backup/manifest');
const backupCrypto = require('../backup/crypto');
const { sanitizeErrorMessage } = require('../backup/sanitize');
const runsRepository = require('../backup/runs-repository');
const { parsePostgresConnection, pgCliArgs, pgChildEnv } = require('../backup/pg-connection');
const { BackupTrackingError } = require('../backup/errors');
const logger = require('../observability/logger');

function generateBackupId() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `bkp_${timestamp}_${crypto.randomBytes(4).toString('hex')}`;
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

async function fetchDatabaseMetadata(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });
  // P0 (branch demo — mesma classe de crash corrigida em storage/postgres-store.js): um `pg.Client` sem
  // listener de 'error' derruba o processo inteiro (uncaughtException) se a conexão cair. Log e segue —
  // o erro real de conexão continua sendo reportado pela rejeição da própria query/`.connect()`.
  client.on('error', (error) => { console.error(`[backup-postgres] erro de conexão (não fatal): ${error.message}`); });
  await client.connect();
  try {
    const versionResult = await client.query('SHOW server_version');
    // Correção pós-H5 (revisão técnica independente): o manifesto registrava `database: 'postgres'`
    // fixo, em vez do nome real do banco de origem — corrigido para `current_database()`.
    const databaseResult = await client.query('SELECT current_database() AS name');
    const migrationResult = await client.query('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').catch(() => ({ rows: [] }));
    return {
      postgresVersion: versionResult.rows[0]?.server_version || null,
      databaseName: databaseResult.rows[0]?.name || null,
      migrationVersion: migrationResult.rows[0]?.version || null
    };
  } finally {
    await client.end();
  }
}

async function runBackup({ databaseUrl, environment, tempDir, s3Client } = {}) {
  logger.info('backup_started', { component: 'backup' });
  const resolvedDatabaseUrl = databaseUrl || process.env.DATABASE_URL;
  if (!resolvedDatabaseUrl) throw new Error('DATABASE_URL é obrigatória para executar o backup do PostgreSQL.');
  const resolvedEnvironment = environment || resolveAppEnvironment();
  backupCrypto.validateBackupEncryptionKeyIfPresent();
  // Correção pós-H5 (revisão técnica independente): até existir validação real de SSE/KMS do provider de
  // storage, um backup em produção sem criptografia application-side é um artefato em texto claro — nunca
  // aceito. Verificado ANTES de qualquer recurso ser criado (nada para limpar se falhar aqui).
  if (isProductionEnvironment(resolvedEnvironment) && !backupCrypto.isBackupEncryptionConfigured()) {
    throw new Error('BACKUP_ENCRYPTION_KEY é obrigatória em produção — backup em texto claro (sem criptografia application-side) nunca é aceito. Configure uma chave com pelo menos 32 caracteres.');
  }
  // Falha de configuração (ex.: produção sem storage offsite real) é verificada ANTES de criar qualquer
  // recurso (diretório temporário, conexão) — nada para limpar nesse caso, o erro propaga imediatamente.
  // `s3Client` é injetável (opcional) só para permitir testar o caminho de produção com um cliente S3
  // fake, sem credenciais/rede reais — mesmo padrão já usado em runRestore().
  const storageAdapter = createStorageAdapter({ environment: resolvedEnvironment, s3Client });
  // Correção pós-H5 (revisão técnica independente): a connection string NUNCA é passada como argumento
  // de linha de comando a `pg_dump`/`pg_restore` — `ps`/`/proc` exporiam usuário/senha para qualquer um
  // capaz de listar processos do sistema. `parsePostgresConnection()` extrai host/porta/usuário/banco
  // (não-segredo, viram argv) e a senha (só via `PGPASSWORD` no `env` do processo filho).
  const connection = parsePostgresConnection(resolvedDatabaseUrl);
  const childEnv = pgChildEnv(connection);

  const backupId = generateBackupId();
  const workDir = fs.mkdtempSync(path.join(tempDir || os.tmpdir(), 'patrono-backup-'));
  fs.chmodSync(workDir, 0o700);
  const client = new Client({ connectionString: resolvedDatabaseUrl });
  client.on('error', (error) => { console.error(`[backup-postgres] erro de conexão (não fatal): ${error.message}`); });
  let trackingAvailable = true;

  const dumpPath = path.join(workDir, `${backupId}.dump`);
  try {
    // Correção pós-H5 (revisão técnica independente): iniciar o rastreamento operacional
    // (`backup_runs`) faz parte do MESMO bloco try/finally do resto do backup — nunca um try/catch
    // isolado ANTES dele, que deixaria essa falha escapar da limpeza de recursos (workDir/conexão) e,
    // em produção, escapar do fail-closed abaixo.
    try {
      await client.connect();
      await runsRepository.insertBackupRunStarted(client, { backupId, environment: resolvedEnvironment, storageProvider: storageAdapter.provider });
    } catch (trackingStartError) {
      // Em produção, um backup NUNCA pode ser gerado sem evidência operacional durável — se
      // `backup_runs` não pôde nem ser iniciada, o backup é abortado ANTES do `pg_dump` rodar
      // (fail-closed). Fora de produção, permanece tolerante (permite testar/rodar sem a migration 008
      // aplicada), mas isso é uma degradação EXPLÍCITA, nunca silenciosa — documentada aqui e no
      // runbook, nunca inferida implicitamente por quem lê o código.
      if (isProductionEnvironment(resolvedEnvironment)) {
        throw new Error(
          `Não foi possível iniciar o rastreamento operacional do backup (backup_runs) em produção: ` +
          `${sanitizeErrorMessage(trackingStartError.message)}. Backup abortado ANTES do pg_dump — ` +
          `produção nunca gera um backup sem evidência operacional durável.`
        );
      }
      trackingAvailable = false;
    }

    // -Fc (custom format): permite pg_restore seletivo, é o formato binário padrão recomendado pelo
    // próprio PostgreSQL para backups lógicos (item 5 do escopo H5). --no-owner/--no-privileges evitam
    // que um restore em ambiente diferente falhe por papéis/owners que não existem no destino. Nunca
    // passa a connection string completa como argv — host/porta/usuário/banco vão como flags de CLI
    // (não-segredo), a senha só via `PGPASSWORD` no `env` do processo filho (childEnv).
    await execFileAsync('pg_dump', pgCliArgs(connection, ['-Fc', '--no-owner', '--no-privileges', '-f', dumpPath]), { env: childEnv });

    const { size: sizeBytesRaw } = fs.statSync(dumpPath);
    if (sizeBytesRaw <= 0) throw new Error('pg_dump produziu um artefato de tamanho zero — backup inválido.');

    // Smoke validation (item 43): um pg_dump que "terminou" sem lançar não é suficiente — confirma que o
    // arquivo é um archive válido e listável antes de declarar o backup utilizável.
    await execFileAsync('pg_restore', ['--list', dumpPath]);

    let artifactPath = dumpPath;
    let encrypted = false;
    let encryptionKeyId = null;
    if (backupCrypto.isBackupEncryptionConfigured()) {
      const encryptedPath = path.join(workDir, `${backupId}.dump.enc`);
      await backupCrypto.encryptFile(dumpPath, encryptedPath);
      artifactPath = encryptedPath;
      encrypted = true;
      encryptionKeyId = backupCrypto.currentEncryptionKeyId();
    }

    const sha256 = await sha256OfFile(artifactPath);
    const sizeBytes = fs.statSync(artifactPath).size;
    const objectKey = `${resolvedEnvironment}/${backupId}${encrypted ? '.dump.enc' : '.dump'}`;

    const { postgresVersion, databaseName, migrationVersion } = await fetchDatabaseMetadata(resolvedDatabaseUrl);
    const commit = applicationCommit();

    // Upload do artefato PRIMEIRO; o manifesto só é enviado DEPOIS de o artefato estar confirmado no
    // storage — um objeto de dados sem manifesto correspondente nunca é tratado como backup válido pelo
    // restore (item 40: upload parcial nunca vira backup válido).
    await storageAdapter.putObject(objectKey, artifactPath);

    const createdAt = new Date().toISOString();
    const manifest = buildManifest({
      backupId, createdAt, completedAt: new Date().toISOString(), environment: resolvedEnvironment,
      database: databaseName || 'unknown', postgresVersion, migrationVersion, applicationCommit: commit,
      format: 'custom', compression: 'pg_dump-default', encrypted, encryptionKeyId, sha256, sizeBytes,
      storageProvider: storageAdapter.provider, storageObjectKey: objectKey
    });
    const manifestPath = path.join(workDir, `${backupId}.manifest.json`);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    // Chave do manifesto é INDEPENDENTE da extensão do artefato de dados (`.dump`/`.dump.enc`) —
    // sempre `${environment}/${backupId}.manifest.json` — para que o restore possa localizá-lo sabendo
    // apenas o backupId e o ambiente de origem, sem precisar adivinhar se o artefato foi cifrado.
    await storageAdapter.putObject(`${resolvedEnvironment}/${backupId}.manifest.json`, manifestPath);

    if (trackingAvailable) {
      // Correção pós-H5 (revisão técnica independente): o artefato JÁ está confirmado no storage neste
      // ponto (upload do `.dump`/`.dump.enc` e do manifesto ambos concluídos acima) — o backup em si é
      // válido independentemente do que acontecer aqui. Se `markBackupRunCompleted()` falhar, NUNCA
      // tratamos isso como falha do backup (nunca chamamos `markBackupRunFailed`, que mentiria sobre o
      // resultado real) — lançamos um erro DEDICADO (`BackupTrackingError`) que carrega o manifesto
      // completo, para que quem chamar saiba exatamente o que reconciliar manualmente.
      try {
        await runsRepository.markBackupRunCompleted(client, {
          backupId, storageObjectKey: objectKey, format: 'custom', sizeBytes, sha256, encrypted, encryptionKeyId,
          postgresVersion, migrationVersion, applicationCommit: commit
        });
      } catch (trackingCompleteError) {
        throw new BackupTrackingError(
          `Backup concluído e enviado ao storage com sucesso (backupId=${backupId}, objectKey=${objectKey}), ` +
          `mas o registro de evidência operacional (backup_runs) não pôde ser atualizado para "completed": ` +
          `${sanitizeErrorMessage(trackingCompleteError.message)}. O artefato É VÁLIDO — não repita o backup ` +
          `automaticamente; reconcilie a linha de backup_runs manualmente (ela permanece "started").`,
          { manifest, cause: trackingCompleteError }
        );
      }
    }

    logger.info('backup_completed', { component: 'backup', backupId, sizeBytes: manifest.sizeBytes });
    return manifest;
  } catch (error) {
    // `BackupTrackingError` significa que o backup TEVE SUCESSO — nunca marcar como failed (mentiria
    // sobre o resultado real) nem apagar o artefato já confirmado no storage. Propaga como está,
    // preservando `.manifest` para quem chamar decidir a reconciliação.
    if (error instanceof BackupTrackingError) {
      logger.error('backup_tracking_failed', { component: 'backup', backupId, errorCode: 'BACKUP_TRACKING_FAILED', error: logger.serializeError(error) });
      throw error;
    }

    const sanitizedMessage = sanitizeErrorMessage(error.message);
    logger.error('backup_failed', { component: 'backup', backupId, errorCode: 'BACKUP_FAILED', error: logger.serializeError(error) });
    if (trackingAvailable) {
      // Correção pós-H5 (revisão técnica independente): mesmo aqui — onde o backup JÁ falhou por outro
      // motivo — uma falha adicional ao registrar `status='failed'` nunca fica silenciosa. Não lançamos
      // um segundo erro (o erro original do backup é o que importa e já será propagado abaixo), mas
      // sinalizamos explicitamente em stderr — nunca um `.catch(() => {})` vazio sem nenhum sinal.
      await runsRepository.markBackupRunFailed(client, { backupId, errorMessage: sanitizedMessage }).catch(trackingFailError => {
        console.error(`Aviso: falha adicional ao registrar backup_runs como "failed" (backupId=${backupId}): ${sanitizeErrorMessage(trackingFailError.message)}`);
        logger.error('backup_tracking_failed', { component: 'backup', backupId, errorCode: 'BACKUP_RUN_MARK_FAILED_FAILED', error: logger.serializeError(trackingFailError) });
      });
    }
    const wrapped = new Error(sanitizedMessage);
    wrapped.backupId = backupId;
    throw wrapped;
  } finally {
    // Silencioso intencionalmente: encerrar a conexão de rastreamento é limpeza de recurso, não uma
    // operação cujo resultado afete a evidência operacional (já registrada/tentada acima) — uma falha
    // aqui não teria mais nada de útil para reportar além do que já foi.
    await client.end().catch(() => {});
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  runBackup()
    .then(manifest => {
      console.log(`Backup concluído: ${manifest.backupId} (${manifest.sizeBytes} bytes, sha256=${manifest.sha256})`);
      process.exitCode = 0;
    })
    .catch(error => {
      if (error instanceof BackupTrackingError) {
        // Código de saída DISTINTO (2) de uma falha real de backup (1) — o backup em si teve sucesso;
        // só a evidência operacional não foi registrada. Nunca reexecutar automaticamente a partir
        // deste sinal (um scheduler externo não deve tratar exit code 2 como "tente de novo").
        console.error(`AVISO: ${sanitizeErrorMessage(error.message)}`);
        if (error.manifest) console.error(`Manifesto do backup válido: ${JSON.stringify(error.manifest)}`);
        process.exitCode = 2;
        return;
      }
      console.error('Falha ao executar backup:', sanitizeErrorMessage(error.message));
      process.exitCode = 1;
    });
}

module.exports = { runBackup, generateBackupId, sha256OfFile, applicationCommit, fetchDatabaseMetadata };
