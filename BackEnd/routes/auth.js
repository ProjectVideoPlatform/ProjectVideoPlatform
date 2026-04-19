const express = require('express');
const jwt = require('jsonwebtoken');
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

// Register
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

    const token = jwt.sign(
      { userId: user._id },
      jwtConfig.secret,
      { expiresIn: jwtConfig.expiresIn }
    );

    res.status(201).json({
      token,
      user: { id: user._id, email: user.email, role: user.role },
      message: 'User registered successfully',
    });
  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ✅ เพิ่ม loginRateLimiter เป็น middleware
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

    const token = jwt.sign(
      { userId: user._id },
      jwtConfig.secret,
      { expiresIn: jwtConfig.expiresIn }
    );

    res.json({
      token,
      user: { id: user._id, email: user.email, role: user.role },
      message: 'Login successful',
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user profile
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

// Refresh token — ✅ ย้ายมาก่อน module.exports
router.post('/refresh', authenticateToken, async (req, res) => {
  try {
    const token = jwt.sign(
      { userId: req.user._id },
      jwtConfig.secret,
      { expiresIn: jwtConfig.expiresIn }
    );

    res.json({ token, message: 'Token refreshed successfully' });
  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

// ✅ export แค่ครั้งเดียว ที่ท้ายไฟล์
module.exports = router;