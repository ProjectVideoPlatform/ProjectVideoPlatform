package com.securevideo;

import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;
import org.apache.flink.table.api.EnvironmentSettings;
import org.apache.flink.table.api.bridge.java.StreamTableEnvironment;

public class DropOffAlertJob {
    public static void main(String[] args) throws Exception {
        // 1. Setup Environment
        StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment();
        EnvironmentSettings settings = EnvironmentSettings.newInstance().inStreamingMode().build();
        StreamTableEnvironment tEnv = StreamTableEnvironment.create(env, settings);

        // 2. สร้างตารางรับข้อมูลจาก Kafka (raw-events)
        // สมมติว่า Node.js ส่ง event มาหน้าตาประมาณนี้ { "user_id": "u1", "video_id": "v1", "event_type": "close", "timestamp": 1700000000000 }
        tEnv.executeSql(
            "CREATE TABLE raw_events (" +
            "  user_id STRING," +
            "  video_id STRING," +
            "  event_type STRING," +
            "  ts BIGINT," +
            "  event_time AS TO_TIMESTAMP_LTZ(ts, 3)," + // แปลง ms เป็น Timestamp
            "  WATERMARK FOR event_time AS event_time - INTERVAL '5' SECOND" + // จัดการข้อมูลที่ส่งมา Delay
            ") WITH (" +
            "  'connector' = 'kafka'," +
            "  'topic' = 'raw-events'," +
            "  'properties.bootstrap.servers' = 'kafka:9092'," +
            "  'properties.group.id' = 'flink-dropoff-group'," +
            "  'scan.startup.mode' = 'latest-offset'," +
            "  'format' = 'json'" +
            ")"
        );

        // 3. สร้างตารางปลายทาง ส่งกลับเข้า Kafka (alerts) เพื่อให้ Node.js เอาไปยิง WebSocket ให้ Creator
        tEnv.executeSql(
            "CREATE TABLE dropoff_alerts (" +
            "  window_start TIMESTAMP(3)," +
            "  video_id STRING," +
            "  dropoff_count BIGINT," +
            "  alert_message STRING" +
            ") WITH (" +
            "  'connector' = 'kafka'," +
            "  'topic' = 'alerts'," +
            "  'properties.bootstrap.servers' = 'kafka:9092'," +
            "  'format' = 'json'" +
            ")"
        );

        // 4. ประมวลผลแบบ Real-time (Sliding Window ทุกๆ 1 นาที อัปเดตทุกๆ 10 วินาที)
        String alertQuery = 
            "INSERT INTO dropoff_alerts " +
            "SELECT " +
            "  window_start, " +
            "  video_id, " +
            "  COUNT(*) AS dropoff_count, " +
            "  'HIGH_DROPOFF_DETECTED' AS alert_message " +
            "FROM TABLE(" +
            "  HOP(TABLE raw_events, DESCRIPTOR(event_time), INTERVAL '10' SECOND, INTERVAL '1' MINUTE)" +
            ") " +
            "WHERE event_type IN ('close', 'pause') " +
            "GROUP BY window_start, window_end, video_id " +
            "HAVING COUNT(*) > 50"; // เงื่อนไข: ถ้าคนปิด/หยุดดู เกิน 50 คนใน 1 นาที ให้แจ้งเตือน!

        tEnv.executeSql(alertQuery);
    }
}