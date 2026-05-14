# Elasticsearch Integration Guide

## ✅ สิ่งที่ได้ทำแล้ว

### 1. **สร้าง ElasticsearchService** (`services/ElasticsearchService.js`)
   - บริการ utility สำหรับการ index, update, delete, search documents
   - รองรับ bulk indexing สำหรับ initial data sync
   - มี error handling และ logging

### 2. **แก้ไข Video.js** 
   ✨ เพิ่มการ integrate กับ Elasticsearch:
   - **Elasticsearch Mapping** - ตัวชี้ของ field types สำหรับ full-text search
   - **Post save hook** - เมื่อบันทึกวิดีโอใหม่จะ index ไปยัง ES
   - **Post update hook** - เมื่อแก้ไขข้อมูลจะ update ใน ES
   - **Pre delete hook** - เมื่อลบจะลบจาก ES ด้วย
   - **Static Methods:**
     - `Video.initializeESIndex()` - สร้าง index mapping
     - `Video.searchVideos(query, options)` - ค้นหาวิดีโอด้วย full-text search + filters
     - `Video.syncToElasticsearch()` - sync ข้อมูลทั้งหมดจาก MongoDB

### 3. **แก้ไข Purchase.js**
   ✨ เพิ่มการ integrate กับ Elasticsearch:
   - **Elasticsearch Mapping** - สำหรับ analytics queries
   - **Post save/update/delete hooks** - เหมือน Video
   - **Static Methods:**
     - `Purchase.initializeESIndex()` - สร้าง index
     - `Purchase.searchPurchases(filters, options)` - ค้นหาพร้อม advanced filtering
     - `Purchase.getRevenueAnalytics(filters)` - ดึง analytics ด้วย aggregation
     - `Purchase.syncToElasticsearch()` - sync ข้อมูล

### 4. **แก้ไข server.js**
   - เพิ่ม initialization ของ Elasticsearch indexes ตอน startup
   - เรียก `Video.initializeESIndex()` และ `Purchase.initializeESIndex()`

### 5. **สร้าง Migration Script** (`scripts/es-migration.js`)
   - ใช้สำหรับ sync data, recreate indexes, delete indexes

---

## 🚀 การใช้งาน

### 1️⃣ **ใช้ Development (ในเบื้องต้น)**
Server จะ auto-initialize indexes เมื่อ startup:
```bash
npm start
```

### 2️⃣ **Sync ข้อมูลเก่าจาก MongoDB ไป Elasticsearch**

```bash
# Sync ทั้งหมด
node scripts/es-migration.js --action sync --model all

# Sync เฉพาะ videos
node scripts/es-migration.js --action sync --model videos

# Sync เฉพาะ purchases
node scripts/es-migration.js --action sync --model purchases

# ระบุ batch size (default 500)
node scripts/es-migration.js --action sync --model all --batchSize 1000
```

### 3️⃣ **Recreate Indexes** (ลบเก่า สร้างใหม่)

```bash
# Recreate ทั้งหมด
node scripts/es-migration.js --action recreate --model all

# Recreate เฉพาะ videos
node scripts/es-migration.js --action recreate --model videos
```

### 4️⃣ **Delete Indexes**

```bash
# Delete ทั้งหมด
node scripts/es-migration.js --action delete --model all
```

### 5️⃣ **ดูสถิติ Indexes**

```bash
# ดูสถิติทั้งหมด
node scripts/es-migration.js --action stats --model all

# ดูเฉพาะ videos
node scripts/es-migration.js --action stats --model videos
```

---

## 🔍 API Usage

### **Search Videos**

```javascript
// ในโค้ด controller หรือ service
const results = await Video.searchVideos(
  {
    search: 'tutorial python',
    accessType: 'free',
    tags: ['programming', 'python'],
    priceRange: { min: 0, max: 500 }
  },
  { 
    page: 1, 
    limit: 20, 
    sortBy: 'createdAt', 
    order: 'desc' 
  }
);

// Response
{
  data: [...videos],
  total: 150,
  page: 1,
  limit: 20,
  pages: 8
}
```

### **Search & Filter Purchases**

```javascript
const results = await Purchase.searchPurchases(
  {
    userId: 'user_id',
    status: ['completed', 'processing'],
    paymentMethod: 'credit_card',
    dateRange: {
      from: '2024-01-01',
      to: '2024-12-31'
    },
    amountRange: { min: 100, max: 5000 }
  },
  { page: 1, limit: 20 }
);
```

### **Get Revenue Analytics**

```javascript
const analytics = await Purchase.getRevenueAnalytics({
  status: 'completed',
  dateRange: {
    from: '2024-01-01',
    to: '2024-12-31'
  }
});

// Response
{
  totalRevenue: 150000,
  byCurrency: [{ key: 'THB', doc_count: 500 }, ...],
  byPaymentMethod: [{ key: 'credit_card', doc_count: 300 }, ...],
  byVideo: [...],
  dailyRevenue: [...]
}
```

---

## 📊 ประโยชน์ของ Elasticsearch

### **Video Index ได้:**
- ✅ Full-text search (ค้นหาจาก title, description)
- ✅ Filter ตาม accessType, tags, price range
- ✅ Autocomplete suggestions
- ✅ Faceted search

### **Purchase Index ได้:**
- ✅ Complex filtering (userId, status, paymentMethod, dateRange)
- ✅ Revenue analytics aggregation
- ✅ Payment method breakdown
- ✅ Daily/Monthly revenue trends
- ✅ Video popularity analysis

---

## 🔧 โครงสร้าง Code

```
BackEnd/
├── models/
│   ├── Video.js          (✨ Modified)
│   └── Purchase.js       (✨ Modified)
├── services/
│   └── ElasticsearchService.js  (✨ New)
├── scripts/
│   └── es-migration.js   (✨ New)
├── config/
│   └── elasticsearch.js  (Already exists)
└── server.js             (✨ Modified)
```

---

## ⚠️ สิ่งที่ควรทำต่อ

### 1. **ทำให้ Elasticsearch Sync ทำงาน Automatic**
   - สร้าง Queue jobs (Kafka/RabbitMQ) สำหรับ async sync
   - เพิ่ม error recovery logic

### 2. **เพิ่ม Search API Routes**
   - Create endpoint `/api/videos/search`
   - Create endpoint `/api/admin/analytics/revenue`

### 3. **Optimize Elasticsearch**
   - Adjust analyzer สำหรับ Thai language
   - Fine-tune scoring/relevance

### 4. **Monitoring**
   - Add health checks
   - Monitor index size และ query performance

---

## 🐛 Troubleshooting

### **Index ไม่ Create ได้**
```bash
# Check ES connection
curl -X GET "http://localhost:9200/"

# Check config
cat /config/elasticsearch.js
```

### **Data ไม่ Sync**
```bash
# ลองสร้าง index ใหม่
node scripts/es-migration.js --action recreate --model all

# ดู logs ใน server console
```

### **Slow Search**
- ลด batch size: `--batchSize 100`
- Check ES resource usage

---

## 📝 Notes

- Elasticsearch hooks ไม่ throw errors ไม่ให้ block MongoDB save
- Auto-sync documents บนตอนที่เขียน/แก้ไขข้อมูล
- Bulk sync ใช้สำหรับ initial data load เท่านั้น
