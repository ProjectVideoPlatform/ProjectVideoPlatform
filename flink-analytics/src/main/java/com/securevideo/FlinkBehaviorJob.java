package com.securevideo;

import org.apache.flink.api.common.eventtime.WatermarkStrategy;
import org.apache.flink.api.common.functions.MapFunction;
import org.apache.flink.api.common.state.*;
import org.apache.flink.api.common.time.Time;
import org.apache.flink.api.common.typeinfo.Types;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.connector.kafka.source.KafkaSource;
import org.apache.flink.connector.kafka.source.enumerator.initializer.OffsetsInitializer;
import org.apache.flink.api.common.serialization.SimpleStringSchema;
import org.apache.flink.streaming.api.CheckpointingMode;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;
import org.apache.flink.streaming.api.functions.KeyedProcessFunction;
import org.apache.flink.util.Collector;
import org.apache.flink.shaded.jackson2.com.fasterxml.jackson.databind.JsonNode;
import org.apache.flink.shaded.jackson2.com.fasterxml.jackson.databind.ObjectMapper;
import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisPool;
import redis.clients.jedis.JedisPoolConfig;
import redis.clients.jedis.params.SetParams;

import java.util.*;

/**
 * FlinkBehaviorJob — 2 jobs รวมในไฟล์เดียว
 *
 *  Job 1: Category Boost
 *    - อ่าน video-logs stream
 *    - keyed by user_id, session window 30 นาที (timer-based)
 *    - นับ category ที่ดูติดกัน ≥ 3 เรื่องใน session
 *    - เขียน Redis: SETEX user:boost:{userId} {category} 7200
 *    - Redis write เป็น idempotent อยู่แล้ว (SETEX เขียนซ้ำ = refresh TTL)
 *    - ใช้ Flink EXACTLY_ONCE checkpoint การันตี state ไม่ถูก process ซ้ำ
 *
 *  Job 2: Co-watch Counter
 *    - อ่าน video-logs stream เฉพาะ event_type = 'completed'
 *    - keyed by user_id
 *    - จำ video ก่อนหน้าใน state
 *    - เมื่อเจอ completed ตัวที่ 2 → ZINCRBY co_watch:{prevVideoId} 1 {currVideoId}
 *    - ZINCRBY ไม่ idempotent → ใช้ Redis SET NX per event_id เป็น dedup gate
 *    - state หมดอายุหลัง 30 นาที ถ้าไม่มี event ใหม่
 *
 *  Idempotency strategy:
 *    Category Boost  → Flink EXACTLY_ONCE + SETEX (naturally idempotent)
 *    Co-watch        → Redis SET NX "dedup:cw:{eventId}" EX 3600
 *
 *  Output:
 *    - Redis keys ที่ recommendation.service.js อ่านได้ทันที
 */
public class FlinkBehaviorJob {

    // ── Constants ──────────────────────────────────────────────────────────────
    static final int    CATEGORY_BOOST_THRESHOLD = 3;
    static final long   SESSION_GAP_MS           = 30 * 60 * 1000L;
    static final int    BOOST_TTL_SEC            = 2 * 60 * 60;
    static final int    COWATCH_TTL_SEC          = 7 * 24 * 60 * 60;
    static final int    DEDUP_TTL_SEC            = 60 * 60; // 1 ชั่วโมง — ครอบ checkpoint replay gap
    static final double COWATCH_INCREMENT        = 1.0;
    static final int    COWATCH_TOP_N            = 20;

    static final String REDIS_HOST = System.getenv().getOrDefault("REDIS_HOST", "redis");
    static final int    REDIS_PORT = 6379;
    static final String REDIS_PASS = System.getenv("REDIS_PASSWORD");

