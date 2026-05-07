"""
user_vector_worker.py  (Kafka consumer version)
─────────────────────────────────────────────────
Consumer group: vector-workers
รับ user_id จาก Kafka → compute vector → เขียน Redis
รัน N instances พร้อมกันได้ (docker-compose --scale)
"""

import os
import json
import time
import signal
import redis
import numpy as np
import pymongo
from pymongo.read_preferences import ReadPreference
from pymongo.errors import ServerSelectionTimeoutError
from pinecone import Pinecone
from kafka import KafkaConsumer
from kafka.errors import KafkaError
from concurrent.futures import ThreadPoolExecutor, as_completed

# ── Config ────────────────────────────────────────────────
MONGO_URI       = os.environ["MONGO_URI"]
MONGO_DB        = os.environ["MONGO_DB"]
MONGO_REPLICA   = os.environ.get("MONGO_REPLICA_SET")

REDIS_HOST      = os.environ.get("REDIS_HOST", "redis")
REDIS_PASSWORD  = os.environ.get("REDIS_PASSWORD")

PINECONE_KEY    = os.environ["PINECONE_API_KEY"]

KAFKA_BROKERS   = os.environ.get("KAFKA_BROKERS", "kafka:9092").split(",")
KAFKA_TOPIC     = os.environ.get("KAFKA_TOPIC", "user-vector-refresh")
KAFKA_GROUP     = os.environ.get("KAFKA_GROUP", "vector-workers")
WORKER_ID       = os.environ.get("WORKER_ID", "worker-1")

SEED_LIMIT      = int(os.environ.get("SEED_LIMIT", 10))
USER_VECTOR_TTL = int(os.environ.get("USER_VECTOR_TTL", 7200))   # 2 ชม.
THREAD_WORKERS  = int(os.environ.get("THREAD_WORKERS", 8))       # thread pool per process
POLL_TIMEOUT_MS = int(os.environ.get("POLL_TIMEOUT_MS", 5000))
MAX_POLL_RECORDS= int(os.environ.get("MAX_POLL_RECORDS", 50))    # messages ต่อ poll

# ── Connections ───────────────────────────────────────────
class State:
    def __init__(self):
        self.redis  = self._make_redis()
        self.mongo  = self._make_mongo()
        self._init_db()

    def _make_mongo(self):
        kwargs = dict(
            maxPoolSize=50,
            minPoolSize=10,
            maxIdleTimeMS=30000,
            waitQueueTimeoutMS=5000,
            retryWrites=True,
            retryReads=True,
            heartbeatFrequencyMS=5000,
            serverSelectionTimeoutMS=30000,
            socketTimeoutMS=30000,
            connectTimeoutMS=10000,
            readPreference="secondaryPreferred",
        )
        if MONGO_REPLICA:
            kwargs["replicaSet"] = MONGO_REPLICA
        return pymongo.MongoClient(MONGO_URI, **kwargs)

    def _make_redis(self):
        return redis.Redis(
            host=REDIS_HOST, port=6379,
            decode_responses=True, password=REDIS_PASSWORD,
            socket_connect_timeout=5,
            socket_timeout=5,
            health_check_interval=30,
        )

    def _init_db(self):
        self.db          = self.mongo[MONGO_DB]
        self.history_col = self.db.get_collection(
            "watchhistories",
            read_preference=ReadPreference.SECONDARY_PREFERRED,
        )

    def reconnect_mongo(self):
        try: self.mongo.close()
        except Exception: pass
        self.mongo = self._make_mongo()
        self._init_db()
        print(f"[{WORKER_ID}] ✅ MongoDB reconnected")

state = State()

# ── Pinecone ──────────────────────────────────────────────
pc    = Pinecone(api_key=PINECONE_KEY)
index = pc.Index("video-catalog")

# ── Kafka consumer (lazy init + retry) ───────────────────
# ไม่สร้างระดับ module เพราะถ้า Kafka ยังไม่พร้อม → crash ทันทีโดยไม่มี retry
consumer = None  # จะถูก set ใน make_consumer()

def make_consumer(retries: int = 12, delay: int = 5) -> KafkaConsumer:
    """
    สร้าง KafkaConsumer พร้อม retry
    เรียกใน __main__ หลัง MongoDB พร้อมแล้ว
    """
    for attempt in range(1, retries + 1):
        try:
            print(f"[{WORKER_ID}] 🔌 Connecting Kafka "
                  f"(attempt {attempt}/{retries}) → {KAFKA_BROKERS}")
            c = KafkaConsumer(
                KAFKA_TOPIC,
                bootstrap_servers=KAFKA_BROKERS,
                group_id=KAFKA_GROUP,
                value_deserializer=lambda v: json.loads(v.decode("utf-8")),
                auto_offset_reset="earliest",
                enable_auto_commit=False,       # manual commit หลัง process สำเร็จ
                max_poll_records=MAX_POLL_RECORDS,
                session_timeout_ms=30000,
                heartbeat_interval_ms=10000,
                max_poll_interval_ms=300000,    # 5 นาที
                request_timeout_ms=40000,
                api_version_auto_timeout_ms=10000,
            )
            print(f"[{WORKER_ID}] ✅ Kafka connected")
            return c
        except KafkaError as e:
            print(f"[{WORKER_ID}] ⚠️  Kafka not ready: {e}")
            if attempt == retries:
                raise
            time.sleep(delay)

