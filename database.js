const fs = require('node:fs');
const path = require('node:path');

function configured() { return Boolean(process.env.DATABASE_URL); }
function pool() {
  if (!configured()) return null;
  const { Pool } = require('pg');
  return new Pool({ connectionString: process.env.DATABASE_URL, max: 10, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false });
}
async function query(text, params) { const p = pool(); if (!p) throw new Error('DATABASE_URL não configurada'); try { return await p.query(text, params); } finally { await p.end(); } }
module.exports = { configured, pool, query };
