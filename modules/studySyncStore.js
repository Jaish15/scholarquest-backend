/* ============================================================
   ScholarQuest — Friends & Direct Messages Persistence Store
   Database abstraction layer supporting PostgreSQL & JSON storage
   ============================================================ */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FRIENDSHIPS_FILE = path.join(DATA_DIR, 'friendships.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'direct_messages.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

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
      CREATE TABLE IF NOT EXISTS friendships (
        id VARCHAR(64) PRIMARY KEY,
        requester_id VARCHAR(64) NOT NULL,
        recipient_id VARCHAR(64) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(requester_id, recipient_id)
      );
      CREATE TABLE IF NOT EXISTS direct_messages (
        id VARCHAR(64) PRIMARY KEY,
        sender_id VARCHAR(64) NOT NULL,
        recipient_id VARCHAR(64) NOT NULL,
        text TEXT DEFAULT '',
        attachment JSONB DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        read BOOLEAN DEFAULT false
      );
    `);
    console.log('[DB] PostgreSQL Friends & DM tables initialized successfully.');
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

function getUsers() {
  return readJSON(USERS_FILE);
}

function getUserById(userId) {
  const users = getUsers();
  const user = users.find(u => u.id === userId);
  if (!user) return null;
  const { passwordHash, ...safeUser } = user;
  return safeUser;
}

// ── Friendship Store Operations ─────────────────────────────────────────────

async function getFriendshipBetween(user1Id, user2Id) {
  if (pgPool) {
    const res = await pgPool.query(
      `SELECT * FROM friendships 
        WHERE (requester_id = $1 AND recipient_id = $2) 
           OR (requester_id = $2 AND recipient_id = $1)
        LIMIT 1`,
      [user1Id, user2Id]
    );
    return res.rows[0] || null;
  }

  const list = readJSON(FRIENDSHIPS_FILE);
  return list.find(f => 
    (f.requesterId === user1Id && f.recipientId === user2Id) ||
    (f.requesterId === user2Id && f.recipientId === user1Id)
  ) || null;
}

async function sendFriendRequest(requesterId, recipientId) {
  if (requesterId === recipientId) {
    throw new Error('You cannot send a friend request to yourself.');
  }

  const existing = await getFriendshipBetween(requesterId, recipientId);
  const now = new Date().toISOString();

  if (existing) {
    const reqId = existing.requesterId || existing.requester_id;
    if (existing.status === 'accepted') {
      throw new Error('You are already friends with this scholar.');
    }
    if (existing.status === 'pending') {
      if (reqId === requesterId) {
        throw new Error('Friend request already sent.');
      } else {
        // Automatically accept if the other person already sent a pending request
        return await respondFriendRequest(existing.id, requesterId, 'accept');
      }
    }
    // If declined, re-open request
    if (pgPool) {
      const res = await pgPool.query(
        `UPDATE friendships SET requester_id = $1, recipient_id = $2, status = 'pending', updated_at = $3 WHERE id = $4 RETURNING *`,
        [requesterId, recipientId, now, existing.id]
      );
      return res.rows[0];
    } else {
      const list = readJSON(FRIENDSHIPS_FILE);
      const idx = list.findIndex(f => f.id === existing.id);
      if (idx !== -1) {
        list[idx].requesterId = requesterId;
        list[idx].recipientId = recipientId;
        list[idx].status = 'pending';
        list[idx].updatedAt = now;
        writeJSON(FRIENDSHIPS_FILE, list);
        return list[idx];
      }
    }
  }

  const newFriendship = {
    id: uuidv4(),
    requesterId,
    recipientId,
    status: 'pending',
    createdAt: now,
    updatedAt: now
  };

  if (pgPool) {
    const res = await pgPool.query(
      `INSERT INTO friendships (id, requester_id, recipient_id, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [newFriendship.id, requesterId, recipientId, 'pending', now, now]
    );
    return res.rows[0];
  } else {
    const list = readJSON(FRIENDSHIPS_FILE);
    list.push(newFriendship);
    writeJSON(FRIENDSHIPS_FILE, list);
    return newFriendship;
  }
}

