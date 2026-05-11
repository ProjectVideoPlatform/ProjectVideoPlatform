# recommendation-service/server.py
import grpc
import json
import asyncio
from concurrent import futures

import recommendation_pb2
import recommendation_pb2_grpc

from pinecone import Pinecone
import redis.asyncio as aioredis
from motor.motor_asyncio import AsyncIOMotorClient
import os

# ── init clients ──────────────────────────────────────────────────────────────
pc        = Pinecone(api_key=os.environ["PINECONE_API_KEY"])
pine_idx  = pc.Index("video-catalog")

redis_client = aioredis.from_url(os.environ["REDIS_HOST"])
mongo        = AsyncIOMotorClient(os.environ["MONGO_URI"])
db           = mongo["secure-video"]  # ← เปลี่ยนชื่อ DB

PINECONE_FETCH_LIMIT = 50
SEED_LIMIT           = 10
COWATCH_LIMIT        = 10


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
    fetch_response = pine_idx.fetch(seed_ids)
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
            # 1. watched set
            watched_redis = await redis_client.zrange(f"user:watched:{user_id}", 0, -1)
            watched_mongo = await db["watchhistories"].find(
                {"userId": user_id}, {"videoId": 1}
            ).to_list(None)

            watched_set = set(
                [id.decode() if isinstance(id, bytes) else id for id in watched_redis] +
                [h["videoId"] for h in watched_mongo]
            )

            if not watched_set:
                trending = await get_trending(limit)
                return recommendation_pb2.VideoListResponse(
                    videos=[to_proto_video(v) for v in trending],
                    source="trending_cold_start"
                )

            # 2. user vector + boost พร้อมกัน
            user_vector, boost_raw = await asyncio.gather(
                get_user_vector(user_id),
                redis_client.get(f"user:boost:{user_id}")
            )
            boost_category = boost_raw.decode() if isinstance(boost_raw, bytes) else boost_raw

            if not user_vector:
                trending = await get_trending(limit)
                return recommendation_pb2.VideoListResponse(
                    videos=[to_proto_video(v) for v in trending],
                    source="trending_no_vector"
                )

            # 3. Pinecone query
            top_k    = min(limit + len(watched_set), PINECONE_FETCH_LIMIT)
            response = pine_idx.query(vector=user_vector, top_k=top_k, include_metadata=True)

            if not response.matches:
                trending = await get_trending(limit)
                return recommendation_pb2.VideoListResponse(
                    videos=[to_proto_video(v) for v in trending],
                    source="trending_no_matches"
                )

            # 4. filter watched
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

            # 5. ดึงจาก MongoDB
            docs     = await db["videos"].find(
                {"id": {"$in": recommended_ids}, "uploadStatus": "completed"}
            ).to_list(limit)

            order    = {id: i for i, id in enumerate(recommended_ids)}
            docs.sort(key=lambda v: order.get(v["id"], 99))
            boosted  = apply_boost(docs, boost_category)

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