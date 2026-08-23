/* ============================================================
   ScholarQuest — Main Express Server
   MSc IT Mini Project 2026 | Author: Jaish15
   ============================================================ */

require('dotenv').config();
const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const cors     = require('cors');
const path     = require('path');

// ── Route Imports ─────────────────────────────────────────────
const authRoutes        = require('./routes/auth');
const userRoutes        = require('./routes/user');
const quizRoutes        = require('./routes/quiz');
const habitRoutes       = require('./routes/habits');
const leaderboardRoutes = require('./routes/leaderboard');
const friendsRoutes     = require('./routes/friends');
const dmRoutes          = require('./routes/dm');
const setupStudySyncSocket = require('./modules/studySyncSocket');

// ── App & HTTP Server Setup ───────────────────────────────────
const app    = express();
const server = http.createServer(app);

// Flexible CORS setup allowing process.env.FRONTEND_URL & any local dev port (8086, 8080, 5500, etc.)
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (
      origin === process.env.FRONTEND_URL ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    ) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST']
  }
});
const PORT = process.env.PORT || 3000;

// Initialize StudySync Real-Time Socket Controller (Friends & DMs)
setupStudySyncSocket(io);

// ── Middleware ────────────────────────────────────────────────
const passport = require('passport');
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(passport.initialize());

// Serve Uploaded DM Attachments
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Health Check ──────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: '⚔️ ScholarQuest API & StudySync (Friends & DMs) running!',
    version: '2.0.0',
    docs: 'See README.md for all endpoints'
  });
});

// ── API Routes ────────────────────────────────────────────────
app.use('/api/auth',        authRoutes);
app.use('/api/user',        userRoutes);
app.use('/api/quizzes',     quizRoutes);
app.use('/api/habits',      habitRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/friends',     friendsRoutes);
app.use('/api/dm',          dmRoutes);

// ── CodeScroll Blank Practice IDE Endpoint (Judge0 API Integration + Native Fallback) ──
const { exec } = require('child_process');
const fs = require('fs');
const os = require('os');

const JUDGE0_LANGUAGE_MAP = {
  python: 71,      // Python 3.8.1
  py: 71,
  javascript: 63,  // JavaScript (Node.js 12.14.0)
  js: 63,
  c: 50,           // C (GCC 9.2.0)
  cpp: 54,         // C++ (GCC 9.2.0)
  'c++': 54,
  ruby: 72         // Ruby 2.7.0
};

function runLocalProcess(cmd, timeoutMs = 4000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: timeoutMs, maxBuffer: 1024 * 512 }, (err, stdout, stderr) => {
      if (err && err.killed) {
        return resolve({ stdout: stdout || '', stderr: 'Execution timed out (limit: 4s).', status: 'Time Limit Exceeded' });
      }
      resolve({
        stdout: stdout || '',
        stderr: stderr || (err ? err.message : ''),
        status: (err || stderr) ? 'Runtime Error' : 'Success'
      });
    });
  });
}

async function executeLocally(code, language) {
  const tmpDir = os.tmpdir();
  const fileId = 'sq_sandbox_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const langKey = (language || 'javascript').toLowerCase().trim();

  if (langKey === 'python' || langKey === 'py') {
    const filePath = path.join(tmpDir, `${fileId}.py`);
    fs.writeFileSync(filePath, code);
    const res = await runLocalProcess(`python3 "${filePath}"`);
    try { fs.unlinkSync(filePath); } catch (e) {}
    return res;
  }

  if (langKey === 'javascript' || langKey === 'js') {
    const filePath = path.join(tmpDir, `${fileId}.js`);
    fs.writeFileSync(filePath, code);
    const res = await runLocalProcess(`node "${filePath}"`);
    try { fs.unlinkSync(filePath); } catch (e) {}
    return res;
  }

  if (langKey === 'ruby') {
    const filePath = path.join(tmpDir, `${fileId}.rb`);
    fs.writeFileSync(filePath, code);
    const res = await runLocalProcess(`ruby "${filePath}"`);
    try { fs.unlinkSync(filePath); } catch (e) {}
    return res;
  }

  if (langKey === 'c') {
    const cPath = path.join(tmpDir, `${fileId}.c`);
    const outPath = path.join(tmpDir, `${fileId}.out`);
    fs.writeFileSync(cPath, code);
    const compileRes = await runLocalProcess(`gcc "${cPath}" -o "${outPath}"`);
    if (compileRes.stderr && !fs.existsSync(outPath)) {
      try { fs.unlinkSync(cPath); } catch (e) {}
      return { stdout: '', stderr: compileRes.stderr, status: 'Compilation Error' };
    }
    const runRes = await runLocalProcess(`"${outPath}"`);
    try { fs.unlinkSync(cPath); } catch (e) {}
    try { fs.unlinkSync(outPath); } catch (e) {}
    return runRes;
  }

  if (langKey === 'cpp' || langKey === 'c++') {
    const cppPath = path.join(tmpDir, `${fileId}.cpp`);
    const outPath = path.join(tmpDir, `${fileId}.out`);
    fs.writeFileSync(cppPath, code);
    const compileRes = await runLocalProcess(`g++ -std=c++17 "${cppPath}" -o "${outPath}"`);
    if (compileRes.stderr && !fs.existsSync(outPath)) {
      try { fs.unlinkSync(cppPath); } catch (e) {}
      return { stdout: '', stderr: compileRes.stderr, status: 'Compilation Error' };
    }
    const runRes = await runLocalProcess(`"${outPath}"`);
    try { fs.unlinkSync(cppPath); } catch (e) {}
    try { fs.unlinkSync(outPath); } catch (e) {}
    return runRes;
  }

  return { stdout: '', stderr: `Unsupported language: ${language}`, status: 'Error' };
}

