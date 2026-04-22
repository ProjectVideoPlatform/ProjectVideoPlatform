const jwt = require('jsonwebtoken');
const User = require('../models/User');
const jwtConfig = require('../config/auth');
const logger = require('../utils/logger');

// ─────────────────────────────────────────────
// authenticateToken
// อ่าน JWT จาก httpOnly cookie ชื่อ 'authToken'
// ไม่รับ Authorization: Bearer header อีกต่อไป
// ─────────────────────────────────────────────
const authenticateToken = async (req, res, next) => {
  try {
    // ✅ อ่านจาก cookie แทน header — JS ฝั่ง client เข้าถึงไม่ได้
    const token = req.cookies?.authToken;

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, jwtConfig.secret);
    } catch (err) {
      // แยก error type เพื่อ debug ง่ายขึ้น
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ error: 'Invalid token', code: 'TOKEN_INVALID' });
    }

    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    next();
  } catch (error) {
    logger.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

// ─────────────────────────────────────────────
// requireAdmin — ใช้ต่อจาก authenticateToken
// ─────────────────────────────────────────────
const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

module.exports = { authenticateToken, requireAdmin };