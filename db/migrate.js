/* ============================================================
   ScholarQuest — JSON to PostgreSQL Migration Script
   Migrates existing data/users.json, quizzes.json,
   friendships.json, direct_messages.json,
   password_reset_tokens.json into Neon PostgreSQL.
   Run: node db/migrate.js
   ============================================================ */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const DATA_DIR = path.join(__dirname, '..', 'data');

function readJSON(filename) {
  const file = path.join(DATA_DIR, `${filename}.json`);
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

async function migrateUsers(client) {
  const users = readJSON('users');
  console.log(`\n👤 Migrating ${users.length} users...`);
  let ok = 0, skip = 0;

  for (const u of users) {
    try {
      await client.query(`
        INSERT INTO users (
          id, full_name, username, email, phone,
          password_hash, google_id, github_id, github_username,
          verified, level, xp, coins, hp, max_hp,
          avatar, inventory, equipped, stats, active_theme,
          leetcode_username, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$22)
        ON CONFLICT (id) DO NOTHING
      `, [
        u.id,
        u.fullName || u.full_name || '',
        u.username || '',
        u.email || '',
        u.phone || '',
        u.passwordHash || u.password_hash || '',
        u.googleId || u.google_id || '',
        u.githubId || u.github_id || '',
        u.githubUsername || u.github_username || '',
        u.verified !== undefined ? u.verified : true,
        u.level || 1,
        u.xp || 0,
        u.coins || 0,
        u.hp || 100,
        u.maxHp || u.max_hp || 100,
        JSON.stringify(u.avatar || { id: 'peasant' }),
        JSON.stringify(u.inventory || []),
        JSON.stringify(u.equipped || { head: 'none', hand: 'none', pet: 'none' }),
        JSON.stringify(u.stats || {}),
        u.activeTheme || u.active_theme || 'default',
        u.leetcodeUsername || u.leetcode_username || '',
        u.createdAt || u.created_at || new Date().toISOString()
      ]);

      // Migrate habits embedded in user
      if (u.habits && u.habits.length > 0) {
        for (const h of u.habits) {
          await client.query(`
            INSERT INTO habits (id, user_id, name, difficulty, streak, last_completed, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (id) DO NOTHING
          `, [
            h.id || `habit-${Date.now()}-${Math.random()}`,
            u.id,
            h.name || 'Habit',
            h.difficulty || 'medium',
            h.streak || 0,
            h.lastCompleted || null,
            new Date().toISOString()
          ]);
        }
      }
      ok++;
    } catch (err) {
      console.warn(`  ⚠️  Skipped user ${u.username}: ${err.message}`);
      skip++;
    }
  }
  console.log(`  ✅ Users: ${ok} migrated, ${skip} skipped`);
}

async function migrateQuizzes(client) {
  const quizzes = readJSON('quizzes');
  console.log(`\n📝 Migrating ${quizzes.length} quizzes...`);
  let ok = 0;

  for (const q of quizzes) {
    try {
      await client.query(`
        INSERT INTO quizzes (id, title, description, difficulty, domain, tags, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO NOTHING
      `, [
        q.id,
        q.title || 'Quiz',
        q.description || '',
        q.difficulty || 'medium',
        q.domain || 'general',
        JSON.stringify(q.tags || []),
        q.createdAt || new Date().toISOString()
      ]);

      if (q.questions && q.questions.length > 0) {
        for (let i = 0; i < q.questions.length; i++) {
          const qq = q.questions[i];
          await client.query(`
            INSERT INTO quiz_questions (id, quiz_id, question, options, correct_answer, sort_order)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO NOTHING
          `, [
            qq.id || `q-${q.id}-${i}`,
            q.id,
            qq.question || '',
            JSON.stringify(qq.options || []),
            qq.correctAnswer || qq.correct_answer || '',
            i
          ]);
        }
      }
      ok++;
    } catch (err) {
      console.warn(`  ⚠️  Skipped quiz ${q.id}: ${err.message}`);
    }
  }
  console.log(`  ✅ Quizzes: ${ok} migrated`);
}

async function migrateFriendships(client) {
  const list = readJSON('friendships');
  console.log(`\n👥 Migrating ${list.length} friendships...`);
  let ok = 0;

  for (const f of list) {
    try {
      await client.query(`
        INSERT INTO friendships (id, requester_id, recipient_id, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO NOTHING
      `, [
        f.id,
        f.requesterId || f.requester_id,
        f.recipientId || f.recipient_id,
        f.status || 'pending',
        f.createdAt || f.created_at || new Date().toISOString(),
        f.updatedAt || f.updated_at || new Date().toISOString()
      ]);
      ok++;
    } catch (err) {
      console.warn(`  ⚠️  Skipped friendship ${f.id}: ${err.message}`);
    }
  }
  console.log(`  ✅ Friendships: ${ok} migrated`);
}

async function migrateMessages(client) {
  const list = readJSON('direct_messages');
  console.log(`\n💬 Migrating ${list.length} direct messages...`);
  let ok = 0;

  for (const m of list) {
    try {
      await client.query(`
        INSERT INTO direct_messages (id, sender_id, recipient_id, text, attachment, read, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO NOTHING
      `, [
        m.id,
        m.senderId || m.sender_id,
        m.recipientId || m.recipient_id,
        m.text || '',
        m.attachment ? JSON.stringify(m.attachment) : null,
        m.read || false,
        m.timestamp || m.created_at || new Date().toISOString()
      ]);
      ok++;
    } catch (err) {
      console.warn(`  ⚠️  Skipped message ${m.id}: ${err.message}`);
    }
  }
  console.log(`  ✅ Messages: ${ok} migrated`);
}

async function migratePasswordResetTokens(client) {
  const list = readJSON('password_reset_tokens');
  console.log(`\n🔑 Migrating ${list.length} password reset tokens...`);
  let ok = 0;

  for (const t of list) {
    try {
      await client.query(`
        INSERT INTO password_reset_tokens (token, user_id, used, expires_at, created_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (token) DO NOTHING
      `, [
        t.token,
        t.userId || t.user_id,
        t.used || false,
        t.expiresAt || t.expires_at || new Date().toISOString(),
        t.createdAt || t.created_at || new Date().toISOString()
      ]);
      ok++;
    } catch (err) {
      console.warn(`  ⚠️  Skipped token: ${err.message}`);
    }
  }
  console.log(`  ✅ Tokens: ${ok} migrated`);
}

async function migrate() {
  console.log('🚀 ScholarQuest — JSON → PostgreSQL Migration');
  console.log('='.repeat(50));
  const client = await pool.connect();
  try {
    await migrateUsers(client);
    await migrateQuizzes(client);
    await migrateFriendships(client);
    await migrateMessages(client);
    await migratePasswordResetTokens(client);
    console.log('\n🎉 Migration complete! All data is now in PostgreSQL.');
  } catch (err) {
    console.error('\n❌ Migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