# ── Core ──────────────────────────────────────────────────
def compute_user_vector(user_id: str) -> list | None:
    """Fetch history → Pinecone vectors → mean vector"""
    try:
        history = list(
            state.history_col.find(
                {"userId": user_id},
                {"videoId": 1, "_id": 0},
            )
            .sort("watchedAt", -1)
            .limit(SEED_LIMIT)
            .max_time_ms(5000)
        )

        if not history:
            print(f"[{WORKER_ID}] ⚠️  No history: user={user_id}")
            return None

        seed_ids       = [h["videoId"] for h in history]
        fetch_response = index.fetch(ids=seed_ids)
        records        = fetch_response.vectors or {}

        vectors = [
            records[vid].values
            for vid in seed_ids
            if vid in records and getattr(records[vid], "values", None)
        ]

        if not vectors:
            print(f"[{WORKER_ID}] ⚠️  No Pinecone vectors: user={user_id}")
            return None

        result = np.mean(vectors, axis=0).tolist()
        print(f"[{WORKER_ID}] ✅ computed dims={len(result)} user={user_id}")
        return result

    except Exception as e:
        print(f"[{WORKER_ID}] ❌ compute failed for {user_id}: {e}")
        return None


def process_message(msg_value: dict) -> bool:
    """Process 1 message จาก Kafka, คืน True = สำเร็จ"""
    user_id = msg_value.get("user_id")
    if not user_id:
        return False

    vector = compute_user_vector(user_id)
    if not vector:
        return False

    try:
        state.redis.setex(
            f"user:vector:{user_id}",
            USER_VECTOR_TTL,
            json.dumps(vector),
        )
        return True
    except redis.RedisError as e:
        print(f"[{WORKER_ID}] ⚠️  Redis error for {user_id}: {e}")
        return False


def process_batch(messages: list[dict]) -> tuple[int, int]:
    """
    ประมวลผล batch ของ messages แบบ parallel (ThreadPoolExecutor)
    คืนค่า (success_count, failed_count)
    """
    success = failed = 0
    with ThreadPoolExecutor(max_workers=THREAD_WORKERS) as executor:
        futures = {
            executor.submit(process_message, msg): msg
            for msg in messages
        }
        for future in as_completed(futures):
            try:
                ok = future.result()
                if ok:
                    success += 1
                else:
                    failed += 1
            except Exception as e:
                print(f"[{WORKER_ID}] ❌ Thread error: {e}")
                failed += 1

    return success, failed


# ── Main loop ─────────────────────────────────────────────
def run():
    print(f"[{WORKER_ID}] 🚀 Worker started")
    print(f"   Kafka:   {KAFKA_BROKERS}  topic={KAFKA_TOPIC}  group={KAFKA_GROUP}")
    print(f"   Threads: {THREAD_WORKERS}  max_poll={MAX_POLL_RECORDS}")

    consecutive_failures = 0
    MAX_FAILURES         = 5

    while True:
        try:
            raw_poll = consumer.poll(timeout_ms=POLL_TIMEOUT_MS)

            if not raw_poll:
                continue  # ไม่มี message ใหม่

            # แปลงเป็น list ของ values (จากทุก partition)
            messages = [
                record.value
                for records in raw_poll.values()
                for record in records
            ]

            total = len(messages)
            print(f"[{WORKER_ID}] 📥 Received {total} messages")

            ok, err = process_batch(messages)
            print(f"[{WORKER_ID}] 📊 Batch done: {ok} ok / {err} failed / {total} total")

            # Commit offset หลัง process ทั้ง batch (at-least-once)
            consumer.commit()
            consecutive_failures = 0

        except KafkaError as e:
            consecutive_failures += 1
            print(f"[{WORKER_ID}] ❌ Kafka error ({consecutive_failures}/{MAX_FAILURES}): {e}")
            if consecutive_failures >= MAX_FAILURES:
                print(f"[{WORKER_ID}] 🔥 Too many Kafka errors, sleeping 60s...")
                time.sleep(60)
                consecutive_failures = 0

        except Exception as e:
            consecutive_failures += 1
            print(f"[{WORKER_ID}] ❌ Unexpected error ({consecutive_failures}/{MAX_FAILURES}): {e}")
            import traceback; traceback.print_exc()

            if consecutive_failures >= MAX_FAILURES:
                print(f"[{WORKER_ID}] 🔄 Reconnecting MongoDB...")
                try:
                    state.reconnect_mongo()
                    consecutive_failures = 0
                except Exception as re_err:
                    print(f"[{WORKER_ID}] ❌ Reconnect failed: {re_err}")
                    time.sleep(60)


# ── Shutdown ──────────────────────────────────────────────
def graceful_shutdown(signum, frame):
    print(f"[{WORKER_ID}] 🛑 Shutting down...")
    try:
        if consumer:
            consumer.commit()
            consumer.close()
        state.mongo.close()
        state.redis.close()
        print(f"[{WORKER_ID}] ✅ Clean shutdown")
    except Exception as e:
        print(f"[{WORKER_ID}] ⚠️  Shutdown error: {e}")
    exit(0)

signal.signal(signal.SIGTERM, graceful_shutdown)
signal.signal(signal.SIGINT,  graceful_shutdown)

# ── Entrypoint ────────────────────────────────────────────
if __name__ == "__main__":
    # 1. Ping MongoDB ก่อน
    for attempt in range(3):
        try:
            state.mongo.admin.command("ping")
            print(f"[{WORKER_ID}] ✅ MongoDB connected")
            break
        except ServerSelectionTimeoutError as e:
            print(f"[{WORKER_ID}] ⚠️  MongoDB attempt {attempt+1}/3: {e}")
            if attempt == 2: raise
            time.sleep(2)

    # 2. สร้าง Kafka consumer พร้อม retry (lazy init)
    consumer = make_consumer()

    # 3. เริ่ม main loop
    run()