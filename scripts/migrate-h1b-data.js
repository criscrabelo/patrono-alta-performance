// Sprint 2, Hardening H1B (docs/PRODUCTION_GATE.md; docs/DECISIONS.md, PROD-H1B-01): migração de dados
// H1A → H1B — extrai users/legalProcesses(=records.processos)/legalDeadlines(=records.legalDeadlines)/
// audit do documento JSONB `app_store` (fonte canônica do H1A) para as tabelas relacionais criadas por
// migrations/004_h1b_core_relational.sql, e faz o CUTOVER (remove essas 4 chaves do blob, já que deixam
// de ser canônicas ali — storage/index.js nunca mais as lê/grava no blob depois disso).
//
// Uso:
//   node scripts/migrate-h1b-data.js --dry-run
//   DATABASE_URL=... node scripts/migrate-h1b-data.js [--force]
//
// --dry-run: lê e valida o app_store existente, reporta contagens/inconsistências por coleção, SEM
// gravar nada. --force: só necessário quando as tabelas relacionais já contiverem dado — sem --force, a
// importação real recusa reimportar por cima de dado já existente (idempotência).
//
// NUNCA roda automaticamente (não faz parte do boot do servidor). NUNCA apaga o app_store nem qualquer
// outro dado do blob além das 4 chaves migradas — o restante do documento (departments, financials,
// agenda, projetos, etc.) permanece intocado.
const { pool, configured } = require('../database');

function parseArgs(argv) {
  const args = { dryRun: false, force: false };
  for (const raw of argv) {
    if (raw === '--dry-run') args.dryRun = true;
    else if (raw === '--force') args.force = true;
  }
  return args;
}

const LEGAL_DEADLINE_ORIGIN_TYPES = ['JUDICIAL_PROCESSUAL', 'INTERNAL_CONTROL'];
const LEGAL_DEADLINE_STATUSES = ['ativo', 'suspenso', 'cumprido', 'cancelado'];

function findDuplicateIds(items) {
  const seen = new Set(); const duplicates = new Set();
  for (const item of items) { if (item && item.id) { if (seen.has(item.id)) duplicates.add(item.id); seen.add(item.id); } }
  return [...duplicates];
}

function validateUsers(users) {
  const invalid = users.filter(u => !u || typeof u !== 'object' || !u.id || !u.email).map(u => u && u.id);
  return { total: users.length, valid: users.length - invalid.length, invalid, duplicates: findDuplicateIds(users) };
}

function validateLegalProcesses(processos) {
  const invalid = processos.filter(p => !p || !p.id).length;
  return { total: processos.length, valid: processos.length - invalid, duplicates: findDuplicateIds(processos) };
}

function validateLegalDeadlines(deadlines, processIds, userIds) {
  const orphanProcess = []; const orphanResponsible = []; const invalidEnum = []; let valid = 0;
  for (const d of deadlines) {
    let ok = true;
    if (!d || !d.id) { ok = false; }
    else {
      if (!d.processId || !processIds.has(d.processId)) { orphanProcess.push(d.id); ok = false; }
      if (d.responsibleUserId && !userIds.has(d.responsibleUserId)) { orphanResponsible.push(d.id); ok = false; }
      if (!LEGAL_DEADLINE_ORIGIN_TYPES.includes(d.originType) || !LEGAL_DEADLINE_STATUSES.includes(d.status)) { invalidEnum.push(d.id); ok = false; }
    }
    if (ok) valid++;
  }
  return { total: deadlines.length, valid, orphanProcess, orphanResponsible, invalidEnum, duplicates: findDuplicateIds(deadlines) };
}

function validateAudit(events) {
  const invalid = events.filter(e => !e || !e.id || !e.action || !e.entity || !e.entityId).length;
  return { total: events.length, valid: events.length - invalid, duplicates: findDuplicateIds(events) };
}

function hasCriticalIssues(usersReport, processesReport, deadlinesReport, auditReport) {
  return Boolean(
    usersReport.invalid.length || usersReport.duplicates.length ||
    processesReport.duplicates.length ||
    deadlinesReport.orphanProcess.length || deadlinesReport.orphanResponsible.length || deadlinesReport.invalidEnum.length || deadlinesReport.duplicates.length ||
    auditReport.duplicates.length
  );
}

async function insertUserIdempotent(client, user) {
  await client.query(
    `INSERT INTO app_users (id, name, email, role, department, mfa, temporary_password, company_id, spe_id, deleted_at, version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (id) DO NOTHING`,
    [user.id, user.name ?? null, user.email, user.role ?? null, user.department ?? null, Boolean(user.mfa), Boolean(user.temporaryPassword), user.companyId ?? null, user.speId ?? null, user.deletedAt ?? null, user.version || 1]
  );
}

async function insertLegalProcessIdempotent(client, process) {
  await client.query(
    `INSERT INTO legal_processes (id, source, external_id, module, board_id, board_name, department, title, "group", columns, columns_by_title, classification, company_id, spe_id, scope_type, created_at_source, synced_at, deleted_at, version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     ON CONFLICT (id) DO NOTHING`,
    [
      process.id, process.source ?? 'unknown', process.externalId ?? null, process.module ?? null,
      process.boardId ?? null, process.boardName ?? null, process.department ?? null, process.title ?? null,
      process.group ?? null, JSON.stringify(process.columns ?? {}), JSON.stringify(process.columnsByTitle ?? {}),
      process.classification ?? null, process.companyId ?? null, process.speId ?? null, process.scopeType ?? null,
      process.createdAt ?? null, process.syncedAt ?? null, process.deletedAt ?? null, process.version || 1
    ]
  );
}

