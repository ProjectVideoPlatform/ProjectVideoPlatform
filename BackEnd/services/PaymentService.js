'use strict';

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const logger = require('../utils/logger');
const User   = require('../models/User');

const PaymentService = {

  async authorize({ amount, currency = 'thb', customerId, metadata = {} }) {
    const intent = await stripe.paymentIntents.create({
      amount:         Math.round(amount * 100),
      currency,
      capture_method: 'manual',
      metadata:       { customerId: customerId?.toString(), ...metadata }
    });
    return {
      clientSecret:   intent.client_secret,
      intentId:       intent.id,
      requiresAction: intent.status === 'requires_action'
    };
  },

  async capture(paymentIntentId) {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.status !== 'requires_capture') {
      throw new Error(`Cannot capture — status: ${intent.status}`);
    }
    const captured = await stripe.paymentIntents.capture(paymentIntentId);
    return {
      success:    true,
      id:         captured.id,
      gatewayId:  captured.latest_charge,
      method:     captured.payment_method_types[0],
      gateway:    'stripe',
      capturedAt: new Date().toISOString(),
      amount:     captured.amount_received / 100
    };
  },

  async processPayment(paymentData) {
    const { paymentIntentId, amount, currency, customerId, metadata } = paymentData;
    if (paymentIntentId) return await this.capture(paymentIntentId);
    const result = await this.authorize({ amount, currency, customerId, metadata });
    return { success: false, requiresAction: true, clientSecret: result.clientSecret, intentId: result.intentId };
  },

  async refund({ transactionId, chargeId, amount, reason }) {
    console.log('=== STRIPE REFUND ===');
    console.log('transactionId:', transactionId);
    console.log('chargeId:', chargeId);

    const isPromptPay = !!chargeId && chargeId.startsWith('py_');
    let refund;

    if (isPromptPay) {
      refund = await stripe.refunds.create({
        charge:   chargeId,
        amount:   amount ? Math.round(amount * 100) : undefined,
        reason:   'requested_by_customer',
        metadata: { reason, paymentIntentId: transactionId }
      });
    } else {
      refund = await stripe.refunds.create({
        payment_intent: transactionId,
        amount:         amount ? Math.round(amount * 100) : undefined,
        reason:         'requested_by_customer',
        metadata:       { reason }
      });
    }

    return {
      success:     ['succeeded', 'pending','requires_action'].includes(refund.status),
      refundId:    refund.id,
      amount:      refund.amount / 100,
      status:      refund.status,
      isPromptPay,
      processedAt: new Date().toISOString()
    };
  },

  async retrieveIntent(paymentIntentId) {
    return await stripe.paymentIntents.retrieve(paymentIntentId);
  },

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

  async authorizePromptPay({ amount, currency = 'thb', customerId, metadata = {} }) {
    const user = await User.findById(customerId).lean();
    if (!user?.email) throw new Error(`User ${customerId} not found or missing email`);

    const paymentMethod = await stripe.paymentMethods.create({
      type:            'promptpay',
      billing_details: { email: user.email, name: user.name ?? undefined }
    }).catch(e => { console.error('[Stripe] paymentMethods.create FAILED:', e.message); throw e; });

    const intent = await stripe.paymentIntents.create({
      amount:               Math.round(amount * 100),
      currency,
      payment_method_types: ['promptpay'],
      payment_method:       paymentMethod.id,
      confirm:              true,
      metadata:             { customerId: customerId?.toString(), ...metadata }
    }).catch(e => { console.error('[Stripe] paymentIntents.create FAILED:', e.message); throw e; });

    return {
      intentId:  intent.id,
      qrCodeUrl: intent.next_action?.promptpay_display_qr_code?.image_url_png ?? null,
      expiresIn: 900,
      status:    intent.status
    };
  },

  async checkPromptPayStatus(paymentIntentId) {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    return {
      status:    intent.status,
      succeeded: intent.status === 'succeeded',
      gatewayId: intent.latest_charge
    };
  },

  verifyWebhook(rawBody, signature) {
    return stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  }
};

module.exports = PaymentService;