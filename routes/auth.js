/* ============================================================
   Route: /api/auth
   Handles: Register, Login, Google/GitHub OAuth, OTP, Password Reset
   Storage: Neon PostgreSQL
   ============================================================ */

const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const { Resend } = require('resend');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'scholarquest_secret_change_in_prod';
const getResend = () => new Resend(process.env.RESEND_API_KEY);

const BACKEND_URL = (process.env.BACKEND_URL || (process.env.NODE_ENV === 'production' || process.env.RENDER ? 'https://scholarquest-backend.onrender.com' : 'http://localhost:3000')).replace(/\/+$/, '');
const GOOGLE_CALLBACK = process.env.GOOGLE_CALLBACK_URL || `${BACKEND_URL}/api/auth/google/callback`;
const GITHUB_CALLBACK = process.env.GITHUB_CALLBACK_URL || `${BACKEND_URL}/api/auth/github/callback`;

function makeToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, username: user.username },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function safeUser(row) {
  if (!row) return null;
  const { password_hash, ...rest } = row;
  return {
    id: rest.id,
    fullName: rest.full_name,
    username: rest.username,
    email: rest.email,
    phone: rest.phone || '',
    googleId: rest.google_id || '',
    githubId: rest.github_id || '',
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

// ── Google OAuth Strategy ──────────────────────────────────────
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: GOOGLE_CALLBACK,
    proxy: true
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value?.toLowerCase().trim();
      if (!email) return done(new Error('No email found in Google profile'), null);

      const existing = await db.query(
        `SELECT * FROM users WHERE email = $1 OR google_id = $2 LIMIT 1`,
        [email, profile.id]
      );
      let user = existing.rows[0];

      if (!user) {
        const cleanName = profile.displayName || 'Google Scholar';
        const baseUsername = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '') || 'scholar';
        let uniqueUsername = baseUsername;
        let counter = 1;
        while (true) {
          const check = await db.query(`SELECT id FROM users WHERE LOWER(username) = LOWER($1)`, [uniqueUsername]);
          if (!check.rows.length) break;
          uniqueUsername = `${baseUsername}${counter++}`;
        }
        return done(null, {
          isNew: true, provider: 'google', providerId: profile.id,
          email, fullName: cleanName, suggestedUsername: uniqueUsername
        });
      } else {
        if (!user.google_id) {
          await db.query(`UPDATE users SET google_id = $1, updated_at = NOW() WHERE id = $2`, [profile.id, user.id]);
        }
        return done(null, user);
      }
    } catch (err) {
      return done(err, null);
    }
  }));
}

// ── GitHub OAuth Strategy ──────────────────────────────────────
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  passport.use(new GitHubStrategy({
    clientID: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL: GITHUB_CALLBACK,
    proxy: true,
    scope: ['user:email']
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const emails = profile.emails || [];
      const email = (emails.find(e => e.primary)?.value || emails[0]?.value || '').toLowerCase().trim();
      if (!email) return done(new Error('No email found in GitHub profile'), null);

      const existing = await db.query(
        `SELECT * FROM users WHERE email = $1 OR github_id = $2 LIMIT 1`,
        [email, String(profile.id)]
      );
      let user = existing.rows[0];

      if (!user) {
        const cleanName = profile.displayName || profile.username || 'GitHub Scholar';
        const baseUsername = (profile.username || email.split('@')[0]).replace(/[^a-zA-Z0-9_]/g, '') || 'scholar';
        let uniqueUsername = baseUsername;
        let counter = 1;
        while (true) {
          const check = await db.query(`SELECT id FROM users WHERE LOWER(username) = LOWER($1)`, [uniqueUsername]);
          if (!check.rows.length) break;
          uniqueUsername = `${baseUsername}${counter++}`;
        }
        return done(null, {
          isNew: true, provider: 'github', providerId: String(profile.id),
          email, fullName: cleanName, suggestedUsername: uniqueUsername,
          githubUsername: profile.username
        });
      } else {
        if (!user.github_id) {
          await db.query(
            `UPDATE users SET github_id = $1, github_username = $2, updated_at = NOW() WHERE id = $3`,
            [String(profile.id), profile.username || '', user.id]
          );
        }
        return done(null, user);
      }
    } catch (err) {
      return done(err, null);
    }
  }));
}

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// ── GET /api/auth/google ───────────────────────────────────────
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'], session: false }));

