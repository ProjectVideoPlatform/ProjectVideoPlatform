# user_vector_worker.py
import os
import time
import json
import signal
import redis
import numpy as np
from pinecone import Pinecone
import pymongo

REDIS_HOST      = os.environ.get('REDIS_HOST', 'redis')
REDIS_PASSWORD  = os.environ.get('REDIS_PASSWORD')
MONGO_URI       = os.environ.get('MONGO_URI', 'mongodb://mongodb:27017/app_db')
PINECONE_KEY    = os.environ.get('PINECONE_API_KEY')

SEED_LIMIT      = 10
USER_VECTOR_TTL = 60 * 60 * 2   # 2 ชั่วโมง
BATCH_SIZE      = 100
REFRESH_INTERVAL = 60 * 60      # 1 ชั่วโมง

if not PINECONE_KEY:
    raise ValueError("PINECONE_API_KEY is required")
if not MONGO_URI:
    raise ValueError("MONGO_URI is required")

# ── Connections ───────────────────────────────────────────
r = redis.Redis(
    host=REDIS_HOST, port=6379,
    decode_responses=True, password=REDIS_PASSWORD
)

mongo       = pymongo.MongoClient(MONGO_URI)
db          = mongo['app_db']
history_col = db['watchhistories']

pc    = Pinecone(api_key=PINECONE_KEY)
index = pc.Index('video-catalog')

# ── Core ──────────────────────────────────────────────────
def compute_user_vector(user_id: str) -> list | None:
    history = list(
        history_col.find(
            { 'userId': user_id },
            { 'videoId': 1, '_id': 0 }
        )
        .sort('watchedAt', -1)
        .limit(SEED_LIMIT)
    )

    if not history:
        return None

    seed_ids = [h['videoId'] for h in history]

    try:
        fetch_response = index.fetch(seed_ids)
        records        = fetch_response.get('records') or {}
    except Exception as e:
        print(f"❌ Pinecone fetch failed: {e}")
        return None

    vectors = [
        records[vid].values
        for vid in seed_ids
        if vid in records and records[vid].values
    ]

    if not vectors:
        return None

    return np.mean(vectors, axis=0).tolist()

def refresh_active_users():
    since    = time.time() - 60 * 60 * 24
    pipeline = [
        { '$match':   { 'watchedAt': { '$gte': since } } },
        { '$group':   { '_id': '$userId' } },
        { '$limit':   BATCH_SIZE },
    ]
    active_users = [doc['_id'] for doc in history_col.aggregate(pipeline)]
    print(f"🔄 Refreshing {len(active_users)} active users...")

    success = 0
    failed  = 0
    for user_id in active_users:
        try:
            vector = compute_user_vector(user_id)
            if vector:
                r.set(
                    f"user:vector:{user_id}",
                    json.dumps(vector),
                    ex=USER_VECTOR_TTL
                )
                success += 1
        except Exception as e:
            print(f"⚠️ Failed for user {user_id}: {e}")
            failed += 1

    print(f"✅ Done: {success} success, {failed} failed")

# ── Shutdown ──────────────────────────────────────────────
def graceful_shutdown(signum, frame):
    print("🛑 Shutting down...")
    mongo.close()
    exit(0)

signal.signal(signal.SIGTERM, graceful_shutdown)
signal.signal(signal.SIGINT,  graceful_shutdown)

# ── Main ──────────────────────────────────────────────────
if __name__ == '__main__':
    print("🚀 User vector worker starting...")
    while True:
        try:
            refresh_active_users()
        except Exception as e:
            print(f"❌ Refresh failed: {e}")
        print(f"😴 Sleeping {REFRESH_INTERVAL // 60} minutes...")
        time.sleep(REFRESH_INTERVAL)