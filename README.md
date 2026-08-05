# ⚔️ ScholarQuest — Backend API

> **MSc IT Mini Project 2026** | Node.js + Express REST API

ScholarQuest is a **gamified learning platform** where students earn XP, level up their avatar, track study habits, and compete on leaderboards.

---

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Create your .env file
cp .env.example .env

# 3. Start the development server
npm run dev

# Server runs at: http://localhost:3000
```

---

## 📁 Project Structure

```
scholarquest-backend/
├── server.js              # Main Express entry point
├── db.js                  # JSON file DB abstraction layer
├── .env.example           # Environment variable template
├── routes/
│   ├── auth.js            # POST /api/auth/register | /login
│   ├── user.js            # GET|PATCH /api/user/:id
│   ├── quiz.js            # GET /api/quizzes | POST /api/quizzes/submit
│   ├── habits.js          # GET|POST|PATCH|DELETE /api/habits/:userId
│   └── leaderboard.js     # GET /api/leaderboard
├── middleware/
│   └── auth.js            # JWT verification middleware
└── data/
    ├── quizzes.json        # Seeded quiz data (5 quizzes)
    └── users.json          # User store (auto-created on register)
```

---

## 🔌 API Endpoints

### Auth
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/auth/register` | Register new user | ❌ |
| POST | `/api/auth/login` | Login, get JWT token | ❌ |

### User
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/user/:id` | Get full game state | ✅ |
| PATCH | `/api/user/:id` | Update XP, coins, avatar | ✅ |

### Quizzes
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/quizzes` | List all quizzes | ❌ |
| GET | `/api/quizzes/:id` | Get quiz by ID | ❌ |
| POST | `/api/quizzes/submit` | Submit answers, earn XP | ✅ |

### Habits
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/habits/:userId` | Get user habits | ✅ |
| POST | `/api/habits/:userId` | Create habit | ✅ |
| PATCH | `/api/habits/:userId/:habitId/complete` | Mark habit done | ✅ |
| DELETE | `/api/habits/:userId/:habitId` | Delete habit | ✅ |

### Leaderboard
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/leaderboard` | Top 10 users by level/XP | ❌ |

---

## 🔐 Authentication

All protected routes require a Bearer token in the `Authorization` header:

```
Authorization: Bearer <your_jwt_token>
```

Tokens are obtained from `/api/auth/register` or `/api/auth/login`.

---

## 🛢️ Database Migration: JSON → MongoDB

The project uses a `db.js` abstraction layer to make migration easy.

### Steps to migrate:
```bash
npm install mongoose
```

1. Create `models/User.js` and `models/Quiz.js` with Mongoose schemas
2. In `.env`, add: `MONGO_URI=mongodb://localhost:27017/scholarquest`
3. In each route file, replace:
   - `readDB('users')` → `await User.find({})`
   - `writeDB('users', users)` → `await user.save()`
4. Update `db.js` to export mongoose connection helper

All `TODO (MongoDB):` comments in route files mark exact swap points.

---

## 🧪 Test the API

```bash
# Health check
curl http://localhost:3000

# Get all quizzes
curl http://localhost:3000/api/quizzes

# Register a user
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"jayasri","email":"jay@test.com","password":"test123"}'

# View leaderboard
curl http://localhost:3000/api/leaderboard
```

---

## 🎮 Game Mechanics

| Mechanic | Description |
|----------|-------------|
| **XP** | Earned by completing quizzes & habits |
| **Level-up** | Auto: `level * 100 XP` needed per level |
| **Coins** | Earned with XP, spend in shop |
| **Streaks** | Consecutive habit completions |
| **HP** | Lose streak = lose HP (frontend logic) |

---

## 📦 Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js v24 |
| Framework | Express.js 4 |
| Auth | JWT + bcryptjs |
| Storage | JSON files (→ MongoDB) |
| IDs | UUID v4 |

---

*ScholarQuest — Level Up Your Learning* ⚔️
