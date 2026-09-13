// Sprint 2, Hardening H1B (revisão final — blocker de cutover): nomes compartilhados entre
// storage/postgres-store.js e scripts/migrate-h1b-data.js para o marcador de migração de DADOS H1B,
// para nunca haver dois lugares com a chave/tabela grafada de formas diferentes.
//
// "migration de SCHEMA" (schema_migrations, aplicada por `npm run migrate`) é DIFERENTE de "migração de
// DADOS" (este marcador, gravado só por `scripts/migrate-h1b-data.js` depois que users/legalProcesses/
// legalDeadlines/audit foram efetivamente extraídos do app_store para as tabelas relacionais). A
// migration 004 cria a TABELA `data_migrations` vazia — a linha abaixo só existe depois do cutover real.
module.exports = {
  DATA_MIGRATIONS_TABLE: 'data_migrations',
  H1B_CORE_RELATIONAL_CUTOVER_KEY: 'h1b_core_relational_cutover'
};