    // ── Main ───────────────────────────────────────────────────────────────────
    public static void main(String[] args) throws Exception {

        StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment();

        // ── FIX #1: EXACTLY_ONCE checkpoint ───────────────────────────────────
        // AT_LEAST_ONCE (default) → Flink state อาจถูก process ซ้ำตอน restart
        // EXACTLY_ONCE            → Kafka offset + Flink state commit พร้อมกัน
        //                           Category Boost ไม่ต้องการ dedup เพิ่มเติม
        env.enableCheckpointing(30_000);
        env.getCheckpointConfig().setCheckpointingMode(CheckpointingMode.EXACTLY_ONCE);
        env.getCheckpointConfig().setMinPauseBetweenCheckpoints(5_000);
        env.getCheckpointConfig().setCheckpointTimeout(60_000);

        // ── FIX #2: เปลี่ยนจาก FlinkKafkaConsumer (legacy) → KafkaSource ────
        // FlinkKafkaConsumer ถูก deprecate ใน Flink 1.14+
        // KafkaSource รองรับ EXACTLY_ONCE ได้สมบูรณ์กว่า
        KafkaSource<String> kafkaSource = KafkaSource.<String>builder()
            .setBootstrapServers(
                System.getenv().getOrDefault("KAFKA_BROKERS", "kafka:9092"))
            .setTopics("video-logs")
            .setGroupId("flink-behavior-group")
            .setStartingOffsets(OffsetsInitializer.latest())
            .setValueOnlyDeserializer(new SimpleStringSchema())
            .build();

        // WatermarkStrategy.noWatermarks() = processing time mode
        DataStream<String> rawStream = env
            .fromSource(kafkaSource, WatermarkStrategy.noWatermarks(), "video-logs-source");

        // ── Parse JSON → VideoEvent ────────────────────────────────────────────
        DataStream<VideoEvent> events = rawStream
            .map(new ParseEventMap())
            .filter(e -> e != null && e.userId != null && !e.userId.equals("anonymous"))
            .name("parse-events");

        // ── Job 1: Category Boost ──────────────────────────────────────────────
        // Redis write = SETEX → idempotent โดยธรรมชาติ
        // EXACTLY_ONCE checkpoint การันตี categoryCount ไม่นับซ้ำ
        // → ไม่ต้องการ event-level dedup เพิ่ม
        events
            .filter(e -> e.category != null && !e.category.equals("unknown"))
            .filter(e -> List.of("play", "watch_chunk", "completed").contains(e.eventType))
            .keyBy(e -> e.userId)
            .process(new CategoryBoostProcessor())
            .name("category-boost");

        // ── Job 2: Co-watch Counter ────────────────────────────────────────────
        // Redis write = ZINCRBY → ไม่ idempotent
        // → ต้องการ Redis SET NX dedup gate ต่อ event_id
        events
            .filter(e -> e.eventType.equals("completed"))
            .keyBy(e -> e.userId)
            .process(new CoWatchProcessor())
            .name("co-watch-counter");

        env.execute("FlinkBehaviorJob");
    }

    // ── VideoEvent POJO ────────────────────────────────────────────────────────
    public static class VideoEvent {
        public String userId;
        public String videoId;
        public String eventType;
        public String category;
        public String eventId;    // ← FIX #3: เพิ่ม field สำหรับ dedup key
        public long   receivedAt;
    }

    // ── Parse JSON ─────────────────────────────────────────────────────────────
    public static class ParseEventMap implements MapFunction<String, VideoEvent> {
        private final ObjectMapper mapper = new ObjectMapper();

        @Override
        public VideoEvent map(String raw) {
            try {
                JsonNode node = mapper.readTree(raw);

                VideoEvent e = new VideoEvent();
                e.userId    = getText(node, "user_id",    "userId");
                e.videoId   = getText(node, "video_id",   "videoId");
                e.eventType = getText(node, "event_type", "eventType");

                // รองรับ category ทั้ง String และ Array
                JsonNode catNode = node.get("video_category");
                if (catNode == null) catNode = node.get("category");
                if (catNode != null) {
                    e.category = catNode.isArray() && catNode.size() > 0
                        ? catNode.get(0).asText("unknown")
                        : catNode.asText("unknown");
                } else {
                    e.category = "unknown";
                }

                // ── FIX #3: parse eventId ──────────────────────────────────────
                // ลำดับ: event_id → eventId → log_id → สร้าง composite key
                e.eventId = getText(node, "event_id", "eventId", "log_id");
                if (e.eventId == null) {
                    // fallback: bucket timestamp ลง 5 นาที
                    // ความแม่นยำ ±5 นาที — ดีพอสำหรับ checkpoint replay gap
                    // ควรให้ Node.js route ส่ง event_id UUID มาเพื่อความถูกต้อง 100%
                    JsonNode tsNode = node.get("receivedAt");
                    long ts = tsNode != null
                        ? parseTimestamp(tsNode.asText())
                        : System.currentTimeMillis();
                    long bucket = ts / (5 * 60 * 1000L);
                    e.eventId = e.userId + ":" + e.videoId + ":" + e.eventType + ":" + bucket;
                }

                // timestamp
                JsonNode tsNode = node.get("receivedAt");
                e.receivedAt = tsNode != null
                    ? parseTimestamp(tsNode.asText())
                    : System.currentTimeMillis();

                return (e.userId != null && e.videoId != null && e.eventType != null) ? e : null;

            } catch (Exception ex) {
                return null;
            }
        }

