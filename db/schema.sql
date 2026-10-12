/* ============================================================
   ScholarQuest — PostgreSQL Schema
   Run: node db/setup.js
   ============================================================ */

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Users ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              VARCHAR(64)  PRIMARY KEY,
  full_name       TEXT         NOT NULL,
  username        VARCHAR(64)  UNIQUE NOT NULL,
  email           VARCHAR(255) UNIQUE NOT NULL,
  phone           VARCHAR(20)  DEFAULT '',
  password_hash   TEXT         DEFAULT '',
  google_id       VARCHAR(128) DEFAULT '',
  github_id       VARCHAR(128) DEFAULT '',
  github_username VARCHAR(128) DEFAULT '',
  verified        BOOLEAN      DEFAULT false,
  level           INTEGER      DEFAULT 1,
  xp              INTEGER      DEFAULT 0,
  coins           INTEGER      DEFAULT 0,
  hp              INTEGER      DEFAULT 100,
  max_hp          INTEGER      DEFAULT 100,
  avatar          JSONB        DEFAULT '{"id":"peasant"}',
  inventory       JSONB        DEFAULT '[]',
  equipped        JSONB        DEFAULT '{"head":"none","hand":"none","pet":"none"}',
  stats           JSONB        DEFAULT '{"quizzesCompleted":0,"focusMinutes":0,"lessonsCompleted":0,"maxHabitStreak":0}',
  active_theme    VARCHAR(32)  DEFAULT 'default',
  leetcode_username VARCHAR(64) DEFAULT '',
  created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

-- ── Habits ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS habits (
  id             VARCHAR(64)  PRIMARY KEY,
  user_id        VARCHAR(64)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT         NOT NULL,
  difficulty     VARCHAR(16)  DEFAULT 'medium',
  streak         INTEGER      DEFAULT 0,
  last_completed TIMESTAMP    DEFAULT NULL,
  created_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

-- ── Quizzes ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quizzes (
  id          VARCHAR(64)  PRIMARY KEY,
  title       TEXT         NOT NULL,
  description TEXT         DEFAULT '',
  difficulty  VARCHAR(16)  DEFAULT 'medium',
  domain      VARCHAR(64)  DEFAULT 'general',
  tags        JSONB        DEFAULT '[]',
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

-- ── Quiz Questions ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quiz_questions (
  id             VARCHAR(64)  PRIMARY KEY,
  quiz_id        VARCHAR(64)  NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  question       TEXT         NOT NULL,
  options        JSONB        NOT NULL,
  correct_answer TEXT         NOT NULL,
  sort_order     INTEGER      DEFAULT 0
);

-- ── Friendships ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS friendships (
  id           VARCHAR(64)  PRIMARY KEY,
  requester_id VARCHAR(64)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id VARCHAR(64)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       VARCHAR(20)  DEFAULT 'pending',
  created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(requester_id, recipient_id)
);

-- ── Direct Messages ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS direct_messages (
  id           VARCHAR(64)  PRIMARY KEY,
  sender_id    VARCHAR(64)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id VARCHAR(64)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text         TEXT         DEFAULT '',
  attachment   JSONB        DEFAULT NULL,
  read         BOOLEAN      DEFAULT false,
  created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

-- ── Password Reset Tokens ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         SERIAL       PRIMARY KEY,
  token      TEXT         UNIQUE NOT NULL,
  user_id    VARCHAR(64)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  used       BOOLEAN      DEFAULT false,
  expires_at TIMESTAMP    NOT NULL,
  created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_habits_user_id       ON habits(user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_quiz  ON quiz_questions(quiz_id);
CREATE INDEX IF NOT EXISTS idx_friendships_req      ON friendships(requester_id);
CREATE INDEX IF NOT EXISTS idx_friendships_rec      ON friendships(recipient_id);
CREATE INDEX IF NOT EXISTS idx_dm_sender            ON direct_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_dm_recipient         ON direct_messages(recipient_id);
CREATE INDEX IF NOT EXISTS idx_prt_token            ON password_reset_tokens(token);
