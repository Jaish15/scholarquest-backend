/* ============================================================
   Route: /api/user
   Handles: Get & Update user game state, Profile, & Password
   Storage: Neon PostgreSQL
   ============================================================ */

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();
const XP_PER_LEVEL = (level) => level * 100;

function safeUser(row) {
  if (!row) return null;
  const { password_hash, ...rest } = row;
  return {
    id: rest.id,
    fullName: rest.full_name,
    username: rest.username,
    email: rest.email,
    phone: rest.phone || '',
    verified: rest.verified,
    level: rest.level,
    xp: rest.xp,
    coins: rest.coins,
    hp: rest.hp,
    maxHp: rest.max_hp,
    avatar: rest.avatar,
    inventory: rest.inventory,
    equipped: rest.equipped,
    stats: rest.stats,
    activeTheme: rest.active_theme,
    leetcodeUsername: rest.leetcode_username || '',
    createdAt: rest.created_at
  };
}

// ── GET /api/user/:id ─────────────────────────────────────────
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM users WHERE id = $1`, [req.params.id]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: safeUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/user/:id/profile ───────────────────────────────
router.patch('/:id/profile', verifyToken, async (req, res) => {
  try {
    const { fullName, phone, email } = req.body;
    const userId = req.params.id;

    const current = await db.query(`SELECT * FROM users WHERE id = $1`, [userId]);
    if (!current.rows.length) return res.status(404).json({ error: 'User not found' });

    let newEmail = current.rows[0].email;
    if (email && email.trim()) {
      const cleanEmail = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({ error: 'Please enter a valid email address.' });
      }
      const dup = await db.query(`SELECT id FROM users WHERE LOWER(email) = $1 AND id != $2`, [cleanEmail, userId]);
      if (dup.rows.length) return res.status(409).json({ error: 'This email is already registered to another account.' });
      newEmail = cleanEmail;
    }

    const result = await db.query(`
      UPDATE users SET
        full_name  = COALESCE(NULLIF($1, ''), full_name),
        phone      = COALESCE($2, phone),
        email      = $3,
        updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `, [fullName?.trim() || '', phone ?? current.rows[0].phone, newEmail, userId]);

    res.json({ message: 'Profile updated successfully!', user: safeUser(result.rows[0]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/user/:id/change-password ────────────────────────
router.post('/:id/change-password', verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current password and new password are required.' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters long.' });

    const result = await db.query(`SELECT * FROM users WHERE id = $1`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    const user = result.rows[0];

    if (user.password_hash) {
      const stored = user.password_hash;
      let match = (stored === currentPassword);
      if (!match && stored.startsWith('$2')) {
        match = await bcrypt.compare(currentPassword, stored);
      }
      if (!match) return res.status(400).json({ error: 'Current password is incorrect.' });
    }

    const newHash = newPassword;
    await db.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [newHash, req.params.id]);

    res.json({ message: 'Password updated successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/user/:id ───────────────────────────────────────
// Update game state: XP, coins, level, HP, avatar, stats, etc.
router.patch('/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.params.id;
    const current = await db.query(`SELECT * FROM users WHERE id = $1`, [userId]);
    if (!current.rows.length) return res.status(404).json({ error: 'User not found' });

    const u = current.rows[0];
    const updates = req.body;

    let level    = u.level;
    let xp       = updates.xp !== undefined ? updates.xp : u.xp;
    let coins    = updates.coins !== undefined ? updates.coins : u.coins;
    let hp       = updates.hp !== undefined ? updates.hp : u.hp;
    let maxHp    = updates.maxHp !== undefined ? updates.maxHp : u.max_hp;
    let avatar   = updates.avatar ? { ...u.avatar, ...updates.avatar } : u.avatar;
    let equipped = updates.equipped ? { ...u.equipped, ...updates.equipped } : u.equipped;
    let inventory = updates.inventory || u.inventory;
    let stats    = updates.stats ? { ...u.stats, ...updates.stats } : u.stats;
    let activeTheme = updates.activeTheme || u.active_theme;
    let leetcodeUsername = updates.leetcodeUsername !== undefined ? updates.leetcodeUsername : u.leetcode_username;

    // Auto level-up
    while (xp >= XP_PER_LEVEL(level)) {
      xp    -= XP_PER_LEVEL(level);
      level += 1;
      coins += 50;
    }

    const result = await db.query(`
      UPDATE users SET
        level              = $1,
        xp                 = $2,
        coins              = $3,
        hp                 = $4,
        max_hp             = $5,
        avatar             = $6,
        equipped           = $7,
        inventory          = $8,
        stats              = $9,
        active_theme       = $10,
        leetcode_username  = $11,
        updated_at         = NOW()
      WHERE id = $12
      RETURNING *
    `, [level, xp, coins, hp, maxHp,
        JSON.stringify(avatar), JSON.stringify(equipped), JSON.stringify(inventory),
        JSON.stringify(stats), activeTheme, leetcodeUsername, userId]);

    res.json({ message: 'State updated!', user: safeUser(result.rows[0]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