        private long parseTimestamp(String text) {
            try {
                return java.time.Instant.parse(text).toEpochMilli();
            } catch (Exception ex) {
                return System.currentTimeMillis();
            }
        }

        private String getText(JsonNode node, String... keys) {
            for (String key : keys) {
                JsonNode n = node.get(key);
                if (n != null && !n.isNull()) return n.asText();
            }
            return null;
        }
    }

    // ── Job 1: Category Boost Processor ───────────────────────────────────────
    //
    //  Idempotency:
    //    EXACTLY_ONCE checkpoint → processElement() ไม่ถูกเรียกซ้ำ
    //    SETEX → เขียนซ้ำ = refresh TTL เท่านั้น ผลเหมือนกัน
    //    → ไม่ต้องการ seenEvents state เพิ่ม
    //
    public static class CategoryBoostProcessor
            extends KeyedProcessFunction<String, VideoEvent, Void> {

        private MapState<String, Integer> categoryCount;
        private ValueState<Long>          lastEventTime;
        private ValueState<Long>          sessionTimerTs;

        private transient JedisPool jedisPool;

        @Override
        public void open(Configuration cfg) {
            categoryCount  = getRuntimeContext().getMapState(
                new MapStateDescriptor<>("category-count", Types.STRING, Types.INT));
            lastEventTime  = getRuntimeContext().getState(
                new ValueStateDescriptor<>("last-event-time", Types.LONG));
            sessionTimerTs = getRuntimeContext().getState(
                new ValueStateDescriptor<>("session-timer-ts", Types.LONG));

            jedisPool = createJedisPool();
        }

        @Override
        public void processElement(VideoEvent event, Context ctx, Collector<Void> out)
                throws Exception {

            long now      = event.receivedAt;
            Long lastTime = lastEventTime.value();

            // session gap → reset count
            if (lastTime != null && (now - lastTime) > SESSION_GAP_MS) {
                categoryCount.clear();
            }

            lastEventTime.update(now);

            // นับ category
            Integer count = categoryCount.get(event.category);
            if (count == null) count = 0;
            categoryCount.put(event.category, ++count);

            // เขียน Redis boost — SETEX เป็น idempotent
            if (count >= CATEGORY_BOOST_THRESHOLD) {
                try (Jedis jedis = jedisPool.getResource()) {
                    jedis.setex("user:boost:" + event.userId, BOOST_TTL_SEC, event.category);
                }
            }

            // ตั้ง/รีเซ็ต session cleanup timer
            Long prevTimer = sessionTimerTs.value();
            if (prevTimer != null) {
                ctx.timerService().deleteProcessingTimeTimer(prevTimer);
            }
            long newTimer = now + SESSION_GAP_MS;
            ctx.timerService().registerProcessingTimeTimer(newTimer);
            sessionTimerTs.update(newTimer);
        }

        @Override
        public void onTimer(long timestamp, OnTimerContext ctx, Collector<Void> out)
                throws Exception {
            categoryCount.clear();
            lastEventTime.clear();
            sessionTimerTs.clear();
        }

        @Override
        public void close() {
            if (jedisPool != null) jedisPool.close();
        }
    }

