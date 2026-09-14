// Integração completa do workspace Jurídico do Monday (docs/DEMO_DEPLOY.md — rodada de integração
// completa): script ADMINISTRATIVO/DEMO para rodar a sincronização Monday → Patrono diretamente no
// servidor (ex.: `fly ssh console -a <app> -C "node scripts/sync-monday.js"`), sem exigir que o
// operador copie um token de sessão do navegador manualmente.
//
// Reaproveita EXATAMENTE a mesma rotina usada por `POST /api/monday/sync` (server.js, `runMondaySync()`)
// — nenhuma segunda implementação da lógica de sincronização existe aqui. Este script só decide COMO
// carregar/persistir o store (via `storage/`, igual aos demais scripts administrativos) e como reportar
// o resultado no terminal.
//
// Somente leitura no Monday: `runMondaySync()`/`fetchMondayBoard()` só enviam `query` GraphQL ao Monday,
// nunca `mutation` — nada aqui escreve de volta no Monday. Nenhum `LegalDeadline` é criado
// automaticamente (este caminho nunca toca `store.records.legalDeadlines`).
//
// Uso:
//   MONDAY_TOKEN=... DATABASE_URL=... node scripts/sync-monday.js [--modules=processos,notificacoes]
//   npm run sync:monday -- --modules=processos
//
// Sem `--modules`, sincroniza TODOS os boards habilitados em legal-source-catalog.js.
// Sem `MONDAY_TOKEN`, cada board falha individualmente (relatado como "status: error" por board) — o
// script nunca derruba os demais boards nem finge sucesso.
function parseArgs(argv) {
  const args = { modules: null };
  for (const raw of argv) {
    if (raw.startsWith('--modules=')) args.modules = raw.slice('--modules='.length).split(',').map(v => v.trim()).filter(Boolean);
  }
  return args;
}

async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!process.env.MONDAY_TOKEN) {
    console.warn('Aviso: MONDAY_TOKEN não está definida — todos os boards falharão individualmente (nenhum dado fictício será gravado).');
  }

  const { readStore, writeStore, runMondaySync, audit } = require('../server');
  const store = await readStore();

  const operatorActor = { id: 'sync-monday-cli', name: 'Script administrativo (sync-monday.js)' };
  console.log(`Iniciando sincronização Monday → Patrono${args.modules ? ` (módulos: ${args.modules.join(', ')})` : ' (todos os boards habilitados)'}...`);

  const run = await runMondaySync(store, operatorActor.name, args.modules);
  audit(store, operatorActor, 'SYNC', 'monday', run.id, null, run, 'Sincronização somente leitura executada via script administrativo (scripts/sync-monday.js)');
  await writeStore(store);

  console.log('\nBOARD | ID | LIDOS | CRIADOS | ATUALIZADOS | INALTERADOS | FALHAS | STATUS');
  for (const entry of run.modules) {
    if (entry.status === 'error') {
      console.log(`${entry.module} | ${entry.board || '-'} | - | - | - | - | 1 | ERRO: ${entry.error}`);
    } else {
      console.log(`${entry.module} | ${entry.board} | ${entry.read} | ${entry.created} | ${entry.updated} | ${entry.unchanged} | 0 | OK`);
    }
  }
  console.log(`\nStatus geral da execução: ${run.status}`);
  console.log(`Run id: ${run.id}`);
  process.exitCode = run.status === 'partial' ? 1 : 0;
}

if (require.main === module) {
  run().catch(error => { console.error(`Falha ao sincronizar: ${error.message}`); process.exitCode = 1; });
}
module.exports = { run, parseArgs };
