// Sprint 2, Hardening H5 (docs/PRODUCTION_GATE.md, PG-21; docs/DECISIONS.md, PROD-H5-01): manifesto de
// backup — metadata mínima necessária para o restore validar integridade, ambiente e compatibilidade
// ANTES de tocar em qualquer banco de dados. Nunca contém segredo (chave de criptografia, credenciais de
// storage, DATABASE_URL) — só o necessário para decidir se um artefato é confiável e aplicável.
const REQUIRED_FIELDS = [
  'backupId', 'createdAt', 'environment', 'database', 'postgresVersion', 'migrationVersion',
  'format', 'encrypted', 'sha256', 'sizeBytes', 'storageProvider', 'storageObjectKey'
];

function buildManifest(fields) {
  const manifest = {
    backupId: fields.backupId,
    createdAt: fields.createdAt,
    completedAt: fields.completedAt ?? null,
    environment: fields.environment,
    database: fields.database,
    postgresVersion: fields.postgresVersion,
    migrationVersion: fields.migrationVersion,
    applicationCommit: fields.applicationCommit ?? null,
    format: fields.format,
    compression: fields.compression ?? null,
    encrypted: Boolean(fields.encrypted),
    encryptionKeyId: fields.encryptionKeyId ?? null,
    sha256: fields.sha256,
    sizeBytes: fields.sizeBytes,
    storageProvider: fields.storageProvider,
    storageObjectKey: fields.storageObjectKey
  };
  const errors = validateManifest(manifest);
  if (errors.length) throw new Error(`Manifesto de backup inválido: ${errors.join('; ')}`);
  return manifest;
}

// Usado tanto ao CRIAR (antes de gravar/subir o manifesto) quanto ao RESTAURAR (antes de confiar em um
// manifesto lido do storage offsite) — nunca confia cegamente em metadata vinda de fora.
function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') return ['manifesto ausente ou não é um objeto'];
  for (const field of REQUIRED_FIELDS) {
    if (manifest[field] === undefined || manifest[field] === null || manifest[field] === '') {
      errors.push(`campo obrigatório ausente: ${field}`);
    }
  }
  if (typeof manifest.sha256 === 'string' && !/^[0-9a-f]{64}$/i.test(manifest.sha256)) {
    errors.push('sha256 não é um hex de 64 caracteres válido');
  }
  if (typeof manifest.sizeBytes === 'number' && manifest.sizeBytes <= 0) {
    errors.push('sizeBytes deve ser maior que zero (backup de tamanho zero nunca é válido)');
  }
  return errors;
}

module.exports = { REQUIRED_FIELDS, buildManifest, validateManifest };
