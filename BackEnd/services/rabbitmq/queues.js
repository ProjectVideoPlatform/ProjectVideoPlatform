// queues.js — แก้ syntax error (ลืม comma)
module.exports = {
  VIDEO_TRANSCODE:           'video_transcoding',
  EMAIL_NOTIFY:              'video_notifications',
  VIDEO_LOGS:                'video_watch_logs',
  VIDEO_INDEX:               'video_index',
  DLX_EXCHANGE:              'dead_letter_exchange',
  DLX_EMAIL_QUEUE:           'dlx_email_queue',
  DLX_ANALYTICS_QUEUE:       'dlx_analytics_queue',
  DLX_TRANS_QUEUE:           'dlx_transcoding_queue',
  DLX_EMBEDDING_QUEUE:       'dlx_embedding_queue',   // ✅ เพิ่ม
  DLX_EMAIL_ROUTING_KEY:     'failed_email',
  DLX_ANALYTICS_ROUTING_KEY: 'failed_analytics',
  DLX_TRANS_ROUTING_KEY:     'failed_transcoding',
  DLX_EMBEDDING_ROUTING_KEY: 'failed_embedding',      // ✅ เพิ่ม
  RETRY_QUEUE:               'retry_queue',
  DELAY_QUEUE:               'delay_queue'
};