async function respondFriendRequest(requestId, recipientId, action) {
  const status = action === 'accept' ? 'accepted' : 'declined';
  const now = new Date().toISOString();

  if (pgPool) {
    const res = await pgPool.query(
      `UPDATE friendships 
        SET status = $1, updated_at = $2 
        WHERE id = $3 AND (recipient_id = $4 OR requester_id = $4) 
        RETURNING *`,
      [status, now, requestId, recipientId]
    );
    if (!res.rows.length) throw new Error('Friend request not found or unauthorized.');
    return res.rows[0];
  } else {
    const list = readJSON(FRIENDSHIPS_FILE);
    const idx = list.findIndex(f => f.id === requestId && (f.recipientId === recipientId || f.requesterId === recipientId));
    if (idx === -1) throw new Error('Friend request not found or unauthorized.');
    list[idx].status = status;
    list[idx].updatedAt = now;
    writeJSON(FRIENDSHIPS_FILE, list);
    return list[idx];
  }
}

async function getPendingRequests(userId) {
  let incoming = [];
  let outgoing = [];

  if (pgPool) {
    const inRes = await pgPool.query(
      `SELECT * FROM friendships WHERE recipient_id = $1 AND status = 'pending' ORDER BY created_at DESC`,
      [userId]
    );
    const outRes = await pgPool.query(
      `SELECT * FROM friendships WHERE requester_id = $1 AND status = 'pending' ORDER BY created_at DESC`,
      [userId]
    );
    incoming = inRes.rows;
    outgoing = outRes.rows;
  } else {
    const list = readJSON(FRIENDSHIPS_FILE);
    incoming = list.filter(f => f.recipientId === userId && f.status === 'pending');
    outgoing = list.filter(f => f.requesterId === userId && f.status === 'pending');
  }

  // Augment incoming with requester user profiles
  const augmentedIncoming = incoming.map(req => {
    const requesterId = req.requesterId || req.requester_id;
    const user = getUserById(requesterId);
    return {
      id: req.id,
      requesterId,
      recipientId: req.recipientId || req.recipient_id,
      createdAt: req.createdAt || req.created_at,
      status: req.status,
      user: user ? {
        id: user.id,
        username: user.username,
        level: user.level || 1,
        avatar: user.avatar || { id: 'peasant' },
        stats: user.stats || {}
      } : { id: requesterId, username: 'Unknown Scholar', level: 1, avatar: { id: 'peasant' } }
    };
  });

  return { incoming: augmentedIncoming, outgoing };
}

