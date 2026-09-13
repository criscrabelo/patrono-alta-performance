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
  let trackingAvailable = true;

  try {
    // Uma falha de conexão aqui (DATABASE_URL inalcançável) já é sinal de que o pg_dump abaixo também
    // falhará com a mesma causa — não tenta mascarar isso, só desliga o rastreamento operacional (que
    // depende da mesma conexão) e deixa o pg_dump real produzir o erro definitivo e sanitizado.
    await client.connect();
    await runsRepository.insertBackupRunStarted(client, { backupId, environment: resolvedEnvironment, storageProvider: storageAdapter.provider });
  } catch (error) {
    trackingAvailable = false;
  }

  const dumpPath = path.join(workDir, `${backupId}.dump`);
  try {
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
      await runsRepository.markBackupRunCompleted(client, {
        backupId, storageObjectKey: objectKey, format: 'custom', sizeBytes, sha256, encrypted, encryptionKeyId,
        postgresVersion, migrationVersion, applicationCommit: commit
      });
    }

    return manifest;
  } catch (error) {
    const sanitizedMessage = sanitizeErrorMessage(error.message);
    if (trackingAvailable) {
      await runsRepository.markBackupRunFailed(client, { backupId, errorMessage: sanitizedMessage }).catch(() => {});
    }
    const wrapped = new Error(sanitizedMessage);
    wrapped.backupId = backupId;
    throw wrapped;
  } finally {
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
      console.error('Falha ao executar backup:', sanitizeErrorMessage(error.message));
      process.exitCode = 1;
    });
}

module.exports = { runBackup, generateBackupId, sha256OfFile, applicationCommit, fetchDatabaseMetadata };
