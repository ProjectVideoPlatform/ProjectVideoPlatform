// recommendation.service.js
const { Pinecone } = require('@pinecone-database/pinecone');
const pc = new Pinecone({ apiKey: 'YOUR_API_KEY' });
const index = pc.index('video-recommendations');

async function getVectorRecommendations(userId) {
    // 1. ดึง Vector ความชอบล่าสุดของผู้ใช้ (ที่ Python ฝังไว้ให้)
    const userFetch = await index.fetch([`user_pref_${userId}`]);
    const userVector = userFetch.records[`user_pref_${userId}`]?.values;

    if (!userVector) return getTrendingVideos(); // Fallback ถ้ายังไม่มีประวัติ

    // 2. ทำ Similarity Search: หาคลิปวิดีโอที่ Vector ใกล้เคียงกับ User ที่สุด
    const queryResponse = await index.query({
        vector: userVector,
        filter: { type: { $eq: 'video' } }, // ค้นหาเฉพาะ record ที่เป็นวิดีโอ
        topK: 10,
        includeMetadata: true
    });

    // 3. นำ IDs ที่ได้ไปดึงข้อมูลจาก ClickHouse หรือ Main DB มาแสดงผล
    const recommendedIds = queryResponse.matches.map(match => match.id);
    return await clickhouse.query(`SELECT * FROM videos WHERE video_id IN (${recommendedIds})`).toPromise();
}