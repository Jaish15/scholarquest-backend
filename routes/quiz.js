/* ============================================================
   Route: /api/quizzes
   Handles: List quizzes, submit answers, earn XP
   Storage: JSON file (data/quizzes.json)
   TODO: Replace readDB/writeDB with Mongoose Quiz model
   ============================================================ */

const express = require('express');
const { readDB, writeDB } = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// XP & Coin rewards per difficulty
const REWARDS = {
  easy:   { xp: 20,  coins: 10 },
  medium: { xp: 40,  coins: 20 },
  hard:   { xp: 80,  coins: 40 }
};

// ── GET /api/quizzes ──────────────────────────────────────────
// Returns all available quizzes (questions included)
router.get('/', (req, res) => {
  // TODO (MongoDB): Quiz.find({})
  const quizzes = readDB('quizzes');
  res.json({ quizzes });
});

// ── GET /api/quizzes/:id ──────────────────────────────────────
// Returns a single quiz by ID
router.get('/:id', (req, res) => {
  const quizzes = readDB('quizzes');
  const quiz    = quizzes.find(q => q.id === req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  res.json({ quiz });
});

// ── POST /api/quizzes/submit ──────────────────────────────────
// Body: { quizId, answers: [{ questionId, selectedOption }], userId }
// Returns: { score, total, xpEarned, coinsEarned }
router.post('/submit', verifyToken, (req, res) => {
  try {
    const { quizId, answers = [], userId } = req.body;

    const quizzes = readDB('quizzes');
    const quiz    = quizzes.find(q => q.id === quizId);
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

    // Grade answers
    let score = 0;
    const graded = answers.map(ans => {
      const question = quiz.questions.find(q => q.id === ans.questionId);
      const correct  = question && question.correctAnswer === ans.selectedOption;
      if (correct) score++;
      return { questionId: ans.questionId, correct, correctAnswer: question?.correctAnswer };
    });

    const total      = quiz.questions.length;
    const perfect    = score === total;
    const reward     = REWARDS[quiz.difficulty] || REWARDS.medium;
    const xpEarned   = Math.round(reward.xp   * (score / total));
    const coinsEarned= Math.round(reward.coins * (score / total));

    // Update user stats
    if (userId) {
      const users = readDB('users');
      const idx   = users.findIndex(u => u.id === userId);
      if (idx !== -1) {
        users[idx].xp    = (users[idx].xp    || 0) + xpEarned;
        users[idx].coins = (users[idx].coins  || 0) + coinsEarned;
        users[idx].stats = users[idx].stats || {};
        users[idx].stats.quizzesCompleted = (users[idx].stats.quizzesCompleted || 0) + 1;

        // Auto level-up
        const XP_PER_LEVEL = (level) => level * 100;
        while (users[idx].xp >= XP_PER_LEVEL(users[idx].level)) {
          users[idx].xp    -= XP_PER_LEVEL(users[idx].level);
          users[idx].level += 1;
          users[idx].coins += 50;
        }
        writeDB('users', users);
      }
    }

    res.json({
      message: perfect ? '🏆 Perfect Score! Quest Cleared!' : `✅ Quiz submitted!`,
      score, total, perfect, xpEarned, coinsEarned, graded
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
