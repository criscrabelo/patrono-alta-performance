// Sprint 2, Hardening H5 (docs/PRODUCTION_GATE.md, PG-21; docs/DECISIONS.md, PROD-H5-01): testes
// unitários dos módulos de apoio de backup/restore (`backup/*`) — não exigem PostgreSQL real. O teste de
// ponta a ponta com `pg_dump`/`pg_restore` reais está em `tests/h5-backup-restore-postgres.test.js`
// (gated por TEST_DATABASE_URL, mesmo padrão de todo o restante do projeto).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveAppEnvironment, isProductionEnvironment, VALID_ENVIRONMENTS } = require('../backup/environment');
const { buildManifest, validateManifest } = require('../backup/manifest');
const backupCrypto = require('../backup/crypto');
const { sanitizeErrorMessage } = require('../backup/sanitize');
const { createStorageAdapter } = require('../backup/storage-adapter');
const { createFilesystemStorageAdapter } = require('../backup/storage-adapters/filesystem');
const { createS3StorageAdapter } = require('../backup/storage-adapters/s3');
const { parsePostgresConnection, pgCliArgs, pgChildEnv } = require('../backup/pg-connection');

function validManifestFields(overrides = {}) {
  return {
    backupId: 'bkp_test_0001', createdAt: new Date().toISOString(), environment: 'development',
    database: 'postgres', postgresVersion: '16.13', migrationVersion: '008_h5_backup_restore_runs',
    format: 'custom', encrypted: false, sha256: 'a'.repeat(64), sizeBytes: 1024,
    storageProvider: 'filesystem', storageObjectKey: 'development/bkp_test_0001.dump',
    ...overrides
  };
}

// --- environment.js ---------------------------------------------------------------------------------
test('[H5-env-A] resolveAppEnvironment() honra APP_ENVIRONMENT explícita', () => {
  const original = process.env.APP_ENVIRONMENT;
  try {
    process.env.APP_ENVIRONMENT = 'staging';
    assert.equal(resolveAppEnvironment(), 'staging');
  } finally { if (original === undefined) delete process.env.APP_ENVIRONMENT; else process.env.APP_ENVIRONMENT = original; }
});

test('[H5-env-B] resolveAppEnvironment() rejeita valor inválido', () => {
  const original = process.env.APP_ENVIRONMENT;
  try {
    process.env.APP_ENVIRONMENT = 'nao-existe';
    assert.throws(() => resolveAppEnvironment(), /APP_ENVIRONMENT inválida/);
  } finally { if (original === undefined) delete process.env.APP_ENVIRONMENT; else process.env.APP_ENVIRONMENT = original; }
});

test('[H5-env-C] resolveAppEnvironment() deriva de NODE_ENV quando ausente (fail-closed: nunca assume produção por engano)', () => {
  const originalApp = process.env.APP_ENVIRONMENT;
  const originalNode = process.env.NODE_ENV;
  try {
    delete process.env.APP_ENVIRONMENT;
    process.env.NODE_ENV = 'production';
    assert.equal(resolveAppEnvironment(), 'production');
    process.env.NODE_ENV = 'test';
    assert.equal(resolveAppEnvironment(), 'development');
  } finally {
    if (originalApp === undefined) delete process.env.APP_ENVIRONMENT; else process.env.APP_ENVIRONMENT = originalApp;
    process.env.NODE_ENV = originalNode;
  }
});

test('[H5-env-D] isProductionEnvironment()', () => {
  assert.equal(isProductionEnvironment('production'), true);
  assert.equal(isProductionEnvironment('staging'), false);
  assert.equal(isProductionEnvironment('development'), false);
});

// --- manifest.js --------------------------------------------------------------------------------------
test('[H5-manifest-A] buildManifest() aceita campos completos e devolve manifesto normalizado', () => {
  const manifest = buildManifest(validManifestFields());
  assert.equal(manifest.backupId, 'bkp_test_0001');
  assert.equal(manifest.encrypted, false);
  assert.equal(manifest.encryptionKeyId, null);
});

