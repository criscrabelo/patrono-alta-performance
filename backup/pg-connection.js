// Correção pós-H5 (docs/DECISIONS.md, PROD-H5-01): credencial do PostgreSQL NUNCA em argv de um
// processo filho — `ps`/`/proc`/qualquer inspetor de processos do sistema operacional pode ler os
// argumentos de linha de comando de qualquer processo em execução, mesmo entre usuários sem privilégio
// root em alguns sistemas. `pg_dump`/`pg_restore` eram chamados anteriormente com a connection string
// COMPLETA (usuário:senha@host:porta/banco) como argumento posicional — visível para qualquer um que
// rodasse `ps aux` no momento da execução. Este módulo parseia a URL uma única vez e devolve os
// argumentos de CLI SEM segredo (host/porta/usuário/banco) mais um `env` específico que carrega a senha
// via `PGPASSWORD` (lida pelo `libpq` nativo, nunca aparece em argv) — nunca muta `process.env` global.
function parsePostgresConnection(connectionString) {
  let parsed;
  try { parsed = new URL(connectionString); } catch { throw new Error('Connection string do PostgreSQL inválida (não é uma URI válida).'); }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('Connection string do PostgreSQL inválida (esquema deve ser postgres:// ou postgresql://).');
  }
  const user = parsed.username ? decodeURIComponent(parsed.username) : undefined;
  const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
  const host = parsed.hostname || undefined;
  const port = parsed.port || undefined;
  const database = parsed.pathname ? decodeURIComponent(parsed.pathname.replace(/^\//, '')) : undefined;
  const sslmode = parsed.searchParams.get('sslmode') || undefined;
  return { host, port, user, password, database, sslmode };
}

// Argumentos de CLI para pg_dump/pg_restore — nunca inclui a senha (só host/porta/usuário/banco, todos
// não-segredo). `extraArgs` são intercalados no INÍCIO (flags/opções), `-d <database>` sempre por
// último, coerente com a sintaxe de ambas as ferramentas.
function pgCliArgs(connection, extraArgs = []) {
  const args = [...extraArgs];
  if (connection.host) args.push('-h', connection.host);
  if (connection.port) args.push('-p', String(connection.port));
  if (connection.user) args.push('-U', connection.user);
  if (connection.database) args.push('-d', connection.database);
  return args;
}

// `env` específico para o processo filho — NUNCA `process.env.PGPASSWORD = ...` (isso vazaria a senha
// para qualquer outro código deste processo Node que leia `process.env` depois, inclusive código futuro
// não relacionado). Construído a partir de uma cópia de `process.env`, descartada pelo garbage collector
// assim que a chamada a `execFile` retorna — nunca persiste além do escopo da chamada.
function pgChildEnv(connection) {
  const env = { ...process.env };
  if (connection.password) env.PGPASSWORD = connection.password;
  else delete env.PGPASSWORD;
  if (connection.sslmode) env.PGSSLMODE = connection.sslmode;
  return env;
}

module.exports = { parsePostgresConnection, pgCliArgs, pgChildEnv };
