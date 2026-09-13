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

test('[H5-crypto-C] encryptFile()/decryptFile() round-trip preserva o conteúdo original', () => {
  const original = process.env.BACKUP_ENCRYPTION_KEY;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patrono-h5-crypto-'));
  try {
    process.env.BACKUP_ENCRYPTION_KEY = 'chave-de-teste-com-pelo-menos-32-caracteres';
    const plainPath = path.join(dir, 'plain.bin');
    const encryptedPath = path.join(dir, 'enc.bin');
    const roundTripPath = path.join(dir, 'roundtrip.bin');
    const content = crypto_randomContent();
    fs.writeFileSync(plainPath, content);
    backupCrypto.encryptFile(plainPath, encryptedPath);
    assert.notDeepEqual(fs.readFileSync(encryptedPath), content, 'artefato cifrado nunca deve ser igual ao original em claro');
    backupCrypto.decryptFile(encryptedPath, roundTripPath);
    assert.deepEqual(fs.readFileSync(roundTripPath), content);
  } finally {
    if (original === undefined) delete process.env.BACKUP_ENCRYPTION_KEY; else process.env.BACKUP_ENCRYPTION_KEY = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
function crypto_randomContent() { return require('node:crypto').randomBytes(4096); }

test('[H5-crypto-D] decryptFile() com chave diferente da usada para cifrar falha (autenticação GCM)', () => {
  const original = process.env.BACKUP_ENCRYPTION_KEY;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patrono-h5-crypto-'));
  try {
    process.env.BACKUP_ENCRYPTION_KEY = 'chave-A-de-teste-com-pelo-menos-32-caracteres';
    const plainPath = path.join(dir, 'plain.bin');
    const encryptedPath = path.join(dir, 'enc.bin');
    fs.writeFileSync(plainPath, crypto_randomContent());
    backupCrypto.encryptFile(plainPath, encryptedPath);
    process.env.BACKUP_ENCRYPTION_KEY = 'chave-B-diferente-com-pelo-menos-32-caracteres';
    assert.throws(() => backupCrypto.decryptFile(encryptedPath, path.join(dir, 'out.bin')));
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
        store.set(command.input.Key, command.input.Body);
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
