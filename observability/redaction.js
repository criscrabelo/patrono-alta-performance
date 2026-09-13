// Sprint 2, Hardening H6 (docs/PRODUCTION_GATE.md, PG-17; docs/DECISIONS.md, PROD-H6-01): sanitização
// centralizada e defensiva usada por todo o subsistema de observabilidade (logger, alertas) e reaproveitada
// por backup/sanitize.js (H5) para nunca haver duas implementações divergentes de redaction no projeto.
//
// Duas camadas de defesa, aplicadas sempre juntas:
//   1) por NOME de campo (qualquer chave que pareça segredo é substituída inteiramente, mesmo que o
//      valor "pareça" inofensivo) — cobre password/token/secret/key/authorization/cookie/mfa/totp/hmac/
//      encryption/pgpassword/databaseurl/apikey e variações de caixa;
//   2) por PADRÃO no conteúdo de strings (connection string com credencial embutida, "password=...",
//      cabeçalho Bearer) — cobre o caso em que o segredo aparece dentro de uma mensagem de erro livre,
//      não como valor de um campo nomeado.
const REDACTED = '[REDACTED]';
const MAX_STRING_LENGTH = 2000;
const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 50;

const SECRET_KEY_PATTERN = /(password|passwordhash|temporarypassword|token|secret|secretkey|accesskey|apikey|authorization|cookie|setcookie|mfa|totp|hmac|encryption|encryptionkey|pgpassword|databaseurl|privatekey|clientsecret|signature)/i;

// Correção pós-H6 (revisão técnica final, PR #17): o token que segue "Bearer " pode ser um JWT
// (segmentos separados por ".") ou um valor base64/base64url — ambos usam caracteres além de
// [a-z0-9._-], entre eles "+", "/" e "=" (padding). O conjunto abaixo cobre esse alfabeto inteiro,
// ainda delimitado por qualquer whitespace/aspas/vírgula (nunca consome texto ilimitado — é um único
// bloco de caracteres do próprio alfabeto de token, não um `.*`).
const STRING_SECRET_PATTERNS = [
  /postgres(?:ql)?:\/\/[^\s"']*/gi,
  /password\s*=\s*[^\s"'&]+/gi,
  /bearer\s+[a-z0-9\-._~+/=]+/gi,
  /\bsk-[a-z0-9]{10,}/gi
];

function isSecretKey(key) {
  return SECRET_KEY_PATTERN.test(String(key));
}

// Remove CR/LF (impede injeção de linhas de log independentes) e trunca mensagens excessivas.
function sanitizeString(value) {
  let sanitized = String(value);
  for (const pattern of STRING_SECRET_PATTERNS) sanitized = sanitized.replace(pattern, REDACTED);
  sanitized = sanitized.replace(/[\r\n]+/g, ' ');
  if (sanitized.length > MAX_STRING_LENGTH) sanitized = `${sanitized.slice(0, MAX_STRING_LENGTH)}...[TRUNCATED]`;
  return sanitized;
}

function sanitizeErrorMessage(message) {
  return sanitizeString(message == null ? 'erro desconhecido' : message);
}

function redact(value, depth = 0) {
  if (value == null) return value;
  if (depth > MAX_DEPTH) return '[MAX_DEPTH_EXCEEDED]';
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value !== 'object') return value;
  if (value instanceof Error) return redact(serializeErrorShape(value), depth);
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_ITEMS).map((item) => redact(item, depth + 1));
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = isSecretKey(key) ? REDACTED : redact(item, depth + 1);
  }
  return out;
}

// Forma mínima e segura de um Error, usada apenas internamente por redact() — nunca JSON.stringify(error) cru.
function serializeErrorShape(error) {
  return { name: error.name, message: error.message, code: error.code };
}

module.exports = { redact, sanitizeErrorMessage, sanitizeString, isSecretKey, REDACTED, MAX_STRING_LENGTH };
