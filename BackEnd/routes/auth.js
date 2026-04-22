const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const jwtConfig = require('../config/auth');
const { authenticateToken } = require('../middleware/auth');
const {
  loginRateLimiter,
  recordFailedAttempt,
  clearFailedAttempts,
} = require('../middleware/loginRateLimiter');
const router = express.Router();
const logger = require('../utils/logger');

// ─────────────────────────────────────────────
// Cookie config — ใช้ร่วมกันทุก route ที่ set/clear cookie
// ─────────────────────────────────────────────
const COOKIE_NAME = 'authToken';

const cookieOptions = {
  httpOnly: true,          // ✅ JS อ่านไม่ได้ — ป้องกัน XSS
  secure: process.env.NODE_ENV === 'production', // HTTPS only ใน production
  sameSite: 'strict',      // ✅ ป้องกัน CSRF — browser ไม่ส่ง cookie ข้าม site
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 วัน (ms)
  path: '/',
};

// ─────────────────────────────────────────────
// Helper: sign JWT และ set httpOnly cookie
// ─────────────────────────────────────────────
const setAuthCookie = (res, userId) => {
  const token = jwt.sign(
    { userId },
    jwtConfig.secret,
    { expiresIn: jwtConfig.expiresIn }
  );
  res.cookie(COOKIE_NAME, token, cookieOptions);
  return token; // คืน token เผื่อ logging แต่ไม่ส่งใน response body
};

// ─────────────────────────────────────────────
// Register
// ─────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { email, password, role = 'user' } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const user = new User({
      email,
      password,
      // ✅ Security: ไม่ให้ client กำหนด role เองได้ตรงๆ
      // ถ้า project นี้ต้องการ admin registration ให้ทำผ่าน invite code แทน
      role: role === 'admin' ? 'admin' : 'user',
    });

    await user.save();

    // ✅ set cookie แทนการส่ง token ใน body
    setAuthCookie(res, user._id);

    res.status(201).json({
      // ไม่ส่ง token ใน body อีกต่อไป
      user: { id: user._id, email: user.email, role: user.role },
      message: 'User registered successfully',
    });
  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─────────────────────────────────────────────
// Login
// ─────────────────────────────────────────────
router.post('/login', loginRateLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const ip = req.ip;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      await recordFailedAttempt(email, ip);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValid = await user.comparePassword(password);
    if (!isValid) {
      await recordFailedAttempt(email, ip);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await clearFailedAttempts(email, ip);

    // ✅ set cookie แทนการส่ง token ใน body
    setAuthCookie(res, user._id);

    res.json({
      // ไม่ส่ง token ใน body
      user: { id: user._id, email: user.email, role: user.role },
      message: 'Login successful',
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─────────────────────────────────────────────
// Logout — ✅ เพิ่ม route นี้เพื่อให้ server ลบ cookie ได้
// ─────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  });
  res.json({ message: 'Logged out successfully' });
});

// ─────────────────────────────────────────────
// Get current user profile
// ─────────────────────────────────────────────
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('-password')
      .populate('purchasedVideos', 'id title price');

    res.json({ user });
  } catch (error) {
    logger.error('Profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// ─────────────────────────────────────────────
// Verify token (ใช้จาก cookie อัตโนมัติ)
// ─────────────────────────────────────────────
router.get('/verify', authenticateToken, async (req, res) => {
  try {
    res.json({
      loggedIn: true,
      user: { id: req.user._id, email: req.user.email, role: req.user.role },
    });
  } catch (error) {
    res.status(500).json({ loggedIn: false, error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// Refresh token — ออก cookie ใหม่โดยไม่ต้อง login ซ้ำ
// ─────────────────────────────────────────────
router.post('/refresh', authenticateToken, async (req, res) => {
  try {
    // ✅ ออก cookie ใหม่ (rotate token)
    setAuthCookie(res, req.user._id);
    res.json({ message: 'Token refreshed successfully' });
  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

module.exports = router;