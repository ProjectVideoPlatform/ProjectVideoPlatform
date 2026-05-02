// routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const Stripe = require('stripe');

// เรียกใช้ Stripe ด้วย Secret Key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ==========================================
// STEP 1: อายัดวงเงิน (ยังไม่ตัดเงิน)
// Endpoint: POST /api/payment/authorize
// ==========================================
router.post('/authorize', async (req, res) => {
  try {
    const { amount, orderId, tableNumber } = req.body;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount * 100,       // บาท → สตางค์
      currency: 'thb',
      capture_method: 'manual',   // ← สำคัญ! ไม่ตัดเงินทันที
      metadata: { orderId, tableNumber }
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// STEP 2: ตัดเงินจริง (หลังผู้ใช้กดยืนยัน)
// Endpoint: POST /api/payment/capture
// ==========================================
router.post('/capture', async (req, res) => {
  try {
    const { paymentIntentId } = req.body;

    // ดึงข้อมูล Intent มาเช็คสถานะก่อน
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (intent.status !== 'requires_capture') {
      return res.status(400).json({ error: `สถานะไม่ถูกต้อง: ${intent.status}` });
    }

    // ทำการตัดเงินจริง
    const captured = await stripe.paymentIntents.capture(paymentIntentId);
    res.json({ success: true, amount: captured.amount / 100 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// STEP 3: ยกเลิกอายัด (กรณี user ยกเลิกหรือไม่จ่าย)
// Endpoint: POST /api/payment/cancel
// ==========================================
router.post('/cancel', async (req, res) => {
  try {
    const { paymentIntentId } = req.body;
    await stripe.paymentIntents.cancel(paymentIntentId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;