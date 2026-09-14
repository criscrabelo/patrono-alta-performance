const fs = require('node:fs');
const path = require('node:path');

function configured() { return Boolean(process.env.DATABASE_URL); }
function pool() {
  if (!configured()) return null;
  const { Pool } = require('pg');
  const p = new Pool({ connectionString: process.env.DATABASE_URL, max: 10, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false });
  // P0 (branch demo — correção de crash observado no sync Monday/Postgres): mesmo risco de
  // storage/postgres-store.js — um client ocioso deste pool que perde a conexão emite 'error' de forma
  // assíncrona; sem listener, vira uncaughtException e derruba o processo/script inteiro. Estes pools são
  // de curta duração (scripts administrativos, sempre fechados com `.end()`), mas o risco existe enquanto
  // o pool está aberto — nunca deixar sem handler.
  p.on('error', (error) => { console.error(`[database] erro de conexão idle no pool (não fatal): ${error.message}`); });
  return p;
}
async function query(text, params) { const p = pool(); if (!p) throw new Error('DATABASE_URL não configurada'); try { return await p.query(text, params); } finally { await p.end(); } }
module.exports = { configured, pool, query };
