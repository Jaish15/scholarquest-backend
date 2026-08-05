/* ============================================================
   ScholarQuest — Main Express Server
   MSc IT Mini Project 2026 | Author: Jaish15
   ============================================================
   Architecture note:
   - Currently uses JSON file storage (data/*.json)
   - TODO: Replace with MongoDB (mongoose) when ready
     Steps: npm install mongoose, update db.js, swap
     require('./data/...') with mongoose model calls
   ============================================================ */

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

// ── Route Imports ─────────────────────────────────────────────
const authRoutes        = require('./routes/auth');
const userRoutes        = require('./routes/user');
const quizRoutes        = require('./routes/quiz');
const habitRoutes       = require('./routes/habits');
const leaderboardRoutes = require('./routes/leaderboard');

// ── App Setup ─────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',  // lock down in prod
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Health Check ──────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: '⚔️ ScholarQuest API is running!',
    version: '1.0.0',
    docs: 'See README.md for all endpoints'
  });
});

// ── API Routes ────────────────────────────────────────────────
app.use('/api/auth',        authRoutes);
app.use('/api/user',        userRoutes);
app.use('/api/quizzes',     quizRoutes);
app.use('/api/habits',      habitRoutes);
app.use('/api/leaderboard', leaderboardRoutes);

// ── 404 Handler ───────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found', path: req.path });
});

// ── Global Error Handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

// ── Start Server ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n⚔️  ScholarQuest API running at http://localhost:${PORT}`);
  console.log(`📦  Storage: JSON files (data/*.json)`);
  console.log(`🔄  TODO: Swap to MongoDB — see README.md\n`);
});

module.exports = app;