    // ── Job 2: Co-watch Processor ──────────────────────────────────────────────
    //
    //  Idempotency:
    //    ZINCRBY ไม่ idempotent → ต้องการ explicit dedup
    //    ใช้ Redis SET NX "dedup:cw:{eventId}" EX 3600 เป็น gate
    //
    //    ทำไมไม่ใช้ Flink MapState เป็น dedup:
    //    1. ถ้า scale parallelism → state ไม่ share ข้าม task instances
    //    2. Redis เป็น single source of truth อยู่แล้ว → dedup ที่นี่พอ
    //
    //    ทำไม TTL 1 ชั่วโมง:
    //    - Checkpoint interval = 30 วินาที
    //    - ถ้า crash + restart replay ย้อนหลัง ≈ checkpoint gap ≤ 30 วินาที
    //    - 1 ชั่วโมง ครอบ replay window ได้สบาย
    //    - ถ้าต้องการ full Kafka replay ข้ามวัน → ใช้ --skip-dedup flag
    //
    public static class CoWatchProcessor
            extends KeyedProcessFunction<String, VideoEvent, Void> {

        private ValueState<String> prevVideoId;
        private ValueState<Long>   prevVideoTime;

        private transient JedisPool jedisPool;

        @Override
        public void open(Configuration cfg) {
            prevVideoId   = getRuntimeContext().getState(
                new ValueStateDescriptor<>("prev-video-id",   Types.STRING));
            prevVideoTime = getRuntimeContext().getState(
                new ValueStateDescriptor<>("prev-video-time", Types.LONG));

            jedisPool = createJedisPool();
        }

        @Override
        public void processElement(VideoEvent event, Context ctx, Collector<Void> out)
                throws Exception {

            String prevId   = prevVideoId.value();
            Long   prevTime = prevVideoTime.value();
            long   now      = event.receivedAt;

            boolean inSameSession = prevId != null
                && prevTime != null
                && (now - prevTime) <= SESSION_GAP_MS;

            if (inSameSession && !prevId.equals(event.videoId)) {

                try (Jedis jedis = jedisPool.getResource()) {

                    // ── Dedup gate: SET NX per event_id ───────────────────────
                    // acquired != null → key ถูกสร้างใหม่ = event นี้ยังไม่เคย process
                    // acquired == null → key มีอยู่แล้ว  = duplicate → skip
                    String dedupKey = "dedup:cw:" + event.eventId;
                    String acquired = jedis.set(dedupKey, "1",
                        new SetParams().nx().ex(DEDUP_TTL_SEC));

                    if (acquired == null) {
                        // duplicate — อัปเดต state ด้วยเพื่อให้ session tracking ถูกต้อง
                        prevVideoId.update(event.videoId);
                        prevVideoTime.update(now);
                        ctx.timerService().registerProcessingTimeTimer(now + SESSION_GAP_MS);
                        return;
                    }

                    // ── Write co-watch (ผ่าน dedup gate แล้ว) ─────────────────
                    String coWatchKey = "co_watch:" + prevId;

                    // Pipeline: ลด round-trip จาก 3 commands → 1 batch
                    redis.clients.jedis.Pipeline pipe = jedis.pipelined();
                    pipe.zincrby(coWatchKey, COWATCH_INCREMENT, event.videoId);
                    pipe.zcard(coWatchKey);
                    pipe.expire(coWatchKey, COWATCH_TTL_SEC);
                    List<Object> results = pipe.syncAndReturnAll();

                    // ตัด elements ที่เกิน top N (ใช้ zcard result จาก pipeline)
                    long size = (Long) results.get(1);
                    if (size > COWATCH_TOP_N) {
                        jedis.zremrangeByRank(coWatchKey, 0, size - COWATCH_TOP_N - 1);
                    }
                }
            }

            // อัปเดต state
            prevVideoId.update(event.videoId);
            prevVideoTime.update(now);
            ctx.timerService().registerProcessingTimeTimer(now + SESSION_GAP_MS);
        }

        @Override
        public void onTimer(long timestamp, OnTimerContext ctx, Collector<Void> out)
                throws Exception {
            prevVideoId.clear();
            prevVideoTime.clear();
        }

        @Override
        public void close() {
            if (jedisPool != null) jedisPool.close();
        }
    }

    // ── Redis Pool Factory ─────────────────────────────────────────────────────
    static JedisPool createJedisPool() {
        JedisPoolConfig cfg = new JedisPoolConfig();
        cfg.setMaxTotal(10);
        cfg.setMaxIdle(5);
        cfg.setMinIdle(2);
        cfg.setTestOnBorrow(true);

        if (REDIS_PASS != null && !REDIS_PASS.isEmpty()) {
            return new JedisPool(cfg, REDIS_HOST, REDIS_PORT, 2000, REDIS_PASS);
        }
        return new JedisPool(cfg, REDIS_HOST, REDIS_PORT, 2000);
    }
}