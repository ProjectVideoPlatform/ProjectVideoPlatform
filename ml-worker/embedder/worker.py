# embedder_worker.py
import json
import os
import threading
import time
import pika
from sentence_transformers import SentenceTransformer
from pinecone import Pinecone, ServerlessSpec

PINECONE_KEY  = os.environ.get('PINECONE_API_KEY')
RABBITMQ_URL  = os.environ.get('RABBITMQ_URL', 'amqp://guest:guest@rabbitmq:5672')
BATCH_SIZE    = 50
DLX_EXCHANGE  = 'dead_letter_exchange'
DLX_ROUTING_KEY = 'failed_embedding'

model = SentenceTransformer('all-MiniLM-L6-v2')

pc    = Pinecone(api_key=PINECONE_KEY)
index = pc.Index('video-catalog')

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
        index.upsert(vectors=to_flush)
        print(f"📦 Flushed {len(to_flush)} vectors")
    except Exception as e:
        print(f"❌ Flush failed: {e}")

def process_message(ch, method, properties, body):
    try:
        data       = json.loads(body.decode('utf-8'))
        video_id   = data.get('videoId')
        title      = data.get('title', '')
        desc       = data.get('description', '')
        categories = data.get('category', [])

        if not video_id:
            raise ValueError("Missing videoId")

        text   = f"{title}. {desc}. หมวดหมู่: {', '.join(categories)}"
        vector = model.encode(text).tolist()

        # ✅ แก้ deadlock — flag นอก lock
        should_flush = False
        with batch_lock:
            upsert_batch.append({
                "id":     str(video_id),
                "values": vector,
                "metadata": {"videoId": str(video_id), "title": title, "categories": categories}
            })
            if len(upsert_batch) >= BATCH_SIZE:
                should_flush = True

        if should_flush:
            flush_batch()

        ch.basic_ack(delivery_tag=method.delivery_tag)

    except Exception as e:
        print(f"❌ Embed error: {e}")
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

def connect_and_consume():
    while True:
        try:
            params = pika.URLParameters(RABBITMQ_URL)
            conn   = pika.BlockingConnection(params)
            ch     = conn.channel()
            ch.queue_declare(
                queue='video_index', durable=True,
                arguments={
                    'x-dead-letter-exchange':    DLX_EXCHANGE,
                    'x-dead-letter-routing-key': DLX_ROUTING_KEY,
                }
            )
            ch.basic_qos(prefetch_count=1)
            ch.basic_consume(queue='video_index', on_message_callback=process_message)
            print("🚀 Embedder worker ready")
            ch.start_consuming()
        except Exception as e:
            print(f"⚠️ RabbitMQ crashed, reconnecting: {e}")
            flush_batch()   # flush ก่อน reconnect
            time.sleep(5)

connect_and_consume()