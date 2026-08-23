/* ============================================================
   Route: /api/leaderboard
   Handles: Top users ranked by XP / level
   Storage: JSON file (data/users.json)
   TODO: Replace readDB with Mongoose User.find().sort(...)
   ============================================================ */

const express = require('express');
const { readDB } = require('../db');

const router = express.Router();

// ── GET /api/leaderboard ──────────────────────────────────────
// Returns top 10 users sorted by level desc, then xp desc
router.get('/', (req, res) => {
  try {
    const users = readDB('users');

    const leaderboard = users
      .map(u => ({
        id: u.id,
        username: u.username,
        level: u.level || 1,
        xp: u.xp || 0,
        coins: u.coins || 0,
        quizzesCompleted: u.stats?.quizzesCompleted || 0,
        maxHabitStreak: u.stats?.maxHabitStreak || 0,
        avatar: u.avatar || { id: 'peasant' }
      }))
      .sort((a, b) => b.level - a.level || b.xp - a.xp)
      .slice(0, 10);

    res.json({ leaderboard });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
