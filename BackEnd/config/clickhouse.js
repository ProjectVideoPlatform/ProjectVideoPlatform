// config/clickhouse.js - ✅ Using Vault for secrets
'use strict';

const { createClient } = require('@clickhouse/client');
const vaultService = require('./vault');

let clickhouseClient = null;

async function initClickhouse() {
  if (clickhouseClient) {
    return clickhouseClient;
  }

  try {
    // ✅ Initialize Vault first
    await vaultService.initialize();

    // ✅ Get ClickHouse config from Vault
    const config = vaultService.getClickHouseConfig();

    console.log('📊 Connecting to ClickHouse...');
    clickhouseClient = createClient({
      url: config.url,
      username: config.username,
      password: config.password,
      database: config.database,
    });

    // Test connection
    const result = await clickhouseClient.query({
      query: 'SELECT version()',
    });

    console.log('✅ ClickHouse connected successfully');
    console.log('   Version:', result.data);

    return clickhouseClient;
  } catch (error) {
    console.error('❌ ClickHouse connection failed:', error.message);
    throw error;
  }
}

module.exports = { 
  clickhouse: clickhouseClient,
  initClickhouse 
};