test('[H5-manifest-B] validateManifest() rejeita campo obrigatório ausente', () => {
  const errors = validateManifest(validManifestFields({ sha256: undefined }));
  assert.ok(errors.some(e => e.includes('sha256')));
});

test('[H5-manifest-C] validateManifest() rejeita sha256 mal formado e sizeBytes<=0', () => {
  assert.ok(validateManifest(validManifestFields({ sha256: 'nao-e-hex' })).length > 0);
  assert.ok(validateManifest(validManifestFields({ sizeBytes: 0 })).length > 0);
  assert.ok(validateManifest(validManifestFields({ sizeBytes: -5 })).length > 0);
});

test('[H5-manifest-D] buildManifest() lança se o manifesto resultante for inválido', () => {
  assert.throws(() => buildManifest(validManifestFields({ backupId: '' })), /Manifesto de backup inválido/);
});

// --- crypto.js ----------------------------------------------------------------------------------------
test('[H5-crypto-A] isBackupEncryptionConfigured()/currentEncryptionKeyId() refletem BACKUP_ENCRYPTION_KEY', () => {
  const original = process.env.BACKUP_ENCRYPTION_KEY;
  try {
    delete process.env.BACKUP_ENCRYPTION_KEY;
    assert.equal(backupCrypto.isBackupEncryptionConfigured(), false);
    assert.equal(backupCrypto.currentEncryptionKeyId(), null);
    process.env.BACKUP_ENCRYPTION_KEY = 'chave-de-teste-com-pelo-menos-32-caracteres';
    assert.equal(backupCrypto.isBackupEncryptionConfigured(), true);
    assert.match(backupCrypto.currentEncryptionKeyId(), /^[0-9a-f]{16}$/);
  } finally { if (original === undefined) delete process.env.BACKUP_ENCRYPTION_KEY; else process.env.BACKUP_ENCRYPTION_KEY = original; }
});

test('[H5-crypto-B] validateBackupEncryptionKeyIfPresent() lança para chave curta, aceita ausente/válida', () => {
  const original = process.env.BACKUP_ENCRYPTION_KEY;
  try {
    delete process.env.BACKUP_ENCRYPTION_KEY;
    assert.doesNotThrow(() => backupCrypto.validateBackupEncryptionKeyIfPresent());
    process.env.BACKUP_ENCRYPTION_KEY = 'curta';
    assert.throws(() => backupCrypto.validateBackupEncryptionKeyIfPresent(), /menos de 32 caracteres/);
    process.env.BACKUP_ENCRYPTION_KEY = 'chave-de-teste-com-pelo-menos-32-caracteres';
    assert.doesNotThrow(() => backupCrypto.validateBackupEncryptionKeyIfPresent());
  } finally { if (original === undefined) delete process.env.BACKUP_ENCRYPTION_KEY; else process.env.BACKUP_ENCRYPTION_KEY = original; }
});

