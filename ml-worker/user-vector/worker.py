# user_vector_worker.py
import os
import time
import json
import signal
import redis
import numpy as np
from pinecone import Pinecone
import pymongo
from pymongo.read_preferences import ReadPreference
from pymongo.errors import ServerSelectionTimeoutError

# ── Config ────────────────────────────────────────────────
REDIS_HOST      = os.environ.get('REDIS_HOST', 'redis')
REDIS_PASSWORD  = os.environ.get('REDIS_PASSWORD')
MONGO_URI       = os.environ.get('MONGO_URI')
MONGO_DB        = os.environ.get('MONGO_DB')
MONGO_REPLICA   = os.environ.get('MONGO_REPLICA_SET')  # None = standalone
PINECONE_KEY    = os.environ.get('PINECONE_API_KEY')

SEED_LIMIT       = 10
USER_VECTOR_TTL  = 60 * 60 * 2
BATCH_SIZE       = 100
REFRESH_INTERVAL = 60 * 60 * 24 

if not PINECONE_KEY:
    raise ValueError("PINECONE_API_KEY is required")
if not MONGO_URI:
    raise ValueError("MONGO_URI is required")

# ── Connections ───────────────────────────────────────────
def create_mongo_client():
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
        readPreference='secondaryPreferred',
    )
    # ✅ ใส่ replicaSet เฉพาะตอนที่ตั้งค่าไว้
    if MONGO_REPLICA:
        kwargs['replicaSet'] = MONGO_REPLICA

    return pymongo.MongoClient(MONGO_URI, **kwargs)

def create_redis_client():
    return redis.Redis(
        host=REDIS_HOST, port=6379,
        decode_responses=True, password=REDIS_PASSWORD,
        socket_connect_timeout=5,
        socket_timeout=5,
        retry_on_timeout=True,
        health_check_interval=30,
    )

# ── State (mutable สำหรับ reconnect) ─────────────────────
class State:
    def __init__(self):
        self.redis  = create_redis_client()
        self.mongo  = create_mongo_client()
        self._init_db()

    def _init_db(self):
        self.db          = self.mongo[MONGO_DB]
        self.history_col = self.db.get_collection(
            'watchhistories',
            read_preference=ReadPreference.SECONDARY_PREFERRED
        )

    def reconnect_mongo(self):
        try:
            self.mongo.close()
        except Exception:
            pass
        self.mongo = create_mongo_client()
        self._init_db()  # ✅ อัปเดต history_col ด้วย
        print("✅ MongoDB reconnected")

state = State()

# ── Test connection ───────────────────────────────────────
for attempt in range(3):
    try:
        state.mongo.admin.command('ping')
        print("✅ MongoDB connected")
        break
    except ServerSelectionTimeoutError as e:
        print(f"⚠️ MongoDB attempt {attempt+1}/3: {e}")
        if attempt == 2:
            raise
        time.sleep(2)

# ── Pinecone ──────────────────────────────────────────────
pc    = Pinecone(api_key=PINECONE_KEY)
index = pc.Index('video-catalog')

# ── Core ──────────────────────────────────────────────────
def compute_user_vector(user_id: str) -> list | None:
    try:
        history = list(
            state.history_col.find(
                { 'userId': user_id },
                { 'videoId': 1, '_id': 0 }
            )
            .sort('watchedAt', -1)
            .limit(SEED_LIMIT)
            .max_time_ms(5000)
        )

        print(f"🔍 user={user_id} | history={len(history)} docs | collection={state.history_col.full_name}")

        if not history:
            print(f"⚠️ No history found for user={user_id}")
            return None

        seed_ids = [h['videoId'] for h in history]
        print(f"🌱 seed_ids={seed_ids}")

        fetch_response = index.fetch(ids=seed_ids)
        records = fetch_response.vectors or {}
        print(f"📦 Pinecone fetched={len(records)} records out of {len(seed_ids)} requested")

        # ✅ log แต่ละ id ว่าเจอใน Pinecone ไหม
        for vid in seed_ids:
            found = vid in records
            print(f"   {'✅' if found else '❌'} videoId={vid} in Pinecone: {found}")

        vectors = [
            records[vid].values
            for vid in seed_ids
            if vid in records and getattr(records[vid], 'values', None)
        ]

        if not vectors:
            print(f"⚠️ No vectors found in Pinecone for user={user_id}")
            return None

        result = np.mean(vectors, axis=0).tolist()
        print(f"✅ user_vector computed | dims={len(result)} | user={user_id}")
        return result

    except Exception as e:
        print(f"❌ compute_user_vector failed for {user_id}: {e}")
        import traceback
        traceback.print_exc()
        return None

def refresh_active_users():
    since    = time.time() - 60 * 60 * 24
    pipeline = [
        { '$match': { 'watchedAt': { '$gte': since } } },
        { '$group': { '_id': '$userId' } },
        { '$limit': BATCH_SIZE },
    ]

    cursor       = state.history_col.aggregate(pipeline, allowDiskUse=True, maxTimeMS=30000)
    active_users = [doc['_id'] for doc in cursor]

    print(f"🔄 Refreshing {len(active_users)} active users...")

    if not active_users:
        print("ℹ️ No active users found")
        return

    success = 0
    failed  = 0

    for user_id in active_users:
        try:
            vector = compute_user_vector(user_id)
            if vector:
                state.redis.setex(
                    f"user:vector:{user_id}",
                    USER_VECTOR_TTL,
                    json.dumps(vector)
                )
                success += 1
                if success % 10 == 0:
                    print(f"📊 Progress: {success}/{len(active_users)}")
            else:
                failed += 1
        except redis.RedisError as e:
            print(f"⚠️ Redis error for {user_id}: {e}")
            failed += 1
        except Exception as e:
            print(f"⚠️ Failed for {user_id}: {e}")
            failed += 1

    print(f"✅ Done: {success} success, {failed} failed")

# ── Shutdown ──────────────────────────────────────────────
def graceful_shutdown(signum, frame):
    print("🛑 Shutting down...")
    try:
        state.mongo.close()
        state.redis.close()
        print("✅ Connections closed")
    except Exception as e:
        print(f"⚠️ Shutdown error: {e}")
    exit(0)

signal.signal(signal.SIGTERM, graceful_shutdown)
signal.signal(signal.SIGINT,  graceful_shutdown)

# ── Main ──────────────────────────────────────────────────
if __name__ == '__main__':
    print(f"🚀 User vector worker starting...")
    print(f"   DB:       {MONGO_DB}")
    print(f"   Redis:    {REDIS_HOST}")
    print(f"   Interval: {REFRESH_INTERVAL // 60} min")
    print(f"   Batch:    {BATCH_SIZE}")

    consecutive_failures = 0
    MAX_FAILURES         = 3

    while True:
        try:
            refresh_active_users()
            consecutive_failures = 0

        except Exception as e:
            consecutive_failures += 1
            print(f"❌ Refresh failed ({consecutive_failures}/{MAX_FAILURES}): {e}")

            if consecutive_failures >= MAX_FAILURES:
                print("🔥 Too many failures, reconnecting MongoDB...")
                try:
                    state.reconnect_mongo()  # ✅ reconnect ผ่าน state
                    consecutive_failures = 0
                except Exception as reconnect_err:
                    print(f"❌ Reconnect failed: {reconnect_err}")
                    time.sleep(60)

        print(f"😴 Sleeping {REFRESH_INTERVAL // 60} minutes...")
        time.sleep(REFRESH_INTERVAL)