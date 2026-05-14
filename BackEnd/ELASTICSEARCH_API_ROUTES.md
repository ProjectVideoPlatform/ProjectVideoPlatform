# Elasticsearch API Routes Guide

## 📍 API Endpoints สำหรับ Elasticsearch

### ✅ ขั้นตอนการใช้งาน

1. **รัน Migration Script** (เพียงครั้งเดียว - ตอนแรก):
```bash
cd c:\Github\ProjectVideoPlatform\BackEnd
node scripts/es-migration.js --action sync --model all
```

2. **Start Server** - Indexes จะ auto-create และ auto-sync:
```bash
npm start
```

3. **ใช้ API endpoints** ด้านล่าง

---

## 🔍 PUBLIC API (ไม่ต้องเป็น Admin)

### Search Videos
```http
GET /api/elasticsearch/videos/search?q=python&accessType=free&limit=20
```

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| q | string | '' | Search term (title, description) |
| accessType | string | - | free \| paid \| subscription_only |
| tags | string | - | Comma-separated: "python,tutorial" |
| priceMin | number | - | Minimum price |
| priceMax | number | - | Maximum price |
| page | number | 1 | Page number |
| limit | number | 20 | Results per page |
| sort | string | _score | createdAt \| price \| _score |
| order | string | desc | asc \| desc |

**Example Requests:**

```bash
# ค้นหา free videos เกี่ยวกับ Python
curl "http://localhost:3000/api/elasticsearch/videos/search?q=python&accessType=free"

# ค้นหา paid videos ราคา 100-500 บาท
curl "http://localhost:3000/api/elasticsearch/videos/search?q=javascript&accessType=paid&priceMin=100&priceMax=500"

# ค้นหา videos ตาม tags
curl "http://localhost:3000/api/elasticsearch/videos/search?tags=programming,tutorial"

# เรียง ตามราคา (ถูกไปแพง)
curl "http://localhost:3000/api/elasticsearch/videos/search?sort=price&order=asc"
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "video_id",
      "title": "Learn Python",
      "description": "...",
      "accessType": "free",
      "price": 0,
      "tags": ["python", "tutorial"]
    }
  ],
  "pagination": {
    "total": 150,
    "page": 1,
    "limit": 20,
    "pages": 8
  }
}
```

---

## 🔐 ADMIN API (ต้อง Token + Admin Role)

### Search Purchases
```http
GET /api/elasticsearch/purchases/search?status=completed&page=1
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| userId | string | User ID |
| videoId | string | Video ID |
| status | string | pending,completed,failed,refunded (comma-separated) |
| paymentMethod | string | kplus, credit_card, promptpay, etc. |
| currency | string | THB, USD, etc. |
| dateFrom | date | Start date (YYYY-MM-DD) |
| dateTo | date | End date (YYYY-MM-DD) |
| amountMin | number | Minimum amount |
| amountMax | number | Maximum amount |
| page | number | Page number |
| limit | number | Results per page |
| sort | string | purchaseDate, amount, status |
| order | string | asc or desc |

**Example Requests:**

```bash
# ค้นหา purchases ที่ completed เดือนนี้
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:3000/api/elasticsearch/purchases/search?status=completed&dateFrom=2024-05-01&dateTo=2024-05-31"

# ค้นหา purchases ของ user ที่ได้ credit card
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:3000/api/elasticsearch/purchases/search?userId=USER_ID&paymentMethod=credit_card"

# ค้นหา purchases ที่ failed
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:3000/api/elasticsearch/purchases/search?status=failed&limit=50"
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "purchase_id",
      "userId": "user_id",
      "videoId": "video_id",
      "amount": 299,
      "currency": "THB",
      "paymentMethod": "credit_card",
      "status": "completed",
      "purchaseDate": "2024-05-14T10:30:00Z"
    }
  ],
  "pagination": {
    "total": 1250,
    "page": 1,
    "limit": 20,
    "pages": 63
  }
}
```

---

### Get Revenue Analytics
```http
GET /api/elasticsearch/analytics/revenue?dateFrom=2024-05-01&dateTo=2024-05-31
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| status | string | Default: completed |
| dateFrom | date | Start date |
| dateTo | date | End date |

