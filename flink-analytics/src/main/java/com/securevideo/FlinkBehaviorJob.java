package com.securevideo;

import org.apache.flink.api.common.functions.MapFunction;
import org.apache.flink.api.common.state.*;
import org.apache.flink.api.common.time.Time;
import org.apache.flink.api.common.typeinfo.Types;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;
import org.apache.flink.streaming.api.functions.KeyedProcessFunction;
import org.apache.flink.streaming.connectors.kafka.FlinkKafkaConsumer;
import org.apache.flink.streaming.connectors.kafka.FlinkKafkaProducer;
import org.apache.flink.util.Collector;
import org.apache.flink.shaded.jackson2.com.fasterxml.jackson.databind.JsonNode;
import org.apache.flink.shaded.jackson2.com.fasterxml.jackson.databind.ObjectMapper;
import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisPool;
import redis.clients.jedis.JedisPoolConfig;

import java.util.*;

/**
 * FlinkBehaviorJob — 2 jobs รวมในไฟล์เดียว
 *
 *  Job 1: Category Boost
 *    - อ่าน video-logs stream
 *    - keyed by user_id, session window 30 นาที (timer-based)
 *    - นับ category ที่ดูติดกัน ≥ 3 เรื่องใน session
 *    - เขียน Redis: SET user:boost:{userId} {category} EX 7200
 *
 *  Job 2: Co-watch Counter
 *    - อ่าน video-logs stream เฉพาะ event_type = 'completed'
 *    - keyed by user_id
 *    - จำ video ก่อนหน้าใน state
 *    - เมื่อเจอ completed ตัวที่ 2 → ZADD co_watch:{prevVideoId} {score} {currVideoId}
 *    - state หมดอายุหลัง 30 นาที ถ้าไม่มี event ใหม่
 *
 *  Output:
 *    - Redis keys ที่ recommendation.service.js อ่านได้ทันที
 *    - ไม่มี Kafka sink เพิ่ม (เขียน Redis โดยตรง)
 */
public class FlinkBehaviorJob {

    // ── Constants ──────────────────────────────────────────────────────────────
    static final int    CATEGORY_BOOST_THRESHOLD = 3;        // ดู category เดียวกัน ≥ 3 เรื่อง
    static final long   SESSION_GAP_MS           = 30 * 60 * 1000L; // 30 นาที
    static final int    BOOST_TTL_SEC            = 2 * 60 * 60;     // 2 ชั่วโมง
    static final int    COWATCH_TTL_SEC          = 7 * 24 * 60 * 60; // 7 วัน
    static final double COWATCH_INCREMENT        = 1.0;
    static final int    COWATCH_TOP_N            = 20;       // เก็บแค่ top 20 ต่อวิดีโอ

    static final String REDIS_HOST = System.getenv().getOrDefault("REDIS_HOST", "redis");
    static final int    REDIS_PORT = 6379;
    static final String REDIS_PASS = System.getenv("REDIS_PASSWORD");

    // ── Main ───────────────────────────────────────────────────────────────────
    public static void main(String[] args) throws Exception {

        StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment();

        // Checkpoint ทุก 30 วินาที — ป้องกัน state สูญหายถ้า crash
        env.enableCheckpointing(30_000);

        // ── Kafka Source ───────────────────────────────────────────────────────
        Properties kafkaProps = new Properties();
        kafkaProps.setProperty("bootstrap.servers",
            System.getenv().getOrDefault("KAFKA_BROKERS", "kafka:9092"));
        kafkaProps.setProperty("group.id", "flink-behavior-group");
        kafkaProps.setProperty("auto.offset.reset", "latest");

        FlinkKafkaConsumer<String> kafkaSource = new FlinkKafkaConsumer<>(
            "video-logs",          // topic เดิมที่ route ส่งอยู่แล้ว — ไม่ต้องแก้ route
            new org.apache.flink.api.common.serialization.SimpleStringSchema(),
            kafkaProps
        );

        DataStream<String> rawStream = env.addSource(kafkaSource).name("video-logs-source");

        // ── Parse JSON → VideoEvent ────────────────────────────────────────────
        DataStream<VideoEvent> events = rawStream
            .map(new ParseEventMap())
            .filter(e -> e != null && e.userId != null && !e.userId.equals("anonymous"))
            .name("parse-events");

        // ── Job 1: Category Boost ──────────────────────────────────────────────
        events
            .filter(e -> e.category != null && !e.category.equals("unknown"))
            .filter(e -> List.of("play", "watch_chunk", "completed").contains(e.eventType))
            .keyBy(e -> e.userId)
            .process(new CategoryBoostProcessor())
            .name("category-boost");

        // ── Job 2: Co-watch Counter ────────────────────────────────────────────
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
        public String category;   // single category string
        public long   receivedAt; // epoch ms
    }

    // ── Parse JSON ─────────────────────────────────────────────────────────────
    //
    //  route ส่ง video_category ที่อาจเป็น String หรือ Array
    //  จัดการทั้งสองกรณี:
    //    "cooking"        → "cooking"
    //    ["cooking","diy"] → "cooking" (เอาตัวแรก)
    //
    public static class ParseEventMap implements MapFunction<String, VideoEvent> {
        private final ObjectMapper mapper = new ObjectMapper();

