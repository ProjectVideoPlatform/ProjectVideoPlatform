# kafka_history_worker.py
import json
import os
import signal
import redis
from confluent_kafka import Consumer, KafkaError

HISTORY_MAX    = 200
REDIS_HOST     = os.environ.get('REDIS_HOST', 'redis')
KAFKA_BROKER   = os.environ.get('KAFKA_BROKERS', 'kafka:9092')
REDIS_PASSWORD = os.environ.get('REDIS_PASSWORD')

r = redis.Redis(
    host=REDIS_HOST, port=6379,
    decode_responses=True, password=REDIS_PASSWORD
)

# ✅ Lua script — check + push เป็น atomic operation เดียว
# Redis รัน Lua แบบ single-threaded → ไม่มี race condition
PUSH_IF_NOT_EXISTS = r.register_script("""
local key      = KEYS[1]
local video_id = ARGV[1]
local max_len  = tonumber(ARGV[2])
local ttl      = tonumber(ARGV[3])
local check_n  = tonumber(ARGV[4])

-- เช็คใน N อันล่าสุด
local recent = redis.call('LRANGE', key, 0, check_n - 1)
for _, v in ipairs(recent) do
    if v == video_id then
        return 0  -- ซ้ำ ไม่ push
    end
end

-- ไม่ซ้ำ → push + trim + expire
redis.call('LPUSH',  key, video_id)
redis.call('LTRIM',  key, 0, max_len - 1)
redis.call('EXPIRE', key, ttl)
return 1  -- push สำเร็จ
""")

def handle_user_activity(data):
    user_id  = data.get('userId')
    video_id = data.get('videoId')

    if not user_id or user_id == 'anonymous' or not video_id:
        return

    history_key = f"user:history:{user_id}"

    result = PUSH_IF_NOT_EXISTS(
        keys=[history_key],
        args=[
            video_id,
            HISTORY_MAX,
            60 * 60 * 24 * 30,  # TTL 30 วัน
            20,                  # เช็คซ้ำใน 20 อันล่าสุด
        ]
    )

    if result == 1:
        print(f"📖 History: user={user_id}, video={video_id}")
    else:
        print(f"⏭️  Skip duplicate: user={user_id}, video={video_id}")

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