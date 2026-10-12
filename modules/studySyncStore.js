/* ============================================================
   ScholarQuest — Friends & Direct Messages Store
   Storage: Neon PostgreSQL
   ============================================================ */

const db = require('../db');
const { v4: uuidv4 } = require('uuid');

// ── User helpers ─────────────────────────────────────────────

async function getUserById(userId) {
  const res = await db.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [userId]);
  if (!res.rows.length) return null;
  const { password_hash, ...u } = res.rows[0];
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    level: u.level || 1,
    avatar: u.avatar || { id: 'peasant' },
    stats: u.stats || {}
  };
}

// ── Friendship Store ─────────────────────────────────────────

async function getFriendshipBetween(user1Id, user2Id) {
  const res = await db.query(
    `SELECT * FROM friendships
      WHERE (requester_id = $1 AND recipient_id = $2)
         OR (requester_id = $2 AND recipient_id = $1)
      LIMIT 1`,
    [user1Id, user2Id]
  );
  return res.rows[0] || null;
}

async function sendFriendRequest(requesterId, recipientId) {
  if (requesterId === recipientId) throw new Error('You cannot send a friend request to yourself.');

  const existing = await getFriendshipBetween(requesterId, recipientId);
  const now = new Date().toISOString();

  if (existing) {
    const reqId = existing.requester_id;
    if (existing.status === 'accepted') throw new Error('You are already friends with this scholar.');
    if (existing.status === 'pending') {
      if (reqId === requesterId) throw new Error('Friend request already sent.');
      // Other person already sent — auto-accept
      return await respondFriendRequest(existing.id, requesterId, 'accept');
    }
    // Re-open declined request
    const res = await db.query(
      `UPDATE friendships SET requester_id = $1, recipient_id = $2, status = 'pending', updated_at = $3 WHERE id = $4 RETURNING *`,
      [requesterId, recipientId, now, existing.id]
    );
    return res.rows[0];
  }

  const id = uuidv4();
  const res = await db.query(
    `INSERT INTO friendships (id, requester_id, recipient_id, status, created_at, updated_at)
      VALUES ($1, $2, $3, 'pending', $4, $4) RETURNING *`,
    [id, requesterId, recipientId, now]
  );
  return res.rows[0];
}

async function respondFriendRequest(requestId, userId, action) {
  const status = action === 'accept' ? 'accepted' : 'declined';
  const res = await db.query(
    `UPDATE friendships
      SET status = $1, updated_at = NOW()
      WHERE id = $2 AND (recipient_id = $3 OR requester_id = $3)
      RETURNING *`,
    [status, requestId, userId]
  );
  if (!res.rows.length) throw new Error('Friend request not found or unauthorized.');
  return res.rows[0];
}

async function getPendingRequests(userId) {
  const inRes = await db.query(
    `SELECT * FROM friendships WHERE recipient_id = $1 AND status = 'pending' ORDER BY created_at DESC`,
    [userId]
  );
  const outRes = await db.query(
    `SELECT * FROM friendships WHERE requester_id = $1 AND status = 'pending' ORDER BY created_at DESC`,
    [userId]
  );

  const augmentedIncoming = await Promise.all(inRes.rows.map(async (req) => {
    const user = await getUserById(req.requester_id);
    return {
      id: req.id,
      requesterId: req.requester_id,
      recipientId: req.recipient_id,
      createdAt: req.created_at,
      status: req.status,
      user: user || { id: req.requester_id, username: 'Unknown Scholar', level: 1, avatar: { id: 'peasant' } }
    };
  }));

  return { incoming: augmentedIncoming, outgoing: outRes.rows };
}

async function getFriendsList(userId, onlineUserIds = new Set()) {
  const res = await db.query(
    `SELECT * FROM friendships
      WHERE (requester_id = $1 OR recipient_id = $1) AND status = 'accepted'`,
    [userId]
  );

  const msgsRes = await db.query(
    `SELECT * FROM direct_messages
      WHERE sender_id = $1 OR recipient_id = $1
      ORDER BY created_at ASC`,
    [userId]
  );
  const allMessages = msgsRes.rows;

  const friends = await Promise.all(res.rows.map(async (f) => {
    const friendId = f.requester_id === userId ? f.recipient_id : f.requester_id;
    const user = await getUserById(friendId);

    const threadMsgs = allMessages.filter(m =>
      (m.sender_id === userId && m.recipient_id === friendId) ||
      (m.sender_id === friendId && m.recipient_id === userId)
    );
    const lastMsg = threadMsgs.length ? threadMsgs[threadMsgs.length - 1] : null;
    const unreadCount = threadMsgs.filter(m => m.sender_id === friendId && m.recipient_id === userId && !m.read).length;

    return {
      id: friendId,
      friendshipId: f.id,
      username: user?.username || 'Scholar',
      email: user?.email || '',
      level: user?.level || 1,
      avatar: user?.avatar || { id: 'peasant' },
      stats: user?.stats || {},
      online: onlineUserIds.has(friendId),
      lastMessage: lastMsg ? {
        text: lastMsg.text || (lastMsg.attachment ? ('📎 ' + (lastMsg.attachment.originalName || 'Attachment')) : ''),
        timestamp: lastMsg.created_at,
        senderId: lastMsg.sender_id
      } : null,
      unreadCount
    };
  }));

  friends.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    const timeA = a.lastMessage ? new Date(a.lastMessage.timestamp).getTime() : 0;
    const timeB = b.lastMessage ? new Date(b.lastMessage.timestamp).getTime() : 0;
    if (timeA !== timeB) return timeB - timeA;
    return a.username.localeCompare(b.username);
  });

  return friends;
}

// ── Direct Message Store ─────────────────────────────────────

async function saveDirectMessage(senderId, recipientId, text = '', attachment = null) {
  const id = uuidv4();
  const res = await db.query(
    `INSERT INTO direct_messages (id, sender_id, recipient_id, text, attachment, read, created_at)
      VALUES ($1, $2, $3, $4, $5, false, NOW()) RETURNING *`,
    [id, senderId, recipientId, text ? text.trim() : '', attachment ? JSON.stringify(attachment) : null]
  );
  const m = res.rows[0];
  return {
    id: m.id,
    senderId: m.sender_id,
    recipientId: m.recipient_id,
    text: m.text,
    attachment: m.attachment,
    timestamp: m.created_at,
    read: m.read
  };
}

async function getDirectMessages(user1Id, user2Id) {
  const res = await db.query(
    `SELECT * FROM direct_messages
      WHERE (sender_id = $1 AND recipient_id = $2)
         OR (sender_id = $2 AND recipient_id = $1)
      ORDER BY created_at ASC`,
    [user1Id, user2Id]
  );
  return res.rows.map(m => ({
    id: m.id,
    senderId: m.sender_id,
    recipientId: m.recipient_id,
    text: m.text,
    attachment: m.attachment,
    timestamp: m.created_at,
    read: m.read
  }));
}

async function markMessagesAsRead(currentUserId, friendId) {
  await db.query(
    `UPDATE direct_messages SET read = true
      WHERE sender_id = $1 AND recipient_id = $2 AND read = false`,
    [friendId, currentUserId]
  );
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
