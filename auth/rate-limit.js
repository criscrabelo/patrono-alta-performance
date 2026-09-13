// Sprint 2, Hardening H3 (docs/PRODUCTION_GATE.md; docs/DECISIONS.md, PROD-H3-01): rate limiting
// global e proteção contra abuso/força bruta, distribuído via PostgreSQL (migrations/
// 007_h3_rate_limiting.sql) — nunca `new Map()` em memória como fonte canônica (perde estado no
// restart, não funciona com múltiplas instâncias, permite bypass trivial alternando processo).
//
// Camada isolada, reaproveitada por server.js em cada rota sensível — nenhuma lógica de limite
// espalhada manualmente em dezenas de `if` no roteador.
//
// H2 já tem `failed_login_count`/`locked_until` por CONTA (proteção por identidade). H3 é a camada
// COMPLEMENTAR: proteção distribuída por ORIGEM/abuso global (IP, identidade resolvida antes de
// autenticar, ou a combinação dos dois) — nenhuma das duas substitui a outra.
const crypto = require('node:crypto');
const storage = require('../storage');
const rateLimitsRepository = require('../storage/repositories/rate-limits-repository');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Mesma disciplina de MFA_ENCRYPTION_KEY (docs/DECISIONS.md, PROD-H2-01/H3-01): chave dedicada para
// derivar as chaves de bucket (HMAC-SHA256) — nunca o IP/e-mail/token em texto puro persistido
// (minimização LGPD, item 30 do escopo). Obrigatória em produção (validateAuthRuntimeConfig() em
// server.js); fora de produção, cai para um valor fixo de desenvolvimento se ausente — nunca bloqueia
// testes que não exercitam rate limiting.
const DEV_RATE_LIMIT_HMAC_KEY = 'dev-only-rate-limit-hmac-key-not-a-real-secret-32c';
function rateLimitHmacKey() {
  const raw = process.env.RATE_LIMIT_HMAC_KEY;
  if (raw && raw.length >= 32) return raw;
  if (IS_PRODUCTION) return null;
  return DEV_RATE_LIMIT_HMAC_KEY;
}
function hashIdentifier(scope, value) {
  const key = rateLimitHmacKey();
  if (!key) throw new Error('RATE_LIMIT_HMAC_KEY ausente/curta — não é possível derivar chaves de rate limit em produção.');
  return crypto.createHmac('sha256', key).update(`${scope}:${value}`).digest('hex');
}

// Item 18 do escopo: política inicial conservadora, centralizada aqui (nunca números soltos espalhados
// pelas rotas). `max` = tentativas permitidas por janela; `windowMs` = duração da janela fixa.
const POLICIES = {
  loginIp: { max: 30, windowMs: 10 * 60 * 1000 },
  loginIdentity: { max: 10, windowMs: 10 * 60 * 1000 },
  loginCombined: { max: 8, windowMs: 10 * 60 * 1000 },
  mfaVerifyIp: { max: 30, windowMs: 10 * 60 * 1000 },
  mfaVerifyChallenge: { max: 10, windowMs: 10 * 60 * 1000 },
  forgotPasswordIp: { max: 10, windowMs: 15 * 60 * 1000 },
  forgotPasswordIdentity: { max: 3, windowMs: 15 * 60 * 1000 },
  resetPasswordIp: { max: 10, windowMs: 15 * 60 * 1000 },
  resetPasswordToken: { max: 5, windowMs: 15 * 60 * 1000 },
  adminResetTokenOperator: { max: 10, windowMs: 15 * 60 * 1000 },
  adminResetTokenTarget: { max: 3, windowMs: 15 * 60 * 1000 },
  mfaEnrollUser: { max: 10, windowMs: 15 * 60 * 1000 },
  mfaConfirmUser: { max: 10, windowMs: 10 * 60 * 1000 },
  mfaDisableUser: { max: 10, windowMs: 15 * 60 * 1000 },
  changePasswordUser: { max: 10, windowMs: 15 * 60 * 1000 },
  logoutAllUser: { max: 20, windowMs: 15 * 60 * 1000 },
  approveOperator: { max: 30, windowMs: 15 * 60 * 1000 }
};

// Probabilidade de disparar a limpeza oportunística (item 26 do escopo) a cada chamada real —
// mantém a tabela sem crescimento indefinido sem exigir um cron externo obrigatório.
const CLEANUP_PROBABILITY = 0.02;
const CLEANUP_RETENTION_MS = 24 * 60 * 60 * 1000;

function maybeCleanup(pool) {
  if (Math.random() > CLEANUP_PROBABILITY) return;
  rateLimitsRepository.cleanupExpired(pool, CLEANUP_RETENTION_MS).catch(() => {});
}

