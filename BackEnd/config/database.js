const mongoose = require('mongoose');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function connectDB() {
  try {

    const mongoUri =
      process.env.MONGO_URI ||
      'mongodb://localhost:27017,localhost:27018,localhost:27019/secure-video?replicaSet=rs0';

    await mongoose.connect(mongoUri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,

      // production practice
      readPreference: 'secondaryPreferred',
      retryWrites: true,
      retryReads: true,             
      w: 'majority'
    });

    console.log('MongoDB Replica Set Connected');

  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
}

module.exports = connectDB;