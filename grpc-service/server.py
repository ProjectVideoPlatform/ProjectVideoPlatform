import grpc
import json
import asyncio
from concurrent import futures
from functools import partial

import recommendation_pb2
import recommendation_pb2_grpc

from pinecone import Pinecone
import redis.asyncio as aioredis
from motor.motor_asyncio import AsyncIOMotorClient
import os

# ── init clients ──────────────────────────────────────────────────────────────
pc       = Pinecone(api_key=os.environ["PINECONE_API_KEY"])
pine_idx = pc.Index("video-catalog")

REDIS_HOST     = os.environ.get("REDIS_HOST", "redis")
REDIS_PASSWORD = os.environ.get("REDIS_PASSWORD")

redis_client = aioredis.from_url(
    f"redis://{REDIS_HOST}:6379",
    password=REDIS_PASSWORD or None
)
mongo = AsyncIOMotorClient(os.environ["MONGO_URI"])
db    = mongo["secure-video"]

PINECONE_FETCH_LIMIT = 50
SEED_LIMIT           = 10
COWATCH_LIMIT        = 10

# จำกัด watched history ที่ดึงมา — production ไม่ดึงทั้งหมด
# ใช้แค่ recent N เพื่อ exclude; ยอมให้วิดีโอเก่ามากๆ โผล่ได้บ้าง
WATCHED_EXCLUSION_LIMIT = 200

_executor = futures.ThreadPoolExecutor(max_workers=4)


# ── helpers ───────────────────────────────────────────────────────────────────
def average_vectors(vectors: list[list[float]]) -> list[float] | None:
    if not vectors:
        return None
    dim    = len(vectors[0])
    result = [0.0] * dim
    for vec in vectors:
        for i in range(dim):
            result[i] += vec[i]
    return [v / len(vectors) for v in result]


def to_proto_video(doc: dict) -> recommendation_pb2.Video:
    return recommendation_pb2.Video(
        id          = doc.get("id", ""),
        title       = doc.get("title", ""),
        access_type = doc.get("accessType", "free"),
        tags        = doc.get("tags", []),
    )