// Item 47 do escopo: fora de produção, o fallback local (JSON) continua existindo para desenvolvimento
// — mas rate limiting distribuído exige Postgres real (é exatamente o problema que H3 resolve: estado
// compartilhado entre instâncias). Em vez de inventar uma semântica paralela em memória (que teria
// garantias diferentes do runtime real de produção — nunca sobrevive a restart, nunca compartilhada),
// H3 simplesmente DESATIVA a checagem quando o backend ativo não é PostgreSQL — decisão B do item 47,
// documentada em docs/SECURITY.md. Produção sempre exige PostgreSQL (fail-fast já garantido por
// storage.configure()), então esta desativação nunca alcança produção.
function backendAvailable() { return storage.mode() === 'postgres' && storage.getPool() != null; }

// Item 27 do escopo: fail-closed controlado. Se o backend Postgres estiver configurado mas a consulta
// falhar (conexão caiu, timeout), uma rota de autenticação sensível NUNCA deve prosseguir como se não
// houvesse limite algum — isso reabriria exatamente o vetor de força bruta que H3 existe para fechar.
// Em vez de derrubar a aplicação inteira (um erro não tratado devolveria 500 e potencialmente um stack
// trace), o resultado aqui é "bloqueado" com um Retry-After curto e fixo — a rota chamadora responde
// 429 genérico, igual a qualquer outro bloqueio real, sem revelar que a causa foi uma falha de
// infraestrutura em vez de abuso genuíno.
const FAIL_CLOSED_RETRY_AFTER_SECONDS = 30;

// `check(policyName, scope, value)` consome uma tentativa do bucket e devolve se está permitido.
// `value` é o dado de origem (IP, login_identifier resolvido, challenge id, userId, hash de token) —
// nunca persistido em texto puro; sempre passa por `hashIdentifier()` antes de virar `bucket_key`.
// Item 13 da revisão técnica pós-PR #14: cada resultado bloqueado também informa `shouldAudit` — true
// SOMENTE na transição exata em que o bucket passa a bloquear (`count === limit + 1`). Como `count` é
// incrementado por uma única instrução SQL atômica (nunca duas requisições conseguem gravar o mesmo
// `count`), essa condição por si só já deduplica o evento de auditoria: dentro da mesma janela, só a
// requisição que efetivamente fez o contador cruzar o limite carrega `shouldAudit:true` — todas as
// demais (`count` maior, já bloqueadas antes) carregam `false`, sem exigir nenhuma coluna/estado extra.
// Um bloqueio por fail-closed (backend indisponível) nunca tem `count` real — `shouldAudit` é sempre
// `false` nesse caso (não é um abuso genuíno sendo detectado, é uma falha de infraestrutura; ver `catch`
// abaixo).
async function check(policyName, scope, value) {
  const policy = POLICIES[policyName];
  if (!policy) throw new Error(`Política de rate limit desconhecida: ${policyName}`);
  if (!backendAvailable()) return { allowed: true, retryAfterSeconds: 0, shouldAudit: false };
  const pool = storage.getPool();
  const bucketKey = hashIdentifier(scope, value);
  try {
    const result = await rateLimitsRepository.consumeAndCheck(pool, { bucketKey, scope, windowMs: policy.windowMs, limit: policy.max });
    maybeCleanup(pool);
    if (result.allowed) return { allowed: true, retryAfterSeconds: 0, shouldAudit: false };
    const retryAfterSeconds = Math.max(1, Math.ceil((new Date(result.blockedUntil).getTime() - Date.now()) / 1000));
    return { allowed: false, retryAfterSeconds, shouldAudit: result.count === policy.max + 1 };
  } catch {
    return { allowed: false, retryAfterSeconds: FAIL_CLOSED_RETRY_AFTER_SECONDS, shouldAudit: false };
  }
}

// Verifica várias políticas em sequência (ex.: IP e identidade e a combinação dos dois para login) —
// para na PRIMEIRA que bloquear, sem consumir as tentativas das políticas seguintes (evita um bucket
// mais permissivo mascarar o esgotamento de um bucket mais restrito já estourado). Consome uma
// tentativa em cada política verificada até (e incluindo) a que bloqueia.
async function checkAll(checks) {
  for (const { policyName, scope, value } of checks) {
    const result = await check(policyName, scope, value);
    if (!result.allowed) return result;
  }
  return { allowed: true, retryAfterSeconds: 0, shouldAudit: false };
}

// Usado só por validateAuthRuntimeConfig() (server.js) no boot em produção — nunca aceita o valor
// padrão de desenvolvimento como válido para produção.
function hasValidHmacKeyForProduction() {
  const raw = process.env.RATE_LIMIT_HMAC_KEY;
  return Boolean(raw && raw.length >= 32);
}

module.exports = { check, checkAll, hashIdentifier, POLICIES, backendAvailable, FAIL_CLOSED_RETRY_AFTER_SECONDS, hasValidHmacKeyForProduction };
