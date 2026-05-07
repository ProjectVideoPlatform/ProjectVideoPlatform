'use strict';

// services/access.service.js
//
//  รับผิดชอบทุกอย่างเกี่ยวกับ "user มีสิทธิ์ดูวิดีโอนี้มั้ย"
//  — purchase lookup
//  — canPlay rule
//  — enrichment (inject purchased + canPlay ลงใน video object)
//
//  Route handler ไม่ควรรู้เรื่อง Purchase model หรือ canPlay logic เลย

const Purchase = require('../models/Purchase');

/**
 * ดึง Set ของ videoId ที่ user ซื้อแล้ว (status = completed)
 * คืน Set<string> เพื่อ O(1) lookup แทน .some() O(n)
 *
 * @param {string|ObjectId} userId
 * @returns {Promise<Set<string>>}
 */
async function getPurchasedSet(userId) {
  const ids = await Purchase.find(
    { userId, status: 'completed' },
    { videoId: 1, _id: 0 }
  ).lean();

  // เก็บเป็น string เพื่อ .has() ทำงานได้ถูกต้อง (ObjectId.toString)
  return new Set(ids.map(p => p.videoId.toString()));
}

/**
 * กฎ canPlay ทั้งหมดอยู่ที่เดียว — เพิ่ม rule ใหม่ที่นี่เท่านั้น
 *
 * @param {{ role: string }} user
 * @param {{ accessType: string }} video
 * @param {boolean} isPurchased
 * @returns {boolean}
 */
function computeCanPlay(user, video, isPurchased) {
  if (user.role === 'admin')          return true;
  if (video.accessType === 'free')    return true;
  if (isPurchased)                    return true;
  // เพิ่ม rule ใหม่ตรงนี้ เช่น subscription tier, rental expiry ฯลฯ
  return false;
}

/**
 * Enrich video list — inject purchased + canPlay ลงทุก video
 * ทำงาน O(n) เพราะใช้ Set lookup
 *
 * @param {object[]} videos    - raw video docs จาก DB/Pinecone
 * @param {object}   user      - req.user (ต้องมี _id, role)
 * @returns {Promise<object[]>}
 */
async function enrichWithAccess(videos, user) {
  if (!videos?.length) return [];

  const purchasedSet = await getPurchasedSet(user._id);

  return videos.map(video => {
    const isPurchased = purchasedSet.has(video._id.toString());
    const canPlay     = computeCanPlay(user, video, isPurchased);
    return { ...video, purchased: isPurchased, canPlay };
  });
}

module.exports = { enrichWithAccess, getPurchasedSet, computeCanPlay };