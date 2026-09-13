// Sprint 2, Hardening H5 (docs/PRODUCTION_GATE.md, PG-21; docs/DECISIONS.md, PROD-H5-01): criptografia
// do artefato de backup do PostgreSQL, application-side, ANTES do upload para o storage offsite.
// Independente de `COEVO_BACKUP_KEY` (usada só pelo snapshot JSON legado de `POST /api/backup`) — uma
// chave dedicada, `BACKUP_ENCRYPTION_KEY`, evita acoplar a rotação de uma chave à da outra.
//
// Correção pós-H5 (revisão técnica independente): a implementação original usava
// `fs.readFileSync()`/`fs.writeFileSync()` — carregava o artefato INTEIRO em memória, apesar do
// comentário original já dizer "streaming". Corrigido para streaming REAL via `.pipe()` (backpressure
// automático) — nunca carrega o arquivo inteiro de uma vez.
//
// FORMATO DO ARQUIVO CIFRADO (versão 2, versionado no primeiro byte — nunca decifra silenciosamente um
// formato desconhecido): `formatVersion(1) || iv(12) || ciphertext(N) || tag(16)`. A TAG de autenticação
// GCM só é conhecida depois que TODO o plaintext foi cifrado (`cipher.final()`) — por isso fica no FINAL
// do arquivo (não logo após o IV, como na v1 anterior a esta correção), permitindo escrever o cabeçalho
// (versão+IV) e o ciphertext em streaming, com a tag anexada só ao final. O manifesto nunca guarda a
// chave — só um `encryptionKeyId` lógico (hash curto e não-reversível), preparando rotação futura: uma
// chave nova gera um `encryptionKeyId` diferente, mas backups antigos continuam decifráveis desde que a
// chave antiga usada para gerá-los ainda esteja disponível ao operador.
const crypto = require('node:crypto');
const fs = require('node:fs');

const MIN_KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const FORMAT_VERSION = 2;

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

// Streaming real: `input.pipe(cipher).pipe(output, {end:false})` usa o backpressure nativo de streams
// Node — nunca acumula o arquivo inteiro em memória. A tag só existe depois que `cipher` (readable side)
// termina de emitir dados (equivalente a `cipher.final()` já ter rodado internamente), por isso é
// anexada e o `output` só é finalizado (`end()`) DEPOIS desse ponto.
function encryptFile(sourcePath, destPath) {
  const key = backupEncryptionKey();
  if (!key) throw new Error('BACKUP_ENCRYPTION_KEY ausente/curta — não é possível cifrar o artefato de backup.');
  return new Promise((resolve, reject) => {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const input = fs.createReadStream(sourcePath);
    const output = fs.createWriteStream(destPath, { mode: 0o600 });
    let settled = false;
    const fail = error => { if (!settled) { settled = true; reject(error); } };
    input.on('error', fail);
    cipher.on('error', fail);
    output.on('error', fail);
    output.write(Buffer.concat([Buffer.from([FORMAT_VERSION]), iv]), error => { if (error) fail(error); });
    input.pipe(cipher).pipe(output, { end: false });
    cipher.on('end', () => {
      if (settled) return;
      let tag;
      try { tag = cipher.getAuthTag(); } catch (error) { return fail(error); }
      output.end(tag);
    });
    output.on('finish', () => { if (!settled) { settled = true; resolve(); } });
  });
}

// Streaming real: lê apenas o cabeçalho fixo (13 bytes: versão+IV) e a tag fixa (16 bytes, no final do
// arquivo) com leituras pequenas e diretas — nunca o arquivo inteiro. O ciphertext (potencialmente
// grande) é lido por um range de bytes (`start`/`end` de `fs.createReadStream`) e flui pelo decipher via
// `stream/promises`' `pipeline()`, que já propaga erro (ex.: falha de autenticação GCM) corretamente.
async function decryptFile(sourcePath, destPath) {
  const key = backupEncryptionKey();
  if (!key) throw new Error('BACKUP_ENCRYPTION_KEY ausente/curta — não é possível decifrar o artefato de backup.');
  const { size } = fs.statSync(sourcePath);
  const headerSize = 1 + IV_LENGTH;
  if (size < headerSize + TAG_LENGTH) throw new Error('Artefato cifrado inválido: menor que o cabeçalho/tag esperados.');

  const fd = fs.openSync(sourcePath, 'r');
  let header, tag;
  try {
    header = Buffer.alloc(headerSize);
    fs.readSync(fd, header, 0, headerSize, 0);
    tag = Buffer.alloc(TAG_LENGTH);
    fs.readSync(fd, tag, 0, TAG_LENGTH, size - TAG_LENGTH);
  } finally {
    fs.closeSync(fd);
  }

  const formatVersion = header[0];
  if (formatVersion !== FORMAT_VERSION) {
    throw new Error(`Formato de artefato cifrado desconhecido (versão ${formatVersion}, esperado ${FORMAT_VERSION}) — recusado, nunca decifrado às cegas.`);
  }
  const iv = header.subarray(1, headerSize);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const { pipeline } = require('node:stream/promises');
  const ciphertextEnd = size - TAG_LENGTH - 1; // inclusive, conforme a semântica de {end} de createReadStream
  const input = fs.createReadStream(sourcePath, { start: headerSize, end: ciphertextEnd });
  const output = fs.createWriteStream(destPath, { mode: 0o600 });
  await pipeline(input, decipher, output);
}

module.exports = {
  MIN_KEY_LENGTH, FORMAT_VERSION, isBackupEncryptionConfigured, currentEncryptionKeyId,
  validateBackupEncryptionKeyIfPresent, encryptFile, decryptFile
};
