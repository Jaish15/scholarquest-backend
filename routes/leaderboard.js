/* ============================================================
   Route: /api/leaderboard
   Handles: Top users ranked by XP / level
   Storage: Neon PostgreSQL
   ============================================================ */

const express = require('express');
const db = require('../db');

const router = express.Router();

// ── GET /api/leaderboard ──────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT id, username, level, xp, coins, stats, avatar
      FROM users
      ORDER BY level DESC, xp DESC
      LIMIT 10
    `);

    const leaderboard = result.rows.map(u => ({
      id: u.id,
      username: u.username,
      level: u.level || 1,
      xp: u.xp || 0,
      coins: u.coins || 0,
      quizzesCompleted: u.stats?.quizzesCompleted || 0,
      maxHabitStreak: u.stats?.maxHabitStreak || 0,
      avatar: u.avatar || { id: 'peasant' }
    }));

    res.json({ leaderboard });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
