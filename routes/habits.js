/* ============================================================
   Route: /api/habits
   Handles: List, create, update, streak-tracking habits
   Storage: Neon PostgreSQL
   ============================================================ */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

function isNewDay(lastCompleted) {
  if (!lastCompleted) return true;
  const last  = new Date(lastCompleted).toDateString();
  const today = new Date().toDateString();
  return last !== today;
}

// ── GET /api/habits/:userId ───────────────────────────────────
router.get('/:userId', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM habits WHERE user_id = $1 ORDER BY created_at ASC`,
      [req.params.userId]
    );
    const habits = result.rows.map(h => ({
      id: h.id,
      name: h.name,
      difficulty: h.difficulty,
      streak: h.streak,
      lastCompleted: h.last_completed || ''
    }));
    res.json({ habits });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/habits/:userId ──────────────────────────────────
router.post('/:userId', verifyToken, async (req, res) => {
  try {
    const { name, difficulty = 'medium' } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const userCheck = await db.query(`SELECT id FROM users WHERE id = $1`, [req.params.userId]);
    if (!userCheck.rows.length) return res.status(404).json({ error: 'User not found' });

    const id = uuidv4();
    const result = await db.query(
      `INSERT INTO habits (id, user_id, name, difficulty, streak) VALUES ($1, $2, $3, $4, 0) RETURNING *`,
      [id, req.params.userId, name, difficulty]
    );
    const habit = result.rows[0];
    res.status(201).json({
      message: 'Habit created!',
      habit: { id: habit.id, name: habit.name, difficulty: habit.difficulty, streak: habit.streak, lastCompleted: '' }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/habits/:userId/:habitId/complete ───────────────
router.patch('/:userId/:habitId/complete', verifyToken, async (req, res) => {
  try {
    const { userId, habitId } = req.params;

    const habitRes = await db.query(
      `SELECT * FROM habits WHERE id = $1 AND user_id = $2`, [habitId, userId]
    );
    if (!habitRes.rows.length) return res.status(404).json({ error: 'Habit not found' });
    const habit = habitRes.rows[0];

    if (!isNewDay(habit.last_completed)) {
      return res.status(400).json({ error: 'Habit already completed today!' });
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const lastWasYesterday = habit.last_completed &&
      new Date(habit.last_completed).toDateString() === yesterday.toDateString();

    const newStreak = lastWasYesterday ? habit.streak + 1 : 1;
    const now = new Date().toISOString();

    const updated = await db.query(
      `UPDATE habits SET streak = $1, last_completed = $2 WHERE id = $3 RETURNING *`,
      [newStreak, now, habitId]
    );

    // XP reward
    const xpBonus = habit.difficulty === 'hard' ? 30 : habit.difficulty === 'medium' ? 20 : 10;

    const userRes = await db.query(`SELECT xp, stats FROM users WHERE id = $1`, [userId]);
    const user = userRes.rows[0];
    const stats = { ...user.stats };
    if (newStreak > (stats.maxHabitStreak || 0)) stats.maxHabitStreak = newStreak;

    await db.query(
      `UPDATE users SET xp = xp + $1, stats = $2, updated_at = NOW() WHERE id = $3`,
      [xpBonus, JSON.stringify(stats), userId]
    );

    const h = updated.rows[0];
    res.json({
      message: `🔥 Streak: ${newStreak} days!`,
      habit: { id: h.id, name: h.name, difficulty: h.difficulty, streak: h.streak, lastCompleted: h.last_completed },
      xpEarned: xpBonus
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/habits/:userId/:habitId ───────────────────────
router.delete('/:userId/:habitId', verifyToken, async (req, res) => {
  try {
    await db.query(
      `DELETE FROM habits WHERE id = $1 AND user_id = $2`,
      [req.params.habitId, req.params.userId]
    );
    res.json({ message: 'Habit removed.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
