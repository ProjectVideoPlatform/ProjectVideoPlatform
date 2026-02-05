// routes/user.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Purchase = require('../models/Purchase');
const Video = require('../models/Video');
const { authenticateToken } = require('../middleware/auth');
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
  try {
    const { oldPassword, newPassword } = req.body;

    // 1. ตรวจสอบข้อมูลเบื้องต้น
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'กรุณากรอกรหัสผ่านเดิมและรหัสผ่านใหม่' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 6 ตัวอักษร' });
    }

    // 2. ดึงข้อมูล User
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'ไม่พบผู้ใช้งานในระบบ' });

    // 3. ตรวจสอบรหัสผ่านเดิม
    const isMatch = await user.comparePassword(oldPassword);
    if (!isMatch) {
      return res.status(400).json({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' });
    }

    // 4. อัปเดตรหัสผ่าน (Mongoose Middleware จะ Hash ให้เองถ้าคุณตั้งค่าไว้ใน Schema)
    user.password = newPassword;
    await user.save();

    res.json({ message: 'เปลี่ยนรหัสผ่านสำเร็จแล้ว' });
  } catch (error) {
    console.error('Change Password Error:', error);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
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
