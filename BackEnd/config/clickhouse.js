// config/clickhouse.js  ← สร้างไฟล์นี้ก่อน
'use strict';

const { createClient } = require('@clickhouse/client');

const clickhouse = createClient({
  url:      process.env.CLICKHOUSE_URL      || 'http://clickhouse:8123',
  username: process.env.CLICKHOUSE_USER     || 'app_user',
  password: process.env.CLICKHOUSE_PASSWORD || 'strong_password',
  database: process.env.CLICKHOUSE_DB       || 'app_db',
});

module.exports = { clickhouse };