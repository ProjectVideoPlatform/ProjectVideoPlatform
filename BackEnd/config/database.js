const mongoose = require('mongoose');
  const path = require('path');
    require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
async function connectDB() {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://mongodb:27017/secure-video';
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
}

module.exports = connectDB;