app.post('/api/codescroll/run', async (req, res) => {
  try {
    const { code, language } = req.body;

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Source code is required.' });
    }

    const langKey = (language || 'javascript').toLowerCase().trim();
    const langId = JUDGE0_LANGUAGE_MAP[langKey] || 63;

    const host = process.env.JUDGE0_API_HOST || 'judge0-ce.p.rapidapi.com';
    const apiKey = process.env.JUDGE0_API_KEY;

    if (host && apiKey) {
      const baseUrl = host.startsWith('http://') || host.startsWith('https://')
        ? host
        : `https://${host}`;

      const endpoint = `${baseUrl.replace(/\/$/, '')}/submissions?wait=true&fields=stdout,stderr,compile_output,status,message`;

      const headers = {
        'Content-Type': 'application/json',
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': host.replace(/^https?:\/\//, '').split('/')[0]
      };

      try {
        const judgeRes = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            source_code: code,
            language_id: langId,
            stdin: ''
          })
        });

        if (judgeRes.ok) {
          const data = await judgeRes.json();
          if (data.stdout || data.stderr || data.compile_output) {
            return res.json({
              stdout: data.stdout || '',
              stderr: data.stderr || data.compile_output || data.message || '',
              status: data.status?.description || 'Executed'
            });
          }
        } else {
          console.warn(`[Judge0 API Warning] Returned HTTP ${judgeRes.status}. Using native runner fallback.`);
        }
      } catch (fetchErr) {
        console.warn('[Judge0 Fetch Exception]', fetchErr.message);
      }
    }

    // Native fallback execution
    const fallbackRes = await executeLocally(code, langKey);
    return res.json(fallbackRes);
  } catch (err) {
    console.error('[CodeScroll API Error]', err.message);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

// ── GET /api/codescroll/leetcode-stats/:username (LeetCode Public Stats) ───────
app.get('/api/codescroll/leetcode-stats/:username', async (req, res) => {
  try {
    const username = (req.params.username || '').trim();
    if (!username) {
      return res.status(400).json({ error: 'LeetCode username is required.' });
    }

    const query = `
      query getUserProfile($username: String!) {
        matchedUser(username: $username) {
          username
          profile {
            ranking
            reputation
          }
          submitStats: submitStatsGlobal {
            acSubmissionNum {
              difficulty
              count
            }
          }
        }
      }
    `;

    const response = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      body: JSON.stringify({ query, variables: { username } })
    });

    if (!response.ok) {
      return res.status(502).json({ error: `LeetCode API error status ${response.status}` });
    }

    const data = await response.json();

    if (!data.data || !data.data.matchedUser) {
      return res.status(404).json({ error: `LeetCode profile '@${username}' was not found. Please check spelling.` });
    }

    const matched = data.data.matchedUser;
    const submissions = matched.submitStats?.acSubmissionNum || [];

    const getCount = (diff) => {
      const item = submissions.find(s => s.difficulty.toLowerCase() === diff.toLowerCase());
      return item ? item.count : 0;
    };

    return res.json({
      username: matched.username,
      ranking: matched.profile?.ranking || 'N/A',
      reputation: matched.profile?.reputation || 0,
      totalSolved: getCount('all'),
      easySolved: getCount('easy'),
      mediumSolved: getCount('medium'),
      hardSolved: getCount('hard')
    });
  } catch (err) {
    console.error('[LeetCode Fetch Error]', err.message);
    res.status(500).json({ error: 'Failed to fetch LeetCode stats: ' + err.message });
  }
});

// ── POST /api/user/leetcode (Save linked username to profile) ──────────────────
app.post('/api/user/leetcode', (req, res) => {
  try {
    const { userId, leetcodeUsername } = req.body;
    const users = readDB('users');
    const user = users.find(u => u.id === userId || u.username === userId);

    if (user) {
      user.leetcodeUsername = leetcodeUsername || '';
      writeDB('users', users);
    }

    return res.json({ success: true, leetcodeUsername: leetcodeUsername || '' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

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
server.listen(PORT, () => {
  console.log(`\n⚔️  ScholarQuest API & Real-Time Sockets running at http://localhost:${PORT}`);
  console.log(`📡  StudySync Friends & Direct Messages Engine: ACTIVE`);
  console.log(`📦  Storage: PostgreSQL / Persistent JSON Storage\n`);
});

module.exports = server;
