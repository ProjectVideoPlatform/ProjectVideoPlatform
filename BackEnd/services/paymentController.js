// const { generateKPlusQR, verifyKPlusPayment } = require("../utils/kplusAPI");
// const { getWSS } = require("../websocket");
const PaymentService = {
    
  async processPayment(paymentData) {
    // Mock payment processing
    console.log('Processing payment:', {
      amount: paymentData.amount,
      description: paymentData.description,
      customerId: paymentData.customerId
    });
    
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Test scenarios
    if (paymentData.amount <= 0) {
      return {
        success: false,
        reason: 'Invalid amount',
        errorCode: 'INVALID_AMOUNT'
      };
    }
    
    if (paymentData.amount > 50000) {
      return {
        success: false,
        reason: 'Insufficient funds',
        errorCode: 'INSUFFICIENT_FUNDS'
      };
    }
    
    // Random failures (2% chance)
    if (Math.random() < 0.02) {
      return {
        success: false,
        reason: 'Payment gateway timeout',
        errorCode: 'GATEWAY_TIMEOUT'
      };
    }
    
    // Success
    return {
      success: true,
      id: `pay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      gatewayId: `gateway_${Date.now()}`,
      method: paymentData.paymentMethod || 'credit_card',
      gateway: 'MOCK_GATEWAY',
      capturedAt: new Date().toISOString(),
      rawResponse: {
        status: 'succeeded',
        authorization_code: `AUTH_${Math.random().toString(36).substr(2, 10)}`
      }
    };
  },
  
  async refund(refundData) {
    console.log('Processing refund:', refundData);
    
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // 95% success rate
    if (Math.random() < 0.95) {
      return {
        success: true,
        refundId: `ref_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        amount: refundData.amount,
        processedAt: new Date().toISOString()
      };
    } else {
      return {
        success: false,
        reason: 'Refund processing failed',
        errorCode: 'REFUND_FAILED'
      };
    }
  },
  
  async refundIfNeeded(refundData) {
    console.log('Checking if refund needed:', refundData);
    // Implement logic to check if refund is needed
    return { success: true, message: 'Refund check completed' };
  }
};

module.exports = PaymentService;
// };

// // ===== CREATE QR =====
// exports.createPayment = async (req, res) => {
//   try {
//     const { amount, orderId } = req.body;

//     if (!amount || !orderId) {
//       return res.status(400).json({ success: false, message: "Missing amount or orderId" });
//     }

//     const qrData = await generateKPlusQR(amount, orderId);

//     res.json({
//       success: true,
//       qrImageUrl: qrData.qrImageUrl,
//       kpayId: qrData.kpayId,
//     });

//   } catch (err) {
//     console.error("QR Create Error:", err);
//     res.status(500).json({ success: false });
//   }
// };

// // ===== CALLBACK =====
// exports.handleKPlusCallback = async (req, res) => {
//   try {
//     const signature = req.headers["x-kbank-signature"];
//     const rawBody = req.body; // <--- buffer

//     const verified = verifyKPlusPayment(rawBody, signature);
//     if (!verified) {
//       console.log("❌ Invalid signature");
//       return res.status(400).json({ success: false });
//     }

//     const data = JSON.parse(rawBody.toString());
//     const { orderId, amount } = data;

//     console.log("💚 Payment Verified:", orderId, amount);

//     // Real-time WebSocket notify
//     const wss = getWSS();
//     if (wss) {
//       wss.clients.forEach((client) => {
//         client.send(
//           JSON.stringify({
//             type: "PAYMENT_SUCCESS",
//             orderId,
//             amount,
//           })
//         );
//       });
//     }

//     res.status(200).json({ success: true });

//   } catch (err) {
//     console.error("Callback Error:", err);
//     res.status(500).json({ success: false });
//   }
// };
