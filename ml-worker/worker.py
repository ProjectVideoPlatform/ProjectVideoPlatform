import os
import json
import redis
from confluent_kafka import Consumer
# from sentence_transformers import SentenceTransformer
# from pinecone import Pinecone

# รับค่าจาก Environment Variables ใน Docker Compose
KAFKA_BROKER = os.environ.get('KAFKA_BROKERS', 'kafka:9092')
REDIS_HOST = os.environ.get('REDIS_HOST', 'redis')
REDIS_PASSWORD = os.environ.get('REDIS_PASSWORD', 'redispassword123')
r = redis.Redis(host=REDIS_HOST, port=6379, db=0, decode_responses=True, password=REDIS_PASSWORD)

conf = {
    'bootstrap.servers': KAFKA_BROKER,
    'group.id': 'ml-worker-group',
    'auto.offset.reset': 'earliest'
}
consumer = Consumer(conf)
consumer.subscribe(['user-activities'])

print(f"ML Worker is running... Connected to Kafka: {KAFKA_BROKER}")

try:
    while True:
        msg = consumer.poll(1.0)
        if msg is None: continue
        if msg.error(): 
            print(f"Kafka Error: {msg.error()}")
            continue

        data = json.loads(msg.value().decode('utf-8'))
        
        user_id = data.get('userId')
        video_id = data.get('videoId')
        categories = data.get('category') # ตอนนี้จะเป็น List เช่น ["comedy"]
        event_type = data.get('eventType')

        if not user_id or user_id == 'anonymous':
            continue

        # ✅ 1. เก็บ History (เหมือนเดิม)
        history_key = f"user:history:{user_id}"
        r.lpush(history_key, video_id)
        r.ltrim(history_key, 0, 9)

        # ✅ 2. ให้คะแนนความชอบหมวดหมู่ (วน Loop ถ้ามีหลายหมวดหมู่)
        if categories and categories != 'unknown':
            # ถ้าส่งมาเป็น String ตัวเดียวให้แปลงเป็น List
            if isinstance(categories, str):
                categories = [categories]
                
            score_key = f"user:scores:{user_id}"
            score_weight = 2 if event_type == 'completed' else 1
            
            for cat in categories:
                if cat != 'unknown':
                    r.zincrby(score_key, score_weight, cat)
                    print(f"🔥 Updated score for user {user_id}: {cat} +{score_weight}")

        # ✅ TODO 3 (อนาคต): ถ้ามี Pinecone/VectorDB ให้ทำตรงนี้
        # text_to_embed = f"{category} video"
        # vector = model.encode(text_to_embed).tolist()
        # index.upsert(vectors=[(user_id, vector)])
        
except KeyboardInterrupt:
    print("Worker stopped by user.")
finally:
    consumer.close()