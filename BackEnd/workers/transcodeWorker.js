require('dotenv').config();

const mongoose = require('mongoose');
const { setupInfra } = require('../services/rabbitmq/setupInfra');
const BaseWorker = require('./baseWorker');
const QUEUES = require('../services/rabbitmq/queues');

const { createMediaConvertJob } = require('../services/mediaConvert');
const Video = require('../models/Video');

async function transcodeHandler(data) {
  try {
    console.log(`[Worker] Starting MediaConvert for: ${data.videoId}`);

    const job = await createMediaConvertJob(
      data.inputS3Path,
      data.outputS3Path,
      data.videoId
    );

    await Video.findOneAndUpdate(
      { id: data.videoId },
      {
        uploadStatus: 'processing',
        mediaConvertJobId: job.Id
      }
    );

    console.log(`[Worker] MediaConvert Job Created: ${job.Id}`);

  } catch (error) {
    console.error(`[Worker] Transcode Error:`, error);
    throw error;
  }
}

async function start() {
  try {
    // 1️⃣ Connect MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected (worker)');

    // 2️⃣ Setup RabbitMQ infra
    await setupInfra();

    // 3️⃣ Start Worker
    const worker = new BaseWorker(
      QUEUES.VIDEO_TRANSCODE,
      transcodeHandler
    );

    await worker.start();

  } catch (err) {
    console.error('Worker startup error:', err);
    process.exit(1);
  }
}

start();
