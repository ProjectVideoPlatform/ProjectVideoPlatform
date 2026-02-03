// utils/customValidators.js
const mongoose = require('mongoose');

const customValidators = {
  // ตรวจสอบว่าเป็น array ของ MongoDB IDs
  isMongoIdArray: (value) => {
    if (!Array.isArray(value)) {
      throw new Error('Must be an array');
    }
    
    const invalidIds = value.filter(id => !mongoose.Types.ObjectId.isValid(id));
    if (invalidIds.length > 0) {
      throw new Error(`Invalid MongoDB IDs: ${invalidIds.join(', ')}`);
    }
    
    return true;
  },
  
  // ตรวจสอบว่า videoIds ไม่ซ้ำ
  uniqueVideoIds: (value) => {
    if (!Array.isArray(value)) return true;
    
    const uniqueIds = [...new Set(value.map(id => id.toString()))];
    if (uniqueIds.length !== value.length) {
      throw new Error('Video IDs must be unique');
    }
    
    return true;
  },
  
  // ตรวจสอบจำนวน videoIds (สำหรับ bulk purchase)
  maxVideoIds: (max) => (value) => {
    if (!Array.isArray(value)) return true;
    
    if (value.length > max) {
      throw new Error(`Cannot purchase more than ${max} videos at once`);
    }
    
    return true;
  },
  
  // ตรวจสอบ payment method
  validPaymentMethod: (value) => {
    const validMethods = ['credit_card', 'debit_card', 'promptpay', 'truemoney'];
    if (!validMethods.includes(value)) {
      throw new Error(`Payment method must be one of: ${validMethods.join(', ')}`);
    }
    return true;
  },
  
  // ตรวจสอบ transactionId format
  validTransactionId: (value) => {
    if (typeof value !== 'string') {
      throw new Error('Transaction ID must be a string');
    }
    
    if (value.length < 5 || value.length > 100) {
      throw new Error('Transaction ID must be between 5 and 100 characters');
    }
    
    // ตัวอย่าง: ตรวจสอบว่าเป็น format ที่ถูกต้อง
    const transactionPattern = /^[a-zA-Z0-9_-]+$/;
    if (!transactionPattern.test(value)) {
      throw new Error('Transaction ID contains invalid characters');
    }
    
    return true;
  }
};

module.exports = customValidators;