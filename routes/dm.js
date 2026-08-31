/* ============================================================
   Route: /api/dm
   Handles: 1:1 Direct Messages history, file attachments, fallback sending
   ============================================================ */

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { verifyToken } = require('../middleware/auth');
const store = require('../modules/studySyncStore');

const router = express.Router();

// Upload Directory
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'dm');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const sanitizedBase = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${sanitizedBase}-${uniqueSuffix}${ext}`);
  }
});

// Allowed file extensions whitelist:
// PDF, Images (PNG, JPG, GIF, WebP), Text/MD (.txt, .md), Code (.py, .js, .jsx, .ts, .tsx, .java, .rb, .cpp, .c, .cs, .html, .css, .json, .go, .rs, .sql, .sh, .php, .swift, .kt)
const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.txt', '.md',
  '.py', '.js', '.jsx', '.ts', '.tsx', '.java', '.rb',
  '.cpp', '.c', '.cs', '.h', '.hpp',
  '.html', '.css', '.scss', '.json', '.xml', '.yaml', '.yml',
  '.go', '.rs', '.sql', '.sh', '.php', '.swift', '.kt'
]);

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_EXTENSIONS.has(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`File type '${ext}' is not allowed. Supported formats: PDF, Images (PNG, JPG, GIF, WebP), Text/MD, and Source Code (.py, .js, .java, .cpp, etc.)`), false);
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 5 MB Cap
  fileFilter
});

// ── GET /api/dm/history/:friendId ─────────────────────────────
// Retrieve conversation history with a friend and mark as read
router.get('/history/:friendId', verifyToken, async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const friendId = req.params.friendId;

    if (!friendId) {
      return res.status(400).json({ error: 'friendId is required' });
    }

    const messages = await store.getDirectMessages(currentUserId, friendId);
    await store.markMessagesAsRead(currentUserId, friendId);

    res.json({ messages });
  } catch (err) {
    console.error('[DM API Error] history:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/dm/upload ───────────────────────────────────────
// Upload a file attachment for direct messages (20MB cap, type checked)
router.post('/upload', verifyToken, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File exceeds maximum allowed size of 20MB.' });
      }
      return res.status(400).json({ error: err.message });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    let category = 'document';
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) category = 'image';
    else if (ext === '.pdf') category = 'pdf';
    else if (['.txt', '.md'].includes(ext)) category = 'text';
    else category = 'code';

    const filePayload = {
      url: `/uploads/dm/${req.file.filename}`,
      originalName: req.file.originalname,
      fileName: req.file.filename,
      fileType: category,
      mimeType: req.file.mimetype,
      fileSize: req.file.size
    };

    res.status(201).json({
      message: 'File uploaded successfully',
      file: filePayload
    });
  });
});

// ── POST /api/dm/send ─────────────────────────────────────────
// Fallback REST endpoint to send DM message
router.post('/send', verifyToken, async (req, res) => {
  try {
    const senderId = req.user.id;
    const { recipientId, text, attachment } = req.body;

    if (!recipientId) {
      return res.status(400).json({ error: 'recipientId is required' });
    }

    if (!text && !attachment) {
      return res.status(400).json({ error: 'Message must contain text or an attachment' });
    }

    const savedMsg = await store.saveDirectMessage(senderId, recipientId, text, attachment);

    // Broadcast via socket to both recipient and sender
    const socketModule = require('../modules/studySyncSocket');
    if (socketModule && socketModule.sendDirectMessageEvent) {
      socketModule.sendDirectMessageEvent(recipientId, savedMsg);
      socketModule.sendDirectMessageEvent(senderId, savedMsg);
    }

    res.status(201).json({
      message: 'DM sent successfully',
      dm: savedMsg
    });
  } catch (err) {
    console.error('[DM API Error] send:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
