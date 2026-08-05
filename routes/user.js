/* ============================================================
   Route: /api/user
   Handles: Get & Update user game state (XP, coins, level, etc)
   Storage: JSON file (data/users.json)
   TODO: Replace readDB/writeDB with Mongoose User model
   ============================================================ */

const express = require('express');
const { readDB, writeDB } = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// XP required per level (level 1 → 2 = 100 XP, etc.)
const XP_PER_LEVEL = (level) => level * 100;

// ── GET /api/user/:id ─────────────────────────────────────────
// Returns full game state for a user (excludes passwordHash)
router.get('/:id', verifyToken, (req, res) => {
  // TODO (MongoDB): User.findById(req.params.id).select('-passwordHash')
  const users = readDB('users');
  const user  = users.find(u => u.id === req.params.id);

  if (!user) return res.status(404).json({ error: 'User not found' });

  const { passwordHash: _, ...safeUser } = user;
  res.json({ user: safeUser });
});

// ── PATCH /api/user/:id ───────────────────────────────────────
// Update game state: XP, coins, level, HP, avatar, etc.
// Body: any subset of the user state object
router.patch('/:id', verifyToken, (req, res) => {
  try {
    // TODO (MongoDB): User.findByIdAndUpdate(req.params.id, req.body, { new: true })
    const users = readDB('users');
    const idx   = users.findIndex(u => u.id === req.params.id);

    if (idx === -1) return res.status(404).json({ error: 'User not found' });

    // Merge incoming update fields
    const updates = req.body;
    const user    = users[idx];

    // Deep-merge stats if provided
    if (updates.stats) {
      user.stats = { ...user.stats, ...updates.stats };
      delete updates.stats;
    }
    // Deep-merge avatar if provided
    if (updates.avatar) {
      user.avatar = { ...user.avatar, ...updates.avatar };
      delete updates.avatar;
    }

    Object.assign(user, updates);

    // Auto level-up check
    while (user.xp >= XP_PER_LEVEL(user.level)) {
      user.xp    -= XP_PER_LEVEL(user.level);
      user.level += 1;
      user.coins += 50; // level-up bonus coins
    }

    users[idx] = user;
    writeDB('users', users);

    const { passwordHash: _, ...safeUser } = user;
    res.json({ message: 'State updated!', user: safeUser });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
