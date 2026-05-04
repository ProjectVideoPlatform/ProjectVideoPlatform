'use strict';

// routes/webhook.js
//
//  POST /webhooks/stripe
//
//  ⚠️  CRITICAL: route นี้ต้องใช้ express.raw() ไม่ใช่ express.json()
//      เพราะ stripe.webhooks.constructEvent ต้องการ raw Buffer
//      ถ้า body ถูก parse เป็น JSON ก่อน → signature จะ invalid เสมอ
//
//  ใน app.js / server.js ต้อง mount route นี้ก่อน express.json() middleware
//  หรือใช้วิธี exclude path นี้ออกจาก global json parser

const express         = require('express');
const router          = express.Router();
const PurchaseService = require('./services/PurchaseService');
const { verifyWebhook } = require('./services/PaymentService');
const logger          = require('./utils/logger');

// ── Event types ที่ handle ────────────────────────────────────────────────────
const HANDLED_EVENTS = new Set([
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.refunded',
  'refund.updated',
]);

// ─────────────────────────────────────────────────────────────────────────────
// POST /webhooks/stripe
//
//  express.raw({ type: 'application/json' }) ต้องอยู่ตรงนี้เท่านั้น
//  ไม่ใช่ global middleware
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'];

    if (!signature) {
      logger.warn('[Webhook] Missing Stripe-Signature header');
      return res.status(400).json({ error: 'Missing signature' });
    }

    // ── 1. Parse + verify ──────────────────────────────────────────────────
    let event;
    try {
      event = await verifyWebhook(req.body, signature);
    } catch (err) {
      logger.error('[Webhook] Signature verification failed', { message: err.message });
      return res.status(400).json({ error: `Webhook signature invalid: ${err.message}` });
    }

    logger.info('[Webhook] Received event', { type: event.type, id: event.id });

    // ── 2. Acknowledge ทันที (Stripe retry ถ้าไม่ได้รับ 2xx ใน 30 วิ) ──────
    res.status(200).json({ received: true });

    // ── 3. Handle event แบบ async (ไม่ block response) ───────────────────
    if (!HANDLED_EVENTS.has(event.type)) {
      logger.info(`[Webhook] Unhandled event type: ${event.type}`);
      return;
    }

    setImmediate(async () => {
      try {
        await handleEvent(event);
      } catch (err) {
        logger.error('[Webhook] Event handling failed', {
          eventType: event.type,
          eventId:   event.id,
          message:   err.message,
        });
      }
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// handleEvent — dispatch ไปยัง handler ที่ถูกต้อง
// ─────────────────────────────────────────────────────────────────────────────
async function handleEvent(event) {
  switch (event.type) {

    // ── payment_intent.succeeded ─────────────────────────────────────────
    //  เกิดหลัง confirm สำเร็จ (รวมถึงหลัง 3DS)
    //  ใช้อัพเดต Purchase ที่ยังค้างอยู่ในสถานะ pending (กรณี async confirm)
    case 'payment_intent.succeeded': {
      const intent = event.data.object;
      logger.info('[Webhook] payment_intent.succeeded', { intentId: intent.id });

      await PurchaseService.handlePaymentCompleted({
        transactionId: intent.id,
        gatewayId:     intent.id,
        amount:        intent.amount / 100,   // satang → บาท
        metadata:      intent.metadata || {},
      });
      break;
    }

    // ── payment_intent.payment_failed ────────────────────────────────────
    //  บัตรถูกปฏิเสธ หรือ 3DS fail
    case 'payment_intent.payment_failed': {
      const intent = event.data.object;
      const errMsg = intent.last_payment_error?.message || 'Payment failed';

      logger.warn('[Webhook] payment_intent.payment_failed', {
        intentId: intent.id,
        reason:   errMsg,
      });

      await PurchaseService.handlePaymentFailed({
        transactionId: intent.id,
        reason:        errMsg,
      });
      break;
    }

    // ── charge.refunded ──────────────────────────────────────────────────
    //  refund สำเร็จ (อาจมาจาก Stripe dashboard หรือ API)
    case 'charge.refunded': {
      const charge = event.data.object;
      logger.info('[Webhook] charge.refunded', {
        chargeId:  charge.id,
        intentId:  charge.payment_intent,
        amountRefunded: charge.amount_refunded / 100,
      });

      await PurchaseService.handleRefundProcessed({
        transactionId: charge.payment_intent,
        refundId:      charge.refunds?.data?.[0]?.id,
        amountRefunded: charge.amount_refunded / 100,
      });
      break;
    }

    // ── refund.updated ───────────────────────────────────────────────────
    //  สถานะ refund เปลี่ยน (pending → succeeded / failed)
    case 'refund.updated': {
      const refundObj = event.data.object;
      logger.info('[Webhook] refund.updated', {
        refundId: refundObj.id,
        status:   refundObj.status,
      });

      if (refundObj.status === 'failed') {
        logger.error('[Webhook] Refund failed after processing', {
          refundId:      refundObj.id,
          failureReason: refundObj.failure_reason,
        });
        // TODO: แจ้ง admin หรือ trigger manual refund flow
      }
      break;
    }

    default:
      logger.info(`[Webhook] No handler for: ${event.type}`);
  }
}

module.exports = router;