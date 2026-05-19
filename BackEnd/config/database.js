// config/database.js - ✅ Using Vault for secrets
const mongoose = require('mongoose');
const vaultService = require('./vault');

async function connectDB() {
  try {
    // ✅ Initialize Vault and get MongoDB config
    await vaultService.initialize();
    const mongoConfig = vaultService.getMongoConfig();

    console.log('🗄️  Connecting to MongoDB...');

    await mongoose.connect(mongoConfig.uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,

      // production practice
      readPreference: 'primary',
      retryWrites: true,
      retryReads: true,             
      w: 'majority'
    });

    console.log('✅ MongoDB Replica Set Connected');
    console.log(`   Database: ${mongoConfig.database}`);
    console.log(`   ReplicaSet: ${mongoConfig.replicaSet}`);

  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
  }
}

module.exports = connectDB;