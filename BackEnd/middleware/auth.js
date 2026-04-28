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
    const token = req.cookies?.authToken;

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, jwtConfig.secret);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        // ✅ token หมดอายุ → ลอง refresh จาก refreshToken อัตโนมัติ
        return tryRefreshAndContinue(req, res, next);
      }
      return res.status(401).json({ error: 'Invalid token', code: 'TOKEN_INVALID' });
    }

    // ✅ ถ้า token จะหมดใน 5 นาที → ต่ออายุให้เลย (silent refresh)
    const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);
    if (expiresIn < 5 * 60) {
      const newToken = jwt.sign({ userId: decoded.userId }, jwtConfig.secret, { expiresIn: '1d' });
      res.cookie('authToken', newToken, accessCookieOptions);
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

// ── ถ้า access token หมดอายุ → เช็ค refresh token แทน ──
const tryRefreshAndContinue = async (req, res, next) => {
  const refreshToken = req.cookies?.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({ error: 'Session expired', code: 'REFRESH_EXPIRED' });
  }

  try {
    const decoded = jwt.verify(refreshToken, jwtConfig.refreshSecret);
    const user    = await User.findById(decoded.userId).select('-password');

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // ✅ ออก access token ใหม่ใส่ cookie เลย — frontend ไม่ต้องทำอะไร
    const newToken = jwt.sign({ userId: user._id }, jwtConfig.secret, { expiresIn: '1d' });
    res.cookie('authToken', newToken, accessCookieOptions);

    req.user = user;
    next(); // ✅ ดำเนินการ request เดิมต่อได้เลย
  } catch (err) {
    // refresh token หมดอายุด้วย → force logout
    res.clearCookie('authToken',     { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/' });
    res.clearCookie('refreshToken',  { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/auth/verify' });
    return res.status(401).json({ error: 'Session expired', code: 'REFRESH_EXPIRED' });
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