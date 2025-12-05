const mongoose = require('mongoose');

const purchaseSchema = new mongoose.Schema({
userId: {
type: mongoose.Schema.Types.ObjectId,
ref: 'User',
required: true
},
videoId: {
type: mongoose.Schema.Types.ObjectId,
ref: 'Video',
required: true
},
amount: { type: Number, required: true, min: 0 },
currency: { type: String, default: 'THB' },
paymentMethod: String,
transactionId: String,
status: { type: String, enum: ['pending','completed','failed','refunded'], default: 'completed' },
purchaseDate: { type: Date, default: Date.now },
expiresAt: Date,
accessCount: { type: Number, default: 0 },
lastAccessedAt: Date,

// --- เพิ่มสำหรับ resume ---
lastTime: { type: Number, default: 0 }, // วินาทีล่าสุดที่ดู
updatedAt: { type: Date, default: Date.now }
});

// Index
purchaseSchema.index({ userId: 1, videoId: 1 }, { unique: true });
purchaseSchema.index({ userId: 1, purchaseDate: -1 });
purchaseSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Static: ตรวจสอบสิทธิ์เข้าถึงวิดีโอ
purchaseSchema.statics.hasAccess = async function(userId, videoId) {
const purchase = await this.findOne({
userId,
videoId,
status: 'completed',
$or: [
{ expiresAt: { $exists: false } },
{ expiresAt: null },
{ expiresAt: { $gt: new Date() } }
]
});
return purchase || null;
};

// Method: บันทึกการเข้าถึง + resume
purchaseSchema.methods.recordAccess = async function(currentTime = 0) {
this.accessCount += 1;
this.lastAccessedAt = new Date();
if (currentTime) this.lastTime = currentTime;
this.updatedAt = new Date();
await this.save();
};

module.exports = mongoose.model('Purchase', purchaseSchema);
