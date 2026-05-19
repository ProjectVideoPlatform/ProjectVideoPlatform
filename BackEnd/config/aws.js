  const { S3Client } = require('@aws-sdk/client-s3');
  const { MediaConvertClient } = require('@aws-sdk/client-mediaconvert');
  const path = require('path');
    require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
  // AWS Configuration
  const config = {
    region:  'ap-southeast-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
    
    // S3 Buckets
    uploadsBucket: process.env.UPLOADS_BUCKET || 'your-uploads-bucket',
    hlsOutputBucket: process.env.HLS_OUTPUT_BUCKET || 'your-hls-output-bucket',
    
    // MediaConvert
    mediaConvertEndpoint: process.env.MEDIACONVERT_ENDPOINT,
    mediaConvertRole: process.env.MEDIACONVERT_ROLE,
    mediaConvertQueueArn: process.env.MEDIACONVERT_QUEUE_ARN,
    // CloudFront
    cloudFrontDomain: process.env.CLOUDFRONT_DOMAIN,
    cloudFrontKeyPairId: process.env.CLOUDFRONT_KEY_PAIR_ID,
    cloudFrontPrivateKeyPath: process.env.CLOUDFRONT_PRIVATE_KEY_PATH || '../keys/cloudfront-private-key.pem',
    cloudFrontPrivateKey: process.env.CLOUDFRONT_PRIVATE_KEY
  };

  // Create AWS service instances (SDK v3)
  const s3 = new S3Client({
    region: config.region,
    credentials: config.credentials
  });
  
  const mediaConvert = new MediaConvertClient({
    region: 'us-east-1',
    credentials: config.credentials,
    endpoint: config.mediaConvertEndpoint
  });

  module.exports = {
    config,
    s3,
    mediaConvert
  };