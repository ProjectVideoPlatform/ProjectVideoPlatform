'use strict';

const mongoose = require('mongoose');

const customValidators = {

  // ── Array validators ────────────────────────────────────────────────────────

  // ตรวจสอบว่าเป็น array ของ MongoDB ObjectIds ที่ valid ทั้งหมด
  isMongoIdArray(value) {
    if (!Array.isArray(value)) {
      throw new Error('Must be an array');
    }
    const invalid = value.filter(id => !mongoose.Types.ObjectId.isValid(id));
    if (invalid.length > 0) {
      throw new Error(`Invalid MongoDB IDs: ${invalid.join(', ')}`);
    }
    return true;
  },

  // ตรวจสอบว่า videoIds ไม่ซ้ำกัน
  uniqueVideoIds(value) {
    if (!Array.isArray(value)) return true;
    const unique = [...new Set(value.map(id => id.toString()))];
    if (unique.length !== value.length) {
      throw new Error('Video IDs must be unique');
    }
    return true;
  },

  // factory: ตรวจสอบจำนวน videoIds ไม่เกิน max
  maxVideoIds(max) {
    return (value) => {
      if (!Array.isArray(value)) return true;
      if (value.length > max) {
        throw new Error(`Cannot purchase more than ${max} videos at once`);
      }
      return true;
    };
  },

  // ── Payment validators ──────────────────────────────────────────────────────

  // ✅ ใหม่: ตรวจสอบ Stripe PaymentIntent ID (pi_xxxxxxxxxxxxxxxxxxxxxxxx)
  validPaymentIntentId(value) {
    if (typeof value !== 'string') {
      throw new Error('paymentIntentId must be a string');
    }
    // Stripe PaymentIntent ID format: pi_ ตามด้วย alphanumeric 24 ตัว
    if (!/^pi_[a-zA-Z0-9]{24,}$/.test(value)) {
      throw new Error('Invalid Stripe PaymentIntent ID format (expected pi_...)');
    }
    return true;
  },

  // ── Video validators ────────────────────────────────────────────────────────

  // ตรวจสอบ videoId ก่อนซื้อ (custom async validator — ใช้กับ validateRequest)
  // ถ้าต้องการเช็ค video จาก DB ให้ใส่ logic ที่นี่ได้
  async validateVideoPurchase(value) {
    if (!mongoose.Types.ObjectId.isValid(value)) {
      throw new Error('Invalid video ID');
    }
    return true;
  },

  // ── Amount validators ───────────────────────────────────────────────────────

  // ตรวจสอบ amount (optional field สำหรับ override ราคา)
  validAmount(value) {
    const num = Number(value);
    if (isNaN(num) || num <= 0) {
      throw new Error('Amount must be a positive number');
    }
    if (num > 1_000_000) {
      throw new Error('Amount exceeds maximum allowed value');
    }
    return true;
  }
};

module.exports = customValidators;