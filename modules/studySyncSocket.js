/* ============================================================
   ScholarQuest — StudySync Real-Time Socket.io Controller
   Handles real-time room lifecycle, 15-member cap, 60s disconnect grace,
   auto host promotion, synced activities & live leaderboard.
   ============================================================ */

const store = require('./studySyncStore');
const fs = require('fs');
const path = require('path');

// Load Quiz Bank for synchronized activities
let QUIZ_BANK = [];
try {
  const quizPath = path.join(__dirname, '..', 'data', 'quizzes.json');
  if (fs.existsSync(quizPath)) {
    QUIZ_BANK = JSON.parse(fs.readFileSync(quizPath, 'utf8'));
  }
} catch (e) {
  console.warn('[StudySync] Could not load backend quizzes.json bank:', e.message);
}

// Fallback questions if bank is empty
const DEFAULT_QUESTIONS = [
  {
    id: 'q1',
    text: 'Which protocol is used to transmit data securely over the web?',
    options: ['HTTP', 'HTTPS', 'FTP', 'SMTP'],
    answerIndex: 1
  },
  {
    id: 'q2',
    text: 'In database systems, what does the "A" in ACID stand for?',
    options: ['Atomicity', 'Algorithm', 'Access', 'Allocation'],
    answerIndex: 0
  },
  {
    id: 'q3',
    text: 'Which of the following is a linear data structure?',
    options: ['Tree', 'Graph', 'Linked List', 'Trie'],
    answerIndex: 2
  },
  {
    id: 'q4',
    text: 'Which time complexity represents binary search in a sorted array?',
    options: ['O(n)', 'O(n²)', 'O(log n)', 'O(1)'],
    answerIndex: 2
  }
];

// Socket to Room mapping for fast lookup
const socketToUser = new Map(); // socketId -> { roomId, userId }
const disconnectTimers = new Map(); // `${roomId}:${userId}` -> setTimeout ID

