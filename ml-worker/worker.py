import os
import json
import time
import threading
import redis
import pika
from confluent_kafka import Consumer, KafkaError
from confluent_kafka.admin import AdminClient, NewTopic
from sentence_transformers import SentenceTransformer
from pinecone import Pinecone, ServerlessSpec

# ── Config ───────────────────────────────────────────────
KAFKA_BROKER     = os.environ.get('KAFKA_BROKERS', 'kafka:9092')
REDIS_HOST       = os.environ.get('REDIS_HOST', 'redis')
REDIS_PASSWORD   = os.environ.get('REDIS_PASSWORD')
PINECONE_KEY     = os.environ.get('PINECONE_API_KEY')
RABBITMQ_URL     = os.environ.get('RABBITMQ_URL', 'amqp://guest:guest@rabbitmq:5672')

PINECONE_INDEX_NAME = 'video-catalog'
HISTORY_MAX         = 200
BATCH_SIZE          = 50
DLX_EXCHANGE        = 'dead_letter_exchange'
DLX_ROUTING_KEY     = 'failed_embedding'

if not PINECONE_KEY:
    raise ValueError("PINECONE_API_KEY environment variable is required")

# ── Redis ─────────────────────────────────────────────────
def connect_redis():
    for i in range(5):
        try:
            r = redis.Redis(
                host=REDIS_HOST, port=6379, db=0,
                decode_responses=True, password=REDIS_PASSWORD
            )
            r.ping()
            print("✅ Connected to Redis")
            return r
        except Exception as e:
            print(f"Redis attempt {i+1}/5: {e}")
            time.sleep(2)
    raise Exception("Could not connect to Redis")

r = connect_redis()

# ── Model ─────────────────────────────────────────────────
print("⏳ Loading SentenceTransformer model...")
model = SentenceTransformer('all-MiniLM-L6-v2')
print("✅ Model loaded")

# ── Pinecone ──────────────────────────────────────────────
print("⏳ Connecting to Pinecone...")
pc = Pinecone(api_key=PINECONE_KEY)
if PINECONE_INDEX_NAME not in [idx.name for idx in pc.list_indexes()]:
    pc.create_index(
        name=PINECONE_INDEX_NAME, dimension=384, metric='cosine',
        spec=ServerlessSpec(cloud='aws', region='us-east-1')
    )
    time.sleep(10)
video_index = pc.Index(PINECONE_INDEX_NAME)
print(f"✅ Connected to Pinecone: {PINECONE_INDEX_NAME}")

# ── Pinecone batch (thread-safe) ──────────────────────────
batch_lock   = threading.Lock()
upsert_batch = []

def flush_batch():
    global upsert_batch
    with batch_lock:
        if not upsert_batch:
            return
        to_flush     = upsert_batch[:]
        upsert_batch = []
    try:
        video_index.upsert(vectors=to_flush)
        print(f"📦 Flushed {len(to_flush)} vectors to Pinecone")
    except Exception as e:
        print(f"❌ Flush failed: {e}")

# ════════════════════════════════════════════════════════
#  RabbitMQ — embed + upsert Pinecone
# ════════════════════════════════════════════════════════
def process_message(ch, method, properties, body):
    try:
        data        = json.loads(body.decode('utf-8'))
        video_id    = data.get('videoId')
        title       = data.get('title', '')
        description = data.get('description', '')
        categories  = data.get('category', [])

        if not video_id:
            raise ValueError("Missing videoId")

        text_to_embed = f"{title}. {description}. หมวดหมู่: {', '.join(categories)}"
        vector        = model.encode(text_to_embed).tolist()

        # ✅ เซ็ต flag นอก lock แล้วค่อย flush
        should_flush = False
        with batch_lock:
            upsert_batch.append({
                "id":     str(video_id),
                "values": vector,
                "metadata": {
                    "videoId":    str(video_id),
                    "title":      title,
                    "categories": categories,
                    "status":     "ready"
                }
            })
            if len(upsert_batch) >= BATCH_SIZE:
                should_flush = True

        if should_flush:
            flush_batch()

        print(f"✅ Queued video: {video_id}")
        ch.basic_ack(delivery_tag=method.delivery_tag)

    except Exception as e:
        print(f"❌ Embed error: {e}")
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

