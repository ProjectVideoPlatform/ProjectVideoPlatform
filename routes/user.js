// routes/user.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Purchase = require('../models/Purchase');
const Video = require('../models/Video');
const { authenticateToken } = require('../middleware/authMiddleware');
const bcrypt = require('bcryptjs');

// Get profile
router.get('/profile', authenticateToken, async (req, res) => {
  const user = await User.findById(req.user.id).select('-password');
  res.json(user);
});

// Update profile
router.put('/profile', authenticateToken, async (req, res) => {
  const updates = req.body;
  const user = await User.findByIdAndUpdate(req.user.id, updates, { new: true }).select('-password');
  res.json(user);
});

// Change password
router.post('/change-password', authenticateToken, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const user = await User.findById(req.user.id);
  const isMatch = await user.comparePassword(oldPassword);
  if (!isMatch) return res.status(400).json({ error: 'Old password is incorrect' });

  user.password = newPassword;
  await user.save();
  res.json({ message: 'Password changed successfully' });
});

// Get purchase history
router.get('/purchases', authenticateToken, async (req, res) => {
  const purchases = await Purchase.find({ userId: req.user.id }).populate('videoId', 'title price');
  res.json(purchases);
});

// Check access to a video
router.get('/access/:videoId', authenticateToken, async (req, res) => {
  const hasAccess = await Purchase.hasAccess(req.user.id, req.params.videoId);
  res.json({ hasAccess });
});

module.exports = router;
