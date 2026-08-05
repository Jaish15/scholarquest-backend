/* ============================================================
   Middleware: JWT Auth Verification
   Usage: add verifyToken to any route that needs auth
   ============================================================ */

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'scholarquest_secret_change_in_prod';

/**
 * Middleware to verify JWT from Authorization header
 * Header format: Authorization: Bearer <token>
 */
function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token      = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, username }
    next();
  } catch (err) {
    res.status(403).json({ error: 'Invalid or expired token.' });
  }
}

module.exports = { verifyToken };
