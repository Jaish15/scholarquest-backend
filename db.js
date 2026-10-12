/* ============================================================
   ScholarQuest — PostgreSQL Database Connection
   Uses Neon serverless PostgreSQL via DATABASE_URL
   ============================================================ */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client:', err.message);
});

/**
 * Run a SQL query
 * @param {string} text - SQL query string
 * @param {Array}  params - Query parameters
 */
async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.DB_LOGGING === 'true') {
    console.log(`[DB] query: ${text} | duration: ${duration}ms | rows: ${res.rowCount}`);
  }
  return res;
}

/**
 * Get a client from the pool (for transactions)
 */
function getClient() {
  return pool.connect();
}

module.exports = { query, getClient, pool };
