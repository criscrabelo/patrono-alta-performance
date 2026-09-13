// Sprint 2, Hardening H5 (docs/PRODUCTION_GATE.md, PG-21; docs/DECISIONS.md, PROD-H5-01): fábrica de
// storage adapter offsite — decide QUAL implementação usar (item 9 do escopo H5) e aplica a única regra
// de negócio que não pode ficar espalhada em cada script que precisa de um destino de backup: em
// produção, o destino TEM que ser um storage realmente offsite (hoje, só "s3"); "filesystem" nunca é
// aceito em produção (item 21 — fail-fast se alguém tentar).
const { resolveAppEnvironment, isProductionEnvironment } = require('./environment');
const { createFilesystemStorageAdapter } = require('./storage-adapters/filesystem');
const { createS3StorageAdapter } = require('./storage-adapters/s3');

const OFFSITE_PROVIDERS = ['s3'];

function createStorageAdapter({ environment, provider, s3Client } = {}) {
  const resolvedEnvironment = environment || resolveAppEnvironment();
  const resolvedProvider = String(provider || process.env.BACKUP_STORAGE_PROVIDER || '').trim().toLowerCase() || null;

  if (isProductionEnvironment(resolvedEnvironment)) {
    if (!resolvedProvider || !OFFSITE_PROVIDERS.includes(resolvedProvider)) {
      throw new Error(
        `Em produção, BACKUP_STORAGE_PROVIDER precisa ser um storage offsite real (${OFFSITE_PROVIDERS.join(', ')}) — ` +
        `"${resolvedProvider || '(ausente)'}" não é aceito. Backup local-only nunca é production-grade (docs/PRODUCTION_GATE.md, PG-21).`
      );
    }
  }

  const effectiveProvider = resolvedProvider || 'filesystem';

  if (effectiveProvider === 'filesystem') {
    return createFilesystemStorageAdapter({ baseDir: process.env.BACKUP_LOCAL_DIR });
  }
  if (effectiveProvider === 's3') {
    return createS3StorageAdapter({
      bucket: process.env.BACKUP_BUCKET,
      region: process.env.BACKUP_REGION,
      endpoint: process.env.BACKUP_ENDPOINT,
      accessKeyId: process.env.BACKUP_ACCESS_KEY_ID,
      secretAccessKey: process.env.BACKUP_SECRET_ACCESS_KEY,
      client: s3Client
    });
  }
  throw new Error(`BACKUP_STORAGE_PROVIDER desconhecido: "${effectiveProvider}" (suportados: filesystem, s3).`);
}

module.exports = { OFFSITE_PROVIDERS, createStorageAdapter };
