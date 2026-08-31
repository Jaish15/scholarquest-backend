/* ============================================================
   ScholarQuest — Friends & Direct Messages Real-Time Socket Controller
   Handles real-time 1:1 DMs, online/offline status, friend notifications
   ============================================================ */

const store = require('./studySyncStore');

// Online user tracking: Map<userId, Set<socketId>>
const userSockets = new Map();
// Socket to User lookup: Map<socketId, { userId, username }>
const socketUsers = new Map();
// Pending offline battle invites: Map<userId, Array<{ senderId, senderName, message }>>
const pendingOfflineBattleInvites = new Map();

let ioInstance = null;

function setupStudySyncSocket(io) {
  ioInstance = io;

  io.on('connection', (socket) => {
    console.log(`[Socket.io] Client connected: ${socket.id}`);

    // ── 1. USER REGISTRATION & AUTH ──────────────────────────────────────
    socket.on('user:register', async (data) => {
      try {
        const { userId, username } = data || {};
        if (!userId) return;

        // Associate socket with user
        if (!userSockets.has(userId)) {
          userSockets.set(userId, new Set());
        }
        userSockets.get(userId).add(socket.id);
        socketUsers.set(socket.id, { userId, username });

        // Join personal user room for direct targeting
        socket.join(`user:${userId}`);

        console.log(`[Socket.io] Registered user ${username || userId} (${socket.id})`);

        // Broadcast online status to friends
        broadcastStatusToFriends(userId, true);

        // Send initial online friends list to this socket
        const friends = await store.getFriendsList(userId, getOnlineUsersSet());
        socket.emit('friends:list', { friends });

        // Check and deliver any pending offline battle invites
        if (pendingOfflineBattleInvites.has(userId)) {
          const pendingList = pendingOfflineBattleInvites.get(userId) || [];
          pendingList.forEach(invite => {
            socket.emit('battle:invite', invite);
          });
          pendingOfflineBattleInvites.delete(userId);
        }

      } catch (err) {
        console.error('[Socket Error] user:register:', err.message);
      }
    });

    // ── 2. DIRECT MESSAGING (1:1 Chat) ───────────────────────────────────
    socket.on('dm:send', async (data, callback) => {
      try {
        const senderInfo = socketUsers.get(socket.id);
        const senderId = (data && data.senderId) || (senderInfo && senderInfo.userId);
        const { recipientId, text, attachment } = data || {};

        if (!senderId || !recipientId) {
          const errPayload = { success: false, error: 'Sender and recipient ID are required.' };
          if (callback) return callback(errPayload);
          return socket.emit('dm:error', errPayload);
        }

        if (!text && !attachment) {
          const errPayload = { success: false, error: 'Message must contain text or an attachment.' };
          if (callback) return callback(errPayload);
          return socket.emit('dm:error', errPayload);
        }

        // Persist message to database
        const savedMessage = await store.saveDirectMessage(senderId, recipientId, text, attachment);

        const responsePayload = {
          success: true,
          message: savedMessage
        };

        // Confirmation to sender
        if (callback) callback(responsePayload);
        socket.emit('dm:sent', responsePayload);

        // Real-time delivery to recipient socket(s) and sender sockets
        io.to(`user:${recipientId}`).emit('dm:receive', savedMessage);
        io.to(`user:${senderId}`).emit('dm:receive', savedMessage);

      } catch (err) {
        console.error('[Socket Error] dm:send failed:', err.message);
        const errPayload = { success: false, error: 'Failed to send message.' };
        if (callback) callback(errPayload);
        socket.emit('dm:error', errPayload);
      }
    });

    // ── 3. REQUEST FRIENDS STATUS ────────────────────────────────────────
    socket.on('user:checkFriendsStatus', async (data) => {
      try {
        const userInfo = socketUsers.get(socket.id);
        const userId = (data && data.userId) || (userInfo && userInfo.userId);
        if (!userId) return;
        const friends = await store.getFriendsList(userId, getOnlineUsersSet());
        socket.emit('friends:list', { friends });
      } catch (err) {
        console.error('[Socket Error] user:checkFriendsStatus:', err.message);
      }
    });

    // ── 4. TYPING INDICATOR ──────────────────────────────────────────────
    socket.on('dm:typing', (data) => {
      const senderInfo = socketUsers.get(socket.id);
      const senderId = (senderInfo && senderInfo.userId) || (data && data.senderId);
      const { recipientId, isTyping } = data || {};
      if (senderId && recipientId) {
        io.to(`user:${recipientId}`).emit('dm:typing', {
          senderId,
          isTyping: !!isTyping
        });
      }
    });

    // ── 4. MARK AS READ ──────────────────────────────────────────────────
    socket.on('dm:read', async (data) => {
      try {
        const userInfo = socketUsers.get(socket.id);
        const currentUserId = (userInfo && userInfo.userId) || (data && data.userId);
        const { friendId } = data || {};
        if (currentUserId && friendId) {
          await store.markMessagesAsRead(currentUserId, friendId);
          io.to(`user:${friendId}`).emit('dm:readReceipt', { readBy: currentUserId, friendId });
        }
      } catch (err) {
        console.error('[Socket Error] dm:read:', err.message);
      }
    });

    // ── 5. BATTLE REMINDER NUDGE ──────────────────────────────────────────
    socket.on('battle:invite', async (data) => {
      try {
        const senderInfo = socketUsers.get(socket.id);
        const senderId = (data && data.senderId) || (senderInfo && senderInfo.userId);
        const senderName = (data && data.senderName) || (senderInfo && senderInfo.username) || 'A Scholar';
        const { targetUserId } = data || {};

        if (!senderId || !targetUserId) return;

        const reminderText = `⚔️ ${senderName} reminded you to battle in QuizForge!`;

        const isOnline = userSockets.has(targetUserId) && userSockets.get(targetUserId).size > 0;

        if (isOnline) {
          // Real-time reminder broadcast to target user for modal popup
          io.to(`user:${targetUserId}`).emit('battle:invite', {
            senderId,
            senderName,
            message: reminderText
          });
        } else {
          // Queue offline battle invite for delivery when recipient connects
          if (!pendingOfflineBattleInvites.has(targetUserId)) {
            pendingOfflineBattleInvites.set(targetUserId, []);
          }
          pendingOfflineBattleInvites.get(targetUserId).push({
            senderId,
            senderName,
            message: reminderText
          });
        }

      } catch (err) {
        console.error('[Socket Error] battle:invite failed:', err.message);
      }
    });

    // ── 6. DISCONNECT ────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`[Socket.io] Client disconnected: ${socket.id}`);
      const userInfo = socketUsers.get(socket.id);
      if (userInfo) {
        const { userId } = userInfo;
        socketUsers.delete(socket.id);

        const sockets = userSockets.get(userId);
        if (sockets) {
          sockets.delete(socket.id);
          if (sockets.size === 0) {
            userSockets.delete(userId);
            // Broadcast offline status to friends
            broadcastStatusToFriends(userId, false);
          }
        }
      }
    });
  });
}

