const { generateKPlusQR, verifyKPlusPayment } = require("../utils/kplusAPI");
const { getWSS } = require("../websocket");

// ===== CREATE QR =====
exports.createPayment = async (req, res) => {
  try {
    const { amount, orderId } = req.body;

    if (!amount || !orderId) {
      return res.status(400).json({ success: false, message: "Missing amount or orderId" });
    }

    const qrData = await generateKPlusQR(amount, orderId);

    res.json({
      success: true,
      qrImageUrl: qrData.qrImageUrl,
      kpayId: qrData.kpayId,
    });

  } catch (err) {
    console.error("QR Create Error:", err);
    res.status(500).json({ success: false });
  }
};

// ===== CALLBACK =====
exports.handleKPlusCallback = async (req, res) => {
  try {
    const signature = req.headers["x-kbank-signature"];
    const rawBody = req.body; // <--- buffer

    const verified = verifyKPlusPayment(rawBody, signature);
    if (!verified) {
      console.log("❌ Invalid signature");
      return res.status(400).json({ success: false });
    }

    const data = JSON.parse(rawBody.toString());
    const { orderId, amount } = data;

    console.log("💚 Payment Verified:", orderId, amount);

    // Real-time WebSocket notify
    const wss = getWSS();
    if (wss) {
      wss.clients.forEach((client) => {
        client.send(
          JSON.stringify({
            type: "PAYMENT_SUCCESS",
            orderId,
            amount,
          })
        );
      });
    }

    res.status(200).json({ success: true });

  } catch (err) {
    console.error("Callback Error:", err);
    res.status(500).json({ success: false });
  }
};
