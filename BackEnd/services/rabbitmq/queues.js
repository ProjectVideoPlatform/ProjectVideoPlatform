module.exports = {
  VIDEO_TRANSCODE: 'video_transcoding',
  EMAIL_NOTIFY: 'video_notifications',
VIDEO_LOGS: 'video_watch_logs',
  DLX_EXCHANGE: 'dead_letter_exchange',
  DLX_QUEUE: 'dead_letter_queue',
  DLX_ROUTING_KEY: 'failed',
// Routing Keys (แยกป้ายกำกับ)
    DLX_EMAIL_ROUTING_KEY: 'failed_email',
    DLX_ANALYTICS_ROUTING_KEY: 'failed_analytics',
     DLX_TRANS_ROUTING_KEY: 'failed_transcoding',
  RETRY_QUEUE: 'retry_queue',
  DELAY_QUEUE: 'delay_queue'
};