// ── GET /api/auth/google/callback ─────────────────────────────
router.get('/google/callback', passport.authenticate('google', { session: false, failureRedirect: '/?error=google_auth_failed' }),
  async (req, res) => {
    const user = req.user;
    const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:5500';
    if (user.isNew) {
      const params = new URLSearchParams({
        oauth_pending: '1', provider: 'google', providerId: user.providerId,
        email: user.email, fullName: user.fullName, suggestedUsername: user.suggestedUsername
      });
      return res.redirect(`${FRONTEND}?${params.toString()}#signup`);
    }
    const token = makeToken(user);
    return res.redirect(`${FRONTEND}?token=${token}&userId=${user.id}#dashboard`);
  }
);

// ── GET /api/auth/github ───────────────────────────────────────
router.get('/github', passport.authenticate('github', { scope: ['user:email'], session: false }));

// ── GET /api/auth/github/callback ─────────────────────────────
router.get('/github/callback', passport.authenticate('github', { session: false, failureRedirect: '/?error=github_auth_failed' }),
  async (req, res) => {
    const user = req.user;
    const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:5500';
    if (user.isNew) {
      const params = new URLSearchParams({
        oauth_pending: '1', provider: 'github', providerId: user.providerId,
        email: user.email, fullName: user.fullName, suggestedUsername: user.suggestedUsername,
        githubUsername: user.githubUsername || ''
      });
      return res.redirect(`${FRONTEND}?${params.toString()}#signup`);
    }
    const token = makeToken(user);
    return res.redirect(`${FRONTEND}?token=${token}&userId=${user.id}#dashboard`);
  }
);

