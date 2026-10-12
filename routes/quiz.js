/* ============================================================
   Route: /api/quizzes
   Handles: List quizzes, submit answers, earn XP
   Storage: Neon PostgreSQL
   ============================================================ */

const express = require('express');
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

const REWARDS = {
  easy:   { xp: 20,  coins: 10 },
  medium: { xp: 40,  coins: 20 },
  hard:   { xp: 80,  coins: 40 }
};

const XP_PER_LEVEL = (level) => level * 100;

// ── GET /api/quizzes ──────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const quizzesRes = await db.query(`SELECT * FROM quizzes ORDER BY created_at DESC`);
    const quizIds = quizzesRes.rows.map(q => q.id);

    if (!quizIds.length) return res.json({ quizzes: [] });

    const questionsRes = await db.query(
      `SELECT * FROM quiz_questions WHERE quiz_id = ANY($1) ORDER BY sort_order ASC`,
      [quizIds]
    );

    const questionsByQuiz = {};
    for (const q of questionsRes.rows) {
      if (!questionsByQuiz[q.quiz_id]) questionsByQuiz[q.quiz_id] = [];
      questionsByQuiz[q.quiz_id].push({
        id: q.id,
        question: q.question,
        options: q.options,
        correctAnswer: q.correct_answer
      });
    }

    const quizzes = quizzesRes.rows.map(q => ({
      id: q.id,
      title: q.title,
      description: q.description,
      difficulty: q.difficulty,
      domain: q.domain,
      tags: q.tags,
      questions: questionsByQuiz[q.id] || []
    }));

    res.json({ quizzes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/quizzes/:id ──────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const quizRes = await db.query(`SELECT * FROM quizzes WHERE id = $1`, [req.params.id]);
    if (!quizRes.rows.length) return res.status(404).json({ error: 'Quiz not found' });

    const questionsRes = await db.query(
      `SELECT * FROM quiz_questions WHERE quiz_id = $1 ORDER BY sort_order ASC`,
      [req.params.id]
    );

    const quiz = {
      ...quizRes.rows[0],
      questions: questionsRes.rows.map(q => ({
        id: q.id,
        question: q.question,
        options: q.options,
        correctAnswer: q.correct_answer
      }))
    };

    res.json({ quiz });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/quizzes/submit ──────────────────────────────────
router.post('/submit', verifyToken, async (req, res) => {
  try {
    const { quizId, answers = [], userId } = req.body;

    const quizRes = await db.query(`SELECT * FROM quizzes WHERE id = $1`, [quizId]);
    if (!quizRes.rows.length) return res.status(404).json({ error: 'Quiz not found' });
    const quiz = quizRes.rows[0];

    const questionsRes = await db.query(
      `SELECT * FROM quiz_questions WHERE quiz_id = $1`, [quizId]
    );
    const questions = questionsRes.rows;

    // Grade answers
    let score = 0;
    const graded = answers.map(ans => {
      const question = questions.find(q => q.id === ans.questionId);
      const correct = question && question.correct_answer === ans.selectedOption;
      if (correct) score++;
      return { questionId: ans.questionId, correct, correctAnswer: question?.correct_answer };
    });

    const total       = questions.length;
    const perfect     = score === total;
    const reward      = REWARDS[quiz.difficulty] || REWARDS.medium;
    const xpEarned    = Math.round(reward.xp    * (score / total));
    const coinsEarned = Math.round(reward.coins  * (score / total));

    // Update user stats
    if (userId) {
      const userRes = await db.query(`SELECT * FROM users WHERE id = $1`, [userId]);
      if (userRes.rows.length) {
        const user = userRes.rows[0];
        let xp    = (user.xp    || 0) + xpEarned;
        let coins = (user.coins || 0) + coinsEarned;
        let level = user.level || 1;
        const stats = { ...user.stats, quizzesCompleted: ((user.stats?.quizzesCompleted || 0) + 1) };

        // Auto level-up
        while (xp >= XP_PER_LEVEL(level)) {
          xp    -= XP_PER_LEVEL(level);
          level += 1;
          coins += 50;
        }

        await db.query(
          `UPDATE users SET xp = $1, coins = $2, level = $3, stats = $4, updated_at = NOW() WHERE id = $5`,
          [xp, coins, level, JSON.stringify(stats), userId]
        );
      }
    }

    res.json({
      message: perfect ? '🏆 Perfect Score! Quest Cleared!' : '✅ Quiz submitted!',
      score, total, perfect, xpEarned, coinsEarned, graded
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
