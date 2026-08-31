/* ============================================================
   Route: /api/auth
   Handles: Register & Login
   Storage: JSON file (data/users.json)
   TODO: Replace readDB/writeDB with Mongoose User model
   ============================================================ */

const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const { Resend } = require('resend');
const { v4: uuidv4 } = require('uuid');
const { readDB, writeDB } = require('../db');
const { verifyToken } = require('../middleware/auth');

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'scholarquest_secret_change_in_prod';
const getResend = () => new Resend(process.env.RESEND_API_KEY);

// ── Google OAuth Strategy Configuration ──────────────────────
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: 'http://localhost:3000/api/auth/google/callback'
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = (profile.emails && profile.emails[0] && profile.emails[0].value)
            ? profile.emails[0].value.toLowerCase().trim()
            : null;

          if (!email) {
            return done(new Error('No email found in Google profile'), null);
          }

          const users = readDB('users');
          let user = users.find(u =>
            (u.email && u.email.toLowerCase() === email) ||
            (u.googleId && u.googleId === profile.id)
          );

          if (!user) {
            const cleanName = profile.displayName || profile.name?.givenName || 'Google Scholar';
            const baseUsername = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '') || 'scholar';
            let uniqueUsername = baseUsername;
            let counter = 1;
            while (users.some(u => u.username && u.username.toLowerCase() === uniqueUsername.toLowerCase())) {
              uniqueUsername = `${baseUsername}${counter++}`;
            }

            // Return pending user payload — DO NOT create user record in DB yet
            const pendingUser = {
              isNew: true,
              provider: 'google',
              providerId: profile.id,
              email: email,
              fullName: cleanName,
              suggestedUsername: uniqueUsername
            };
            return done(null, pendingUser);
          } else {
            if (!user.googleId) {
              user.googleId = profile.id;
              writeDB('users', users);
            }
            console.log(`[Google OAuth] Logged into existing account for ${email}`);
            return done(null, user);
          }
        } catch (err) {
          console.error('[Google Strategy Exception]', err.message);
          return done(err, null);
        }
      }
    )
  );
}

// ── GitHub OAuth Strategy Configuration ──────────────────────
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  passport.use(
    new GitHubStrategy(
      {
        clientID: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        callbackURL: 'http://localhost:3000/api/auth/github/callback',
        scope: ['user:email']
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          let email = null;
          if (profile.emails && profile.emails.length > 0) {
            const primary = profile.emails.find(e => e.primary || e.verified) || profile.emails[0];
            if (primary && primary.value) {
              email = primary.value.toLowerCase().trim();
            }
          }
          if (!email) {
            email = `${profile.username || profile.id}@github.local`.toLowerCase();
          }

          const users = readDB('users');
          let user = users.find(u =>
            (u.email && u.email.toLowerCase() === email) ||
            (u.githubId && u.githubId === profile.id)
          );

          if (!user) {
            const cleanName = profile.displayName || profile.username || 'GitHub Scholar';
            const baseUsername = (profile.username || email.split('@')[0]).replace(/[^a-zA-Z0-9_]/g, '') || 'scholar';
            let uniqueUsername = baseUsername;
            let counter = 1;
            while (users.some(u => u.username && u.username.toLowerCase() === uniqueUsername.toLowerCase())) {
              uniqueUsername = `${baseUsername}${counter++}`;
            }

            // Return pending user payload — DO NOT create user record in DB yet
            const pendingUser = {
              isNew: true,
              provider: 'github',
              providerId: profile.id,
              email: email,
              fullName: cleanName,
              suggestedUsername: uniqueUsername
            };
            return done(null, pendingUser);
          } else {
            if (!user.githubId) {
              user.githubId = profile.id;
              writeDB('users', users);
            }
            console.log(`[GitHub OAuth] Logged into existing account for ${email}`);
            return done(null, user);
          }
        } catch (err) {
          console.error('[GitHub Strategy Exception]', err.message);
          return done(err, null);
        }
      }
    )
  );
}