function setupStudySyncSocket(io) {
  io.on('connection', (socket) => {
    console.log(`[Socket.io] Client connected: ${socket.id}`);

    // ── 1. ROOM CREATION ──────────────────────────────────────────────────
    socket.on('room:create', async (data, callback) => {
      try {
        const { userId, username, avatar } = data || {};
        if (!userId || !username) {
          const errPayload = { success: false, error: 'User ID and username are required to create a room.' };
          if (callback) return callback(errPayload);
          return socket.emit('room:error', errPayload);
        }

        const room = await store.createRoom(userId, username, avatar || 'peasant');
        const roomChannel = `room:${room.id}`;
        
        socket.join(roomChannel);
        socketToUser.set(socket.id, { roomId: room.id, userId });

        const members = await store.getRoomMembers(room.id);
        const responsePayload = {
          success: true,
          roomId: room.id,
          joinCode: room.join_code,
          hostUserId: room.host_user_id,
          members,
          currentActivity: room.current_activity
        };

        if (callback) callback(responsePayload);
        socket.emit('room:created', responsePayload);
        io.to(roomChannel).emit('room:memberUpdate', {
          roomId: room.id,
          joinCode: room.join_code,
          hostUserId: room.host_user_id,
          members,
          maxMembers: 15
        });
      } catch (err) {
        console.error('[Socket Error] room:create failed:', err.message);
        const errPayload = { success: false, error: 'Failed to create study room.' };
        if (callback) callback(errPayload);
        socket.emit('room:error', errPayload);
      }
    });

    // ── 2. JOIN ROOM (Enforces Max 15 Concurrent Members) ───────────────────
    socket.on('room:join', async (data, callback) => {
      try {
        const { joinCode, userId, username, avatar } = data || {};
        const cleanCode = (joinCode || '').trim().toUpperCase();

        if (!cleanCode || !userId || !username) {
          const errPayload = { success: false, error: 'Please enter a valid 6-character room code.' };
          if (callback) return callback(errPayload);
          return socket.emit('room:error', errPayload);
        }

        const room = await store.getRoomByCode(cleanCode);
        if (!room) {
          const errPayload = { success: false, error: `Study Room "${cleanCode}" not found or closed.` };
          if (callback) return callback(errPayload);
          return socket.emit('room:error', errPayload);
        }

        // Cancel any pending 60s disconnect grace timer for this user
        const graceKey = `${room.id}:${userId}`;
        if (disconnectTimers.has(graceKey)) {
          clearTimeout(disconnectTimers.get(graceKey));
          disconnectTimers.delete(graceKey);
        }

        // Check active member count (MAX 15 MEMBERS)
        const members = await store.getRoomMembers(room.id);
        const existingMember = members.find(m => m.user_id === userId);
        const activeCount = await store.getActiveMemberCount(room.id);

        if (!existingMember && activeCount >= 15) {
          const fullErr = { success: false, error: 'Room Full (15/15)' };
          if (callback) return callback(fullErr);
          return socket.emit('room:error', fullErr);
        }

        // Add or update member state
        await store.addOrUpdateMember(room.id, userId, username, avatar || 'peasant');
        
        const roomChannel = `room:${room.id}`;
        socket.join(roomChannel);
        socketToUser.set(socket.id, { roomId: room.id, userId });

        const updatedMembers = await store.getRoomMembers(room.id);
        const updatedRoom = await store.getRoomById(room.id);

        const joinSuccessPayload = {
          success: true,
          roomId: room.id,
          joinCode: room.join_code,
          hostUserId: updatedRoom.host_user_id,
          members: updatedMembers,
          currentActivity: updatedRoom.current_activity,
          currentQuestionId: updatedRoom.current_question_id
        };

        if (callback) callback(joinSuccessPayload);
        socket.emit('room:joined', joinSuccessPayload);

        // Broadcast updated member list & count to everyone in the room
        io.to(roomChannel).emit('room:memberUpdate', {
          roomId: room.id,
          joinCode: room.join_code,
          hostUserId: updatedRoom.host_user_id,
          members: updatedMembers,
          maxMembers: 15
        });
      } catch (err) {
        console.error('[Socket Error] room:join failed:', err.message);
        const errPayload = { success: false, error: 'Could not join room. Please check the code.' };
        if (callback) callback(errPayload);
        socket.emit('room:error', errPayload);
      }
    });

    // ── 3. RECONNECT ROOM (Page refresh / recovery) ──────────────────────
    socket.on('room:reconnect', async (data, callback) => {
      try {
        const { roomId, userId, username, avatar } = data || {};
        if (!roomId || !userId) return;

        const room = await store.getRoomById(roomId);
        if (!room || room.status !== 'active') {
          if (callback) callback({ success: false });
          return;
        }

        const graceKey = `${roomId}:${userId}`;
        if (disconnectTimers.has(graceKey)) {
          clearTimeout(disconnectTimers.get(graceKey));
          disconnectTimers.delete(graceKey);
        }

        await store.addOrUpdateMember(roomId, userId, username || 'Scholar', avatar || 'peasant');
        
        const roomChannel = `room:${roomId}`;
        socket.join(roomChannel);
        socketToUser.set(socket.id, { roomId, userId });

        const members = await store.getRoomMembers(roomId);
        const payload = {
          success: true,
          roomId: room.id,
          joinCode: room.join_code,
          hostUserId: room.host_user_id,
          members,
          currentActivity: room.current_activity,
          currentQuestionId: room.current_question_id
        };

        if (callback) callback(payload);
        socket.emit('room:reconnected', payload);

        io.to(roomChannel).emit('room:memberUpdate', {
          roomId: room.id,
          joinCode: room.join_code,
          hostUserId: room.host_user_id,
          members,
          maxMembers: 15
        });
      } catch (err) {
        console.error('[Socket Error] room:reconnect failed:', err.message);
      }
    });

    // ── 4. EXPLICIT LEAVE ROOM ─────────────────────────────────────────────
    socket.on('room:leave', async (data) => {
      try {
        const { roomId, userId } = data || {};
        if (!roomId || !userId) return;

        await store.removeMember(roomId, userId);
        const roomChannel = `room:${roomId}`;
        socket.leave(roomChannel);
        socketToUser.delete(socket.id);

        const newHostId = await store.promoteNextHostIfNeeded(roomId);
        const members = await store.getRoomMembers(roomId);

        io.to(roomChannel).emit('room:memberUpdate', {
          roomId,
          hostUserId: newHostId,
          members,
          maxMembers: 15
        });
      } catch (err) {
        console.error('[Socket Error] room:leave failed:', err.message);
      }
    });

    // ── 4b. REAL-TIME CHAT BROADCAST ──────────────────────────────────────
    socket.on('room:chat', async (data) => {
      try {
        const { roomId, message, sender, userId } = data || {};
        if (!roomId || !message) return;

        const userInfo = socketToUser.get(socket.id);
        const effectiveUserId = userId || (userInfo ? userInfo.userId : 'unknown');
        const roomChannel = `room:${roomId}`;

        const chatPayload = {
          roomId,
          sender: sender || 'Scholar',
          userId: effectiveUserId,
          text: message,
          timestamp: Date.now()
        };

        io.to(roomChannel).emit('room:chat', chatPayload);
      } catch (err) {
        console.error('[Socket Error] room:chat failed:', err.message);
      }
    });

    // ── 5. START SHARED ACTIVITY (Host Only) ──────────────────────────────
    socket.on('activity:start', async (data, callback) => {
      try {
        const { roomId, activityType = 'quizforge' } = data || {};
        const room = await store.getRoomById(roomId);

        if (!room) return;

        // Reset scores for all members when a new shared activity starts
        const members = await store.getRoomMembers(roomId);
        for (const m of members) {
          m.score = 0;
        }

        // Get questions bank
        let questionsList = DEFAULT_QUESTIONS;
        if (QUIZ_BANK.length > 0) {
          const sampleQuiz = QUIZ_BANK[Math.floor(Math.random() * QUIZ_BANK.length)];
          if (sampleQuiz && sampleQuiz.questions) {
            questionsList = sampleQuiz.questions.map((q, idx) => ({
              id: q.id || `q${idx + 1}`,
              text: q.text,
              options: q.options,
              answerIndex: q.options.findIndex(opt => opt === q.correctAnswer) >= 0 
                ? q.options.findIndex(opt => opt === q.correctAnswer) 
                : 0
            }));
          }
        }

        await store.setRoomActivity(roomId, activityType, questionsList[0].id);

        const roomChannel = `room:${roomId}`;
        const activityPayload = {
          activityType,
          questions: questionsList,
          currentIndex: 0,
          currentQuestion: questionsList[0]
        };

        if (callback) callback({ success: true });
        io.to(roomChannel).emit('activity:started', activityPayload);
      } catch (err) {
        console.error('[Socket Error] activity:start failed:', err.message);
      }
    });

    // ── 6. ANSWER SUBMISSION & REAL-TIME LEADERBOARD ─────────────────────
    socket.on('activity:answerSubmitted', async (data) => {
      try {
        const { roomId, userId, isCorrect } = data || {};
        if (!roomId || !userId) return;

        if (isCorrect) {
          await store.updateMemberScore(roomId, userId, 100);
        }

        const members = await store.getRoomMembers(roomId);
        const roomChannel = `room:${roomId}`;

        // Format live room leaderboard (sorted by score DESC)
        const leaderboard = members
          .map(m => ({
            userId: m.user_id,
            username: m.username,
            avatar: m.avatar,
            score: m.score || 0,
            isConnected: m.is_connected
          }))
          .sort((a, b) => b.score - a.score);

        io.to(roomChannel).emit('activity:scoreUpdate', { leaderboard });
      } catch (err) {
        console.error('[Socket Error] activity:answerSubmitted failed:', err.message);
      }
    });

    // ── 7. ADVANCE TO NEXT QUESTION TOGETHER ──────────────────────────────
    socket.on('activity:nextQuestion', async (data) => {
      try {
        const { roomId, nextIndex, question } = data || {};
        if (!roomId) return;

        const roomChannel = `room:${roomId}`;
        io.to(roomChannel).emit('activity:questionChanged', {
          currentIndex: nextIndex,
          question
        });
      } catch (err) {
        console.error('[Socket Error] activity:nextQuestion failed:', err.message);
      }
    });

    // ── 8. DISCONNECT & 60-SECOND GRACE TIMER ─────────────────────────────
    socket.on('disconnect', async () => {
      const userInfo = socketToUser.get(socket.id);
      socketToUser.delete(socket.id);

      if (!userInfo) return;
      const { roomId, userId } = userInfo;

      console.log(`[Socket.io] Client disconnected: ${socket.id} (User ${userId} in Room ${roomId})`);
      
      // Mark as disconnected in DB
      await store.setMemberConnectionState(roomId, userId, false);

      const roomChannel = `room:${roomId}`;
      const membersAfterDisconnect = await store.getRoomMembers(roomId);
      const room = await store.getRoomById(roomId);

      // Broadcast instant disconnected state to room
      io.to(roomChannel).emit('room:memberUpdate', {
        roomId,
        hostUserId: room ? room.host_user_id : null,
        members: membersAfterDisconnect,
        maxMembers: 15
      });

      // Start 60-second Grace Window Timer
      const graceKey = `${roomId}:${userId}`;
      if (disconnectTimers.has(graceKey)) {
        clearTimeout(disconnectTimers.get(graceKey));
      }

      const timerId = setTimeout(async () => {
        disconnectTimers.delete(graceKey);
        console.log(`[Grace Timer Expired] Purging user ${userId} from room ${roomId}`);

        // Purge expired disconnected member to free up 15-member slot
        await store.purgeExpiredDisconnectedMembers(roomId, 60000);

        // Auto-promote next host if original host disconnected and didn't return
        const newHostId = await store.promoteNextHostIfNeeded(roomId);
        const updatedMembers = await store.getRoomMembers(roomId);

        io.to(roomChannel).emit('room:memberUpdate', {
          roomId,
          hostUserId: newHostId,
          members: updatedMembers,
          maxMembers: 15
        });
      }, 60000); // 60 seconds

      disconnectTimers.set(graceKey, timerId);
    });
  });
}

module.exports = setupStudySyncSocket;
