// Sprint 2, Hardening H3 (docs/PRODUCTION_GATE.md; docs/DECISIONS.md, PROD-H3-01): acesso direto à
// tabela `rate_limit_buckets` (migrations/007_h3_rate_limiting.sql). Deliberadamente FORA da ponte
// relacional de `storage/index.js` (que hidrata/persiste coleções dentro do ciclo
// readStore()/writeStore(), com CAS por versão do DOCUMENTO inteiro) — rate limiting precisa de um
// upsert atômico por LINHA sob concorrência real (duas requisições simultâneas no mesmo bucket nunca
// podem ambas ler count=7 e gravar count=8 quando o limite seria 8), o que o CAS de documento não
// garante no nível de sub-campo. `executor` é sempre o pool Postgres direto (`storage.getPool()`).
//
// `consumeAndCheck()` é UMA única instrução atômica (CTE + UPDATE): incrementa o contador da janela
// atual (reiniciando se a janela expirou) e grava `blocked_until` (o instante em que a janela atual
// termina) sempre que o novo contador excede `limit` — tudo em uma única viagem ao banco, sem
// transação explícita nem lock manual (a atomicidade vem da própria constraint UNIQUE em `bucket_key`
// mais a semântica de MVCC do Postgres para uma única instrução).
// Nota de correção (revisão pós-implementação inicial): a versão anterior fazia isso em DUAS etapas —
// uma CTE com o INSERT ... ON CONFLICT DO UPDATE, seguida de um UPDATE separado que reconsultava
// `rate_limit_buckets` para gravar `blocked_until`. Isso é um erro clássico de CTE gravável no
// Postgres: todas as instruções de um único comando (inclusive um UPDATE subsequente que referencia a
// tabela diretamente, não apenas via a CTE) enxergam o mesmo snapshot de ANTES do comando começar — na
// primeira gravação de uma `bucket_key` nova, o UPDATE externo não encontrava linha nenhuma para
// atualizar (a linha inserida pela CTE ainda não existia nesse snapshot), o `RETURNING` externo vinha
// vazio e `rows[0]` era `undefined` — o que virava uma exceção, e o fail-closed (item 27 do escopo)
// tratava isso como bloqueado, bloqueando toda primeira tentativa de qualquer bucket novo. A correção:
// uma ÚNICA instrução INSERT ... ON CONFLICT DO UPDATE que já calcula `blocked_until` no mesmo SET,
// reaplicando a mesma expressão do novo `count`/`window_started_at` (avaliados sobre os valores ANTIGOS
// da linha, como o Postgres sempre faz em UPDATE) — nenhuma segunda consulta à tabela.
async function consumeAndCheck(executor, { bucketKey, scope, windowMs, limit }) {
  const windowExpired = `rate_limit_buckets.window_started_at <= now() - make_interval(secs => $3::double precision / 1000)`;
  const newCount = `(CASE WHEN ${windowExpired} THEN 1 ELSE rate_limit_buckets.count + 1 END)`;
  const newWindowStartedAt = `(CASE WHEN ${windowExpired} THEN now() ELSE rate_limit_buckets.window_started_at END)`;
  const { rows } = await executor.query(
    `INSERT INTO rate_limit_buckets (bucket_key, scope, window_started_at, count, blocked_until, updated_at)
     VALUES ($1, $2, now(), 1, NULL, now())
     ON CONFLICT (bucket_key) DO UPDATE SET
       count = ${newCount},
       window_started_at = ${newWindowStartedAt},
       blocked_until = CASE WHEN ${newCount} > $4 THEN ${newWindowStartedAt} + make_interval(secs => $3::double precision / 1000) ELSE NULL END,
       scope = $2,
       updated_at = now()
     RETURNING bucket_key, count, window_started_at, blocked_until`,
    [bucketKey, scope, windowMs, limit]
  );
  const row = rows[0];
  return {
    count: row.count,
    windowStartedAt: row.window_started_at,
    blockedUntil: row.blocked_until,
    allowed: row.count <= limit
  };
}

// Limpeza oportunística (item 26 do escopo H3): chamada com baixa probabilidade a cada consumo real —
// nunca exige um cron externo obrigatório. Remove linhas cuja janela (e eventual bloqueio) expiraram há
// mais tempo do que qualquer janela configurada poderia precisar manter — nunca apaga um bucket ainda
// dentro de sua janela ou bloqueio ativos.
async function cleanupExpired(executor, olderThanMs) {
  await executor.query(
    `DELETE FROM rate_limit_buckets
     WHERE updated_at < now() - make_interval(secs => $1::double precision / 1000)
       AND (blocked_until IS NULL OR blocked_until < now())`,
    [olderThanMs]
  );
}

module.exports = { consumeAndCheck, cleanupExpired };
