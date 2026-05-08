const { Client } = require('@elastic/elasticsearch');

const esClient = new Client({
  node: process.env.ELASTICSEARCH_URL || 'http://elasticsearch:9200',
});

const connectES = async () => {
  try {
    const info = await esClient.info();
    console.log('✅ Elasticsearch connected:', info.version.number);
  } catch (err) {
    console.error('❌ Elasticsearch connection failed:', err.message);
  }
};

module.exports = { esClient, connectES };