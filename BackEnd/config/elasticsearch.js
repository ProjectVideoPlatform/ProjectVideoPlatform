const { Client } = require('@elastic/elasticsearch');

const esClient = new Client({
  cloud: {
    id: process.env.ELASTIC_CLOUD_ID,
  },
  auth: {
    username: 'elastic',
    password: process.env.ELASTIC_PASSWORD,
  },
});

async function connectES() {
  try {
    const info = await esClient.info();

    console.log('✅ Elasticsearch connected');
    console.log(info.version.number);
  } catch (err) {
    console.error(err);
  }
}

module.exports = { esClient, connectES };