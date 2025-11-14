const crypto = require("crypto");
const axios = require("axios");
const qs = require("qs");

// --- Get access token ---
async function getKBankAccessToken() {
  const data = qs.stringify({ grant_type: 'client_credentials' });
  const res = await axios.post(
    `${process.env.KPAY_BASE_URL}/v2/oauth/token`,
    data,
    {
      headers: {
        'Authorization': 'Basic ' +
          Buffer.from(`${process.env.KPAY_CONSUMER_ID}:${process.env.KPAY_CONSUMER_SECRET}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );
  return res.data.access_token;
}

// --- Generate QR real ---
exports.generateKPlusQR = async (amount, orderId) => {
  const token = await getKBankAccessToken();

  const res = await axios.post(`${process.env.KPAY_BASE_URL}/v1/qrpayment/request`, {
    partnerTransactionId: orderId,
    amount: amount,
    callbackUrl: process.env.KPAY_CALLBACK_URL
  }, {
    headers: { Authorization: `Bearer ${token}` }
  });

  return {
    qrImageUrl: res.data.qrUrl,
    kpayId: res.data.transactionId
  };
};

// --- Verify signature ---
exports.verifyKPlusPayment = (rawBody, signature) => {
  const secret = process.env.KPLUS_WEBHOOK_SECRET;
  const computed = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return computed === signature;
};
