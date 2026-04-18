#!/bin/bash
# Diagnostic script to verify ClickHouse analytics pipeline

echo "=== ClickHouse Analytics Diagnostic Tool ==="
echo ""

CLICKHOUSE_HOST="${CLICKHOUSE_HOST:-clickhouse_db}"
CLICKHOUSE_USER="${CLICKHOUSE_USER:-app_user}"
CLICKHOUSE_PASS="${CLICKHOUSE_PASS:-strong_password}"
CLICKHOUSE_DB="${CLICKHOUSE_DB:-app_db}"

echo "Checking ClickHouse connection..."
clickhouse-client --host=$CLICKHOUSE_HOST --user=$CLICKHOUSE_USER --password=$CLICKHOUSE_PASS \
  --query "SELECT 'ClickHouse is running' AS status" 2>/dev/null

if [ $? -ne 0 ]; then
  echo "ERROR: Cannot connect to ClickHouse on $CLICKHOUSE_HOST"
  exit 1
fi
echo "✓ ClickHouse is running"
echo ""

echo "Checking database existence..."
clickhouse-client --host=$CLICKHOUSE_HOST --user=$CLICKHOUSE_USER --password=$CLICKHOUSE_PASS \
  --query "SELECT 'Database exists' FROM system.databases WHERE name = '$CLICKHOUSE_DB'" 2>/dev/null

echo ""
echo "Checking video_watch_events table structure..."
clickhouse-client --host=$CLICKHOUSE_HOST --user=$CLICKHOUSE_USER --password=$CLICKHOUSE_PASS \
  --database=$CLICKHOUSE_DB \
  --query "DESCRIBE TABLE video_watch_events" 2>/dev/null

echo ""
echo "Checking data in video_watch_events (last 10 rows)..."
clickhouse-client --host=$CLICKHOUSE_HOST --user=$CLICKHOUSE_USER --password=$CLICKHOUSE_PASS \
  --database=$CLICKHOUSE_DB \
  --query "SELECT video_id, user_id, event_type, watch_duration_seconds, total_watch_seconds, event_time FROM video_watch_events ORDER BY event_time DESC LIMIT 10 FORMAT Pretty" 2>/dev/null

echo ""
echo "Checking summary statistics..."
clickhouse-client --host=$CLICKHOUSE_HOST --user=$CLICKHOUSE_USER --password=$CLICKHOUSE_PASS \
  --database=$CLICKHOUSE_DB \
  --query "SELECT COUNT(*) as total_events, COUNT(DISTINCT video_id) as unique_videos, COUNT(DISTINCT user_id) as unique_users, AVG(watch_duration_seconds) as avg_duration, MAX(total_watch_seconds) as max_total_watch FROM video_watch_events FORMAT Pretty" 2>/dev/null

echo ""
echo "=== Diagnostic Complete ==="
