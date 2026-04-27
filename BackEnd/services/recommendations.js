// recommendation.service.js
const { Pinecone } = require('@pinecone-database/pinecone');
const redisClient  = require('../config/redis'); 
const Video        = require('../models/Video');

const pc    = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index('video-catalog');

// ─── 1. Trending fallback (ดึงจาก Redis ตามที่เราคุยกัน) ────────────────────────
async function getTrendingVideos(limit = 12) {
  try {
    const trendingIds = await redisClient.lRange('global:trending:videos', 0, limit - 1);
    
    if (!trendingIds || trendingIds.length === 0) {
      // Fallback ถ้า Redis พังหรือ Cronjob ยังไม่ทำงาน
      return Video.find({ uploadStatus: 'completed' })
        .sort({ createdAt: -1 }) 
        .limit(limit)
        .lean();
    }

    const videos = await Video.find({
      _id: { $in: trendingIds },
      uploadStatus: 'completed'
    }).lean();

    const orderMap = Object.fromEntries(trendingIds.map((id, i) => [id.toString(), i]));
    return videos.sort((a, b) => (orderMap[a._id.toString()] ?? 99) - (orderMap[b._id.toString()] ?? 99));

  } catch (error) {
    console.error('[recommendation] trending error:', error);
    return [];
  }
}

// ─── 2. Personalized recommendations (🔥 ใช้ Video Vector ล้วนๆ) ────────────────
async function getRecommendedVideos(userId, limit = 12) {
  try {
    // 1. ดึงประวัติที่เคยดูจาก Redis เพื่อหา "คลิปล่าสุด" และทำ post-filter
    const watchedRaw = await redisClient.lRange(`user:history:${userId}`, 0, -1);
    const watchedSet = new Set(watchedRaw);

    // ❄️ ถ้ายูสเซอร์ใหม่เอี่ยม ไม่มีประวัติเลย (Cold Start) ส่ง Trending ไปเลย
    if (watchedRaw.length === 0) {
      return { videos: await getTrendingVideos(limit), source: 'trending (cold start)' };
    }

    // 🎯 2. ใช้ "คลิปล่าสุด" เป็นตัวตั้งต้น (Seed Video)
    // สมมติว่า lpush เข้ามา ตัวที่ 0 คือล่าสุด
    const seedVideoId = watchedRaw[0]; 

    // 3. Similarity search — ยิงหา Pinecone ด้วย ID วิดีโอได้เลย! (ไม่ต้องส่ง Vector)
    // Pinecone จะไปหา Vector ของ seedVideoId ในระบบมันเอง แล้วหาตัวที่คล้ายมาให้
    const queryResponse = await index.query({
      id:              seedVideoId, 
      topK:            limit + watchedSet.size, // ดึงเผื่อตัวที่เคยดูแล้ว
      includeMetadata: true,
    });

    // ถ้าหาวิดีโอตั้งต้นใน Pinecone ไม่เจอ (เช่นเพิ่งอัปโหลด Vector ยังไม่เข้า) หรือไม่มีคลิปคล้าย
    if (!queryResponse.matches || queryResponse.matches.length === 0) {
      return { videos: await getTrendingVideos(limit), source: 'trending (pinecone fallback)' };
    }

    // 4. กรองวิดีโอที่เคยดูแล้วออก
    const recommendedIds = [];
    for (const match of queryResponse.matches) {
      // Pinecone จะคืนตัวมันเอง (seedVideoId) กลับมาด้วย เราต้องกรองออก
      const videoId = match.id;
      if (!watchedSet.has(videoId)) {
        recommendedIds.push(videoId);
      }
      if (recommendedIds.length === limit) break; // ได้ครบแล้วหยุด
    }

    // ถ้ากรองไปกรองมา ไม่เหลือคลิปใหม่เลย
    if (!recommendedIds.length) {
      return { videos: await getTrendingVideos(limit), source: 'trending (all watched)' };
    }

    // 5. ดึงรายละเอียดจาก MongoDB ด้วย IDs ที่ผ่านการคัดกรองแล้ว
    const videos = await Video.find({
      _id:          { $in: recommendedIds },
      uploadStatus: 'completed',
    }).lean();

    // 6. เรียงตาม similarity score จาก Pinecone
    const orderMap = Object.fromEntries(
      recommendedIds.map((id, i) => [id.toString(), i])
    );
    videos.sort(
      (a, b) => (orderMap[a._id.toString()] ?? 99) - (orderMap[b._id.toString()] ?? 99)
    );

    return { videos, source: 'personalized' };

  } catch (err) {
    console.error('[recommendation] error:', err);
    // Error ปุ๊บ ส่ง Trending กลับไปทันที ระบบไม่ล่ม
    return { videos: await getTrendingVideos(limit), source: 'trending (error fallback)' };
  }
}

module.exports = { getRecommendedVideos, getTrendingVideos };