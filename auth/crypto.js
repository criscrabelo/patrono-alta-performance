// Sprint 2, Hardening H2 (docs/PRODUCTION_GATE.md; docs/DECISIONS.md, PROD-H2-01): primitivas
// criptográficas de autenticação — senha, TOTP e criptografia de segredo em repouso. Tudo aqui usa
// SOMENTE `node:crypto` nativo, deliberadamente sem adicionar bcrypt/argon2/otplib como dependência nova
// (docs/DECISIONS.md, PROD-H2-01, registra a decisão): `scrypt` é um KDF memory-hard aceito pela OWASP
// como alternativa a Argon2id/bcrypt quando se quer evitar dependência com binding nativo; TOTP (RFC
// 6238) é um algoritmo público e padronizado — implementá-lo com HMAC nativo não é "criptografia
// caseira", é a mesma conta que qualquer biblioteca de TOTP faria por baixo.
const crypto = require('node:crypto');

// ============================================================================================
// Senha — scrypt (N=16384, r=8, p=1, salt 16 bytes, hash 64 bytes), formato auto-descritivo
// `scrypt$N$r$p$saltHex$hashHex` — permite evoluir parâmetros no futuro sem invalidar hashes antigos.
// ============================================================================================
const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, SCRYPT_KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

// Nunca lança em senha malformada/hash corrompido — trata como não-verificado (login deve responder
// 401 genérico, nunca 500, para qualquer combinação de entrada).
function verifyPassword(password, storedHash) {
  try {
    const parts = String(storedHash || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const derived = crypto.scryptSync(String(password), salt, expected.length, { N: Number(nStr), r: Number(rStr), p: Number(pStr) });
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

// Política mínima de senha (docs/SECURITY.md): tamanho mínimo, rejeita vazio/trivial. Não impõe rotação
// periódica automática (só nos eventos explícitos: temporária, reset, comprometimento, decisão admin).
const MIN_PASSWORD_LENGTH = 10;
function isPasswordAcceptable(password) {
  if (typeof password !== 'string') return false;
  const trimmed = password.trim();
  if (trimmed.length < MIN_PASSWORD_LENGTH) return false;
  // Rejeita triviais óbvias (mesma string repetida, sequência de dígitos) sem inventar uma tabela de
  // "senhas proibidas" fora de escopo desta rodada.
  if (/^(.)\1+$/.test(trimmed)) return false;
  if (/^0123456789|^12345678|^abcdefgh/i.test(trimmed)) return false;
  return true;
}

// ============================================================================================
// TOTP — RFC 6238 (HMAC-SHA1, 6 dígitos, passo de 30s), com Base32 (RFC 4648) para o segredo.
// ============================================================================================
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = '', output = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  for (let i = 0; i + 5 <= bits.length; i += 5) output += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  const remainder = bits.length % 5;
  if (remainder) output += BASE32_ALPHABET[parseInt(bits.slice(-remainder).padEnd(5, '0'), 2)];
  return output;
}

function base32Decode(text) {
  const clean = String(text || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function generateTotpSecret() { return base32Encode(crypto.randomBytes(20)); }

function totpAt(secretBase32, timeMs, step = 30, digits = 6) {
  const counter = Math.floor(timeMs / 1000 / step);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const key = base32Decode(secretBase32);
  const hmac = crypto.createHmac('sha1', key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

// Aceita uma janela de +-1 passo (30s) para tolerar pequena divergência de relógio entre cliente e
// servidor — nunca mais que isso, para não alargar a janela de replay de um código capturado.
function verifyTotp(secretBase32, code, { step = 30, window = 1, atMs = Date.now() } = {}) {
  const candidate = String(code || '').trim();
  if (!/^\d{6}$/.test(candidate)) return false;
  for (let delta = -window; delta <= window; delta++) {
    const expected = totpAt(secretBase32, atMs + delta * step * 1000, step);
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected))) return true;
  }
  return false;
}

function totpProvisioningUri(secretBase32, accountLabel, issuer = 'COEVO Alta Performance') {
  const encodedLabel = encodeURIComponent(`${issuer}:${accountLabel}`);
  return `otpauth://totp/${encodedLabel}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// ============================================================================================
// Criptografia do segredo TOTP em repouso — AES-256-GCM, chave vinda de MFA_ENCRYPTION_KEY (mesmo
// padrão já usado por COEVO_BACKUP_KEY neste projeto). Formato: `ivHex:tagHex:cipherHex`.
// ============================================================================================
function mfaEncryptionKey() {
  const raw = process.env.MFA_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) return null;
  return crypto.createHash('sha256').update(raw).digest();
}

function encryptSecret(plainText) {
  const key = mfaEncryptionKey();
  if (!key) throw new Error('MFA_ENCRYPTION_KEY ausente/curta — não é possível cifrar o segredo MFA em repouso.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSecret(payload) {
  const key = mfaEncryptionKey();
  if (!key) throw new Error('MFA_ENCRYPTION_KEY ausente/curta — não é possível decifrar o segredo MFA em repouso.');
  const [ivHex, tagHex, dataHex] = String(payload || '').split(':');
  if (!ivHex || !tagHex || !dataHex) throw new Error('Segredo MFA cifrado em formato inválido.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

// ============================================================================================
// Tokens de sessão/reset — CSPRNG, valor bruto entregue ao cliente uma única vez; só o hash
// (SHA-256, rápido de propósito — o token já tem 256 bits de entropia, ao contrário de uma senha, então
// não precisa de KDF lento) é persistido.
// ============================================================================================
function generateOpaqueToken() { return crypto.randomBytes(32).toString('hex'); }
function hashToken(token) { return crypto.createHash('sha256').update(String(token)).digest('hex'); }

module.exports = {
  hashPassword, verifyPassword, isPasswordAcceptable, MIN_PASSWORD_LENGTH,
  generateTotpSecret, verifyTotp, totpAt, totpProvisioningUri, base32Encode, base32Decode,
  encryptSecret, decryptSecret, mfaEncryptionKey,
  generateOpaqueToken, hashToken
};
