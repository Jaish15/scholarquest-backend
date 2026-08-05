/* ============================================================
   Route: /api/habits
   Handles: List, create, update, streak-tracking habits
   Storage: JSON file (data/users.json, per-user habits array)
   TODO: Replace with Mongoose Habit model (or embed in User)
   ============================================================ */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, writeDB } = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// Helper: check if today's date differs from lastCompleted
function isNewDay(lastCompleted) {
  if (!lastCompleted) return true;
  const last  = new Date(lastCompleted).toDateString();
  const today = new Date().toDateString();
  return last !== today;
}

// ── GET /api/habits/:userId ───────────────────────────────────
router.get('/:userId', verifyToken, (req, res) => {
  const users = readDB('users');
  const user  = users.find(u => u.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ habits: user.habits || [] });
});

// ── POST /api/habits/:userId ──────────────────────────────────
// Body: { name, difficulty }
router.post('/:userId', verifyToken, (req, res) => {
  try {
    const { name, difficulty = 'medium' } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const users = readDB('users');
    const idx   = users.findIndex(u => u.id === req.params.userId);
    if (idx === -1) return res.status(404).json({ error: 'User not found' });

    const newHabit = { id: uuidv4(), name, difficulty, streak: 0, lastCompleted: '' };
    users[idx].habits = [...(users[idx].habits || []), newHabit];
    writeDB('users', users);

    res.status(201).json({ message: 'Habit created!', habit: newHabit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/habits/:userId/:habitId/complete ───────────────
// Marks habit as completed today, updates streak
router.patch('/:userId/:habitId/complete', verifyToken, (req, res) => {
  try {
    const users = readDB('users');
    const idx   = users.findIndex(u => u.id === req.params.userId);
    if (idx === -1) return res.status(404).json({ error: 'User not found' });

    const habits  = users[idx].habits || [];
    const hIdx    = habits.findIndex(h => h.id === req.params.habitId);
    if (hIdx === -1) return res.status(404).json({ error: 'Habit not found' });

    const habit = habits[hIdx];

    if (!isNewDay(habit.lastCompleted)) {
      return res.status(400).json({ error: 'Habit already completed today!' });
    }

    // Streak logic: consecutive days = streak++, else reset to 1
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const lastWasYesterday = habit.lastCompleted &&
      new Date(habit.lastCompleted).toDateString() === yesterday.toDateString();

    habit.streak       = lastWasYesterday ? habit.streak + 1 : 1;
    habit.lastCompleted = new Date().toISOString();

    // XP reward for completing habit
    const xpBonus = habit.difficulty === 'hard' ? 30 : habit.difficulty === 'medium' ? 20 : 10;
    users[idx].xp = (users[idx].xp || 0) + xpBonus;

    // Update maxHabitStreak stat
    if (!users[idx].stats) users[idx].stats = {};
    if (habit.streak > (users[idx].stats.maxHabitStreak || 0)) {
      users[idx].stats.maxHabitStreak = habit.streak;
    }

    habits[hIdx]      = habit;
    users[idx].habits = habits;
    writeDB('users', users);

    res.json({
      message: `🔥 Streak: ${habit.streak} days!`,
      habit,
      xpEarned: xpBonus
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/habits/:userId/:habitId ───────────────────────
router.delete('/:userId/:habitId', verifyToken, (req, res) => {
  try {
    const users = readDB('users');
    const idx   = users.findIndex(u => u.id === req.params.userId);
    if (idx === -1) return res.status(404).json({ error: 'User not found' });

    users[idx].habits = (users[idx].habits || []).filter(h => h.id !== req.params.habitId);
    writeDB('users', users);
    res.json({ message: 'Habit removed.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
