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
// Body: { email, password }
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    // TODO (MongoDB): User.findOne({ email })
    const users = readDB('users');
    const user  = users.find(u => u.email === email);

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
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

module.exports = router;