async function insertLegalDeadlineIdempotent(client, deadline) {
  await client.query(
    `INSERT INTO legal_deadlines (id, process_id, origin, date, origin_type, status, responsible_user_id, department, company_id, spe_id, scope_type, created_by, updated_by, deleted_at, deleted_by, version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (id) DO NOTHING`,
    [
      deadline.id, deadline.processId, deadline.origin, deadline.date, deadline.originType, deadline.status,
      deadline.responsibleUserId ?? null, deadline.department ?? null, deadline.companyId ?? null,
      deadline.speId ?? null, deadline.scopeType ?? null, deadline.createdBy ?? null, deadline.updatedBy ?? null,
      deadline.deletedAt ?? null, deadline.deletedBy ?? null, deadline.version || 1
    ]
  );
}

async function insertAuditEventIdempotent(client, event) {
  await client.query(
    `INSERT INTO audit_log (id, action, entity, entity_id, responsible, date, reason, before, after, correlation_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (id) DO NOTHING`,
    [event.id, event.action, event.entity, event.entityId, event.responsible ?? null, event.date ?? new Date().toISOString(), event.reason ?? null, event.before ?? null, event.after ?? null, event.correlationId ?? null]
  );
}

async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!configured()) { console.error('DATABASE_URL não configurada — a migração H1B exige um destino PostgreSQL.'); process.exitCode = 1; return; }
  const client = pool();
  try {
    const migrated = await client.query("SELECT 1 FROM schema_migrations WHERE version = '004_h1b_core_relational'").catch(() => ({ rows: [] }));
    if (!migrated.rows.length) { console.error('Migration "004_h1b_core_relational" ausente — rode "npm run migrate" antes de migrar os dados.'); process.exitCode = 1; return; }

    const { rows } = await client.query('SELECT data FROM app_store WHERE id = 1');
    if (!rows.length) { console.error('app_store vazio — nada para migrar.'); process.exitCode = 1; return; }
    const blob = rows[0].data;
    const users = Array.isArray(blob.users) ? blob.users : [];
    const processos = (blob.records && Array.isArray(blob.records.processos)) ? blob.records.processos : [];
    const legalDeadlines = (blob.records && Array.isArray(blob.records.legalDeadlines)) ? blob.records.legalDeadlines : [];
    const auditEvents = Array.isArray(blob.audit) ? blob.audit : [];

    const usersReport = validateUsers(users);
    const processesReport = validateLegalProcesses(processos);
    const processIds = new Set(processos.filter(p => p && p.id).map(p => p.id));
    const userIds = new Set(users.filter(u => u && u.id).map(u => u.id));
    const deadlinesReport = validateLegalDeadlines(legalDeadlines, processIds, userIds);
    const auditReport = validateAudit(auditEvents);

    console.log('users:', usersReport);
    console.log('legalProcesses:', processesReport);
    console.log('legalDeadlines:', deadlinesReport);
    console.log('audit:', auditReport);

    if (hasCriticalIssues(usersReport, processesReport, deadlinesReport, auditReport)) {
      console.error('\nInconsistências críticas encontradas (duplicados, órfãos ou enum inválido) — abortando. Nenhum dado foi gravado.');
      process.exitCode = 1;
      return;
    }

    if (args.dryRun) { console.log('\n--dry-run: nenhuma gravação foi realizada.'); process.exitCode = 0; return; }

    const existing = await client.query('SELECT count(*)::int AS n FROM app_users');
    if (existing.rows[0].n > 0 && !args.force) {
      console.error(`\nImportação abortada: a tabela "app_users" já contém ${existing.rows[0].n} registro(s). Use --force para reimportar mesmo assim (idempotente via ON CONFLICT DO NOTHING — nunca sobrescreve linha já existente).`);
      process.exitCode = 1;
      return;
    }

    await client.query('BEGIN');
    try {
      for (const user of users) await insertUserIdempotent(client, user);
      for (const process of processos) await insertLegalProcessIdempotent(client, process);
      for (const deadline of legalDeadlines) await insertLegalDeadlineIdempotent(client, deadline);
      for (const event of auditEvents) await insertAuditEventIdempotent(client, event);

      // Cutover: as 4 coleções deixam de ser canônicas dentro do blob — removidas explicitamente (não
      // apenas "ignoradas pelo runtime"), na MESMA transação que as insere nas tabelas relacionais.
      const strippedBlob = { ...blob };
      delete strippedBlob.users;
      delete strippedBlob.audit;
      if (strippedBlob.records) {
        strippedBlob.records = { ...strippedBlob.records };
        delete strippedBlob.records.processos;
        delete strippedBlob.records.legalDeadlines;
      }
      await client.query('UPDATE app_store SET data = $1, version = version + 1, updated_at = now() WHERE id = 1', [JSON.stringify(strippedBlob)]);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    console.log(`\nMigração H1B concluída com sucesso: ${usersReport.total} usuário(s), ${processesReport.total} processo(s), ${deadlinesReport.total} prazo(s), ${auditReport.total} evento(s) de auditoria migrados. app_store não contém mais essas 4 coleções (cutover aplicado).`);
  } catch (error) {
    console.error(`\nFalha na migração H1B: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (require.main === module) run();
module.exports = { run, validateUsers, validateLegalProcesses, validateLegalDeadlines, validateAudit, hasCriticalIssues, parseArgs };
