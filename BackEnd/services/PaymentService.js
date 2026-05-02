// services/PaymentService.js  ← rename และแยกออกมาชัดเจน
'use strict';

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const logger = require('../utils/logger');

const PaymentService = {

  // ─── Step 1: อายัดวงเงิน (ยังไม่ตัดเงิน) ───────────────────────
  async authorize({ amount, currency = 'thb', customerId, metadata = {} }) {
    const intent = await stripe.paymentIntents.create({
      amount:         Math.round(amount * 100), // สตางค์
      currency,
      capture_method: 'manual',                 // ← ไม่ตัดทันที
      metadata:       { customerId: customerId?.toString(), ...metadata }
    });

    return {
      clientSecret:   intent.client_secret,
      intentId:       intent.id,
      requiresAction: intent.status === 'requires_action'
    };
  },

  // ─── Step 2: ตัดเงินจริง ────────────────────────────────────────
  async capture(paymentIntentId) {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (intent.status !== 'requires_capture') {
      throw new Error(`Cannot capture — status: ${intent.status}`);
    }

    const captured = await stripe.paymentIntents.capture(paymentIntentId);

    return {
      success:   true,
      id:        captured.id,
      gatewayId: captured.latest_charge,
      method:    captured.payment_method_types[0],
      gateway:   'stripe',
      capturedAt: new Date().toISOString(),
      amount:    captured.amount_received / 100
    };
  },

  // ─── processPayment: authorize + รอ frontend confirm ─────────────
  // (PurchaseService เรียกตรงนี้ — ส่ง clientSecret กลับถ้ายังไม่ capture)
  async processPayment(paymentData) {
    const { paymentIntentId, amount, currency, customerId, metadata } = paymentData;

    // ถ้ามี intentId แล้ว = frontend confirm แล้ว → capture เลย
    if (paymentIntentId) {
      return await this.capture(paymentIntentId);
    }

    // ถ้าไม่มี = เริ่มใหม่ → authorize แล้วรอ frontend
    const result = await this.authorize({ amount, currency, customerId, metadata });
    return {
      success:        false,
      requiresAction: true,
      clientSecret:   result.clientSecret,
      intentId:       result.intentId
    };
  },

  // ─── Refund ──────────────────────────────────────────────────────
  async refund({ transactionId, amount, reason }) {
    const refund = await stripe.refunds.create({
      payment_intent: transactionId,
      amount:         amount ? Math.round(amount * 100) : undefined, // partial refund
      reason:         'requested_by_customer',
      metadata:       { reason }
    });

    return {
      success:     refund.status === 'succeeded',
      refundId:    refund.id,
      amount:      refund.amount / 100,
      processedAt: new Date().toISOString()
    };
  },
// services/PaymentService.js

// ─── เพิ่ม: ดึง intent มาเช็ค metadata ────────────────────────────
async retrieveIntent(paymentIntentId) {
  return await stripe.paymentIntents.retrieve(paymentIntentId);
},
  // ─── Compensating refund (ถ้า DB fail หลัง capture) ─────────────
  async refundIfNeeded({ transactionId, amount, reason }) {
    try {
      const intent = await stripe.paymentIntents.retrieve(transactionId);
      if (intent.status !== 'succeeded') return { success: true, skipped: true };

      return await this.refund({ transactionId, amount, reason });
    } catch (err) {
      logger.error('refundIfNeeded failed:', err);
      return { success: false, error: err.message };
    }
  },

  // ─── Webhook signature verify ─────────────────────────────────────
  verifyWebhook(rawBody, signature) {
    return stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  }
};

module.exports = PaymentService;