// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6 },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },

  subscription: {
    plan: { type: String, enum: ['free', 'premium'], default: 'free' },
    startedAt: Date,
    expiresAt: Date
  },

  purchasedVideos: [{
    video: { type: mongoose.Schema.Types.ObjectId, ref: 'Video' },
    purchasedAt: { type: Date, default: Date.now },
    price: Number,
    transactionId: String
  }],

  watchlist: [{
    video: { type: mongoose.Schema.Types.ObjectId, ref: 'Video' },
    addedAt: { type: Date, default: Date.now }
  }],

  resetPasswordToken: String,
  resetPasswordExpires: Date,

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Hash password before save
userSchema.pre('save', async function(next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  this.updatedAt = Date.now();
  next();
});

// Compare password
userSchema.methods.comparePassword = async function(password) {
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('User', userSchema);
