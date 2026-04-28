// models/WatchHistory.js
'use strict';

const mongoose = require('mongoose');

const watchHistorySchema = new mongoose.Schema(
  {
    userId:  { type: String, required: true },
    videoId: { type: String, required: true },
    watchedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

// ── Indexes ───────────────────────────────────────────────
// compound unique — ไม่ซ้ำ
watchHistorySchema.index(
  { userId: 1, videoId: 1 },
  { unique: true }
);
// query ประวัติเรียงตามเวลา
watchHistorySchema.index({ userId: 1, watchedAt: -1 });

module.exports = mongoose.model('WatchHistory', watchHistorySchema);