async function getFriendsList(userId, onlineUserIds = new Set()) {
  let friendships = [];

  if (pgPool) {
    const res = await pgPool.query(
      `SELECT * FROM friendships 
        WHERE (requester_id = $1 OR recipient_id = $1) AND status = 'accepted'`,
      [userId]
    );
    friendships = res.rows;
  } else {
    const list = readJSON(FRIENDSHIPS_FILE);
    friendships = list.filter(f => (f.requesterId === userId || f.recipientId === userId) && f.status === 'accepted');
  }

  const messages = readJSON(MESSAGES_FILE);

  const friends = friendships.map(f => {
    const reqId = f.requesterId || f.requester_id;
    const recId = f.recipientId || f.recipient_id;
    const friendId = reqId === userId ? recId : reqId;
    const user = getUserById(friendId);

    // Find last message between userId and friendId
    const threadMsgs = messages.filter(m => 
      (m.senderId === userId && m.recipientId === friendId) ||
      (m.senderId === friendId && m.recipientId === userId)
    );
    const lastMsg = threadMsgs.length ? threadMsgs[threadMsgs.length - 1] : null;
    const unreadCount = threadMsgs.filter(m => m.senderId === friendId && m.recipientId === userId && !m.read).length;

    return {
      id: friendId,
      friendshipId: f.id,
      username: user ? user.username : 'Scholar',
      email: user ? user.email : '',
      level: user ? user.level || 1 : 1,
      avatar: user ? user.avatar || { id: 'peasant' } : { id: 'peasant' },
      stats: user ? user.stats || {} : {},
      online: onlineUserIds.has(friendId),
      lastMessage: lastMsg ? {
        text: lastMsg.text || (lastMsg.attachment ? ('📎 ' + (lastMsg.attachment.originalName || 'Attachment')) : ''),
        timestamp: lastMsg.timestamp || lastMsg.created_at,
        senderId: lastMsg.senderId || lastMsg.sender_id
      } : null,
      unreadCount
    };
  });

  // Sort friends: online first, then by last message time or username
  friends.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    const timeA = a.lastMessage ? new Date(a.lastMessage.timestamp).getTime() : 0;
    const timeB = b.lastMessage ? new Date(b.lastMessage.timestamp).getTime() : 0;
    if (timeA !== timeB) return timeB - timeA;
    return a.username.localeCompare(b.username);
  });

  return friends;
}

// ── Direct Message Store Operations ─────────────────────────────────────────

async function saveDirectMessage(senderId, recipientId, text = '', attachment = null) {
  const now = new Date().toISOString();
  const newMsg = {
    id: uuidv4(),
    senderId,
    recipientId,
    text: text ? text.trim() : '',
    attachment: attachment || null,
    timestamp: now,
    read: false
  };

  if (pgPool) {
    const res = await pgPool.query(
      `INSERT INTO direct_messages (id, sender_id, recipient_id, text, attachment, created_at, read)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [newMsg.id, senderId, recipientId, newMsg.text, JSON.stringify(attachment), now, false]
    );
    return res.rows[0];
  } else {
    const list = readJSON(MESSAGES_FILE);
    list.push(newMsg);
    writeJSON(MESSAGES_FILE, list);
    return newMsg;
  }
}

async function getDirectMessages(user1Id, user2Id) {
  if (pgPool) {
    const res = await pgPool.query(
      `SELECT * FROM direct_messages 
        WHERE (sender_id = $1 AND recipient_id = $2) 
           OR (sender_id = $2 AND recipient_id = $1)
        ORDER BY created_at ASC`,
      [user1Id, user2Id]
    );
    return res.rows.map(r => ({
      id: r.id,
      senderId: r.sender_id,
      recipientId: r.recipient_id,
      text: r.text,
      attachment: r.attachment,
      timestamp: r.created_at,
      read: r.read
    }));
  }

  const list = readJSON(MESSAGES_FILE);
  return list.filter(m => 
    (m.senderId === user1Id && m.recipientId === user2Id) ||
    (m.senderId === user2Id && m.recipientId === user1Id)
  ).sort((a, b) => new Date(a.timestamp || a.created_at) - new Date(b.timestamp || b.created_at));
}

async function markMessagesAsRead(currentUserId, friendId) {
  if (pgPool) {
    await pgPool.query(
      `UPDATE direct_messages SET read = true 
        WHERE sender_id = $1 AND recipient_id = $2 AND read = false`,
      [friendId, currentUserId]
    );
  } else {
    const list = readJSON(MESSAGES_FILE);
    let changed = false;
    list.forEach(m => {
      if (m.senderId === friendId && m.recipientId === currentUserId && !m.read) {
        m.read = true;
        changed = true;
      }
    });
    if (changed) writeJSON(MESSAGES_FILE, list);
  }
}

module.exports = {
  getUserById,
  getFriendshipBetween,
  sendFriendRequest,
  respondFriendRequest,
  getPendingRequests,
  getFriendsList,
  saveDirectMessage,
  getDirectMessages,
  markMessagesAsRead
};
