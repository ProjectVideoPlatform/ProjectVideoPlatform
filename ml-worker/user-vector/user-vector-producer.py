"""
user_vector_producer.py
────────────────────────
รันทุก 15 นาที (cron / scheduler)
ดึง active users จาก MongoDB แล้วส่ง user_id เข้า Kafka topic
"""

import os
import orjson
import time
import signal
import pymongo
from pymongo.read_preferences import ReadPreference
from pymongo.errors import ServerSelectionTimeoutError
from kafka import KafkaProducer
from kafka.errors import KafkaError
from datetime import datetime, timezone

# ── Config ────────────────────────────────────────────────
MONGO_URI        = os.environ["MONGO_URI"]
MONGO_DB         = os.environ["MONGO_DB"]
MONGO_REPLICA    = os.environ.get("MONGO_REPLICA_SET")

KAFKA_BROKERS    = os.environ.get("KAFKA_BROKERS", "kafka:9092").split(",")
KAFKA_TOPIC      = os.environ.get("KAFKA_TOPIC", "user-vector-refresh")

BATCH_SIZE       = int(os.environ.get("BATCH_SIZE", 10000))   # users per run
ACTIVE_WINDOW_H  = int(os.environ.get("ACTIVE_WINDOW_H", 24)) # ดึง users ที่ active ใน N ชม.
REFRESH_INTERVAL = int(os.environ.get("REFRESH_INTERVAL", 60 * 15))  # 15 min

# ── MongoDB ───────────────────────────────────────────────
def create_mongo_client():
    kwargs = dict(
        maxPoolSize=10,
        minPoolSize=2,
        serverSelectionTimeoutMS=30000,
        socketTimeoutMS=30000,
        connectTimeoutMS=10000,
        readPreference="secondaryPreferred",
        retryReads=True,
    )
    if MONGO_REPLICA:
        kwargs["replicaSet"] = MONGO_REPLICA
    return pymongo.MongoClient(MONGO_URI, **kwargs)

mongo       = create_mongo_client()
db          = mongo[MONGO_DB]
history_col = db.get_collection(
    "watchhistories",
    read_preference=ReadPreference.SECONDARY_PREFERRED,
)

# ── Kafka ─────────────────────────────────────────────────
producer = KafkaProducer(
    bootstrap_servers=KAFKA_BROKERS,
    value_serializer=lambda v: orjson.dumps(v),
    key_serializer=lambda k: k.encode("utf-8") if k else None,
    acks="all",               # ทุก broker ยืนยัน
    retries=5,
    max_in_flight_requests_per_connection=5,
    linger_ms=10,             # batch เล็กๆ ลด round-trip
    batch_size=16384,
    compression_type="gzip",
)

# ── Core ──────────────────────────────────────────────────
def get_active_users() -> list[str]:
    """ดึง user_id ที่มี watch history ใน ACTIVE_WINDOW_H ชั่วโมงล่าสุด"""
    since_ts = time.time() - ACTIVE_WINDOW_H * 3600

    pipeline = [
        {"$match":  {"watchedAt": {"$gte": since_ts}}},
        {"$group":  {"_id": "$userId"}},
        {"$limit":  BATCH_SIZE},
    ]

    cursor = history_col.aggregate(
        pipeline,
        allowDiskUse=True,
        maxTimeMS=30000,
    )
    users = [doc["_id"] for doc in cursor]
    print(f"📋 Found {len(users)} active users in last {ACTIVE_WINDOW_H}h")
    return users


def publish_batch(user_ids: list[str]) -> tuple[int, int]:
    """ส่ง user_ids เข้า Kafka คืนค่า (success, failed)"""
    success = failed = 0
    now_iso = datetime.now(timezone.utc).isoformat()

    for user_id in user_ids:
        payload = {
            "user_id":   user_id,
            "timestamp": now_iso,
        }
        try:
            future = producer.send(
                KAFKA_TOPIC,
                key=str(user_id),    # key = user_id → same partition → ordering
                value=payload,
            )
            # non-blocking; เรา flush ตอนท้าย
            future.add_errback(
                lambda exc, uid=user_id: print(f"❌ Send failed for {uid}: {exc}")
            )
            success += 1
        except KafkaError as e:
            print(f"❌ Kafka error for {user_id}: {e}")
            failed += 1

    producer.flush(timeout=30)
    return success, failed


def run_once():
    user_ids = get_active_users()
    if not user_ids:
        print("ℹ️  No active users, skipping")
        return

    print(f"📤 Publishing {len(user_ids)} users → topic={KAFKA_TOPIC}")
    ok, err = publish_batch(user_ids)
    print(f"✅ Done: {ok} published, {err} failed")


# ── Shutdown ──────────────────────────────────────────────
def graceful_shutdown(signum, frame):
    print("🛑 Producer shutting down...")
    producer.flush()
    producer.close()
    mongo.close()
    exit(0)

signal.signal(signal.SIGTERM, graceful_shutdown)
signal.signal(signal.SIGINT,  graceful_shutdown)

# ── Main ──────────────────────────────────────────────────
if __name__ == "__main__":
    print(f"🚀 User Vector Producer started")
    print(f"   Kafka:   {KAFKA_BROKERS}  topic={KAFKA_TOPIC}")
    print(f"   Window:  {ACTIVE_WINDOW_H}h  batch={BATCH_SIZE}")
    print(f"   Interval: {REFRESH_INTERVAL // 60} min")

    # ── ping MongoDB ──────────────────────────────────────
    for attempt in range(3):
        try:
            mongo.admin.command("ping")
            print("✅ MongoDB connected")
            break
        except ServerSelectionTimeoutError as e:
            print(f"⚠️  MongoDB attempt {attempt+1}/3: {e}")
            if attempt == 2:
                raise
            time.sleep(2)

    # ── loop ──────────────────────────────────────────────
    while True:
        try:
            run_once()
        except Exception as e:
            print(f"❌ run_once failed: {e}")
            import traceback; traceback.print_exc()

        print(f"😴 Sleeping {REFRESH_INTERVAL // 60} min...")
        time.sleep(REFRESH_INTERVAL)