async def pinecone_query(vector: list[float], top_k: int):
    """
    Pinecone SDK (sync) ต้อง wrap ด้วย run_in_executor
    มิฉะนั้น blocking call จะ block event loop ทั้งหมด
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        _executor,
        partial(pine_idx.query, vector=vector, top_k=top_k, include_metadata=True)
    )


async def pinecone_fetch(ids: list[str]):
    """Pinecone fetch ก็ sync เหมือนกัน"""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        _executor,
        partial(pine_idx.fetch, ids)
    )


async def get_user_vector(user_id: str) -> list[float] | None:
    cached = await redis_client.get(f"user:vector:{user_id}")
    if cached:
        return json.loads(cached)

    history = await db["watchhistories"].find(
        {"userId": user_id},
        {"videoId": 1}
    ).sort("watchedAt", -1).limit(SEED_LIMIT).to_list(SEED_LIMIT)

    if not history:
        return None

    seed_ids      = [h["videoId"] for h in history]
    # ใช้ async wrapper แทน sync call
    fetch_response = await pinecone_fetch(seed_ids)
    records       = fetch_response.vectors or {}
    vectors       = [records[id].values for id in seed_ids if id in records]

    if not vectors:
        return None

    user_vector = average_vectors(vectors)
    await redis_client.set(
        f"user:vector:{user_id}",
        json.dumps(user_vector),
        ex=60 * 60 * 2
    )
    return user_vector


async def get_trending(limit: int) -> list[dict]:
    trending_ids = await redis_client.lrange("global:trending:videos", 0, limit - 1)
    if not trending_ids:
        cursor = db["videos"].find({"uploadStatus": "completed"}).sort("createdAt", -1).limit(limit)
        return await cursor.to_list(limit)

    trending_ids = [id.decode() if isinstance(id, bytes) else id for id in trending_ids]
    docs         = await db["videos"].find({"id": {"$in": trending_ids}, "uploadStatus": "completed"}).to_list(limit)
    order        = {id: i for i, id in enumerate(trending_ids)}
    return sorted(docs, key=lambda v: order.get(v["id"], 99))


def apply_boost(videos: list[dict], boost_category: str | None) -> list[dict]:
    if not boost_category:
        return videos
    boosted, remaining = [], []
    for v in videos:
        cat   = v.get("tags") or v.get("categories") or v.get("videoCategory") or []
        match = boost_category in cat if isinstance(cat, list) else cat == boost_category
        (boosted if match else remaining).append(v)
    return boosted + remaining


# ── Servicer ──────────────────────────────────────────────────────────────────
class RecommendationServicer(recommendation_pb2_grpc.RecommendationServiceServicer):

    async def GetRecommended(self, request, context):
        user_id = request.user_id
        limit   = request.limit or 12

        try:
            # ── Step 1: gather watched_set + boost + user_vector พร้อมกันทีเดียว ──
            #
            # Production approach สำหรับ watched exclusion:
            # - ดึงแค่ recent WATCHED_EXCLUSION_LIMIT (200) รายการ แทนที่จะดึงทั้งหมด
            # - Redis zrange ใช้ recent items อยู่แล้ว (sorted by score/time)
            # - MongoDB ก็ sort desc + limit — ยอมให้วิดีโอเก่ามากๆ โผล่ได้บ้าง
            #   เพราะ user ที่ดูวิดีโอหลักพันรายการ ไม่น่าจำได้ว่าดูอะไรไปนานแล้ว
            #
            (
                watched_redis_raw,
                watched_mongo_raw,
                boost_raw,
            ), user_vector = await asyncio.gather(
                asyncio.gather(
                    redis_client.zrange(f"user:watched:{user_id}", 0, -1),
                    db["watchhistories"].find(
                        {"userId": user_id}, {"videoId": 1}
                    ).sort("watchedAt", -1).limit(WATCHED_EXCLUSION_LIMIT).to_list(WATCHED_EXCLUSION_LIMIT),
                    redis_client.get(f"user:boost:{user_id}"),
                ),
                get_user_vector(user_id),
            )

            watched_set = set(
                [id.decode() if isinstance(id, bytes) else id for id in watched_redis_raw] +
                [h["videoId"] for h in watched_mongo_raw]
            )
            boost_category = boost_raw.decode() if isinstance(boost_raw, bytes) else boost_raw

            # ── Step 2: cold start — ไม่มี history เลย ──
            if not watched_set or not user_vector:
                source   = "trending_cold_start" if not watched_set else "trending_no_vector"
                trending = await get_trending(limit)
                return recommendation_pb2.VideoListResponse(
                    videos=[to_proto_video(v) for v in trending],
                    source=source
                )

            # ── Step 3: Pinecone query (async via executor) ──
            top_k    = min(limit + len(watched_set), PINECONE_FETCH_LIMIT)
            response = await pinecone_query(user_vector, top_k)

            if not response.matches:
                trending = await get_trending(limit)
                return recommendation_pb2.VideoListResponse(
                    videos=[to_proto_video(v) for v in trending],
                    source="trending_no_matches"
                )

            # ── Step 4: filter watched ──
            recommended_ids = []
            for match in response.matches:
                if match.id not in watched_set:
                    recommended_ids.append(match.id)
                if len(recommended_ids) >= limit:
                    break

            if not recommended_ids:
                trending = await get_trending(limit)
                return recommendation_pb2.VideoListResponse(
                    videos=[to_proto_video(v) for v in trending],
                    source="trending_all_watched"
                )

            # ── Step 5: ดึง metadata จาก MongoDB ──
            docs = await db["videos"].find(
                {"id": {"$in": recommended_ids}, "uploadStatus": "completed"}
            ).to_list(limit)

            order   = {id: i for i, id in enumerate(recommended_ids)}
            docs.sort(key=lambda v: order.get(v["id"], 99))
            boosted = apply_boost(docs, boost_category)

            return recommendation_pb2.VideoListResponse(
                videos         = [to_proto_video(v) for v in boosted],
                source         = "personalized",
                boost_category = boost_category or ""
            )

        except Exception as e:
            print(f"[GetRecommended] error: {e}")
            trending = await get_trending(limit)
            return recommendation_pb2.VideoListResponse(
                videos=[to_proto_video(v) for v in trending],
                source="trending_error"
            )

    async def GetTrending(self, request, context):
        limit = request.limit or 12
        docs  = await get_trending(limit)
        return recommendation_pb2.VideoListResponse(
            videos=[to_proto_video(v) for v in docs],
            source="trending"
        )

    async def GetCoWatch(self, request, context):
        video_id = request.video_id
        limit    = request.limit or COWATCH_LIMIT
        try:
            co_ids = await redis_client.zrange(f"co_watch:{video_id}", 0, limit - 1, desc=True)
            co_ids = [id.decode() if isinstance(id, bytes) else id for id in co_ids]
            if not co_ids:
                return recommendation_pb2.CoWatchResponse(videos=[])

            docs  = await db["videos"].find(
                {"id": {"$in": co_ids}, "uploadStatus": "completed"}
            ).to_list(limit)
            order = {id: i for i, id in enumerate(co_ids)}
            docs.sort(key=lambda v: order.get(v["id"], 99))

            return recommendation_pb2.CoWatchResponse(videos=[to_proto_video(v) for v in docs])
        except Exception as e:
            print(f"[GetCoWatch] error: {e}")
            return recommendation_pb2.CoWatchResponse(videos=[])


# ── start server ──────────────────────────────────────────────────────────────
async def serve():
    server = grpc.aio.server(futures.ThreadPoolExecutor(max_workers=10))
    recommendation_pb2_grpc.add_RecommendationServiceServicer_to_server(
        RecommendationServicer(), server
    )
    server.add_insecure_port("[::]:50051")
    print("[gRPC] Recommendation Service listening on :50051")
    await server.start()
    await server.wait_for_termination()


if __name__ == "__main__":
    asyncio.run(serve())