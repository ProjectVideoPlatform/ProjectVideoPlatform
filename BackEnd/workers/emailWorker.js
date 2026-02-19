const BaseWorker = require('./baseWorker');
const QUEUES = require('../services/rabbitmq/queues');
const nodemailer = require('nodemailer');

// ⭐ ควรย้ายไป ENV จริง
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD
  }
});

async function emailHandler(data) {
  try {
    console.log(`[Worker] Sending email to ${data.email}`);

    const mailOptions = {
      from: `"Video Platform" <${process.env.EMAIL_USER}>`,
      to: data.email,
      subject: `Video Processed: ${data.title}`,
      text: `สวัสดีครับ วิดีโอเรื่อง ${data.title} ของคุณประมวลผลเสร็จแล้ว ดูได้ที่นี่: ${data.url}`
    };

    await transporter.sendMail(mailOptions);

    console.log(`[Worker] Email sent to ${data.email}`);

  } catch (error) {
    console.error('[Worker] Email error:', error);
    throw error; // ⭐ สำคัญ ให้ BaseWorker nack / retry
  }
}

const worker = new BaseWorker(
  QUEUES.EMAIL_NOTIFY,
  emailHandler
);

worker.start();
