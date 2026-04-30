const jwt = require('jsonwebtoken');
const User = require('../models/User');
const jwtConfig = require('../config/auth');
const logger = require('../utils/logger');

const authenticateToken = async (req, res, next) => {
  try {
    const token = req.cookies?.authToken;

    if (!token) {
      return res.status(401).json({ error: 'Session expired', code: 'TOKEN_MISSING' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, jwtConfig.secret);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        // ✅ แค่บอก frontend ว่าหมดอายุ — ให้ frontend ไป /refresh เอง
        return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ error: 'Invalid token', code: 'TOKEN_INVALID' });
    }

    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      return res.status(401).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
    }

    // ✅ Hybrid hint — ถ้าใกล้หมด บอก frontend แต่ไม่ refresh ให้
    const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);
    if (expiresIn < 5 * 60) {
      res.set('X-Token-Expiring', 'true');
    }

    req.user = user;
    next();
  } catch (error) {
    logger.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

module.exports = { authenticateToken, requireAdmin };