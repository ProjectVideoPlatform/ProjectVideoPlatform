const crypto = require('crypto');
const mongoose = require('mongoose');
const IdempotencyRecord = require('../models/idempotencyRecord');

const generateIdempotencyKey = (userId, transactionId, payload) => {
  const stringifiedPayload = typeof payload === 'string' 
    ? payload 
    : JSON.stringify(payload);
  
  const hash = crypto
    .createHash('sha256')
    .update(`${userId}:${transactionId}:${stringifiedPayload}`)
    .digest('hex');
  
  return hash;
};

const checkAndStoreIdempotency = async (key, userId, metadata = {}) => {
  const session = await mongoose.startSession();
  
  try {
    await session.startTransaction();
    
    // Check existing record
    const existing = await IdempotencyRecord.findOne({ key, userId })
      .session(session);
    
    if (existing) {
      await session.abortTransaction();
      
      if (existing.status === 'completed') {
        return { exists: true, result: existing.result };
      } else if (existing.status === 'processing') {
        throw new Error('Request is still processing');
      }
      // ถ้า failed ให้ retry ได้
    }
    
    // Create new record
    const record = new IdempotencyRecord({
      key,
      userId,
      status: 'processing',
      metadata,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    });
    
    await record.save({ session });
    await session.commitTransaction();
    
    return { exists: false, record };
    
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const updateIdempotencyResult = async (key, status, result, error = null) => {
  const update = {
    status,
    updatedAt: new Date()
  };
  
  if (status === 'completed') {
    update.result = result;
    update.completedAt = new Date();
  } else if (status === 'failed') {
    update.error = error?.message || error;
    update.failedAt = new Date();
  }
  
  await IdempotencyRecord.updateOne({ key }, update);
};

module.exports = {
  generateIdempotencyKey,
  checkAndStoreIdempotency,
  updateIdempotencyResult
};