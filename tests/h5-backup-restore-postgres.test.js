// Sprint 2, Hardening H5 (docs/PRODUCTION_GATE.md, PG-21; docs/DECISIONS.md, PROD-H5-01): teste REAL de
// ponta a ponta de backup/restore — `pg_dump`/`pg_restore` de verdade contra PostgreSQL real, nunca mock
// (item 28/48 do escopo H5: "não aceitar mock de pg_dump ou teste apenas de funções JS como evidência
// suficiente"). Gated por TEST_DATABASE_URL, mesmo padrão de todo o restante do projeto — sem ela, este
// arquivo inteiro é pulado explicitamente, nunca fingindo cobertura que não existe.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

if (!TEST_DATABASE_URL) {
  test('[H5-restore-real] pulado — TEST_DATABASE_URL não configurada (backup/restore real exige PostgreSQL; ver docs/PRODUCTION_GATE.md, seção 28)', { skip: true }, () => {});
} else {
  const { Pool } = require('pg');
  const { runBackup } = require('../scripts/backup-postgres');
  const { runRestore, EPHEMERAL_TABLES_TO_REVOKE } = require('../scripts/restore-postgres');

  function urlFor(dbName) { return TEST_DATABASE_URL.replace(/\/[^/]+$/, `/${dbName}`); }

  async function createIsolatedDatabase(suffix) {
    const name = `patrono_h5_${suffix}_${process.pid}_${Date.now()}`;
    const admin = new Pool({ connectionString: TEST_DATABASE_URL });
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    return { name, url: urlFor(name) };
  }

  async function dropDatabase(name) {
    const admin = new Pool({ connectionString: TEST_DATABASE_URL });
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  }

  async function applyMigrations(databaseUrl) {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;
    delete require.cache[require.resolve('../database')];
    delete require.cache[require.resolve('../scripts/migrate')];
    const { run } = require('../scripts/migrate');
    await run();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalDatabaseUrl;
  }

  // Dataset sintético representativo (item 29 do escopo H5): usuário, processo jurídico, Legal Deadline,
  // audit event, e as 4 tabelas operacionais efêmeras de H2/H3 (sessão, desafio MFA, token de reset,
  // bucket de rate limit) — exatamente as que a política de pós-restore decide revogar em vez de
  // restaurar cegamente (docs/DECISIONS.md, PROD-H5-01).
  async function seedRepresentativeDataset(databaseUrl) {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query(`INSERT INTO app_users (id, name, email, role, department, credentials_version, login_identifier) VALUES ('usr-h5-teste', 'H5 Teste', 'h5.teste@coevo.local', 'colaborador', 'Jurídico', 1, 'usr-h5-teste')`);
      await pool.query(`INSERT INTO legal_processes (id, source, title, department) VALUES ('proc-h5-teste', 'manual', 'Processo H5 Teste', 'Jurídico')`);
      await pool.query(`INSERT INTO legal_deadlines (id, process_id, origin, date, origin_type, status, responsible_user_id, department) VALUES ('deadline-h5-teste', 'proc-h5-teste', 'Prazo de teste H5', '2030-01-01', 'JUDICIAL_PROCESSUAL', 'ativo', 'usr-h5-teste', 'Jurídico')`);
      await pool.query(`INSERT INTO audit_log (id, action, entity, entity_id, responsible, reason, correlation_id) VALUES ('audit-h5-teste', 'CREATE', 'legalDeadlines', 'deadline-h5-teste', 'H5 Teste', 'seed de teste H5', 'corr-h5-teste')`);
      await pool.query(`INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, credentials_version) VALUES ('session-h5-teste', 'usr-h5-teste', 'hash-fake-token', now() + interval '1 hour', 1)`);
      await pool.query(`INSERT INTO auth_challenges (id, user_id, type, expires_at) VALUES ('challenge-h5-teste', 'usr-h5-teste', 'totp', now() + interval '5 minutes')`);
      await pool.query(`INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES ('reset-h5-teste', 'usr-h5-teste', 'hash-fake-reset', now() + interval '1 hour')`);
      await pool.query(`INSERT INTO rate_limit_buckets (bucket_key, scope, count) VALUES ('bucket-h5-teste', 'login:ip', 3)`);
    } finally {
      await pool.end();
    }
  }

  async function countsOf(databaseUrl) {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const tables = ['app_users', 'legal_processes', 'legal_deadlines', 'audit_log', 'auth_sessions', 'auth_challenges', 'password_reset_tokens', 'rate_limit_buckets'];
      const result = {};
      for (const table of tables) {
        const { rows } = await pool.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
        result[table] = rows[0].count;
      }
      return result;
    } finally {
      await pool.end();
    }
  }

  let sourceDb, targetDb, storageDir;

  test.before(async () => {
    sourceDb = await createIsolatedDatabase('source');
    await applyMigrations(sourceDb.url);
    await seedRepresentativeDataset(sourceDb.url);
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patrono-h5-storage-'));
  });

  test.after(async () => {
    await dropDatabase(sourceDb.name);
    if (targetDb) await dropDatabase(targetDb.name);
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  function withEnv(vars, fn) {
    const originals = {};
    for (const key of Object.keys(vars)) { originals[key] = process.env[key]; process.env[key] = vars[key]; }
    return Promise.resolve().then(fn).finally(() => {
      for (const key of Object.keys(vars)) { if (originals[key] === undefined) delete process.env[key]; else process.env[key] = originals[key]; }
    });
  }

  let realManifest;
  const backupTimings = {};

  test('[H5-real-A] backup real com pg_dump gera manifesto válido, sha256 correto e tamanho > 0', async () => {
    const start = Date.now();
    realManifest = await withEnv({ BACKUP_STORAGE_PROVIDER: 'filesystem', BACKUP_LOCAL_DIR: storageDir }, () =>
      runBackup({ databaseUrl: sourceDb.url, environment: 'development' })
    );
    backupTimings.durationMs = Date.now() - start;
    assert.match(realManifest.sha256, /^[0-9a-f]{64}$/);
    assert.ok(realManifest.sizeBytes > 0);
    assert.equal(realManifest.format, 'custom');
    assert.equal(realManifest.encrypted, false);
    assert.ok(realManifest.postgresVersion, 'postgresVersion deve ser registrada no manifesto');
    assert.ok(realManifest.migrationVersion, 'migrationVersion deve ser registrada no manifesto');
    // Correção pós-H5 (revisão técnica independente): manifesto deve registrar o NOME REAL do banco de
    // origem (current_database()), nunca o valor fixo "postgres" hardcoded.
    assert.equal(realManifest.database, sourceDb.name, 'manifesto deve registrar o nome real do banco de origem');
    const objectPath = path.join(storageDir, realManifest.storageObjectKey);
    assert.ok(fs.existsSync(objectPath), 'artefato de backup deve existir no storage local');
    assert.ok(fs.statSync(objectPath).size > 0);
  });

  test('[H5-real-B] backup_runs registra a execução como completed com metadata correta', async () => {
    const pool = new Pool({ connectionString: sourceDb.url });
    try {
      const { rows } = await pool.query('SELECT * FROM backup_runs WHERE backup_id = $1', [realManifest.backupId]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, 'completed');
      assert.equal(rows[0].sha256, realManifest.sha256);
      assert.ok(Number(rows[0].size_bytes) > 0);
    } finally { await pool.end(); }
  });

  test('[H5-real-C] restore real com pg_restore em banco isolado passa, dados equivalem à origem, migrations presentes', async () => {
    targetDb = await createIsolatedDatabase('target');
    const start = Date.now();
    const report = await withEnv({ BACKUP_STORAGE_PROVIDER: 'filesystem', BACKUP_LOCAL_DIR: storageDir }, () =>
      runRestore({
        databaseUrlTarget: targetDb.url, targetEnvironment: 'development',
        backupSourceEnvironment: 'development', backupId: realManifest.backupId
      })
    );
    backupTimings.restoreDurationMs = Date.now() - start;
    assert.equal(report.result, 'success');

    const sourceCounts = await countsOf(sourceDb.url);
    const targetCounts = await countsOf(targetDb.url);
    // Dados de negócio devem ser idênticos entre origem e destino.
    assert.equal(targetCounts.app_users, sourceCounts.app_users);
    assert.equal(targetCounts.legal_processes, sourceCounts.legal_processes);
    assert.equal(targetCounts.legal_deadlines, sourceCounts.legal_deadlines);
    assert.equal(targetCounts.audit_log, sourceCounts.audit_log);

    // Relações preservadas: o Legal Deadline restaurado ainda referencia o mesmo processo/usuário.
    const pool = new Pool({ connectionString: targetDb.url });
    try {
      const { rows } = await pool.query('SELECT process_id, responsible_user_id FROM legal_deadlines WHERE id = $1', ['deadline-h5-teste']);
      assert.equal(rows[0].process_id, 'proc-h5-teste');
      assert.equal(rows[0].responsible_user_id, 'usr-h5-teste');
      const { rows: migrationRows } = await pool.query('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1');
      assert.equal(migrationRows[0].version, realManifest.migrationVersion);
    } finally { await pool.end(); }
  });

  test('[H5-real-D] política pós-restore revoga sessão/desafio MFA/token de reset/rate limit (dados efêmeros nunca restaurados cegamente)', async () => {
    const targetCounts = await countsOf(targetDb.url);
    for (const table of EPHEMERAL_TABLES_TO_REVOKE) {
      assert.equal(targetCounts[table], 0, `${table} deveria estar vazia após a política de revogação pós-restore`);
    }
    // Confirma que a origem CONTINUA com os dados efêmeros intactos — a política afeta só o destino.
    const sourceCounts = await countsOf(sourceDb.url);
    assert.ok(sourceCounts.auth_sessions > 0);
    assert.ok(sourceCounts.rate_limit_buckets > 0);
  });

  test('[H5-real-E] restore_runs registra evidência de auditoria no banco de destino', async () => {
    const pool = new Pool({ connectionString: targetDb.url });
    try {
      const { rows } = await pool.query('SELECT * FROM restore_runs WHERE backup_id = $1', [realManifest.backupId]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].result, 'success');
      assert.equal(rows[0].target_environment, 'development');
    } finally { await pool.end(); }
  });

  test('[H5-real-F] tempo observado de backup e restore são finitos e registrados (RTO/RPO precisam de evidência real, nunca aspiracional)', () => {
    assert.ok(backupTimings.durationMs >= 0);
    assert.ok(backupTimings.restoreDurationMs >= 0);
  });

  // --- Falhas de integridade/configuração (não precisam de um segundo banco de destino real: falham
  // ANTES de qualquer conexão ao alvo, por design de runRestore()) --------------------------------------

  test('[H5-real-G] restore com SHA-256 adulterado no manifesto falha e nunca toca o banco', async () => {
    const tamperedManifest = { ...realManifest, sha256: '0'.repeat(64) };
    const manifestPath = path.join(storageDir, 'tampered.manifest.json');
    const artifactPath = path.join(storageDir, realManifest.storageObjectKey);
    fs.writeFileSync(manifestPath, JSON.stringify(tamperedManifest));
    await assert.rejects(
      () => runRestore({ databaseUrlTarget: 'postgresql://usuario-nunca-usado/nao-importa', targetEnvironment: 'development', localManifestPath: manifestPath, localArtifactPath: artifactPath }),
      /SHA-256/
    );
  });

  test('[H5-real-H] restore para ambiente cruzado (backup de development, alvo staging) é bloqueado por padrão', async () => {
    const manifestPath = path.join(storageDir, realManifest.storageObjectKey.replace(/\.dump$/, '.manifest.json'));
    const artifactPath = path.join(storageDir, realManifest.storageObjectKey);
    await assert.rejects(
      () => runRestore({ databaseUrlTarget: 'postgresql://usuario-nunca-usado/nao-importa', targetEnvironment: 'staging', localManifestPath: manifestPath, localArtifactPath: artifactPath }),
      /cross-environment bloqueado/
    );
  });

  test('[H5-real-I] restore cross-environment com RESTORE_ALLOW_CROSS_ENVIRONMENT + confirmação de produção funciona (override explícito e auditável)', async () => {
    const stagingTarget = await createIsolatedDatabase('cross');
    try {
      const manifestPath = path.join(storageDir, realManifest.storageObjectKey.replace(/\.dump$/, '.manifest.json'));
      const artifactPath = path.join(storageDir, realManifest.storageObjectKey);
      const report = await runRestore({
        databaseUrlTarget: stagingTarget.url, targetEnvironment: 'staging',
        localManifestPath: manifestPath, localArtifactPath: artifactPath,
        allowCrossEnvironment: 'I_ACCEPT_THE_RISK'
      });
      assert.equal(report.result, 'success');
    } finally { await dropDatabase(stagingTarget.name); }
  });

  test('[H5-real-J] restore para produção sem RESTORE_CONFIRM_PRODUCTION falha (confirmação forte obrigatória)', async () => {
    const productionManifest = { ...realManifest, environment: 'production' };
    const manifestPath = path.join(storageDir, 'production.manifest.json');
    const artifactPath = path.join(storageDir, realManifest.storageObjectKey);
    fs.writeFileSync(manifestPath, JSON.stringify(productionManifest));
    await assert.rejects(
      () => runRestore({ databaseUrlTarget: 'postgresql://usuario-nunca-usado/nao-importa', targetEnvironment: 'production', localManifestPath: manifestPath, localArtifactPath: artifactPath }),
      /RESTORE_CONFIRM_PRODUCTION/
    );
  });

  test('[H5-real-K] restore em banco de destino já populado sem RESTORE_REPLACE falha (nunca sobrescreve silenciosamente)', async () => {
    const manifestPath = path.join(storageDir, realManifest.storageObjectKey.replace(/\.dump$/, '.manifest.json'));
    const artifactPath = path.join(storageDir, realManifest.storageObjectKey);
    // targetDb já foi restaurado no teste H5-real-C — está "populado" (schema_migrations tem linhas).
    await assert.rejects(
      () => runRestore({ databaseUrlTarget: targetDb.url, targetEnvironment: 'development', localManifestPath: manifestPath, localArtifactPath: artifactPath }),
      /RESTORE_REPLACE/
    );
  });

  test('[H5-real-L] restore em banco populado COM RESTORE_REPLACE=YES_REPLACE_TARGET_DATA é permitido explicitamente', async () => {
    const manifestPath = path.join(storageDir, realManifest.storageObjectKey.replace(/\.dump$/, '.manifest.json'));
    const artifactPath = path.join(storageDir, realManifest.storageObjectKey);
    const report = await runRestore({
      databaseUrlTarget: targetDb.url, targetEnvironment: 'development',
      localManifestPath: manifestPath, localArtifactPath: artifactPath, replace: 'YES_REPLACE_TARGET_DATA'
    });
    assert.equal(report.result, 'success');
  });

  test('[H5-real-M] backup sem DATABASE_URL falha explicitamente', async () => {
    await assert.rejects(() => runBackup({ databaseUrl: undefined, environment: 'development' }), /DATABASE_URL/);
  });

  test('[H5-real-N] backup em produção sem storage offsite real (local-only) falha explicitamente', async () => {
    // Correção pós-H5: produção agora também exige BACKUP_ENCRYPTION_KEY (checada ANTES do storage) —
    // definida aqui para isolar especificamente a checagem de storage offsite que este teste verifica.
    await assert.rejects(
      () => withEnv({ BACKUP_ENCRYPTION_KEY: 'chave-de-teste-com-pelo-menos-32-caracteres' }, () =>
        runBackup({ databaseUrl: sourceDb.url, environment: 'production' })
      ),
      /storage offsite real/
    );
  });

  // --- Correção pós-H5 (revisão técnica independente): criptografia obrigatória em produção -----------
  test('[H5-real-S] backup em produção SEM BACKUP_ENCRYPTION_KEY falha explicitamente (backup em texto claro nunca é aceito)', async () => {
    await assert.rejects(
      () => runBackup({ databaseUrl: sourceDb.url, environment: 'production' }),
      /BACKUP_ENCRYPTION_KEY é obrigatória em produção/
    );
  });

  test('[H5-real-T] backup em produção com BACKUP_ENCRYPTION_KEY curta falha explicitamente', async () => {
    await assert.rejects(
      () => withEnv({ BACKUP_ENCRYPTION_KEY: 'curta-demais' }, () =>
        runBackup({ databaseUrl: sourceDb.url, environment: 'production' })
      ),
      /menos de 32 caracteres/
    );
  });

  test('[H5-real-U] backup em produção com BACKUP_ENCRYPTION_KEY válida e storage s3 (cliente fake) passa e gera artefato cifrado', async () => {
    const store = new Map();
    const { createS3StorageAdapter } = require('../backup/storage-adapters/s3');
    const fakeClient = {
      async send(command) {
        const name = command.constructor.name;
        if (name === 'PutObjectCommand') {
          const chunks = [];
          for await (const chunk of command.input.Body) chunks.push(chunk);
          store.set(command.input.Key, Buffer.concat(chunks));
          return {};
        }
        throw new Error(`comando não suportado: ${name}`);
      }
    };
    const manifest = await withEnv({
      BACKUP_ENCRYPTION_KEY: 'chave-de-teste-com-pelo-menos-32-caracteres',
      BACKUP_STORAGE_PROVIDER: 's3', BACKUP_BUCKET: 'patrono-backups-producao-teste'
    }, () => runBackup({ databaseUrl: sourceDb.url, environment: 'production', s3Client: fakeClient }));
    assert.equal(manifest.encrypted, true);
    assert.ok(manifest.encryptionKeyId);
    assert.ok(store.has(manifest.storageObjectKey), 'o artefato cifrado deve ter sido "enviado" ao storage s3 (fake)');
  });

  test('[H5-real-V] backup real com criptografia habilitada + restore real decifra corretamente (round-trip completo com dado real)', async () => {
    const encryptedManifest = await withEnv({
      BACKUP_ENCRYPTION_KEY: 'chave-de-teste-com-pelo-menos-32-caracteres',
      BACKUP_STORAGE_PROVIDER: 'filesystem', BACKUP_LOCAL_DIR: storageDir
    }, () => runBackup({ databaseUrl: sourceDb.url, environment: 'development' }));
    assert.equal(encryptedManifest.encrypted, true);
    const encryptedTarget = await createIsolatedDatabase('encryptedtarget');
    try {
      const report = await withEnv({
        BACKUP_ENCRYPTION_KEY: 'chave-de-teste-com-pelo-menos-32-caracteres',
        BACKUP_STORAGE_PROVIDER: 'filesystem', BACKUP_LOCAL_DIR: storageDir
      }, () => runRestore({
        databaseUrlTarget: encryptedTarget.url, targetEnvironment: 'development',
        backupSourceEnvironment: 'development', backupId: encryptedManifest.backupId
      }));
      assert.equal(report.result, 'success');
      const pool = new Pool({ connectionString: encryptedTarget.url });
      try {
        const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM app_users WHERE id = 'usr-h5-teste'");
        assert.equal(rows[0].count, 1, 'dado real deve ter sobrevivido ao round-trip cifra/decifra');
      } finally { await pool.end(); }
    } finally { await dropDatabase(encryptedTarget.name); }
  });

  test('[H5-real-W] senha do PostgreSQL com caracteres especiais funciona no backup/restore real (credencial nunca em argv)', async () => {
    const admin = new Pool({ connectionString: sourceDb.url });
    const roleName = `h5_special_pw_${process.pid}`;
    const specialPassword = "s3nh@:c0m/car#especi&is%25";
    try {
      await admin.query(`CREATE ROLE ${roleName} WITH LOGIN SUPERUSER PASSWORD '${specialPassword.replace(/'/g, "''")}'`);
      const specialUrl = `postgresql://${roleName}:${encodeURIComponent(specialPassword)}@${new URL(sourceDb.url).host}/${sourceDb.name}`;
      const manifest = await withEnv({ BACKUP_STORAGE_PROVIDER: 'filesystem', BACKUP_LOCAL_DIR: storageDir }, () =>
        runBackup({ databaseUrl: specialUrl, environment: 'development' })
      );
      assert.ok(manifest.sizeBytes > 0, 'backup real com senha de caracteres especiais deve funcionar');

      const specialTarget = await createIsolatedDatabase('specialpwtarget');
      try {
        const specialTargetUrl = `postgresql://${roleName}:${encodeURIComponent(specialPassword)}@${new URL(specialTarget.url).host}/${specialTarget.name}`;
        const report = await withEnv({ BACKUP_STORAGE_PROVIDER: 'filesystem', BACKUP_LOCAL_DIR: storageDir }, () =>
          runRestore({
            databaseUrlTarget: specialTargetUrl, targetEnvironment: 'development',
            backupSourceEnvironment: 'development', backupId: manifest.backupId
          })
        );
        assert.equal(report.result, 'success', 'restore real com senha de caracteres especiais deve funcionar');
      } finally { await dropDatabase(specialTarget.name); }
    } finally {
      await admin.query(`DROP ROLE IF EXISTS ${roleName}`).catch(() => {});
      await admin.end();
    }
  });

  test('[H5-real-O] pg_dump com DATABASE_URL de um servidor inalcançável nunca produz um backup "completed"', async () => {
    const pool = new Pool({ connectionString: sourceDb.url });
    let countBefore;
    try {
      countBefore = (await pool.query("SELECT COUNT(*)::int AS count FROM backup_runs WHERE status = 'completed'")).rows[0].count;
    } finally { await pool.end(); }

    const unreachableUrl = 'postgresql://postgres:postgres@127.0.0.1:1/patrono_nao_existe';
    await assert.rejects(() => withEnv({ BACKUP_STORAGE_PROVIDER: 'filesystem', BACKUP_LOCAL_DIR: storageDir }, () =>
      runBackup({ databaseUrl: unreachableUrl, environment: 'development' })
    ));
    // Nenhum backup novo deve ter sido marcado como "completed" a partir dessa tentativa — a contagem de
    // backups completed nesta base nunca cresce por causa de uma tentativa contra um servidor
    // inalcançável (comparação contra o valor capturado ANTES da tentativa, não um número fixo, já que
    // outros testes reais deste arquivo — H5-real-A/U/V/W — também geram linhas completed legítimas).
    const pool2 = new Pool({ connectionString: sourceDb.url });
    try {
      const { rows } = await pool2.query("SELECT COUNT(*)::int AS count FROM backup_runs WHERE status = 'completed'");
      assert.equal(rows[0].count, countBefore, 'a tentativa contra um servidor inalcançável nunca deve gerar uma nova linha completed nesta base');
    } finally { await pool2.end(); }
  });

  test('[H5-real-P] arquivos temporários de trabalho são limpos após backup e restore (sucesso e falha)', async () => {
    const beforeEntries = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('patrono-backup-') || name.startsWith('patrono-restore-'));
    assert.deepEqual(beforeEntries, [], 'nenhum diretório temporário de backup/restore deveria sobreviver após as execuções anteriores (sucesso ou falha)');
  });

  test('[H5-real-Q] backup anterior válido não é apagado por uma tentativa de backup que falha depois', async () => {
    const objectPath = path.join(storageDir, realManifest.storageObjectKey);
    assert.ok(fs.existsSync(objectPath), 'o artefato do backup H5-real-A continua presente no storage mesmo após a falha de H5-real-O');
  });

  test('[H5-real-R] execução completa (pg_dump real → pg_restore real) documentada com evidência de tempo e checks', () => {
    assert.ok(realManifest.backupId);
    assert.ok(backupTimings.durationMs >= 0 && backupTimings.restoreDurationMs >= 0);
  });
}
