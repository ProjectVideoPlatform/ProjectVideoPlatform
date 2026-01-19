const mongoose = require('mongoose');

const purchaseSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  videoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Video', required: true },

  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, default: 'THB' },
  paymentMethod: String,

  transactionId: String,

  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'completed'
  },

  purchaseDate: { type: Date, default: Date.now },
  expiresAt: Date,

  accessCount: { type: Number, default: 0 },
  lastAccessedAt: Date,
  lastTime: { type: Number, default: 0 },

  updatedAt: { type: Date, default: Date.now }
});

/* ---------------- INDEX ---------------- */

// completed ซ้ำไม่ได้
purchaseSchema.index(
  { userId: 1, videoId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'completed' }
  }
);

// idempotency (payment / webhook)
purchaseSchema.index(
  { transactionId: 1 },
  { unique: true, sparse: true }
);

// query access เร็ว
purchaseSchema.index(
  { userId: 1, videoId: 1, status: 1, expiresAt: 1 }
);

/* ---------------- STATIC ---------------- */

purchaseSchema.statics.hasAccess = async function (userId, videoId) {
  return this.findOne({
    userId,
    videoId,
    status: 'completed',
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: null },
      { expiresAt: { $gt: new Date() } }
    ]
  });
};

/* ---------------- METHOD ---------------- */

purchaseSchema.methods.recordAccess = async function (currentTime = 0) {
  await this.constructor.updateOne(
    { _id: this._id },
    {
      $inc: { accessCount: 1 },
      $set: {
        lastAccessedAt: new Date(),
        updatedAt: new Date(),
        ...(currentTime && { lastTime: currentTime })
      }
    }
  );
};

module.exports = mongoose.model('Purchase', purchaseSchema);
