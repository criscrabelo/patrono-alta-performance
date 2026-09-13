#!/usr/bin/env node
// Sprint 2, Hardening H8 (docs/PRODUCTION_GATE.md, PG-19; docs/DECISIONS.md, PROD-H8-01): CLI do runner
// de retenção. Modo padrão é DRY-RUN — NUNCA apaga nada por padrão. Para apagar de fato, exige o flag
// explícito `--execute`; em produção, exige ADICIONALMENTE `RETENTION_EXECUTE_CONFIRMATION` definida
// (mesmo padrão de confirmação forte já usado por H5 — RESTORE_CONFIRM_PRODUCTION — nunca um segredo
// fixo inventado, uma string de confirmação explícita definida pelo operador).
//
// Uso:
//   node scripts/run-retention.js                # dry-run
//   node scripts/run-retention.js --execute       # apaga o que for elegível e não estiver sob hold
const { Pool } = require('pg');
const policy = require('../retention/policy');
const runner = require('../retention/runner');
const logger = require('../observability/logger');

function isProduction() {
  return (process.env.NODE_ENV || 'development') === 'production';
}

async function main() {
  const execute = process.argv.includes('--execute');
  const mode = execute ? 'execute' : 'dry_run';

  if (execute && isProduction() && process.env.RETENTION_EXECUTE_CONFIRMATION !== 'YES_I_UNDERSTAND_RETENTION_EXECUTE') {
    console.error('Execução real de retenção em produção exige RETENTION_EXECUTE_CONFIRMATION=YES_I_UNDERSTAND_RETENTION_EXECUTE explicitamente definida.');
    process.exitCode = 1;
    return;
  }

  if (execute) {
    try {
      policy.validatePolicyForProduction();
    } catch (error) {
      console.error(`Política de retenção inválida — execução abortada: ${error.message}`);
      logger.fatal('retention_policy_invalid', { component: 'retention', errorCode: 'RETENTION_POLICY_INVALID' });
      process.exitCode = 1;
      return;
    }
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL é obrigatória para executar o runner de retenção.');
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl });
  logger.info(mode === 'dry_run' ? 'retention_dry_run_started' : 'retention_executed_started', { component: 'retention' });
  try {
    const result = await runner.runRetention(pool, { mode, createdBy: process.env.USER || 'cli' });
    console.log(`Retention run: ${result.runId} (mode=${result.mode}, policyVersion=${result.policyVersion})`);
    console.log(JSON.stringify(result.summary, null, 2));
    logger.info(mode === 'dry_run' ? 'retention_dry_run' : 'retention_executed', { component: 'retention', runId: result.runId, mode });
  } catch (error) {
    console.error(`Falha ao executar retenção: ${error.message}`);
    logger.error('retention_failed', { component: 'retention', errorCode: 'RETENTION_RUN_FAILED', error: logger.serializeError(error) });
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) main();
module.exports = { main };