// Helper to resolve active frontend origin dynamically (supports state param, origin/referer headers, process.env.FRONTEND_URL, and defaults to http://localhost:5500)
const getFrontendOrigin = (req) => {
  if (req && req.query && req.query.state) {
    try {
      const decoded = decodeURIComponent(req.query.state);
      if (decoded && (decoded.startsWith('http://') || decoded.startsWith('https://'))) return decoded;
    } catch (e) {}
  }
  if (req && req.headers) {
    if (req.headers.origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.origin)) {
      return req.headers.origin;
    }
    if (req.headers.referer) {
      try {
        const u = new URL(req.headers.referer);
        if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(u.origin)) return u.origin;
      } catch (e) {}
    }
  }
  return process.env.FRONTEND_URL || 'http://localhost:5500';
};

// ── GET /api/auth/me ───────────────────────────────────────────
// Returns authenticated user details for current session token
router.get('/me', verifyToken, (req, res) => {
  const users = readDB('users');
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { passwordHash: _, ...safeUser } = user;
  res.json({ user: safeUser });
});

// ── GET /api/auth/google ──────────────────────────────────────
router.get('/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).json({ error: 'Google OAuth environment variables not set on backend server.' });
  }
  const clientOrigin = getFrontendOrigin(req);
  passport.authenticate('google', {
    session: false,
    scope: ['profile', 'email'],
    state: encodeURIComponent(clientOrigin)
  })(req, res, next);
});

// ── GET /api/auth/google/callback ─────────────────────────────
router.get('/google/callback', (req, res, next) => {
  const frontendUrl = getFrontendOrigin(req);

  passport.authenticate('google', { session: false }, (err, user, info) => {
    if (err || !user) {
      console.error('[Google OAuth Failed]', err ? err.message : info);
      return res.redirect(`${frontendUrl}?error=google_auth_failed#login`);
    }

    if (user.isNew) {
      const pendingToken = jwt.sign({
        pendingOauth: true,
        provider: user.provider,
        providerId: user.providerId,
        email: user.email,
        fullName: user.fullName,
        suggestedUsername: user.suggestedUsername
      }, JWT_SECRET, { expiresIn: '15m' });

      return res.redirect(`${frontendUrl}?pending_oauth=${encodeURIComponent(pendingToken)}&sso=google#complete-registration`);
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    return res.redirect(`${frontendUrl}?token=${token}&sso=google#dashboard`);
  })(req, res, next);
});

// ── GET /api/auth/github ──────────────────────────────────────
router.get('/github', (req, res, next) => {
  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
    return res.status(500).json({ error: 'GitHub OAuth environment variables not set on backend server.' });
  }
  const clientOrigin = getFrontendOrigin(req);
  passport.authenticate('github', {
    session: false,
    scope: ['user:email'],
    state: encodeURIComponent(clientOrigin)
  })(req, res, next);
});

