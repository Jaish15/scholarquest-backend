/* ============================================================
   ScholarQuest — StudySync Real-Time Persistence Store
   Database abstraction layer supporting PostgreSQL & JSON storage
   ============================================================ */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ROOMS_FILE = path.join(DATA_DIR, 'study_rooms.json');
const MEMBERS_FILE = path.join(DATA_DIR, 'room_members.json');

// Initialize PostgreSQL Pool if DATABASE_URL is configured
let pgPool = null;
if (process.env.DATABASE_URL) {
  try {
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
    });
    initPgTables();
  } catch (err) {
    console.warn('[DB WARNING] PostgreSQL pool initialization failed, using file storage fallback.', err.message);
    pgPool = null;
  }
}

async function initPgTables() {
  if (!pgPool) return;
  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS study_rooms (
        id VARCHAR(64) PRIMARY KEY,
        join_code VARCHAR(6) UNIQUE NOT NULL,
        host_user_id VARCHAR(64) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(20) DEFAULT 'active',
        current_activity VARCHAR(32) DEFAULT 'idle',
        current_question_id VARCHAR(64)
      );
      CREATE TABLE IF NOT EXISTS room_members (
        room_id VARCHAR(64) NOT NULL,
        user_id VARCHAR(64) NOT NULL,
        username VARCHAR(64) NOT NULL,
        avatar VARCHAR(64) DEFAULT 'peasant',
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_connected BOOLEAN DEFAULT true,
        score INT DEFAULT 0,
        disconnected_at TIMESTAMP,
        PRIMARY KEY (room_id, user_id)
      );
    `);
    console.log('[DB] PostgreSQL StudySync tables initialized successfully.');
  } catch (err) {
    console.error('[DB ERROR] PostgreSQL table init failed:', err.message);
  }
}

// ── File Helpers (Fallback) ──────────────────────────────────────────────────
function readJSON(file) {
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return [];
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ── Unique 6-Character Join Code Generator ──────────────────────────────────
function generateJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude ambiguous chars like I, O, 0, 1
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// ── Store Operations ────────────────────────────────────────────────────────
async function createRoom(hostUserId, username, avatar = 'peasant') {
  let joinCode = generateJoinCode();
  let attempts = 0;
  
  // Ensure unique code
  while (await getRoomByCode(joinCode)) {
    joinCode = generateJoinCode();
    attempts++;
    if (attempts > 100) break;
  }

  const roomId = uuidv4();
  const createdAt = new Date().toISOString();

  if (pgPool) {
    await pgPool.query(
      `INSERT INTO study_rooms (id, join_code, host_user_id, status, current_activity, created_at)
       VALUES ($1, $2, $3, 'active', 'idle', $4)`,
      [roomId, joinCode, hostUserId, createdAt]
    );
    await pgPool.query(
      `INSERT INTO room_members (room_id, user_id, username, avatar, joined_at, is_connected, score)
       VALUES ($1, $2, $3, $4, $5, true, 0)`,
      [roomId, hostUserId, username, avatar, createdAt]
    );
  } else {
    const rooms = readJSON(ROOMS_FILE);
    const members = readJSON(MEMBERS_FILE);

    const newRoom = {
      id: roomId,
      join_code: joinCode,
      host_user_id: hostUserId,
      status: 'active',
      current_activity: 'idle',
      current_question_id: null,
      created_at: createdAt
    };

    const newMember = {
      room_id: roomId,
      user_id: hostUserId,
      username: username,
      avatar: avatar,
      joined_at: createdAt,
      is_connected: true,
      score: 0,
      disconnected_at: null
    };

    rooms.push(newRoom);
    members.push(newMember);

    writeJSON(ROOMS_FILE, rooms);
    writeJSON(MEMBERS_FILE, members);
  }

  return { id: roomId, join_code: joinCode, host_user_id: hostUserId };
}

async function getRoomByCode(joinCode) {
  const cleanCode = (joinCode || '').trim().toUpperCase();
  if (!cleanCode) return null;

  if (pgPool) {
    const res = await pgPool.query(`SELECT * FROM study_rooms WHERE join_code = $1 AND status = 'active'`, [cleanCode]);
    return res.rows[0] || null;
  } else {
    const rooms = readJSON(ROOMS_FILE);
    return rooms.find(r => r.join_code === cleanCode && r.status === 'active') || null;
  }
}

async function getRoomById(roomId) {
  if (pgPool) {
    const res = await pgPool.query(`SELECT * FROM study_rooms WHERE id = $1`, [roomId]);
    return res.rows[0] || null;
  } else {
    const rooms = readJSON(ROOMS_FILE);
    return rooms.find(r => r.id === roomId) || null;
  }
}

async function getActiveMemberCount(roomId) {
  const members = await getRoomMembers(roomId);
  const now = Date.now();
  // Count connected members or members disconnected within last 60 seconds
  const activeMembers = members.filter(m => {
    if (m.is_connected) return true;
    if (m.disconnected_at) {
      const discTime = new Date(m.disconnected_at).getTime();
      return (now - discTime) < 60000;
    }
    return false;
  });
  return activeMembers.length;
}

async function getRoomMembers(roomId) {
  if (pgPool) {
    const res = await pgPool.query(`SELECT * FROM room_members WHERE room_id = $1 ORDER BY joined_at ASC`, [roomId]);
    return res.rows;
  } else {
    const members = readJSON(MEMBERS_FILE);
    return members.filter(m => m.room_id === roomId);
  }
}

async function addOrUpdateMember(roomId, userId, username, avatar) {
  const now = new Date().toISOString();
  if (pgPool) {
    await pgPool.query(`
      INSERT INTO room_members (room_id, user_id, username, avatar, joined_at, is_connected, score, disconnected_at)
      VALUES ($1, $2, $3, $4, $5, true, 0, NULL)
      ON CONFLICT (room_id, user_id) DO UPDATE
      SET username = $3, avatar = $4, is_connected = true, disconnected_at = NULL
    `, [roomId, userId, username, avatar, now]);
  } else {
    const members = readJSON(MEMBERS_FILE);
    const existingIdx = members.findIndex(m => m.room_id === roomId && m.user_id === userId);
    if (existingIdx >= 0) {
      members[existingIdx].username = username;
      members[existingIdx].avatar = avatar;
      members[existingIdx].is_connected = true;
      members[existingIdx].disconnected_at = null;
    } else {
      members.push({
        room_id: roomId,
        user_id: userId,
        username: username,
        avatar: avatar,
        joined_at: now,
        is_connected: true,
        score: 0,
        disconnected_at: null
      });
    }
    writeJSON(MEMBERS_FILE, members);
  }
}

async function setMemberConnectionState(roomId, userId, isConnected) {
  const discAt = isConnected ? null : new Date().toISOString();
  if (pgPool) {
    await pgPool.query(
      `UPDATE room_members SET is_connected = $1, disconnected_at = $2 WHERE room_id = $3 AND user_id = $4`,
      [isConnected, discAt, roomId, userId]
    );
  } else {
    const members = readJSON(MEMBERS_FILE);
    const m = members.find(mem => mem.room_id === roomId && mem.user_id === userId);
    if (m) {
      m.is_connected = isConnected;
      m.disconnected_at = discAt;
      writeJSON(MEMBERS_FILE, members);
    }
  }
}

async function updateMemberScore(roomId, userId, pointsToAdd) {
  if (pgPool) {
    await pgPool.query(
      `UPDATE room_members SET score = score + $1 WHERE room_id = $2 AND user_id = $3`,
      [pointsToAdd, roomId, userId]
    );
  } else {
    const members = readJSON(MEMBERS_FILE);
    const m = members.find(mem => mem.room_id === roomId && mem.user_id === userId);
    if (m) {
      m.score = (m.score || 0) + pointsToAdd;
      writeJSON(MEMBERS_FILE, members);
    }
  }
}

async function setRoomActivity(roomId, currentActivity, currentQuestionId = null) {
  if (pgPool) {
    await pgPool.query(
      `UPDATE study_rooms SET current_activity = $1, current_question_id = $2 WHERE id = $3`,
      [currentActivity, currentQuestionId, roomId]
    );
  } else {
    const rooms = readJSON(ROOMS_FILE);
    const r = rooms.find(room => room.id === roomId);
    if (r) {
      r.current_activity = currentActivity;
      r.current_question_id = currentQuestionId;
      writeJSON(ROOMS_FILE, rooms);
    }
  }
}

async function removeMember(roomId, userId) {
  if (pgPool) {
    await pgPool.query(`DELETE FROM room_members WHERE room_id = $1 AND user_id = $2`, [roomId, userId]);
  } else {
    let members = readJSON(MEMBERS_FILE);
    members = members.filter(m => !(m.room_id === roomId && m.user_id === userId));
    writeJSON(MEMBERS_FILE, members);
  }
}

async function purgeExpiredDisconnectedMembers(roomId, graceMs = 60000) {
  const members = await getRoomMembers(roomId);
  const now = Date.now();
  const expired = [];

  for (const m of members) {
    if (!m.is_connected && m.disconnected_at) {
      const discTime = new Date(m.disconnected_at).getTime();
      if (now - discTime >= graceMs) {
        expired.push(m.user_id);
      }
    }
  }

  for (const uid of expired) {
    await removeMember(roomId, uid);
  }

  return expired;
}

// ── Host Disconnect Auto-Promotion ──────────────────────────────────────────
/* Code Comment Note: If the room host disconnects and does not return within 60s,
   the server auto-promotes the next-longest-connected active member to host so the room stays active. */
async function promoteNextHostIfNeeded(roomId) {
  const room = await getRoomById(roomId);
  if (!room) return null;

  const members = await getRoomMembers(roomId);
  const hostMember = members.find(m => m.user_id === room.host_user_id);

  // If host is connected or within grace window, no promotion needed
  if (hostMember && hostMember.is_connected) {
    return room.host_user_id;
  }

  // Find next connected member ordered by joined_at
  const connectedMembers = members.filter(m => m.is_connected);
  if (connectedMembers.length > 0) {
    const newHost = connectedMembers[0].user_id;
    if (pgPool) {
      await pgPool.query(`UPDATE study_rooms SET host_user_id = $1 WHERE id = $2`, [newHost, roomId]);
    } else {
      const rooms = readJSON(ROOMS_FILE);
      const r = rooms.find(room => room.id === roomId);
      if (r) {
        r.host_user_id = newHost;
        writeJSON(ROOMS_FILE, rooms);
      }
    }
    return newHost;
  }

  // If zero connected members left, mark room closed
  if (pgPool) {
    await pgPool.query(`UPDATE study_rooms SET status = 'closed' WHERE id = $1`, [roomId]);
  } else {
    const rooms = readJSON(ROOMS_FILE);
    const r = rooms.find(room => room.id === roomId);
    if (r) {
      r.status = 'closed';
      writeJSON(ROOMS_FILE, rooms);
    }
  }
  return null;
}

module.exports = {
  createRoom,
  getRoomByCode,
  getRoomById,
  getActiveMemberCount,
  getRoomMembers,
  addOrUpdateMember,
  setMemberConnectionState,
  updateMemberScore,
  setRoomActivity,
  removeMember,
  purgeExpiredDisconnectedMembers,
  promoteNextHostIfNeeded
};
