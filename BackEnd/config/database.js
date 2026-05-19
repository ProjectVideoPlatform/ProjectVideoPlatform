const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// ฟังก์ชันสำหรับแอบวิ่งไปอ่านไฟล์ล่าสุดเข้าหน่วยความจำ
function refreshEnvFromFile() {
  const vaultPath = '/vault/secrets/app.env';
  if (fs.existsSync(vaultPath)) {
    const envConfig = dotenv.parse(fs.readFileSync(vaultPath));
    for (const k in envConfig) {
      process.env[k] = envConfig[k];
    }
  }
}

async function connectDB() {
  try {
    // โหลดค่าล่าสุดก่อนกดเชื่อมต่อทุกครั้ง
    refreshEnvFromFile();

    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/secure-video?replicaSet=rs0';

    await mongoose.connect(mongoUri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      readPreference: 'primary',
      retryWrites: true,
      retryReads: true,             
      w: 'majority'
    });

    console.log('MongoDB Replica Set Connected');

    // 🌟 เติมกลไก: ดักจับเหตุการณ์ถ้า Connection หลุดลอยกลางอากาศเพราะรหัสหมดอายุ (Auth Failed)
    mongoose.connection.on('error', async (err) => {
      if (err.message.includes('Authentication failed') || err.code === 18) {
        console.log('⚠️ Detect MongoDB Auth Failure! Key might be revoked. Retrying with fresh Vault Token...');
        
        // ล้างก้อนเดิม
        await mongoose.disconnect();
        
        // รอแป๊บนึงเพื่อให้แน่ใจว่า Vault Agent เจนไฟล์เสร็จ แล้วกดรีคอนเนคใหม่
        setTimeout(async () => {
          await connectDB();
        }, 3000);
      }
    });

  } catch (error) {
    console.error('MongoDB connection error:', error);
    // ใน Production จริง ถ้าเป็นการโหลดคีย์หลุดรอบแรก ไม่ควรสั่ง process.exit(1) ทันที
    // ให้เปลี่ยนเป็นการระเบิด Error เพื่อรอรอบรีคอนเนคถัดไปแทน
  }
}

module.exports = connectDB;