// ── POST /api/auth/oauth-complete ─────────────────────────────
router.post('/oauth-complete', async (req, res) => {
  try {
    const { provider, providerId, email, fullName, username, phone, githubUsername } = req.body;
    if (!provider || !providerId || !email || !username) {
      return res.status(400).json({ error: 'provider, providerId, email and username are required.' });
    }

    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!usernameRegex.test(username)) {
      return res.status(400).json({ error: 'Username must be 3–20 characters (letters, numbers, underscores).' });
    }

    const dupUser = await db.query(`SELECT id FROM users WHERE LOWER(username) = LOWER($1)`, [username]);
    if (dupUser.rows.length) return res.status(409).json({ error: 'Username is already taken.' });

    const dupEmail = await db.query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1)`, [email]);
    if (dupEmail.rows.length) return res.status(409).json({ error: 'Email is already registered.' });

    const id = uuidv4();
    const googleId = provider === 'google' ? providerId : '';
    const githubId = provider === 'github' ? providerId : '';

    const result = await db.query(`
      INSERT INTO users (id, full_name, username, email, phone, google_id, github_id, github_username, verified, level, xp, coins)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, 1, 0, 0)
      RETURNING *
    `, [id, fullName || username, username, email.toLowerCase(), phone || '', googleId, githubId, githubUsername || '']);

    const newUser = result.rows[0];
    const token = makeToken(newUser);
    res.json({ token, user: safeUser(newUser) });
  } catch (err) {
    console.error('[OAuth Complete Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/register ────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { fullName, email, phone, username, password } = req.body;

    if (!fullName || !fullName.trim()) return res.status(400).json({ error: 'Full name is required.' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Valid email is required.' });
    if (!username) return res.status(400).json({ error: 'Username is required.' });
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Username must be 3–20 characters (letters, numbers, underscores).' });
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters long.' });

    const dupEmail = await db.query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1)`, [email.trim()]);
    if (dupEmail.rows.length) return res.status(409).json({ error: 'This email is already registered.' });

    const dupUser = await db.query(`SELECT id FROM users WHERE LOWER(username) = LOWER($1)`, [username]);
    if (dupUser.rows.length) return res.status(409).json({ error: 'Username is already taken.' });

    // Storing plaintext password so you can view it directly in Neon Console
    const passwordHash = password;
    const id = uuidv4();

    const result = await db.query(`
      INSERT INTO users (id, full_name, username, email, phone, password_hash, verified, level, xp, coins)
      VALUES ($1, $2, $3, $4, $5, $6, true, 1, 0, 0)
      RETURNING *
    `, [id, fullName.trim(), username, email.trim().toLowerCase(), phone || '', passwordHash]);

    const newUser = result.rows[0];
    const token = makeToken(newUser);

    // Send welcome email (non-blocking)
    try {
      const resend = getResend();
      await resend.emails.send({
        from: 'ScholarQuest <onboarding@resend.dev>',
        to: newUser.email,
        subject: '⚔️ Welcome to ScholarQuest!',
        html: `<h2>Welcome, ${newUser.full_name}!</h2><p>Your Scholar account is ready. Start your quest!</p>`
      });
    } catch (emailErr) {
      console.warn('[Email] Welcome email failed:', emailErr.message);
    }

    res.status(201).json({ message: 'Account created!', token, user: safeUser(newUser) });
  } catch (err) {
    console.error('[Register Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/login ───────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, username, identifier, password } = req.body;
    const loginId = identifier || email || username;
    if (!loginId || !password) return res.status(400).json({ error: 'Email or Username and Password are required' });

    const result = await db.query(
      `SELECT * FROM users WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1) LIMIT 1`,
      [loginId]
    );
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid email/username or password' });

    const stored = user.password_hash || '';
    let match = (stored === password);
    if (!match && stored.startsWith('$2')) {
      match = await bcrypt.compare(password, stored);
    }
    if (!match) return res.status(401).json({ error: 'Invalid email/username or password' });

    const token = makeToken(user);
    res.json({ message: 'Login successful!', token, user: safeUser(user) });
  } catch (err) {
    console.error('[Login Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/auth/me ───────────────────────────────────────────
router.get('/me', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM users WHERE id = $1`, [req.user.id]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: safeUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/forgot-password ────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    const result = await db.query(`SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`, [email]);
    const user = result.rows[0];

    // Always return success to prevent email enumeration
    if (!user) return res.json({ message: 'If this email is registered, a reset link has been sent.' });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await db.query(
      `INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)`,
      [token, user.id, expiresAt]
    );

    const origin = req.headers.origin || process.env.FRONTEND_URL || 'http://localhost:5500';
    const resetUrl = `${origin}?token=${token}#reset-password`;

    try {
      const resend = getResend();
      await resend.emails.send({
        from: 'ScholarQuest <onboarding@resend.dev>',
        to: user.email,
        subject: '⚔️ Reset Your ScholarQuest Password',
        html: `
          <h2>Password Reset Request</h2>
          <p>Click the link below to reset your password. It expires in 15 minutes.</p>
          <a href="${resetUrl}" style="background:#6366f1;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">Reset Password 🔑</a>
          <p style="margin-top:20px;color:#666;">If you didn't request this, ignore this email.</p>
        `
      });
    } catch (emailErr) {
      console.warn('[Email] Reset email failed:', emailErr.message);
    }

    res.json({ message: 'If this email is registered, a reset link has been sent.' });
  } catch (err) {
    console.error('[Forgot Password Error]', err.message);
    res.status(500).json({ error: 'Failed to process forgot password request.' });
  }
});

// ── POST /api/auth/reset-password ─────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'Reset token and new password are required.' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters long.' });

    const result = await db.query(
      `SELECT * FROM password_reset_tokens WHERE token = $1 LIMIT 1`, [token]
    );
    const resetToken = result.rows[0];

    if (!resetToken) return res.status(400).json({ error: 'Invalid or expired password reset link.' });
    if (resetToken.used) return res.status(400).json({ error: 'This password reset link has already been used.' });
    if (new Date() > new Date(resetToken.expires_at)) return res.status(400).json({ error: 'This password reset link has expired.' });

    const newHash = newPassword;
    await db.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [newHash, resetToken.user_id]);
    await db.query(`UPDATE password_reset_tokens SET used = true WHERE token = $1`, [token]);

    res.json({ message: '🎉 Password has been reset successfully! You can now log in with your new password.' });
  } catch (err) {
    console.error('[Reset Password Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/auth/account ───────────────────────────────────
router.delete('/account', verifyToken, async (req, res) => {
  try {
    await db.query(`DELETE FROM users WHERE id = $1`, [req.user.id]);
    res.json({ message: 'Account deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
