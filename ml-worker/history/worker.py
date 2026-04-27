# kafka_history_worker.py
import json
import os
import redis
from confluent_kafka import Consumer, KafkaError

HISTORY_MAX  = 200
REDIS_HOST   = os.environ.get('REDIS_HOST', 'redis')
KAFKA_BROKER = os.environ.get('KAFKA_BROKERS', 'kafka:9092')
REDIS_PASSWORD = os.environ.get('REDIS_PASSWORD')   # ✅ เพิ่ม
r = redis.Redis(host=REDIS_HOST, port=6379, decode_responses=True,password=REDIS_PASSWORD  )

def handle_user_activity(data):
    user_id  = data.get('userId')
    video_id = data.get('videoId')
    if not user_id or user_id == 'anonymous' or not video_id:
        return

    history_key = f"user:history:{user_id}"
    recent = r.lrange(history_key, 0, 9)
    if video_id in recent:
        return

    pipe = r.pipeline()
    pipe.lpush(history_key, video_id)
    pipe.ltrim(history_key, 0, HISTORY_MAX - 1)
    pipe.expire(history_key, 60 * 60 * 24 * 30)
    pipe.execute()
    print(f"📖 History: user={user_id}, video={video_id}")

consumer = Consumer({
    'bootstrap.servers':     KAFKA_BROKER,
    'group.id':              'ml-history-group',
    'auto.offset.reset':     'earliest',
    'enable.auto.commit':    False,
    'session.timeout.ms':    30000,    # ✅ แก้จาก default 6000
    'heartbeat.interval.ms': 10000,
})
consumer.subscribe(['user-activities'])
print("🚀 Kafka history worker ready")

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
except KeyboardInterrupt:
    pass
finally:
    consumer.close()