// Sprint 2, Hardening H5 (docs/PRODUCTION_GATE.md, PG-21; docs/DECISIONS.md, PROD-H5-01): criptografia
// OPCIONAL do artefato de backup do PostgreSQL, application-side, ANTES do upload para o storage
// offsite. Independente de `COEVO_BACKUP_KEY` (usada só pelo snapshot JSON legado de
// `POST /api/backup` — ver docs/DECISIONS.md item "endpoints existentes") — uma chave dedicada,
// `BACKUP_ENCRYPTION_KEY`, evita acoplar a rotação de uma chave à da outra.
//
// AES-256-GCM streaming (o artefato de `pg_dump -Fc` pode ser grande — nunca carregar tudo em memória).
// Formato do arquivo cifrado: `ivBytes(12) || tagBytes(16) || ciphertext`. O manifesto nunca guarda a
// chave — só um `encryptionKeyId` lógico (hash curto e não-reversível da chave) que permite identificar
// QUAL chave foi usada sem expor seu valor, preparando rotação futura (item 12 do escopo H5): uma chave
// nova gera um `encryptionKeyId` diferente, mas backups antigos continuam decifráveis desde que a chave
// antiga ainda esteja disponível ao operador — nunca há uma única chave eterna sem identificação.
const crypto = require('node:crypto');
const fs = require('node:fs');

const MIN_KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function backupEncryptionKey() {
  const raw = process.env.BACKUP_ENCRYPTION_KEY;
  if (!raw || raw.length < MIN_KEY_LENGTH) return null;
  return crypto.createHash('sha256').update(raw).digest();
}

// Identificador lógico e não-reversível da chave atual — nunca a chave em si, nunca logado como segredo
// (é seguro registrar no manifesto: não permite recuperar `BACKUP_ENCRYPTION_KEY`).
function currentEncryptionKeyId() {
  const key = backupEncryptionKey();
  if (!key) return null;
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

function isBackupEncryptionConfigured() { return backupEncryptionKey() !== null; }

// Fail-fast: se BACKUP_ENCRYPTION_KEY estiver definida mas curta demais, isso é um erro de configuração
// (nunca deve degradar silenciosamente para "sem criptografia") — chamado pelo boot dos scripts de
// backup/restore quando a variável está presente.
function validateBackupEncryptionKeyIfPresent() {
  const raw = process.env.BACKUP_ENCRYPTION_KEY;
  if (raw && raw.length < MIN_KEY_LENGTH) {
    throw new Error('BACKUP_ENCRYPTION_KEY definida mas com menos de 32 caracteres — corrija ou remova a variável.');
  }
}

// Carrega o arquivo inteiro em memória — aceitável para o volume de dados atual do Patrono; documentado
// como limitação conhecida para bancos que cresçam a ponto de tornar isso impraticável (nesse caso, a
// evolução natural é cifragem em streaming, fora do escopo desta rodada).
function encryptFile(sourcePath, destPath) {
  const key = backupEncryptionKey();
  if (!key) throw new Error('BACKUP_ENCRYPTION_KEY ausente/curta — não é possível cifrar o artefato de backup.');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = fs.readFileSync(sourcePath);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  fs.writeFileSync(destPath, Buffer.concat([iv, tag, ciphertext]), { mode: 0o600 });
}

function decryptFile(sourcePath, destPath) {
  const key = backupEncryptionKey();
  if (!key) throw new Error('BACKUP_ENCRYPTION_KEY ausente/curta — não é possível decifrar o artefato de backup.');
  const buffer = fs.readFileSync(sourcePath);
  if (buffer.length < IV_LENGTH + TAG_LENGTH) throw new Error('Artefato cifrado inválido: menor que o cabeçalho IV+TAG esperado.');
  // Layout gravado por encryptFile(): iv (12 bytes) || tag (16 bytes) || ciphertext.
  const iv = buffer.subarray(0, IV_LENGTH);
  const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buffer.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  fs.writeFileSync(destPath, plaintext, { mode: 0o600 });
}

module.exports = {
  MIN_KEY_LENGTH, isBackupEncryptionConfigured, currentEncryptionKeyId,
  validateBackupEncryptionKeyIfPresent, encryptFile, decryptFile
};
