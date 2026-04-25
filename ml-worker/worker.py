import os
import json
import time
import redis
from confluent_kafka import Consumer, KafkaError
from sentence_transformers import SentenceTransformer
from pinecone import Pinecone, ServerlessSpec
from confluent_kafka.admin import AdminClient, NewTopic
# ── Config ──────────────────────────────────────────────
KAFKA_BROKER   = os.environ.get('KAFKA_BROKERS', 'kafka:9092')
REDIS_HOST     = os.environ.get('REDIS_HOST', 'redis')
REDIS_PASSWORD = os.environ.get('REDIS_PASSWORD')   # None if not set
PINECONE_KEY   = os.environ.get('PINECONE_API_KEY') # No hardcoded fallback

VIDEO_INDEX_NAME = 'video-catalog'
BATCH_SIZE       = 50

# ── Validation ──────────────────────────────────────────
if not PINECONE_KEY:
    raise ValueError("PINECONE_API_KEY environment variable is required")

# ── Clients with retry ──────────────────────────────────
def connect_redis():
    for i in range(5):
        try:
            r = redis.Redis(
                host=REDIS_HOST, 
                port=6379, 
                db=0,
                decode_responses=True, 
                password=REDIS_PASSWORD 
            )
            r.ping()
            print("✅ Connected to Redis")
            return r
        except Exception as e:
            print(f"Redis connection attempt {i+1}/5 failed: {e}")
            time.sleep(2)
    raise Exception("Could not connect to Redis")

r = connect_redis()
def ensure_topic_exists(broker: str, topic: str, partitions: int = 3):
    admin = AdminClient({'bootstrap.servers': broker})
    existing = admin.list_topics(timeout=10).topics
    if topic not in existing:
        print(f"Creating topic: {topic}")
        fs = admin.create_topics([NewTopic(topic, num_partitions=partitions, replication_factor=1)])
        for t, f in fs.items():
            try:
                f.result()
                print(f"✅ Topic '{t}' created")
            except Exception as e:
                print(f"⚠️ Topic creation: {e}")  # อาจ already exists
        time.sleep(2)
# ── Model ───────────────────────────────────────────────
print("Loading SentenceTransformer model...")
model = SentenceTransformer('all-MiniLM-L6-v2')
print("✅ Model loaded")

# ── Pinecone ────────────────────────────────────────────
print("Connecting to Pinecone...")
pc = Pinecone(api_key=PINECONE_KEY)

if VIDEO_INDEX_NAME not in [idx.name for idx in pc.list_indexes()]:
    print(f"Creating index {VIDEO_INDEX_NAME}...")
    pc.create_index(
        name=VIDEO_INDEX_NAME,
        dimension=384,
        metric='cosine',
        spec=ServerlessSpec(cloud='aws', region='us-east-1')
    )
    time.sleep(10)  # Wait for index creation

video_index = pc.Index(VIDEO_INDEX_NAME)
print(f"✅ Connected to Pinecone index: {VIDEO_INDEX_NAME}")

# ── Kafka Consumer ──────────────────────────────────────
conf = {
    'bootstrap.servers': KAFKA_BROKER,
    'group.id': 'ml-worker-group',
    'auto.offset.reset': 'earliest',
    'enable.auto.commit': False,
    'session.timeout.ms': 6000,
    'max.poll.interval.ms': 300000
}
ensure_topic_exists(KAFKA_BROKER, 'user-activities')
consumer = Consumer(conf)
consumer.subscribe(['user-activities'])
print(f"🚀 ML Worker running... Kafka: {KAFKA_BROKER}")

# ── Batch Buffer ────────────────────────────────────────
upsert_batch = []

def flush_batch():
    global upsert_batch
    if not upsert_batch:
        return
    try:
        video_index.upsert(vectors=upsert_batch)
        print(f"📦 Flushed {len(upsert_batch)} vectors to Pinecone")
        upsert_batch = []
    except Exception as e:
        print(f"❌ Failed to flush batch: {e}")

def index_video(video_id: str, categories: list):
    global upsert_batch
    text = " ".join(categories)
    vector = model.encode(text).tolist()
    
    upsert_batch.append({
        "id": video_id,
        "values": vector,
        "metadata": {
            "videoId": video_id,
            "categories": categories,
        }
    })
    
    if len(upsert_batch) >= BATCH_SIZE:
        flush_batch()

# ── Main Loop ────────────────────────────────────────────
try:
    while True:
        msg = consumer.poll(1.0)
        
        if msg is None:
            flush_batch()
            continue
        
        if msg.error():
            if msg.error().code() != KafkaError._PARTITION_EOF:
                print(f"❌ Kafka Error: {msg.error()}")
            continue
        
        try:
            data = json.loads(msg.value().decode('utf-8'))
            user_id = data.get('userId')
            video_id = data.get('videoId')
            categories = data.get('category', [])
            event_type = data.get('eventType', 'view')
            
            if not user_id or user_id == 'anonymous':
                consumer.commit(msg)
                continue
            
            # 1. History
            history_key = f"user:history:{user_id}"
            r.lpush(history_key, video_id)
            r.ltrim(history_key, 0, 49)
            
            # 2. Category Scoring
            if categories:
                if isinstance(categories, str):
                    categories = [categories]
                
                score_key = f"user:scores:{user_id}"
                score_weight = 2 if event_type == 'completed' else 1
                
                for cat in categories:
                    if cat and cat != 'unknown':
                        r.zincrby(score_key, score_weight, cat)
                        print(f"🔥 Score — user: {user_id}, cat: {cat} +{score_weight}")
                
                # 3. Index Video
                clean_cats = [c for c in categories if c and c != 'unknown']
                if clean_cats and video_id:
                    index_video(video_id, clean_cats)
            
            consumer.commit(msg)
            
        except Exception as e:
            print(f"⚠️ Processing error (will retry): {e}")
            import traceback
            traceback.print_exc()
            time.sleep(1)

except KeyboardInterrupt:
    print("🛑 Worker stopped.")
finally:
    flush_batch()
    consumer.close()