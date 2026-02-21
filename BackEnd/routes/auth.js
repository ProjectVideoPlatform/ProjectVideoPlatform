const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const jwtConfig = require('../config/auth');
const { authenticateToken } = require('../middleware/auth');
const {recordFailedAttempt,clearFailedAttempts}  = require('../middleware/loginRateLimiter');
const router = express.Router();
const redisClient = require('../config/redis');
const logger = require('../utils/logger');
// Register
router.post('/register', async (req, res) => {
  try {
    const { email, password, role = 'user' } = req.body;
    
    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Create user (password will be hashed by pre-save hook)
    const user = new User({
      email,
      password,
      role: role === 'admin' ? 'admin' : 'user' // Only allow admin if explicitly set
    });

    await user.save();

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id }, 
      jwtConfig.secret, 
      { expiresIn: jwtConfig.expiresIn }
    );

    res.status(201).json({ 
      token, 
      user: { 
        id: user._id, 
        email: user.email, 
        role: user.role 
      },
      message: 'User registered successfully'
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});


router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const ip = req.ip;
    
    console.log(`Login attempt for ${email} from IP ${ip}`);
    
    // ✅ เช็ค Rate Limit ก่อนตรวจสอบ Password
    const userKey = `rate:user:${email}`;
    const ipKey = `rate:ip:${ip}`;
    
    const [userAttempts, ipAttempts] = await Promise.all([
      redisClient.get(userKey),
      redisClient.get(ipKey)
    ]);
    
    if (parseInt(userAttempts) >= 5 || parseInt(ipAttempts) >= 20) {
      logger.warn(`Rate limit exceeded: ${email} from ${ip}`);
      
      // เช็ค Block Count ด้วย
      const blockCount = await redisClient.incr(`blockcount:${ip}`);
      if (blockCount === 1) await redisClient.expire(`blockcount:${ip}`, 86400);
      if (blockCount >= 50) {
        await redisClient.setex(`blocked:${ip}`, 86400, '1');
        return res.status(429).json({ error: 'Access denied. Too many failed attempts.' });
      }
      
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }
    
    // Check blocked IP
    const blocked = await redisClient.get(`blocked:${ip}`);
    if (blocked) {
      return res.status(429).json({ error: 'Access denied. Too many failed attempts.' });
    }

    // ตรวจสอบ User และ Password
    const user = await User.findOne({ email });
    const isValid = user ? await user.comparePassword(password) : false;

    if (!isValid) {
      await recordFailedAttempt(email, ip);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Login Success
    await clearFailedAttempts(email, ip);
    
    const token = jwt.sign(
      { userId: user._id }, 
      jwtConfig.secret, 
      { expiresIn: jwtConfig.expiresIn }
    );

    res.json({ 
      token, 
      user: { id: user._id, email: user.email, role: user.role },
      message: 'Login successful'
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
    console.error('Profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

router.get('/verify', authenticateToken, async (req, res) => {
  try {
    res.json({
      loggedIn: true,
      user: {
        id: req.user._id,
        email: req.user.email,
        role: req.user.role
      }
    });
  } catch (error) {
    res.status(500).json({ loggedIn: false, error: 'Server error' });
  }
});

module.exports = router;

// Refresh token
router.post('/refresh', authenticateToken, async (req, res) => {
  try {
    const token = jwt.sign(
      { userId: req.user._id }, 
      jwtConfig.secret, 
      { expiresIn: jwtConfig.expiresIn }
    );

    res.json({ 
      token,
      message: 'Token refreshed successfully'
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

module.exports = router;