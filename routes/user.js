/* ============================================================
   Route: /api/user
   Handles: Get & Update user game state, Profile, & Password
   Storage: JSON file (data/users.json)
   ============================================================ */

const express = require('express');
const bcrypt = require('bcryptjs');
const { readDB, writeDB } = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// XP required per level (level 1 → 2 = 100 XP, etc.)
const XP_PER_LEVEL = (level) => level * 100;

// ── GET /api/user/:id ─────────────────────────────────────────
// Returns full game state for a user (excludes passwordHash)
router.get('/:id', verifyToken, (req, res) => {
  const users = readDB('users');
  const user  = users.find(u => u.id === req.params.id);

  if (!user) return res.status(404).json({ error: 'User not found' });

  const { passwordHash: _, ...safeUser } = user;
  res.json({ user: safeUser });
});

// ── PATCH /api/user/:id/profile ──────────────────────────────
// Update profile fields: fullName, phone, email
router.patch('/:id/profile', verifyToken, async (req, res) => {
  try {
    const { fullName, phone, email } = req.body;
    const users = readDB('users');
    const idx = users.findIndex(u => u.id === req.params.id);

    if (idx === -1) return res.status(404).json({ error: 'User not found' });

    const user = users[idx];

    if (email && email.trim()) {
      const cleanEmail = email.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(cleanEmail)) {
        return res.status(400).json({ error: 'Please enter a valid email address.' });
      }
      const existing = users.find(u => u.id !== req.params.id && u.email && u.email.toLowerCase() === cleanEmail);
      if (existing) {
        return res.status(409).json({ error: 'This email is already registered to another account.' });
      }
      user.email = cleanEmail;
    }

    if (fullName && fullName.trim()) user.fullName = fullName.trim();
    if (phone !== undefined) user.phone = phone.trim();

    users[idx] = user;
    writeDB('users', users);

    const { passwordHash: _, ...safeUser } = user;
    res.json({ message: 'Profile updated successfully!', user: safeUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/user/:id/change-password ───────────────────────
// Change password with current password verification
router.post('/:id/change-password', verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required.' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
    }

    const users = readDB('users');
    const idx = users.findIndex(u => u.id === req.params.id);

    if (idx === -1) return res.status(404).json({ error: 'User not found' });

    const user = users[idx];

    // Verify current password
    if (user.passwordHash) {
      const match = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!match) {
        return res.status(400).json({ error: 'Current password is incorrect.' });
      }
    }

    // Update password hash
    const newHash = await bcrypt.hash(newPassword, 10);
    user.passwordHash = newHash;

    users[idx] = user;
    writeDB('users', users);

    res.json({ message: 'Password updated successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/user/:id ───────────────────────────────────────
// Update game state: XP, coins, level, HP, avatar, etc.
router.patch('/:id', verifyToken, (req, res) => {
  try {
    const users = readDB('users');
    const idx   = users.findIndex(u => u.id === req.params.id);

    if (idx === -1) return res.status(404).json({ error: 'User not found' });

    const updates = req.body;
    const user    = users[idx];

    if (updates.stats) {
      user.stats = { ...user.stats, ...updates.stats };
      delete updates.stats;
    }
    if (updates.avatar) {
      user.avatar = { ...user.avatar, ...updates.avatar };
      delete updates.avatar;
    }

    Object.assign(user, updates);

    while (user.xp >= XP_PER_LEVEL(user.level)) {
      user.xp    -= XP_PER_LEVEL(user.level);
      user.level += 1;
      user.coins += 50;
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
