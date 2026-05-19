  const mongoose = require('mongoose');
  const fs = require('fs');
  const dotenv = require('dotenv');

  const vaultPath = '/vault/secrets/app.env';
  let isReconnecting = false; // ป้องกันการสั่งต่อซ้ำซ้อนพร้อมๆ กัน (Race Condition)

  function refreshEnvFromFile() {
    if (fs.existsSync(vaultPath)) {
      // แนะนำให้อ่านสดทุกครั้งที่เรียกใช้ เพื่อล็อกรหัสผ่านล่าสุดจาก Vault Agent
      const envConfig = dotenv.parse(fs.readFileSync(vaultPath));
      for (const k in envConfig) {
        process.env[k] = envConfig[k];
      }
    }
  }

function buildMongoUri() {
  // 1. ถ้ามี MONGO_URI ตัวเต็มที่ Vault Agent ประกอบมาให้แล้ว ให้ใช้ตัวนี้เป็นหลัก
  if (process.env.MONGO_URI) {
    let uri = process.env.MONGO_URI;
    
    // ดักแก่: ถ้าใน URI ตัวเต็มยังไม่มีการระบุ authSource=admin ให้ฉีดเพิ่มเข้าไปเอง ป้องกัน Auth พัง
    if (!uri.includes('authSource=')) {
      // เช็กดูว่ามี Query string (?) อยู่ใน URI หรือยัง
      uri += uri.includes('?') ? '&authSource=admin' : '?authSource=admin';
    }
    return uri;
  }

  // 2. แผนสำรอง (Fallback) หาก Vault แยกคีย์สุ่มมาให้ตามชื่อจริงในไฟล์ (.env)
  if (process.env.MONGO_USERNAME && process.env.MONGO_PASSWORD) {
    const user = encodeURIComponent(process.env.MONGO_USERNAME); // เปลี่ยนให้ตรงกับไฟล์จริง
    const pass = encodeURIComponent(process.env.MONGO_PASSWORD); // เปลี่ยนให้ตรงกับไฟล์จริง
    const host = process.env.MONGO_HOST || 'mongodb1:27017,mongodb2:27017,mongodb3:27017';
    const db   = process.env.MONGO_DB   || 'secure-video';
    const rs   = process.env.MONGO_REPLICA_SET || 'rs0';        // เปลี่ยนให้ตรงกับไฟล์จริง
    
    return `mongodb://${user}:${pass}@${host}/${db}?replicaSet=${rs}&authSource=admin`;
  }

  // 3. ปลายทางสุดท้ายสำหรับกรณีทดสอบ Local ทั่วไป
  return 'mongodb://localhost:27017/secure-video?replicaSet=rs0';
}

  async function connectDB() {
    if (isReconnecting) return;
    isReconnecting = true;

    try {
      refreshEnvFromFile();
      const uri = buildMongoUri();

      // 1. เคลียร์ Event Listener เก่าออกให้หมดก่อน
      mongoose.connection.removeAllListeners();

      // 2. ถ้ามี Connection เก่าค้างอยู่ ให้สั่งปิดอย่างนุ่มนวล (Force Close = false) ก่อนเปิดใหม่
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect().catch(() => {});
      }

      // 3. เริ่มทำการเชื่อมต่อใหม่ด้วยรหัสที่อัปเดตแล้ว
      await mongoose.connect(uri, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        readPreference: 'primary',
        retryWrites: true,
        retryReads: true,
        w: 'majority',
      });

      console.log('✅ MongoDB Dynamic Credentials Connected successfully!');
      isReconnecting = false;

      // 4. ดักจับตัดการเชื่อมต่อแบบผิดปกติ (เช่น รหัสผ่านถูกลบ/หมดอายุกลางอากาศ)
      mongoose.connection.on('disconnected', () => {
        console.warn('⚠️ MongoDB disconnected! กำลังพยายาม Reconnect ด้วยรหัสล่าสุดจาก Vault...');
        handleReconnect();
      });

      mongoose.connection.on('error', (err) => {
        console.error('❌ Mongoose Connection Error Event:', err.message);
        if (err.message?.includes('Authentication failed') || err.code === 18) {
          handleReconnect();
        }
      });

    } catch (error) {
      console.error('❌ MongoDB connection failure:', error.message);
      isReconnecting = false;
      
      // ถ้าต่อไม่ผ่าน (อาจเพราะ Vault Agent ยังอัปเดตไฟล์ .env ใหม่ไม่เสร็จ) ให้ดีเลย์แล้วลองใหม่
      handleReconnect();
    }
  }

  // ฟังก์ชันศูนย์กลางควบคุมการต่อใหม่แบบหน่วงเวลา ป้องกันลูปนรก (Throttling)
  function handleReconnect() {
    if (!isReconnecting) {
      // หน่วงเวลา 5 วินาที เพื่อให้มั่นใจว่า Vault Agent sidecar เขียนไฟล์เสร็จเรียบร้อยชัวร์ๆ
      setTimeout(() => {
        connectDB().catch(err => console.error('Retry Connection Failed:', err.message));
      }, 5000);
    }
  }

  module.exports = connectDB;