**Example:**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:3000/api/elasticsearch/analytics/revenue?dateFrom=2024-05-01&dateTo=2024-05-31"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "summary": {
      "totalRevenue": 150000,
      "currency": "THB"
    },
    "breakdown": {
      "byCurrency": [
        { "key": "THB", "doc_count": 500 }
      ],
      "byPaymentMethod": [
        { "key": "credit_card", "doc_count": 300 },
        { "key": "promptpay", "doc_count": 200 }
      ],
      "byVideo": [
        { "key": "video_id_1", "doc_count": 100 }
      ]
    },
    "trends": {
      "dailyRevenue": [
        { "key": "2024-05-14", "doc_count": 50, "daily_sum": { "value": 15000 } }
      ]
    }
  }
}
```

---

### Get Index Stats
```http
GET /api/elasticsearch/stats/videos
GET /api/elasticsearch/stats/purchases
```

**Example:**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:3000/api/elasticsearch/stats/videos"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "index": "videos",
    "documents": 1250,
    "deleted": 5,
    "sizeInBytes": 5242880,
    "sizeInMB": "5.00"
  }
}
```

---

## 🔧 ADMIN MANAGEMENT ENDPOINTS

### Sync Data to Elasticsearch
```http
POST /api/elasticsearch/admin/sync
Content-Type: application/json

{
  "models": ["videos", "purchases"]
}
```

**Example (PowerShell):**
```powershell
$headers = @{
    "Authorization" = "Bearer YOUR_TOKEN"
    "Content-Type" = "application/json"
}

$body = @{
    models = @("videos", "purchases")
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri "http://localhost:3000/api/elasticsearch/admin/sync" `
  -Method POST `
  -Headers $headers `
  -Body $body
```

**Response:**
```json
{
  "success": true,
  "data": {
    "videos": { "status": "success", "synced": 1250 },
    "purchases": { "status": "success", "synced": 5000 }
  }
}
```

---

### Recreate Indexes (ลบเก่า สร้างใหม่ Sync ข้อมูล)
```http
POST /api/elasticsearch/admin/recreate
Content-Type: application/json

{
  "models": ["videos", "purchases"]
}
```

**⚠️ คำเตือน:** ข้อมูลเก่าจะหายไป! ใช้สำหรับ reset เท่านั้น

---

### Delete Index
```http
DELETE /api/elasticsearch/admin/index/videos
DELETE /api/elasticsearch/admin/index/purchases
```

**⚠️ คำเตือน:** Index จะหายไป!

---

## 🧪 Testing in Postman/Thunder Client

### 1. Set up Authorization
- Type: Bearer Token
- Token: `YOUR_JWT_TOKEN` (จาก login)

### 2. Example Collections

**Search Videos:**
```
GET http://localhost:3000/api/elasticsearch/videos/search
?q=python
&accessType=free
&limit=20
&sort=_score
&order=desc
```

**Get Revenue:**
```
GET http://localhost:3000/api/elasticsearch/analytics/revenue
?dateFrom=2024-05-01
&dateTo=2024-05-31
```

**Sync Data:**
```
POST http://localhost:3000/api/elasticsearch/admin/sync
Body (JSON):
{
  "models": ["videos"]
}
```

---

## 📊 Frontend Integration Example

### React Component - Search Videos

```javascript
const [searchResults, setSearchResults] = useState([]);

const searchVideos = async (query) => {
  const params = new URLSearchParams({
    q: query,
    accessType: 'free',
    limit: 20
  });

  const response = await fetch(
    `/api/elasticsearch/videos/search?${params}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }
  );
  
  const data = await response.json();
  setSearchResults(data.data);
};
```

---

## 🚨 Error Responses

```json
{
  "success": false,
  "error": "Invalid index name. Must be: videos or purchases"
}
```

Common errors:
- 400: Invalid parameters
- 401: Unauthorized (ต้องมี token)
- 403: Forbidden (ต้องเป็น Admin)
- 500: Server error

---

## 📝 Summary

| Task | Command/API |
|------|------------|
| **Initial Setup** | `node scripts/es-migration.js --action sync --model all` |
| **Search Videos** | `GET /api/elasticsearch/videos/search` |
| **Search Purchases** | `GET /api/elasticsearch/purchases/search` *(Admin)* |
| **Revenue Analytics** | `GET /api/elasticsearch/analytics/revenue` *(Admin)* |
| **Check Index Size** | `GET /api/elasticsearch/stats/:indexName` *(Admin)* |
| **Sync Data** | `POST /api/elasticsearch/admin/sync` *(Admin)* |
| **Recreate Index** | `POST /api/elasticsearch/admin/recreate` *(Admin)* |
| **Delete Index** | `DELETE /api/elasticsearch/admin/index/:indexName` *(Admin)* |
