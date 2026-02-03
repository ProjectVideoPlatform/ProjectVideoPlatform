const mongoose = require('mongoose');

const idempotencyRecordSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  transactionId: String,
  videoIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Video' }],
  status: {
    type: String,
    enum: ['processing', 'completed', 'failed'],
    default: 'processing'
  },
  result: mongoose.Schema.Types.Mixed,
  error: String,
  startedAt: Date,
  completedAt: Date,
  failedAt: Date,
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 วัน
  }
});

// TTL index สำหรับ auto cleanup
idempotencyRecordSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 }
);