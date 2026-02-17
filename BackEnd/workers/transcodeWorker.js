const BaseWorker = require('./baseWorker');
const QUEUES = require('../rabbitmq/queues');

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
    throw error; // ⭐ สำคัญ ให้ BaseWorker จัดการ nack / retry
  }
}

const worker = new BaseWorker(
  QUEUES.VIDEO_TRANSCODE,
  transcodeHandler
);

worker.start();