test('[H5-crypto-C] encryptFile()/decryptFile() round-trip preserva o conteúdo original', async () => {
  const original = process.env.BACKUP_ENCRYPTION_KEY;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patrono-h5-crypto-'));
  try {
    process.env.BACKUP_ENCRYPTION_KEY = 'chave-de-teste-com-pelo-menos-32-caracteres';
    const plainPath = path.join(dir, 'plain.bin');
    const encryptedPath = path.join(dir, 'enc.bin');
    const roundTripPath = path.join(dir, 'roundtrip.bin');
    const content = crypto_randomContent();
    fs.writeFileSync(plainPath, content);
    await backupCrypto.encryptFile(plainPath, encryptedPath);
    assert.notDeepEqual(fs.readFileSync(encryptedPath), content, 'artefato cifrado nunca deve ser igual ao original em claro');
    await backupCrypto.decryptFile(encryptedPath, roundTripPath);
    assert.deepEqual(fs.readFileSync(roundTripPath), content);
  } finally {
    if (original === undefined) delete process.env.BACKUP_ENCRYPTION_KEY; else process.env.BACKUP_ENCRYPTION_KEY = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
function crypto_randomContent() { return require('node:crypto').randomBytes(4096); }

test('[H5-crypto-D] decryptFile() com chave diferente da usada para cifrar falha (autenticação GCM)', async () => {
  const original = process.env.BACKUP_ENCRYPTION_KEY;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patrono-h5-crypto-'));
  try {
    process.env.BACKUP_ENCRYPTION_KEY = 'chave-A-de-teste-com-pelo-menos-32-caracteres';
    const plainPath = path.join(dir, 'plain.bin');
    const encryptedPath = path.join(dir, 'enc.bin');
    fs.writeFileSync(plainPath, crypto_randomContent());
    await backupCrypto.encryptFile(plainPath, encryptedPath);
    process.env.BACKUP_ENCRYPTION_KEY = 'chave-B-diferente-com-pelo-menos-32-caracteres';
    await assert.rejects(() => backupCrypto.decryptFile(encryptedPath, path.join(dir, 'out.bin')));
  } finally {
    if (original === undefined) delete process.env.BACKUP_ENCRYPTION_KEY; else process.env.BACKUP_ENCRYPTION_KEY = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('[H5-crypto-E] encryptFile()/decryptFile() usam streaming real — nunca carregam o arquivo inteiro em memória (createReadStream/createWriteStream, não readFileSync/writeFileSync)', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'backup', 'crypto.js'), 'utf8');
  assert.ok(!/fs\.readFileSync\(sourcePath\)/.test(source), 'encryptFile não deve carregar o plaintext inteiro via readFileSync');
  assert.ok(/createReadStream/.test(source) && /createWriteStream/.test(source), 'crypto.js deve usar streams reais');
  // Round-trip com um arquivo maior (1MB) para exercitar múltiplos chunks através do pipe/pipeline.
  const original = process.env.BACKUP_ENCRYPTION_KEY;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patrono-h5-crypto-'));
  try {
    process.env.BACKUP_ENCRYPTION_KEY = 'chave-de-teste-com-pelo-menos-32-caracteres';
    const plainPath = path.join(dir, 'plain-1mb.bin');
    const encryptedPath = path.join(dir, 'enc-1mb.bin');
    const roundTripPath = path.join(dir, 'roundtrip-1mb.bin');
    const content = require('node:crypto').randomBytes(1024 * 1024);
    fs.writeFileSync(plainPath, content);
    await backupCrypto.encryptFile(plainPath, encryptedPath);
    await backupCrypto.decryptFile(encryptedPath, roundTripPath);
    assert.deepEqual(fs.readFileSync(roundTripPath), content);
  } finally {
    if (original === undefined) delete process.env.BACKUP_ENCRYPTION_KEY; else process.env.BACKUP_ENCRYPTION_KEY = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('[H5-crypto-F] decryptFile() rejeita um formato de versão desconhecida — nunca decifra às cegas', async () => {
  const original = process.env.BACKUP_ENCRYPTION_KEY;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patrono-h5-crypto-'));
  try {
    process.env.BACKUP_ENCRYPTION_KEY = 'chave-de-teste-com-pelo-menos-32-caracteres';
    const bogusPath = path.join(dir, 'bogus.enc');
    fs.writeFileSync(bogusPath, Buffer.concat([Buffer.from([99]), Buffer.alloc(12), Buffer.alloc(16)]));
    await assert.rejects(() => backupCrypto.decryptFile(bogusPath, path.join(dir, 'out.bin')), /versão/);
  } finally {
    if (original === undefined) delete process.env.BACKUP_ENCRYPTION_KEY; else process.env.BACKUP_ENCRYPTION_KEY = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- sanitize.js --------------------------------------------------------------------------------------
test('[H5-sanitize-A] sanitizeErrorMessage() remove connection string/senha de mensagens de erro', () => {
  const message = 'connection to postgresql://coevo:supersecreta@db.internal:5432/prod failed; password=outrosecreto';
  const sanitized = sanitizeErrorMessage(message);
  assert.ok(!sanitized.includes('supersecreta'));
  assert.ok(!sanitized.includes('outrosecreto'));
  assert.match(sanitized, /\[REDACTED\]/);
});

// --- storage-adapters/filesystem.js -------------------------------------------------------------------
test('[H5-fsadapter-A] putObject()/getObject() round-trip e objectExists()', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patrono-h5-fs-'));
  try {
    const adapter = createFilesystemStorageAdapter({ baseDir: dir });
    const sourcePath = path.join(dir, 'source.txt');
    fs.writeFileSync(sourcePath, 'conteudo de teste');
    await adapter.putObject('env/obj.txt', sourcePath);
    assert.equal(await adapter.objectExists('env/obj.txt'), true);
    assert.equal(await adapter.objectExists('env/nao-existe.txt'), false);
    const destPath = path.join(dir, 'dest.txt');
    await adapter.getObject('env/obj.txt', destPath);
    assert.equal(fs.readFileSync(destPath, 'utf8'), 'conteudo de teste');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('[H5-fsadapter-B] objectKey não pode escapar do diretório base (path traversal)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patrono-h5-fs-'));
  try {
    const adapter = createFilesystemStorageAdapter({ baseDir: dir });
    const sourcePath = path.join(dir, 'source.txt');
    fs.writeFileSync(sourcePath, 'x');
    await assert.rejects(() => adapter.putObject('../../../etc/passwd', sourcePath));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- storage-adapters/s3.js (cliente fake injetado — nunca rede/credenciais reais) ----------------------
function makeFakeS3Client({ store }) {
  return {
    async send(command) {
      const name = command.constructor.name;
      if (name === 'PutObjectCommand') {
        // O adapter real envia `Body` como um stream (`fs.createReadStream()`), nunca um Buffer — o
        // fake client precisa consumi-lo integralmente para simular o que um S3 real faria ao receber
        // o upload (isso é só o DOUBLE de teste; o adapter em si nunca faz essa acumulação).
        const chunks = [];
        for await (const chunk of command.input.Body) chunks.push(chunk);
        assert.equal(command.input.ContentLength, Buffer.concat(chunks).length, 'ContentLength deve ser calculado via fs.statSync(), nunca lendo o arquivo inteiro');
        store.set(command.input.Key, Buffer.concat(chunks));
        return {};
      }
      if (name === 'GetObjectCommand') {
        if (!store.has(command.input.Key)) { const error = new Error('not found'); error.name = 'NoSuchKey'; throw error; }
        const body = store.get(command.input.Key);
        return { Body: (async function* () { yield body; })() };
      }
      if (name === 'HeadObjectCommand') {
        if (!store.has(command.input.Key)) { const error = new Error('not found'); error.name = 'NotFound'; throw error; }
        return {};
      }
      throw new Error(`comando não suportado no fake S3 client: ${name}`);
    }
  };
}

test('[H5-s3adapter-A] putObject()/getObject()/objectExists() com cliente S3 fake', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patrono-h5-s3-'));
  try {
    const store = new Map();
    const adapter = createS3StorageAdapter({ bucket: 'patrono-backups-teste', client: makeFakeS3Client({ store }) });
    const sourcePath = path.join(dir, 'source.bin');
    fs.writeFileSync(sourcePath, Buffer.from('artefato de teste'));
    await adapter.putObject('development/obj.dump', sourcePath);
    assert.equal(await adapter.objectExists('development/obj.dump'), true);
    assert.equal(await adapter.objectExists('development/outro.dump'), false);
    const destPath = path.join(dir, 'dest.bin');
    await adapter.getObject('development/obj.dump', destPath);
    assert.equal(fs.readFileSync(destPath, 'utf8'), 'artefato de teste');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('[H5-s3adapter-B] createS3StorageAdapter() exige bucket', () => {
  assert.throws(() => createS3StorageAdapter({}), /BACKUP_BUCKET/);
});

// --- storage-adapter.js (fábrica) -----------------------------------------------------------------------
test('[H5-factory-A] em produção, provider "filesystem" (ou ausente) é recusado — offsite real é obrigatório', () => {
  assert.throws(() => createStorageAdapter({ environment: 'production', provider: 'filesystem' }), /storage offsite real/);
  assert.throws(() => createStorageAdapter({ environment: 'production', provider: undefined }), /storage offsite real/);
});

test('[H5-factory-B] em produção, provider "s3" é aceito (bucket obrigatório do adapter subjacente)', () => {
  const original = process.env.BACKUP_BUCKET;
  try {
    delete process.env.BACKUP_BUCKET;
    assert.throws(() => createStorageAdapter({ environment: 'production', provider: 's3' }), /BACKUP_BUCKET/);
  } finally { if (original === undefined) delete process.env.BACKUP_BUCKET; else process.env.BACKUP_BUCKET = original; }
});

test('[H5-factory-C] fora de produção, sem provider configurado, usa filesystem por padrão', () => {
  const originalDir = process.env.BACKUP_LOCAL_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patrono-h5-factory-'));
  try {
    process.env.BACKUP_LOCAL_DIR = dir;
    const adapter = createStorageAdapter({ environment: 'development', provider: undefined });
    assert.equal(adapter.provider, 'filesystem');
  } finally {
    if (originalDir === undefined) delete process.env.BACKUP_LOCAL_DIR; else process.env.BACKUP_LOCAL_DIR = originalDir;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('[H5-factory-D] provider desconhecido lança erro explícito', () => {
  assert.throws(() => createStorageAdapter({ environment: 'development', provider: 'azure-blob-inexistente' }), /desconhecido/);
});

test('[H5-factory-E] VALID_ENVIRONMENTS exporta os 3 ambientes esperados', () => {
  assert.deepEqual([...VALID_ENVIRONMENTS].sort(), ['development', 'production', 'staging']);
});

// --- Correção pós-H5 (revisão técnica independente): credencial nunca em argv --------------------------
test('[H5-pgconn-A] parsePostgresConnection() extrai host/porta/usuário/banco sem a senha nos campos de argv', () => {
  const conn = parsePostgresConnection('postgresql://appuser:s3gredo@db.interno:5433/patrono_prod?sslmode=require');
  assert.equal(conn.host, 'db.interno');
  assert.equal(conn.port, '5433');
  assert.equal(conn.user, 'appuser');
  assert.equal(conn.database, 'patrono_prod');
  assert.equal(conn.sslmode, 'require');
  assert.equal(conn.password, 's3gredo');
});

test('[H5-pgconn-B] pgCliArgs() nunca inclui a senha — apenas host/porta/usuário/banco', () => {
  const conn = parsePostgresConnection('postgresql://appuser:s3gredo@db.interno:5433/patrono_prod');
  const args = pgCliArgs(conn, ['-Fc']);
  assert.ok(!args.includes('s3gredo'), 'a senha nunca deve aparecer nos argumentos de CLI');
  assert.ok(args.some(a => String(a).includes('s3gredo')) === false);
  assert.deepEqual(args, ['-Fc', '-h', 'db.interno', '-p', '5433', '-U', 'appuser', '-d', 'patrono_prod']);
});

test('[H5-pgconn-C] pgChildEnv() carrega a senha SOMENTE via PGPASSWORD, nunca muta process.env global', () => {
  const before = process.env.PGPASSWORD;
  const conn = parsePostgresConnection('postgresql://appuser:s3gredo@db.interno:5433/patrono_prod?sslmode=require');
  const env = pgChildEnv(conn);
  assert.equal(env.PGPASSWORD, 's3gredo');
  assert.equal(env.PGSSLMODE, 'require');
  assert.equal(process.env.PGPASSWORD, before, 'process.env global nunca deve ser mutado com a senha');
});

test('[H5-pgconn-D] senha com caracteres especiais (@, :, /, %) é preservada corretamente', () => {
  const specialPassword = 'p@ss:w/ord%25with+chars';
  const encoded = encodeURIComponent(specialPassword);
  const conn = parsePostgresConnection(`postgresql://user:${encoded}@localhost:5432/db`);
  assert.equal(conn.password, specialPassword);
  const env = pgChildEnv(conn);
  assert.equal(env.PGPASSWORD, specialPassword);
  const args = pgCliArgs(conn);
  assert.ok(!args.some(a => String(a).includes(specialPassword)), 'senha especial nunca deve vazar para argv');
});

test('[H5-pgconn-E] parsePostgresConnection() rejeita connection string com esquema inválido', () => {
  assert.throws(() => parsePostgresConnection('mysql://user:pass@localhost:3306/db'), /esquema deve ser postgres/);
  assert.throws(() => parsePostgresConnection('não é uma url'), /inválida/);
});

test('[H5-pgconn-F] backup-postgres.js/restore-postgres.js nunca constroem argv de pg_dump/pg_restore com a connection string bruta', () => {
  const backupSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'backup-postgres.js'), 'utf8');
  const restoreSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'restore-postgres.js'), 'utf8');
  assert.ok(!/execFileAsync\('pg_dump',\s*\[[^\]]*resolvedDatabaseUrl/.test(backupSource), 'pg_dump nunca deve receber resolvedDatabaseUrl em argv');
  assert.ok(!/execFileAsync\('pg_restore',\s*\[[^\]]*databaseUrlTarget/.test(restoreSource), 'pg_restore nunca deve receber databaseUrlTarget em argv');
  assert.ok(backupSource.includes('pgCliArgs') && backupSource.includes('pgChildEnv'), 'backup-postgres.js deve usar o helper pg-connection');
  assert.ok(restoreSource.includes('pgCliArgs') && restoreSource.includes('pgChildEnv'), 'restore-postgres.js deve usar o helper pg-connection');
});

// --- Correção pós-H5: criptografia obrigatória em produção ---------------------------------------------
test('[H5-prod-encrypt-A] isBackupEncryptionConfigured()/isProductionEnvironment() compõem a checagem obrigatória em produção (unitário do bloco usado por runBackup)', () => {
  const original = process.env.BACKUP_ENCRYPTION_KEY;
  try {
    delete process.env.BACKUP_ENCRYPTION_KEY;
    assert.equal(isProductionEnvironment('production') && !backupCrypto.isBackupEncryptionConfigured(), true);
    process.env.BACKUP_ENCRYPTION_KEY = 'chave-de-teste-com-pelo-menos-32-caracteres';
    assert.equal(isProductionEnvironment('production') && !backupCrypto.isBackupEncryptionConfigured(), false);
  } finally {
    if (original === undefined) delete process.env.BACKUP_ENCRYPTION_KEY; else process.env.BACKUP_ENCRYPTION_KEY = original;
  }
});

// --- Correção pós-H5: BACKUP_ENDPOINT deve ser https:// em produção ------------------------------------
test('[H5-s3https-A] em produção, BACKUP_ENDPOINT http:// é recusado', () => {
  const original = process.env.BACKUP_ENDPOINT;
  try {
    process.env.BACKUP_ENDPOINT = 'http://minio.interno:9000';
    assert.throws(() => createStorageAdapter({ environment: 'production', provider: 's3' }), /https:/);
  } finally { if (original === undefined) delete process.env.BACKUP_ENDPOINT; else process.env.BACKUP_ENDPOINT = original; }
});

test('[H5-s3https-B] em produção, BACKUP_ENDPOINT https:// é aceito (segue para a validação de bucket)', () => {
  const originalEndpoint = process.env.BACKUP_ENDPOINT;
  const originalBucket = process.env.BACKUP_BUCKET;
  try {
    process.env.BACKUP_ENDPOINT = 'https://s3-compatible.exemplo.com';
    delete process.env.BACKUP_BUCKET;
    // Sem BACKUP_BUCKET, deve falhar por bucket ausente — NUNCA pela checagem de https (prova que a
    // validação de esquema já passou).
    assert.throws(() => createStorageAdapter({ environment: 'production', provider: 's3' }), /BACKUP_BUCKET/);
  } finally {
    if (originalEndpoint === undefined) delete process.env.BACKUP_ENDPOINT; else process.env.BACKUP_ENDPOINT = originalEndpoint;
    if (originalBucket === undefined) delete process.env.BACKUP_BUCKET; else process.env.BACKUP_BUCKET = originalBucket;
  }
});

test('[H5-s3https-C] fora de produção, BACKUP_ENDPOINT http:// continua permitido (MinIO/testes locais)', () => {
  const originalEndpoint = process.env.BACKUP_ENDPOINT;
  const originalBucket = process.env.BACKUP_BUCKET;
  try {
    process.env.BACKUP_ENDPOINT = 'http://localhost:9000';
    process.env.BACKUP_BUCKET = 'teste-local';
    const adapter = createStorageAdapter({ environment: 'development', provider: 's3' });
    assert.equal(adapter.provider, 's3');
  } finally {
    if (originalEndpoint === undefined) delete process.env.BACKUP_ENDPOINT; else process.env.BACKUP_ENDPOINT = originalEndpoint;
    if (originalBucket === undefined) delete process.env.BACKUP_BUCKET; else process.env.BACKUP_BUCKET = originalBucket;
  }
});

test('[H5-s3https-D] BACKUP_ENDPOINT malformado em produção lança erro explícito (não um crash genérico)', () => {
  const original = process.env.BACKUP_ENDPOINT;
  try {
    process.env.BACKUP_ENDPOINT = 'não-é-uma-url';
    assert.throws(() => createStorageAdapter({ environment: 'production', provider: 's3' }), /BACKUP_ENDPOINT inválido/);
  } finally { if (original === undefined) delete process.env.BACKUP_ENDPOINT; else process.env.BACKUP_ENDPOINT = original; }
});

// --- Correção pós-H5: S3 adapter usa streaming real, nunca readFileSync do arquivo inteiro --------------
test('[H5-s3stream-A] storage-adapters/s3.js não usa fs.readFileSync()/acumulação de chunks em array para upload/download', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'backup', 'storage-adapters', 's3.js'), 'utf8');
  assert.ok(!/fs\.readFileSync\(sourceFilePath\)/.test(source), 'putObject não deve carregar o arquivo inteiro via readFileSync');
  assert.ok(!/const chunks = \[\]/.test(source), 'getObject não deve acumular chunks em array');
  assert.ok(/createReadStream/.test(source), 'putObject deve usar createReadStream');
  assert.ok(/pipeline/.test(source), 'getObject deve usar pipeline() para streaming');
});

test('[H5-s3stream-B] putObject() calcula ContentLength via fs.statSync (nunca lendo o arquivo) e o corpo enviado bate com o arquivo original', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patrono-h5-s3stream-'));
  try {
    const store = new Map();
    const adapter = createS3StorageAdapter({ bucket: 'patrono-backups-teste', client: makeFakeS3Client({ store }) });
    const sourcePath = path.join(dir, 'source-grande.bin');
    const content = require('node:crypto').randomBytes(512 * 1024);
    fs.writeFileSync(sourcePath, content);
    const result = await adapter.putObject('development/grande.dump', sourcePath);
    assert.equal(result.sizeBytes, content.length);
    const destPath = path.join(dir, 'dest-grande.bin');
    await adapter.getObject('development/grande.dump', destPath);
    assert.deepEqual(fs.readFileSync(destPath), content);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
