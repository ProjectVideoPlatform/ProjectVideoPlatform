-- ClickHouse Schema Initialization
-- This script runs automatically when the ClickHouse container starts

CREATE DATABASE IF NOT EXISTS app_db;

-- Drop old table if exists (for migration)
DROP TABLE IF EXISTS app_db.video_watch_events;

-- Create the main video analytics table with complete schema
CREATE TABLE app_db.video_watch_events
(
    video_id               String,
    user_id                String,
    session_id             String,  -- เพิ่มเพื่อติดตามเซสชันผู้ใช้
    event_type             LowCardinality(String),  -- play/watch/pause/seek/completed/close/error
    watch_duration_seconds UInt32,  -- ระยะเวลาที่ดูในครั้งนี้ (เป็นวินาที)
    total_watch_seconds    UInt32,  -- รวมเวลาดูตั้งแต่เริ่มเซสชัน (เป็นวินาที)
    current_time_seconds   UInt32,  -- ตำแหน่งปัจจุบันในวิดีโอ (เป็นวินาที)
    device_type            LowCardinality(String),
    country_code           LowCardinality(String),
    event_time             DateTime,

    -- dedup key: ถ้า client ส่ง event เดิมซ้ำ ClickHouse จะ merge ทิ้ง
    -- ใช้ ReplacingMergeTree แทน MergeTree
    _inserted_at           DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(_inserted_at)
PARTITION BY toYYYYMM(event_time)
ORDER BY (video_id, user_id, event_type, event_time)
SETTINGS index_granularity = 8192;

-- สร้าง view สำหรับ summary statistics
CREATE VIEW IF NOT EXISTS app_db.video_watch_summary AS
SELECT
    video_id,
    COUNT(*) as total_events,
    COUNT(DISTINCT user_id) as unique_users,
    COUNT(DISTINCT session_id) as unique_sessions,
    AVG(watch_duration_seconds) as avg_watch_duration,
    MAX(total_watch_seconds) as max_total_watch_time,
    SUM(watch_duration_seconds) as total_watch_hours_raw,
    ROUND(SUM(watch_duration_seconds) / 3600, 2) as total_watch_hours
FROM app_db.video_watch_events
GROUP BY video_id;