// ── GET /api/auth/github/callback ─────────────────────────────
router.get('/github/callback', (req, res, next) => {
  const frontendUrl = getFrontendOrigin(req);

  passport.authenticate('github', { session: false }, (err, user, info) => {
    if (err || !user) {
      console.error('[GitHub OAuth Failed]', err ? err.message : info);
      return res.redirect(`${frontendUrl}?error=github_auth_failed#login`);
    }

    if (user.isNew) {
      const pendingToken = jwt.sign({
        pendingOauth: true,
        provider: user.provider,
        providerId: user.providerId,
        email: user.email,
        fullName: user.fullName,
        suggestedUsername: user.suggestedUsername
      }, JWT_SECRET, { expiresIn: '15m' });

      return res.redirect(`${frontendUrl}?pending_oauth=${encodeURIComponent(pendingToken)}&sso=github#complete-registration`);
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    return res.redirect(`${frontendUrl}?token=${token}&sso=github#dashboard`);
  })(req, res, next);
});

// ── POST /api/auth/register ───────────────────────────────────
// Body: { fullName, email, phone, username, password }
router.post('/register', async (req, res) => {
  try {
    const { fullName, email, phone, username, password } = req.body;
    const cleanUsername = (username || '').trim();
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanName = (fullName || cleanUsername || 'Scholar').trim();
    const cleanPhone = (phone || '').trim();

    // Validation
    if (!cleanName) {
      return res.status(400).json({ error: 'Full name is required.' });
    }

    if (!cleanEmail) {
      return res.status(400).json({ error: 'Email address is required.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    if (!cleanUsername || cleanUsername.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters long.' });
    }

    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    const users = readDB('users');
    
    // Check Email Uniqueness
    const emailExists = users.some(u => u.email && u.email.toLowerCase() === cleanEmail);
    if (emailExists) {
      return res.status(409).json({ error: 'An account with this email address already exists.' });
    }

    // Check Username Uniqueness
    const usernameExists = users.some(u => u.username && u.username.toLowerCase() === cleanUsername.toLowerCase());
    if (usernameExists) {
      return res.status(409).json({ error: 'Username is already taken. Please choose another.' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user with default ScholarQuest state
    const newUser = {
      id: uuidv4(),
      fullName: cleanName,
      username: cleanUsername,
      email: cleanEmail,
      phone: cleanPhone,
      passwordHash,
      createdAt: new Date().toISOString(),
      // ── ScholarQuest game state ──
      level: 1,
      xp: 0,
      coins: 150,
      loginStreak: 0,
      loginDates: [],
      quizStats: {
        quizzesCompleted: 0,
        missedByDomain: {}
      },
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

    users.push(newUser);
    writeDB('users', users);

    // Return token (exclude passwordHash)
    const token = jwt.sign({ id: newUser.id, username: newUser.username }, JWT_SECRET, { expiresIn: '7d' });
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
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();

    // Generic success response to avoid disclosing email registration status
    const genericResponse = {
      message: 'If that email is registered, a reset link has been sent.'
    };

    if (!cleanEmail) {
      return res.status(400).json({ error: 'Email address is required' });
    }

    const users = readDB('users');
    const user = users.find(u => u.email && u.email.toLowerCase() === cleanEmail);

    if (!user) {
      return res.json(genericResponse);
    }

    // Generate secure random token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes

    const resetTokens = readDB('password_reset_tokens') || [];
    resetTokens.push({
      id: uuidv4(),
      userId: user.id,
      token,
      expiresAt,
      used: false,
      createdAt: new Date().toISOString()
    });
    writeDB('password_reset_tokens', resetTokens);

    // Construct reset link URL dynamically
    const origin = getFrontendOrigin(req);
    const resetUrl = `${origin}?token=${token}#reset-password`;

    // ScholarQuest Dark/Gold Branded HTML Email Template
    const htmlTemplate = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0d0b08; color: #f5e8d7; margin: 0; padding: 24px; }
          .card { max-width: 540px; margin: 0 auto; background: #16120c; border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 18px; padding: 36px 28px; box-shadow: 0 12px 36px rgba(0,0,0,0.8); }
          .header { text-align: center; border-bottom: 1px solid rgba(245, 158, 11, 0.2); padding-bottom: 20px; margin-bottom: 24px; }
          .title { font-size: 26px; font-weight: 800; color: #f59e0b; margin: 0; letter-spacing: 0.04em; }
          .subtitle { font-size: 11px; color: rgba(245,232,215,0.5); text-transform: uppercase; letter-spacing: 0.1em; margin-top: 4px; }
          .greeting { font-size: 16px; font-weight: 700; color: #f5e8d7; margin-bottom: 16px; }
          .text { font-size: 14px; color: rgba(245,232,215,0.8); line-height: 1.6; margin-bottom: 24px; }
          .btn-wrapper { text-align: center; margin: 32px 0; }
          .reset-btn { background: linear-gradient(90deg, #f59e0b, #d97706); color: #0f0b06 !important; font-weight: 800; font-size: 15px; padding: 14px 34px; border-radius: 12px; text-decoration: none; display: inline-block; box-shadow: 0 4px 16px rgba(245,158,11,0.4); }
          .expiry-box { font-size: 12px; color: #ef4444; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); padding: 12px 16px; border-radius: 10px; text-align: center; margin-top: 24px; font-weight: 600; }
          .fallback-link { font-size: 11px; color: #f59e0b; word-break: break-all; text-align: center; margin-top: 20px; line-height: 1.5; }
          .footer { font-size: 11px; color: rgba(245,232,215,0.4); text-align: center; border-top: 1px solid rgba(245,158,11,0.15); padding-top: 20px; margin-top: 32px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="header">
            <div class="title">⚔️ ScholarQuest</div>
            <div class="subtitle">Password Reset Request</div>
          </div>
          
          <div class="greeting">Greetings, ${user.fullName || user.username || 'Scholar'}!</div>
          
          <div class="text">
            A password reset request was initiated for your ScholarQuest account. Click the button below to reset your password and recover your account:
          </div>
          
          <div class="btn-wrapper">
            <a href="${resetUrl}" target="_blank" class="reset-btn">Reset Your Password 🔑</a>
          </div>
          
          <div class="fallback-link">
            If the button doesn't work, copy and paste this URL into your browser:<br>
            <a href="${resetUrl}" style="color: #f59e0b;">${resetUrl}</a>
          </div>
          
          <div class="expiry-box">
            ⏳ Note: This password reset link expires in <strong>15 minutes</strong>.
          </div>
          
          <div class="footer">
            If you did not request this password reset, please ignore this email.<br>
            © ScholarQuest Gamified Platform
          </div>
        </div>
      </body>
      </html>
    `;

    try {
      const resend = getResend();
      const sendPromise = resend.emails.send({
        from: 'ScholarQuest <onboarding@resend.dev>',
        to: user.email,
        subject: '⚔️ Reset Your ScholarQuest Password',
        html: htmlTemplate
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Resend email dispatch timed out')), 3000)
      );
      await Promise.race([sendPromise, timeoutPromise]);
      console.log(`[Resend Email] Password reset email sent to user.`);
    } catch (emailErr) {
      console.error('[Resend Email Exception]', emailErr.message);
    }

    return res.json(genericResponse);

  } catch (err) {
    console.error('[Forgot Password Error]', err.message);
    res.status(500).json({ error: 'Failed to process forgot password request.' });
  }
});

// ── POST /api/auth/reset-password ────────────────────────────
// Body: { token, newPassword }
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Reset token and new password are required.' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    const resetTokens = readDB('password_reset_tokens') || [];
    const tokenRecord = resetTokens.find(t => t.token === token);

    if (!tokenRecord) {
      return res.status(400).json({ error: 'Invalid or expired password reset link.' });
    }

    if (tokenRecord.used) {
      return res.status(400).json({ error: 'This password reset link has already been used.' });
    }

    if (Date.now() > tokenRecord.expiresAt) {
      return res.status(400).json({ error: 'This password reset link has expired. Please request a new link.' });
    }

    const users = readDB('users');
    const userIndex = users.findIndex(u => u.id === tokenRecord.userId);

    if (userIndex === -1) {
      return res.status(400).json({ error: 'Account not found.' });
    }

    // Hash new password
    const newHash = await bcrypt.hash(newPassword, 10);
    users[userIndex].passwordHash = newHash;
    writeDB('users', users);

    // Mark token as used
    tokenRecord.used = true;
    writeDB('password_reset_tokens', resetTokens);

    return res.json({
      message: '🎉 Password has been reset successfully! You can now log in with your new password.'
    });

  } catch (err) {
    console.error('[Reset Password Error]', err.message);
    res.status(500).json({ error: 'Failed to reset password.' });
  }
});

// ── DELETE /api/auth/account ──────────────────────────────────
// Authenticated Hard Delete Endpoint: Wipes current user and all associated data
router.delete('/account', verifyToken, (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // 1. Delete user record from users.json
    let users = readDB('users') || [];
    const initialUserCount = users.length;
    users = users.filter(u => u.id !== userId);
    if (users.length === initialUserCount) {
      return res.status(404).json({ error: 'User account not found' });
    }
    writeDB('users', users);

    // 2. Delete friend connections involving userId from friendships.json
    let friendships = readDB('friendships') || [];
    friendships = friendships.filter(f => f.requesterId !== userId && f.receiverId !== userId);
    writeDB('friendships', friendships);

    // 3. Delete direct messages involving userId from direct_messages.json
    let directMessages = readDB('direct_messages') || [];
    directMessages = directMessages.filter(m => m.senderId !== userId && m.receiverId !== userId);
    writeDB('direct_messages', directMessages);

    // 4. Delete password reset tokens for userId from password_reset_tokens.json
    let resetTokens = readDB('password_reset_tokens') || [];
    resetTokens = resetTokens.filter(t => t.userId !== userId);
    writeDB('password_reset_tokens', resetTokens);

    // 5. Delete room members for userId from room_members.json
    let roomMembers = readDB('room_members') || [];
    roomMembers = roomMembers.filter(rm => rm.userId !== userId);
    writeDB('room_members', roomMembers);

    console.log(`[Account Deleted] User ID ${userId} hard-deleted completely across all collections.`);
    res.json({ message: '⚔️ Account and all associated data permanently deleted.' });
  } catch (err) {
    console.error('[Delete Account Error]', err.message);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// ── POST /api/auth/check-username ───────────────────────────
router.post('/check-username', (req, res) => {
  const { username } = req.body;
  const clean = (username || '').trim();
  if (!clean || clean.length < 3) {
    return res.json({ available: false, error: 'Username must be at least 3 characters long.' });
  }
  const users = readDB('users') || [];
  const taken = users.some(u => u.username && u.username.toLowerCase() === clean.toLowerCase());
  return res.json({ available: !taken });
});

// ── POST /api/auth/oauth/complete-registration ─────────────
router.post('/oauth/complete-registration', async (req, res) => {
  try {
    const { pendingToken, username } = req.body;
    const cleanUsername = (username || '').trim();

    if (!pendingToken) {
      return res.status(400).json({ error: 'Missing OAuth session token. Please try signing in again.' });
    }

    if (!cleanUsername || cleanUsername.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters long.' });
    }

    // Verify pending OAuth token
    let decoded;
    try {
      decoded = jwt.verify(pendingToken, JWT_SECRET);
    } catch (e) {
      return res.status(400).json({ error: 'OAuth registration session expired. Please sign in again.' });
    }

    if (!decoded.pendingOauth || !decoded.email || !decoded.provider) {
      return res.status(400).json({ error: 'Invalid OAuth registration token.' });
    }

    const { provider, providerId, email, fullName } = decoded;
    const users = readDB('users') || [];

    // Check if username is already taken
    const usernameExists = users.some(u => u.username && u.username.toLowerCase() === cleanUsername.toLowerCase());
    if (usernameExists) {
      return res.status(409).json({ error: 'Username is already taken. Please choose another.' });
    }

    // Double-check if user account was created concurrently
    let existingUser = users.find(u =>
      (u.email && u.email.toLowerCase() === email.toLowerCase()) ||
      (provider === 'google' && u.googleId === providerId) ||
      (provider === 'github' && u.githubId === providerId)
    );

    if (existingUser) {
      const token = jwt.sign({ id: existingUser.id, username: existingUser.username }, JWT_SECRET, { expiresIn: '7d' });
      const { passwordHash: _, ...safeUser } = existingUser;
      return res.json({ message: `Welcome back, ${existingUser.username}! 🏹`, token, user: safeUser });
    }

    // Create new OAuth user with exact standard starting values (Level 1, 0 XP, 150 Coins)
    const newUser = {
      id: uuidv4(),
      fullName: (fullName || cleanUsername || 'Scholar').trim(),
      username: cleanUsername,
      email: email.toLowerCase(),
      phone: '',
      [provider === 'google' ? 'googleId' : 'githubId']: providerId,
      passwordHash: '',
      createdAt: new Date().toISOString(),
      level: 1,
      xp: 0,
      coins: 150,
      loginStreak: 1,
      loginDates: [new Date().toISOString().split('T')[0]],
      quizStats: {
        quizzesCompleted: 0,
        missedByDomain: {}
      },
      hp: 100,
      maxHp: 100,
      avatar: { id: 'peasant' },
      inventory: ['basic_book'],
      equipped: { head: 'none', hand: 'none', pet: 'none' },
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

    users.push(newUser);
    writeDB('users', users);

    console.log(`[OAuth Registration Complete] Created new account for ${email} (${cleanUsername})`);

    const token = jwt.sign({ id: newUser.id, username: newUser.username }, JWT_SECRET, { expiresIn: '7d' });
    const { passwordHash: _, ...safeUser } = newUser;

    res.status(201).json({
      message: '⚔️ Account registration complete! Welcome to ScholarQuest.',
      token,
      user: safeUser
    });
  } catch (err) {
    console.error('[OAuth Registration Error]', err.message);
    res.status(500).json({ error: 'Failed to complete registration.' });
  }
});

module.exports = router;

