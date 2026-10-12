/* ============================================================
   Route: /api/friends
   Handles: User search, friend requests, friend list & responses
   ============================================================ */

const express = require('express');
const { verifyToken } = require('../middleware/auth');
const db = require('../db');
const store = require('../modules/studySyncStore');

const router = express.Router();

// ── GET /api/friends/search?q=... ─────────────────────────────
// Search registered scholars by username or email
router.get('/search', verifyToken, async (req, res) => {
  try {
    const query = (req.query.q || '').trim().toLowerCase();
    if (!query || query.length < 1) {
      return res.json({ users: [] });
    }

    const currentUserId = req.user.id;
    const { rows: matches } = await db.query(
      `SELECT id, username, email, level, avatar, stats FROM users
       WHERE id != $1 AND (LOWER(username) LIKE $2 OR LOWER(email) LIKE $2)
       LIMIT 30`,
      [currentUserId, `%${query}%`]
    );

    // Attach relationship status for each matched user
    const results = await Promise.all(matches.map(async (u) => {
      const friendship = await store.getFriendshipBetween(currentUserId, u.id);
      let relationshipStatus = 'none';
      let requestId = null;

      if (friendship) {
        const reqId = friendship.requesterId || friendship.requester_id;
        requestId = friendship.id;
        if (friendship.status === 'accepted') {
          relationshipStatus = 'accepted';
        } else if (friendship.status === 'pending') {
          relationshipStatus = (reqId === currentUserId) ? 'pending_sent' : 'pending_received';
        } else if (friendship.status === 'declined') {
          relationshipStatus = 'declined';
        }
      }

      return {
        id: u.id,
        username: u.username,
        email: u.email,
        level: u.level || 1,
        avatar: u.avatar || { id: 'peasant' },
        stats: u.stats || {},
        relationshipStatus,
        requestId
      };
    }));

    res.json({ users: results });
  } catch (err) {
    console.error('[Friends API Error] search:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/friends/request ─────────────────────────────────
// Body: { recipientId }
router.post('/request', verifyToken, async (req, res) => {
  try {
    const { recipientId } = req.body;
    const requesterId = req.user.id;

    if (!recipientId) {
      return res.status(400).json({ error: 'recipientId is required' });
    }

    const recipient = await store.getUserById(recipientId);
    if (!recipient) {
      return res.status(404).json({ error: 'Scholar not found' });
    }

    const friendship = await store.sendFriendRequest(requesterId, recipientId);

    // Notify recipient via Socket.io if online
    const socketModule = require('../modules/studySyncSocket');
    if (socketModule && socketModule.notifyFriendRequest) {
      const requester = await store.getUserById(requesterId);
      socketModule.notifyFriendRequest(recipientId, {
        id: friendship.id,
        requesterId,
        recipientId,
        user: requester,
        createdAt: friendship.createdAt || friendship.created_at
      });
    }

    res.status(201).json({
      message: 'Friend request sent!',
      friendship
    });
  } catch (err) {
    console.error('[Friends API Error] request:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── GET /api/friends/requests ─────────────────────────────────
// Get incoming and outgoing pending friend requests
router.get('/requests', verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const { incoming, outgoing } = await store.getPendingRequests(currentUserId);
    res.json({ incoming, outgoing });
  } catch (err) {
    console.error('[Friends API Error] requests:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/friends/respond ─────────────────────────────────
// Body: { requestId, action: 'accept' | 'decline' }
router.post('/respond', verifyToken, async (req, res) => {
  try {
    const { requestId, action } = req.body;
    const currentUserId = req.user.id;

    if (!requestId || !action || !['accept', 'decline'].includes(action)) {
      return res.status(400).json({ error: 'Valid requestId and action (accept/decline) required' });
    }

    const updated = await store.respondFriendRequest(requestId, currentUserId, action);

    // Notify via Socket.io
    const socketModule = require('../modules/studySyncSocket');
    if (socketModule && socketModule.notifyFriendResponse) {
      const otherUserId = (updated.requesterId === currentUserId || updated.requester_id === currentUserId)
        ? (updated.recipientId || updated.recipient_id)
        : (updated.requesterId || updated.requester_id);
      socketModule.notifyFriendResponse(otherUserId, {
        requestId,
        action,
        userId: currentUserId,
        user: await store.getUserById(currentUserId)
      });
    }

    res.json({
      message: action === 'accept' ? 'Friend request accepted!' : 'Friend request declined.',
      friendship: updated
    });
  } catch (err) {
    console.error('[Friends API Error] respond:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── GET /api/friends/list ─────────────────────────────────────
// Retrieve all accepted friends with online status & last message
router.get('/list', verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const socketModule = require('../modules/studySyncSocket');
    const onlineSet = (socketModule && socketModule.getOnlineUsersSet) ? socketModule.getOnlineUsersSet() : new Set();

    const friends = await store.getFriendsList(currentUserId, onlineSet);
    res.json({ friends });
  } catch (err) {
    console.error('[Friends API Error] list:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
