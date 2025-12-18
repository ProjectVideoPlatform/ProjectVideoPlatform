const axios = require('axios');

async function getKBankAccessToken() {
  const consumerId = 'eoAaArwATj8WAy7yi4lm2xmWDyUoguif';
  const consumerSecret = 'W4ri7GD1mFuRrERf';
  const base64Auth = Buffer.from(`${consumerId}:${consumerSecret}`).toString('base64');

  const response = await axios.post(
    'https://openapi-sandbox.kasikornbank.com/v2/oauth/token',
    'grant_type=client_credentials',
    {
      headers: {
        'Authorization': `Basic ${base64Auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-test-mode': 'true',
        'env-id': 'OAUTH2'
      }
    }
  );

  console.log('Access Token:', response.data.access_token);
  console.log('Expires in:', response.data.expires_in);
  return response.data.access_token;
}

// เรียก function
getKBankAccessToken().catch(console.error);
//kuyyyy