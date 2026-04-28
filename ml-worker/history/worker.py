# kafka_history_worker.py
import json
import os
import signal
import time
import redis
import pymongo
from confluent_kafka import Consumer, KafkaError

HISTORY_MAX    = 50
REDIS_HOST     = os.environ.get('REDIS_HOST', 'redis')
KAFKA_BROKER   = os.environ.get('KAFKA_BROKERS', 'kafka:9092')
REDIS_PASSWORD = os.environ.get('REDIS_PASSWORD')
MONGO_URI      = os.environ.get('MONGO_URI')
TTL_SECONDS    = 60 * 60 * 24 * 30

# ── Redis ─────────────────────────────────────────────────
r = redis.Redis(
    host=REDIS_HOST, port=6379,
    decode_responses=True, password=REDIS_PASSWORD
)

# ── MongoDB ───────────────────────────────────────────────
mongo      = pymongo.MongoClient(MONGO_URI)
db         = mongo['app_db']
history_col = db['watchhistories']

# index ป้องกันซ้ำ + query เร็ว
history_col.create_index(
    [('userId', 1), ('videoId', 1)],
    unique=True
)
history_col.create_index(
    [('userId', 1), ('watchedAt', -1)]
)

# ── Lua: zadd + expire + trim ─────────────────────────────
ZADD_WITH_TRIM = r.register_script("""
local key      = KEYS[1]
local score    = tonumber(ARGV[1])
local video_id = ARGV[2]
local max_len  = tonumber(ARGV[3])
local ttl      = tonumber(ARGV[4])

redis.call('ZADD', key, score, video_id)
redis.call('EXPIRE', key, ttl)

local size = redis.call('ZCARD', key)
if size > max_len then
    redis.call('ZREMRANGEBYRANK', key, 0, size - max_len - 1)
end

return 1
""")

def handle_user_activity(data):
    user_id  = data.get('userId')
    video_id = data.get('videoId')

    if not user_id or user_id == 'anonymous' or not video_id:
        return

    now         = time.time()
    watched_key = f"user:watched:{user_id}"

    # 1. Redis Sorted Set — real-time recommendation
    ZADD_WITH_TRIM(
        keys=[watched_key],
        args=[now, video_id, HISTORY_MAX, TTL_SECONDS]
    )

    # 2. MongoDB — full history ไม่จำกัด
    try:
        history_col.update_one(
            { 'userId': user_id, 'videoId': video_id },
            { '$set': { 'watchedAt': time.time() } },
            upsert=True   # ✅ ไม่ซ้ำ — update watchedAt ถ้ามีอยู่แล้ว
        )
    except Exception as e:
        print(f"⚠️ MongoDB write failed: {e}")
        # ไม่ raise — Redis สำเร็จแล้ว MongoDB fail ไม่ทำให้ระบบพัง

    print(f"📖 History: user={user_id}, video={video_id}")

# ── Kafka ─────────────────────────────────────────────────
consumer = Consumer({
    'bootstrap.servers':     KAFKA_BROKER,
    'group.id':              'ml-history-group',
    'auto.offset.reset':     'earliest',
    'enable.auto.commit':    False,
    'session.timeout.ms':    30000,
    'heartbeat.interval.ms': 10000,
})
consumer.subscribe(['user-activities'])
print("🚀 Kafka history worker ready")

def graceful_shutdown(signum, frame):
    print("🛑 Shutting down...")
    consumer.close()
    mongo.close()
    exit(0)

signal.signal(signal.SIGTERM, graceful_shutdown)
signal.signal(signal.SIGINT,  graceful_shutdown)

try:
    while True:
        msg = consumer.poll(1.0)
        if msg is None:
            continue
        if msg.error():
            if msg.error().code() != KafkaError._PARTITION_EOF:
                print(f"❌ Kafka error: {msg.error()}")
            continue
        try:
            data = json.loads(msg.value().decode('utf-8'))
            handle_user_activity(data)
            consumer.commit(msg)
        except Exception as e:
            print(f"⚠️ Error: {e}")
finally:
    consumer.close()
    mongo.close()