        @Override
        public VideoEvent map(String raw) {
            try {
                JsonNode node = mapper.readTree(raw);

                VideoEvent e = new VideoEvent();
                e.userId    = getText(node, "user_id", "userId");
                e.videoId   = getText(node, "video_id", "videoId");
                e.eventType = getText(node, "event_type", "eventType");

                // รองรับ category ทั้ง String และ Array
                JsonNode catNode = node.get("video_category");
                if (catNode == null) catNode = node.get("category");
                if (catNode != null) {
                    if (catNode.isArray() && catNode.size() > 0) {
                        e.category = catNode.get(0).asText("unknown");
                    } else {
                        e.category = catNode.asText("unknown");
                    }
                } else {
                    e.category = "unknown";
                }

                // timestamp: receivedAt ISO string → epoch ms
                JsonNode tsNode = node.get("receivedAt");
                if (tsNode != null) {
                    try {
                        e.receivedAt = java.time.Instant.parse(tsNode.asText()).toEpochMilli();
                    } catch (Exception ex) {
                        e.receivedAt = System.currentTimeMillis();
                    }
                } else {
                    e.receivedAt = System.currentTimeMillis();
                }

                return (e.userId != null && e.videoId != null && e.eventType != null) ? e : null;

            } catch (Exception ex) {
                return null; // drop malformed messages
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
    //  State per user:
    //    - categoryCount: Map<category, count> ใน session ปัจจุบัน
    //    - lastEventTime: เวลา event ล่าสุด (ใช้ detect session gap)
    //    - sessionTimer:  Flink timer handle สำหรับ cleanup
    //
    //  Logic:
    //    1. ถ้า event ห่างจาก lastEventTime > 30 นาที → reset session
    //    2. increment categoryCount[category]
    //    3. ถ้า categoryCount[category] >= 3 → เขียน Redis boost
    //    4. ตั้ง timer ล้าง state หลัง 30 นาที ที่ไม่มี event
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

            // ── Session gap detection ──────────────────────────────────────────
            if (lastTime != null && (now - lastTime) > SESSION_GAP_MS) {
                // session ใหม่ → reset count
                categoryCount.clear();
            }

            lastEventTime.update(now);

            // ── นับ category ──────────────────────────────────────────────────
            Integer count = categoryCount.get(event.category);
            if (count == null) count = 0;
            count++;
            categoryCount.put(event.category, count);

            // ── เขียน Redis boost ─────────────────────────────────────────────
            if (count >= CATEGORY_BOOST_THRESHOLD) {
                try (Jedis jedis = jedisPool.getResource()) {
                    String key = "user:boost:" + event.userId;
                    jedis.setex(key, BOOST_TTL_SEC, event.category);
                }
                // ไม่ reset count → boost ยังคงอยู่ถ้าดูต่อ
            }

            // ── ตั้ง/รีเซ็ต session cleanup timer ─────────────────────────────
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
            // session หมดเวลา → clear state
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
    //  State per user:
    //    - prevVideoId:   video ที่ completed ล่าสุด
    //    - prevVideoTime: เวลาที่ completed (ใช้ detect session gap)
    //
    //  Logic:
    //    1. ถ้า completed ห่างจาก prevVideoTime > 30 นาที → ถือว่า session ใหม่
    //       ไม่นับ co-watch (คนไม่ได้ดูต่อเนื่อง)
    //    2. ถ้าอยู่ใน session เดียวกัน → ZADD co_watch:{prevVideoId} +1 {currVideoId}
    //    3. ZREMRANGEBYRANK ตัด top 20 ที่เหลือ (ประหยัด Redis memory)
    //    4. บันทึก prevVideoId = currVideoId
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
                // ── เขียน co-watch ─────────────────────────────────────────────
                try (Jedis jedis = jedisPool.getResource()) {
                    String key = "co_watch:" + prevId;

                    // increment score (ZADD NX → ถ้ายังไม่มี / ZADD INCR → บวกเพิ่ม)
                    jedis.zincrby(key, COWATCH_INCREMENT, event.videoId);

                    // เก็บแค่ top COWATCH_TOP_N — ตัดที่เกินออก
                    // ZREMRANGEBYRANK key 0 -(N+1) → ลบ elements ที่ score ต่ำสุด
                    long size = jedis.zcard(key);
                    if (size > COWATCH_TOP_N) {
                        jedis.zremrangeByRank(key, 0, size - COWATCH_TOP_N - 1);
                    }

                    // refresh TTL ทุกครั้งที่มี co-watch ใหม่
                    jedis.expire(key, COWATCH_TTL_SEC);
                }
            }

            // ── บันทึก state ───────────────────────────────────────────────────
            prevVideoId.update(event.videoId);
            prevVideoTime.update(now);

            // ── ตั้ง timer ล้าง state หลัง session หมด ────────────────────────
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