const { Client } = require('@elastic/elasticsearch');

const esClient = new Client({
  node: 'http://elasticsearch:9200', // สำคัญ
  auth: {
    username: 'elastic',
    password: process.env.ELASTIC_PASSWORD,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

const connectES = async () => {
  try {
    const info = await esClient.info();

    console.log('✅ Elasticsearch connected');
    console.log(info);

    // ถ้าจะเอา version
    console.log(
      'ES Version:',
      info?.version?.number || info?.body?.version?.number
    );
  } catch (err) {
    console.error('❌ Elasticsearch connection failed');
    console.error(err);
  }
};

module.exports = { esClient, connectES };