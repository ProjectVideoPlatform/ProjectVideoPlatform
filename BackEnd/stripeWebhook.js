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

const express           = require('express');
const router            = express.Router();
const PurchaseService   = require('./services/PurchaseService');
const { verifyWebhook } = require('./services/PaymentService');
const logger            = require('./utils/logger');

const HANDLED_EVENTS = new Set([
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.requires_action',
  'charge.refunded',
  'refund.updated',
]);

// ─────────────────────────────────────────────────────────────────────────────
// POST /webhooks/stripe
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

    let event;
    try {
      event = verifyWebhook(req.body, signature);
    } catch (err) {
      logger.error('[Webhook] Signature verification failed', { message: err.message });
      return res.status(400).json({ error: `Webhook signature invalid: ${err.message}` });
    }

    logger.info('[Webhook] Received event', { type: event.type, id: event.id });

    // Acknowledge ทันที — Stripe retry ถ้าไม่ได้รับ 2xx ใน 30 วิ
    res.status(200).json({ received: true });

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
// helpers
// ─────────────────────────────────────────────────────────────────────────────
function isPromptPay(intent) {
  return intent.payment_method_types?.includes('promptpay');
}

// ─────────────────────────────────────────────────────────────────────────────
// handleEvent
// ─────────────────────────────────────────────────────────────────────────────
async function handleEvent(event) {
  switch (event.type) {

    // ── payment_intent.succeeded ─────────────────────────────────────────────
    //  Card  : เกิดหลัง capture สำเร็จ
    //  PromptPay : เกิดหลัง user สแกน QR แล้วโอนเสร็จ
    case 'payment_intent.succeeded': {
      const intent = event.data.object;

      logger.info('[Webhook] payment_intent.succeeded', {
        intentId:   intent.id,
        method:     isPromptPay(intent) ? 'promptpay' : 'card',
        chargeId:   intent.latest_charge,   // ← ch_... ใช้ refund ทีหลัง
      });

      await PurchaseService.handlePaymentCompleted({
        transactionId: intent.id,
        gatewayId:     intent.latest_charge,  // ← FIX: เดิมส่ง intent.id ซ้ำ
        amount:        intent.amount / 100,
        metadata:      intent.metadata || {},
      });
      break;
    }

    // ── payment_intent.payment_failed ────────────────────────────────────────
    //  Card  : บัตรถูกปฏิเสธ / 3DS fail
    //  PromptPay : user ไม่สแกนจนหมดเวลา (15 นาที)
    case 'payment_intent.payment_failed': {
      const intent = event.data.object;
      const reason = intent.last_payment_error?.message || 'Payment failed';

      logger.warn('[Webhook] payment_intent.payment_failed', {
        intentId:  intent.id,
        method:    isPromptPay(intent) ? 'promptpay' : 'card',
        reason,
      });

      await PurchaseService.handlePaymentFailed({
        transactionId: intent.id,
        reason,
      });
      break;
    }

    // ── payment_intent.requires_action ──────────────────────────────────────
    //  PromptPay เท่านั้น: QR หมดอายุแล้ว Stripe ส่ง event นี้มา
    //  Card ปกติจะไม่เข้า case นี้ใน server-side flow
    case 'payment_intent.requires_action': {
      const intent = event.data.object;

      if (!isPromptPay(intent)) {
        // Card requires_action = 3DS — ไม่ต้องทำอะไร รอ frontend confirm
        logger.info('[Webhook] requires_action (card/3DS) — skipping', { intentId: intent.id });
        break;
      }

      // PromptPay: QR หมดอายุแล้ว → mark failed
      logger.warn('[Webhook] PromptPay QR expired', { intentId: intent.id });

      await PurchaseService.handlePaymentFailed({
        transactionId: intent.id,
        reason:        'PromptPay QR expired',
      });
      break;
    }

    // ── charge.refunded ──────────────────────────────────────────────────────
    //  Card  : refund สำเร็จทันที (status: succeeded)
    //  PromptPay : refund อยู่ระหว่างดำเนินการ (status: pending → succeeded)
    //             webhook นี้ยิงทันทีที่ Stripe รับ refund request
    case 'charge.refunded': {
      const charge = event.data.object;

      logger.info('[Webhook] charge.refunded', {
        chargeId:       charge.id,
        intentId:       charge.payment_intent,
        amountRefunded: charge.amount_refunded / 100,
        method:         charge.payment_method_details?.type || 'unknown',
      });

      await PurchaseService.handleRefundProcessed({
        transactionId:  charge.payment_intent,
        refundId:       charge.refunds?.data?.[0]?.id,
        amountRefunded: charge.amount_refunded / 100,
      });
      break;
    }

    // ── refund.updated ───────────────────────────────────────────────────────
    //  PromptPay สำคัญมาก: pending → succeeded เมื่อเงินเข้าบัญชีจริง (3-10 วัน)
    //  Card : ปกติไม่ค่อยเข้า case นี้เพราะ succeeded ทันที
    case 'refund.updated': {
      const refundObj = event.data.object;

      logger.info('[Webhook] refund.updated', {
        refundId:  refundObj.id,
        status:    refundObj.status,
        chargeId:  refundObj.charge,
      });

      if (refundObj.status === 'succeeded') {
        // PromptPay: เงินเข้าบัญชี user แล้ว → update refund_pending → refunded
        await PurchaseService.handleRefundSucceeded({
          refundId:  refundObj.id,
          chargeId:  refundObj.charge,
          amount:    refundObj.amount / 100,
        });
      }

      if (refundObj.status === 'failed') {
        logger.error('[Webhook] Refund failed after processing', {
          refundId:      refundObj.id,
          failureReason: refundObj.failure_reason,
        });
        // update status กลับเป็น completed + แจ้ง admin
        await PurchaseService.handleRefundFailed({
          refundId:      refundObj.id,
          chargeId:      refundObj.charge,
          failureReason: refundObj.failure_reason,
        });
      }
      break;
    }

    default:
      logger.info(`[Webhook] No handler for: ${event.type}`);
  }
}

module.exports = router;