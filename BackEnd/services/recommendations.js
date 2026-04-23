// recommendation.service.js
const { Pinecone } = require('@pinecone-database/pinecone');
const Redis = require('ioredis'); // 🆕 เพิ่ม Redis Client
const Video = require('../models/Video');

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
// 🛠 แก้ชื่อ Index ให้ตรงกับฝั่ง Python
const index = pc.index('video-catalog'); 
const redis = new Redis(process.env.REDIS_URL); // เชื่อมต่อ Redis

async function getTrendingVideos(limit = 12) {
  return Video.find({ uploadStatus: 'completed' })
    .sort({ views: -1, createdAt: -1 })
    .limit(limit)
    .lean();
}

async function getRecommendedVideos(userId, limit = 12) {
  try {
    // 1. ดึงประวัติที่เคยดูแล้วจาก Redis เพื่อเตรียมกรองออก (Post-filtering)
    const historyKey = `user:history:${userId}`;
    const watchedVideos = await redis.lrange(historyKey, 0, -1);
    const watchedSet = new Set(watchedVideos);

    // 2. ดึง user preference vector (ต้องมั่นใจว่ามีเซอร์วิสอื่นคอยอัปเดตค่านี้ลง Pinecone)
    const userFetch = await index.fetch([`user_pref_${userId}`]);
    const userVector = userFetch.records[`user_pref_${userId}`]?.values;

    if (!userVector) {
      return { videos: await getTrendingVideos(limit), source: 'trending' };
    }

    // 3. Similarity search (ดึงเผื่อออกมาสำหรับกรองวิดีโอซ้ำ)
    const queryLimit = limit + watchedSet.size; 
    const queryResponse = await index.query({
      vector: userVector,
      topK: queryLimit, 
      // เอา filter type ออกถ้าฝั่ง Python ไม่ได้ใส่ type ใน metadata
      includeMetadata: true,
    });

    if (!queryResponse.matches.length) {
      return { videos: await getTrendingVideos(limit), source: 'trending' };
    }

    // 4. กรองวิดีโอที่เคยดูแล้วออก และดึงไอดี (Post-filtering in action)
    const recommendedIds = [];
    for (const match of queryResponse.matches) {
      // ใช้ metadata.videoId ตามที่ Python เซฟไว้
      const videoId = match.metadata?.videoId || match.id; 
      
      if (!watchedSet.has(videoId)) {
        recommendedIds.push(videoId);
      }
      if (recommendedIds.length === limit) break; // ได้ครบตามจำนวนที่ต้องการแล้ว
    }

    if (recommendedIds.length === 0) {
       return { videos: await getTrendingVideos(limit), source: 'trending' };
    }

    // 5. ดึงจาก MongoDB
    const videos = await Video.find({
      _id: { $in: recommendedIds },
      uploadStatus: 'completed',
    }).lean();

    // 6. เรียงตามลำดับความคล้าย (Similarity) ที่ได้มาจาก Pinecone
    const orderMap = Object.fromEntries(recommendedIds.map((id, i) => [id.toString(), i]));
    videos.sort((a, b) => (orderMap[a._id.toString()] ?? 99) - (orderMap[b._id.toString()] ?? 99));

    return { videos, source: 'personalized' };
  } catch (error) {
    console.error('Error fetching recommendations:', error);
    return { videos: await getTrendingVideos(limit), source: 'trending' };
  }
}

module.exports = { getRecommendedVideos };