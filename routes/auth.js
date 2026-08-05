/* ============================================================
   Route: /api/auth
   Handles: Register & Login
   Storage: JSON file (data/users.json)
   TODO: Replace readDB/writeDB with Mongoose User model
   ============================================================ */

const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { readDB, writeDB } = require('../db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'scholarquest_secret_change_in_prod';

// ── POST /api/auth/register ───────────────────────────────────
// Body: { username, email, password }
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Validation
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'username, email and password are required' });
    }

    // TODO (MongoDB): User.findOne({ email })
    const users = readDB('users');
    const existing = users.find(u => u.email === email || u.username === username);
    if (existing) {
      return res.status(409).json({ error: 'User already exists with that email or username' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user with default ScholarQuest state
    const newUser = {
      id: uuidv4(),
      username,
      email,
      passwordHash,
      createdAt: new Date().toISOString(),
      // ── ScholarQuest game state ──
      level: 1,
      xp: 0,
      coins: 150,
      hp: 100,
      maxHp: 100,
      avatar: { id: 'peasant' },
      inventory: ['basic_book'],
      equipped: { head: 'none', hand: 'none' },
      stats: {
        quizzesCompleted: 0,
        focusMinutes: 0,
        lessonsCompleted: 0,
        maxHabitStreak: 0
      },
      activeTheme: 'gold',
      habits: [
        { id: uuidv4(), name: 'Solve 1 DSA Problem', difficulty: 'medium', streak: 0, lastCompleted: '' },
        { id: uuidv4(), name: 'Attend Lecture / Study 1 hour', difficulty: 'easy', streak: 0, lastCompleted: '' },
        { id: uuidv4(), name: 'Write code in Python / JS', difficulty: 'hard', streak: 0, lastCompleted: '' }
      ]
    };

    // TODO (MongoDB): await new User(newUser).save()
    users.push(newUser);
    writeDB('users', users);

    // Return token (exclude passwordHash)
    const token = jwt.sign({ id: newUser.id, username }, JWT_SECRET, { expiresIn: '7d' });
    const { passwordHash: _, ...safeUser } = newUser;

    res.status(201).json({
      message: '⚔️ Scholar registered! Your quest begins.',
      token,
      user: safeUser
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/login ─────────────────────────────────────
// Body: { email, username, identifier, password }
router.post('/login', async (req, res) => {
  try {
    const { email, username, identifier, password } = req.body;
    const loginId = (identifier || email || username || '').trim();

    if (!loginId || !password) {
      return res.status(400).json({ error: 'Email or Username and Password are required' });
    }

    // TODO (MongoDB): User.findOne({ $or: [{ email: loginId }, { username: loginId }] })
    const users = readDB('users');
    const user  = users.find(u =>
      (u.email && u.email.toLowerCase() === loginId.toLowerCase()) ||
      (u.username && u.username.toLowerCase() === loginId.toLowerCase())
    );

    if (!user) {
      return res.status(401).json({ error: 'Invalid email/username or password' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email/username or password' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    const { passwordHash: _, ...safeUser } = user;

    res.json({
      message: `Welcome back, ${user.username}! 🏹`,
      token,
      user: safeUser
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/forgot-password ───────────────────────────
// Body: { email }
router.post('/forgot-password', (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const users = readDB('users');
    const userIndex = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase());

    if (userIndex === -1) {
      return res.status(404).json({ error: 'No scholar account found with this email' });
    }

    // Generate a 6-digit recovery code & expiry (15 mins)
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const resetExpires = Date.now() + 15 * 60 * 1000;

    users[userIndex].resetCode = resetCode;
    users[userIndex].resetExpires = resetExpires;

    writeDB('users', users);

    res.json({
      message: '⚔️ Recovery code dispatched!',
      resetCode, // Returned for instant demo testing
      expiresIn: '15 minutes'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/reset-password ────────────────────────────
// Body: { email, resetCode, newPassword }
router.post('/reset-password', async (req, res) => {
  try {
    const { email, resetCode, newPassword } = req.body;
    if (!email || !resetCode || !newPassword) {
      return res.status(400).json({ error: 'Email, reset code, and new password are required' });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }

    const users = readDB('users');
    const userIndex = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase());

    if (userIndex === -1) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const user = users[userIndex];

    if (!user.resetCode || user.resetCode !== resetCode.trim()) {
      return res.status(400).json({ error: 'Invalid recovery code' });
    }

    if (Date.now() > user.resetExpires) {
      return res.status(400).json({ error: 'Recovery code has expired. Request a new one.' });
    }

    // Update password
    const newHash = await bcrypt.hash(newPassword, 10);
    users[userIndex].passwordHash = newHash;
    delete users[userIndex].resetCode;
    delete users[userIndex].resetExpires;

    writeDB('users', users);

    res.json({
      message: '🔑 Password reset successfully! You can now log in.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

