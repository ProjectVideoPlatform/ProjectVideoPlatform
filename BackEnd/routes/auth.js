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
// Cookie config
// ─────────────────────────────────────────────
const COOKIE_NAME         = 'authToken';
const REFRESH_COOKIE_NAME = 'refreshToken';

const accessCookieOptions = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge:   24 * 60 * 60 * 1000, // 24 ชั่วโมง
  path:     '/',
};

const refreshCookieOptions = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge:   7 * 24 * 60 * 60 * 1000, // 7 วัน
  path:     '/api/auth/refresh',       // ส่งเฉพาะ path นี้
};

// ─────────────────────────────────────────────
// Helper: sign JWT ทั้งคู่และ set httpOnly cookie
// ─────────────────────────────────────────────
const setAuthCookies = (res, userId) => {
  const accessToken = jwt.sign(
    { userId },
    jwtConfig.secret,
    { expiresIn: '1d' }
  );
  const refreshToken = jwt.sign(
    { userId },
    jwtConfig.refreshSecret,
    { expiresIn: '7d' }
  );
  res.cookie(COOKIE_NAME,         accessToken,  accessCookieOptions);
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions);
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
      role: role === 'admin' ? 'admin' : 'user',
    });
    await user.save();

    setAuthCookies(res, user._id);

    res.status(201).json({
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

    setAuthCookies(res, user._id);

    res.json({
      user: { id: user._id, email: user.email, role: user.role },
      message: 'Login successful',
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─────────────────────────────────────────────
// Refresh Token
// ─────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({ error: 'No refresh token', code: 'NO_REFRESH_TOKEN' });
  }

  try {
    const decoded = jwt.verify(refreshToken, jwtConfig.refreshSecret);
    const user    = await User.findById(decoded.userId).select('-password');

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // ออก access token ใหม่อย่างเดียว — refresh token ยังใช้อันเดิม
    const newAccessToken = jwt.sign(
      { userId: user._id },
      jwtConfig.secret,
      { expiresIn: '15m' }
    );
    res.cookie(COOKIE_NAME, newAccessToken, accessCookieOptions);

    res.json({ ok: true });
  } catch (err) {
    // Refresh token หมดอายุหรือ invalid → clear ทั้งคู่ → force logout
    res.clearCookie(COOKIE_NAME,         { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/' });
    res.clearCookie(REFRESH_COOKIE_NAME, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/auth/refresh' });
    return res.status(401).json({ error: 'Session expired', code: 'REFRESH_EXPIRED' });
  }
});

// ─────────────────────────────────────────────
// Logout
// ─────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path:     '/',
  });
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path:     '/api/auth/refresh',
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
// Verify token
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

module.exports = router;