def connect_rabbitmq():
    for i in range(5):
        try:
            params = pika.URLParameters(RABBITMQ_URL)
            conn   = pika.BlockingConnection(params)
            ch     = conn.channel()
            ch.queue_declare(
                queue='video_index',
                durable=True,
                arguments={
                    'x-dead-letter-exchange':    DLX_EXCHANGE,
                    'x-dead-letter-routing-key': DLX_ROUTING_KEY
                }
            )
            ch.basic_qos(prefetch_count=1)
            print("✅ Connected to RabbitMQ")
            return conn, ch
        except Exception as e:
            print(f"RabbitMQ attempt {i+1}/5: {e}")
            time.sleep(3)
    raise Exception("Cannot connect to RabbitMQ")

def run_rabbitmq():
    while True:
        try:
            conn, ch = connect_rabbitmq()
            ch.basic_consume(queue='video_index', on_message_callback=process_message)
            print("🐇 RabbitMQ consumer ready")
            ch.start_consuming()
        except Exception as e:
            print(f"⚠️ RabbitMQ crashed, reconnecting: {e}")
            time.sleep(5)

# ════════════════════════════════════════════════════════
#  Kafka — Redis history only
# ════════════════════════════════════════════════════════
def handle_user_activity(data: dict):
    user_id  = data.get('userId')
    video_id = data.get('videoId')

    if not user_id or user_id == 'anonymous' or not video_id:
        return

    history_key = f"user:history:{user_id}"

    recent = r.lrange(history_key, 0, 9)
    if video_id in recent:
        print(f"⏭️ Skip duplicate — user:{user_id} video:{video_id}")
        return

    pipe = r.pipeline()
    pipe.lpush(history_key, video_id)
    pipe.ltrim(history_key, 0, HISTORY_MAX - 1)
    pipe.expire(history_key, 60 * 60 * 24 * 30)
    pipe.execute()
    print(f"📖 History — user:{user_id} video:{video_id}")

def ensure_topic_exists(broker, topic, partitions=3):
    admin    = AdminClient({'bootstrap.servers': broker})
    existing = admin.list_topics(timeout=10).topics
    if topic not in existing:
        fs = admin.create_topics([
            NewTopic(topic, num_partitions=partitions, replication_factor=1)
        ])
        for t, f in fs.items():
            try:
                f.result()
                print(f"✅ Topic '{t}' created")
            except Exception as e:
                print(f"⚠️ {e}")
        time.sleep(2)

# ════════════════════════════════════════════════════════
#  MAIN
# ════════════════════════════════════════════════════════
rabbit_thread = threading.Thread(target=run_rabbitmq, daemon=True)
rabbit_thread.start()

ensure_topic_exists(KAFKA_BROKER, 'user-activities')
conf = {
    'bootstrap.servers':     KAFKA_BROKER,
    'group.id':              'ml-worker-group',
    'auto.offset.reset':     'earliest',
    'enable.auto.commit':    False,
    'session.timeout.ms':    30000,   # ✅ แก้จาก 6000
    'heartbeat.interval.ms': 10000,   # ✅ เพิ่มใหม่
    'max.poll.interval.ms':  300000,
}
consumer = Consumer(conf)
consumer.subscribe(['user-activities'])
print("🚀 ML Worker running...")

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
            handle_user_activity(data)
            consumer.commit(msg)
        except Exception as e:
            print(f"⚠️ Error: {e}")
            import traceback; traceback.print_exc()
            time.sleep(1)

except KeyboardInterrupt:
    print("🛑 Worker stopped.")
finally:
    flush_batch()
    consumer.close()