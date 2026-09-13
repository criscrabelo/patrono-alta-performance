// Sprint 2, Hardening H5 (docs/PRODUCTION_GATE.md, PG-21; docs/DECISIONS.md, PROD-H5-01): identidade de
// ambiente explícita para backup/restore (item 14/15 do escopo). `APP_ENVIRONMENT` é uma variável NOVA,
// independente de `NODE_ENV` (que só distingue "produção" de "não produção" para o runtime do servidor).
// Um backup precisa saber de QUAL ambiente ele veio (production/staging/development) para que o restore
// possa recusar por padrão um cenário de cross-environment restore (staging/dev restaurado em produção).
const VALID_ENVIRONMENTS = ['production', 'staging', 'development'];

// Se `APP_ENVIRONMENT` não estiver definida, cai para uma derivação conservadora a partir de
// `NODE_ENV` — nunca assume produção silenciosamente quando não for esse o caso, e nunca assume
// não-produção quando `NODE_ENV=production` (mesma disciplina fail-closed já usada em
// `validateAuthRuntimeConfig()`).
function resolveAppEnvironment() {
  const explicit = String(process.env.APP_ENVIRONMENT || '').trim().toLowerCase();
  if (explicit) {
    if (!VALID_ENVIRONMENTS.includes(explicit)) {
      throw new Error(`APP_ENVIRONMENT inválida: "${explicit}" (valores aceitos: ${VALID_ENVIRONMENTS.join(', ')}).`);
    }
    return explicit;
  }
  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
}

function isProductionEnvironment(environment) { return environment === 'production'; }

module.exports = { VALID_ENVIRONMENTS, resolveAppEnvironment, isProductionEnvironment };
