/* ============================================================
   ScholarQuest — Database Setup Script
   Creates all tables on the Neon PostgreSQL database
   Run: node db/setup.js
   ============================================================ */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function setup() {
  const client = await pool.connect();
  try {
    console.log('🔌 Connected to Neon PostgreSQL...');
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(sql);
    console.log('✅ All tables created successfully!');
  } catch (err) {
    console.error('❌ Setup failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

setup();
