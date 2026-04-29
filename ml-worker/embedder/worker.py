import json
import os
import time
import pika
import traceback
from sentence_transformers import SentenceTransformer
from pinecone import Pinecone, ServerlessSpec

PINECONE_KEY    = os.environ.get('PINECONE_API_KEY')
RABBITMQ_URL    = os.environ.get('RABBITMQ_URL', 'amqp://guest:guest@rabbitmq:5672')
PINECONE_INDEX  = 'video-catalog'
DLX_EXCHANGE    = 'dead_letter_exchange'
DLX_ROUTING_KEY = 'failed_embedding'

if not PINECONE_KEY:
    raise ValueError("PINECONE_API_KEY is required")

# ── Model (retry) ─────────────────────────────────────────
def load_model(retries=5):
    for i in range(retries):
        try:
            print(f"⏳ Loading model (attempt {i+1}/{retries})...")
            m = SentenceTransformer('all-MiniLM-L6-v2')
            print("✅ Model loaded")
            return m
        except Exception as e:
            print(f"❌ Model load failed: {e}")
            if i < retries - 1:
                time.sleep(5)
    raise Exception("Cannot load model after retries")

model = load_model()

# ── Pinecone ─────────────────────────────────────────────
def get_or_create_index(retries=5):
    pc = Pinecone(api_key=PINECONE_KEY)
    
    for i in range(retries):
        try:
            existing = [idx.name for idx in pc.list_indexes()]
            
            if PINECONE_INDEX not in existing:
                print(f"⏳ Creating Pinecone index '{PINECONE_INDEX}'...")
                pc.create_index(
                    name=PINECONE_INDEX,
                    dimension=384,   # all-MiniLM-L6-v2 output size
                    metric='cosine',
                    spec=ServerlessSpec(cloud='aws', region='us-east-1')
                )
                for _ in range(20):
                    time.sleep(3)
                    status = pc.describe_index(PINECONE_INDEX).status
                    if status.get('ready'):
                        print(f"✅ Pinecone index '{PINECONE_INDEX}' ready")
                        break
            else:
                print(f"✅ Pinecone index '{PINECONE_INDEX}' exists")

            return pc.Index(PINECONE_INDEX)

        except Exception as e:
            print(f"❌ Pinecone connect failed (attempt {i+1}/{retries}): {e}")
            if i < retries - 1:
                time.sleep(5)

    raise Exception("Cannot connect to Pinecone after retries")

index = get_or_create_index()

# ── RabbitMQ ──────────────────────────────────────────────
def process_message(ch, method, properties, body):
    try:
        data       = json.loads(body.decode('utf-8'))
        video_id   = data.get('videoId')
        title      = data.get('title', '')
        desc       = data.get('description', '')
        categories = data.get('categories', []) # ถ้าฝั่ง Node.js ส่งมาเป็น categories อย่าลืมแก้ให้ตรงกันนะครับ

        if not video_id:
            raise ValueError("Missing videoId")

        print(f"📥 Processing Video: {video_id}")

        text   = f"{title}. {desc}. หมวดหมู่: {', '.join(categories)}"
        vector = model.encode(text).tolist()

        # 1. เซฟลง Pinecone ให้เสร็จสมบูรณ์ก่อน
        index.upsert(
            vectors=[
                {
                    "id":     str(video_id),
                    "values": vector,
                    "metadata": {
                        "videoId":    str(video_id),
                        "title":      title,
                        "categories": categories
                    }
                },
               
            ]
        )
        print(f"✅ Successfully indexed Video: {video_id}")

        # 2. เมื่อเซฟชัวร์แล้ว ค่อยส่ง ACK บอก RabbitMQ ให้ลบงานทิ้ง
        ch.basic_ack(delivery_tag=method.delivery_tag)

    except Exception as e:
        print(f"❌ Embed error for video {video_id}: {e}")
        traceback.print_exc()  # 🚨 เพิ่มบรรทัดนี้ มันจะบอกเลยว่าพังบรรทัดที่เท่าไหร่ เพราะอะไร
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

def connect_and_consume():
    while True:
        try:
            params = pika.URLParameters(RABBITMQ_URL)
            conn   = pika.BlockingConnection(params)
            ch     = conn.channel()
            ch.queue_declare(
                queue='video_index',
                durable=True,
                arguments={
                    'x-dead-letter-exchange':    DLX_EXCHANGE,
                    'x-dead-letter-routing-key': DLX_ROUTING_KEY,
                }
            )
            # ดึงงานมาทีละ 1 งาน
            ch.basic_qos(prefetch_count=1)
            ch.basic_consume(queue='video_index', on_message_callback=process_message)
            
            print("🚀 Embedder worker ready and waiting for messages...")
            ch.start_consuming()
        except Exception as e:
            print(f"⚠️ RabbitMQ connection lost, reconnecting in 5 seconds... Error: {e}")
            time.sleep(5)

# ── Start ─────────────────────────────────────────────────
if __name__ == '__main__':
    connect_and_consume()