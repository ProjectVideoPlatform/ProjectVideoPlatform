// config/elasticsearch.js - ✅ Using Vault for secrets
const { Client } = require('@elastic/elasticsearch');
const vaultService = require('./vault');

let esClient = null;

async function initElasticsearch() {
  if (esClient) {
    return esClient;
  }

  try {
    // ✅ Initialize Vault first
    await vaultService.initialize();

    // ✅ Get Elasticsearch config from Vault
    const config = vaultService.getElasticsearchConfig();

    console.log('🔍 Connecting to Elasticsearch...');
    esClient = new Client(config);

    // Test connection
    const info = await esClient.info();

    console.log('✅ Elasticsearch connected successfully');
    console.log('   Version:', info.version.number);

    return esClient;
  } catch (error) {
    console.error('❌ Elasticsearch connection failed:', error.message);
    throw error;
  }
}

async function connectES() {
  return await initElasticsearch();
}

module.exports = { 
  esClient,
  initElasticsearch,
  connectES 
};