function getOnlineUsersSet() {
  return new Set(userSockets.keys());
}

async function broadcastStatusToFriends(userId, isOnline) {
  if (!ioInstance) return;
  try {
    const friends = await store.getFriendsList(userId, getOnlineUsersSet());
    friends.forEach(f => {
      ioInstance.to(`user:${f.id}`).emit('user:status', {
        userId,
        online: isOnline
      });
    });
  } catch (e) {
    console.warn('[Socket] Could not broadcast status:', e.message);
  }
}

function notifyFriendRequest(recipientId, requestPayload) {
  if (!ioInstance) return;
  ioInstance.to(`user:${recipientId}`).emit('friend:request', requestPayload);
}

function notifyFriendResponse(recipientId, responsePayload) {
  if (!ioInstance) return;
  ioInstance.to(`user:${recipientId}`).emit('friend:response', responsePayload);
}

function sendDirectMessageEvent(recipientId, messagePayload) {
  if (!ioInstance) return;
  ioInstance.to(`user:${recipientId}`).emit('dm:receive', messagePayload);
}

module.exports = setupStudySyncSocket;
module.exports.getOnlineUsersSet = getOnlineUsersSet;
module.exports.notifyFriendRequest = notifyFriendRequest;
module.exports.notifyFriendResponse = notifyFriendResponse;
module.exports.sendDirectMessageEvent = sendDirectMessageEvent;
