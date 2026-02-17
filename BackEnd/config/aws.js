  const AWS = require('aws-sdk');
  const path = require('path');
    require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
  // AWS Configuration
  const config = {
    region:  'ap-southeast-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    
    // S3 Buckets
    uploadsBucket: process.env.UPLOADS_BUCKET || 'your-uploads-bucket',
    hlsOutputBucket: process.env.HLS_OUTPUT_BUCKET || 'your-hls-output-bucket',
    
    // MediaConvert
    mediaConvertEndpoint: process.env.MEDIACONVERT_ENDPOINT,
    mediaConvertRole: process.env.MEDIACONVERT_ROLE,
    
    // CloudFront
    cloudFrontDomain: process.env.CLOUDFRONT_DOMAIN,
    cloudFrontKeyPairId: process.env.CLOUDFRONT_KEY_PAIR_ID,
    cloudFrontPrivateKeyPath: process.env.CLOUDFRONT_PRIVATE_KEY_PATH || '../keys/cloudfront-private-key.pem',
    cloudFrontPrivateKey: process.env.CLOUDFRONT_PRIVATE_KEY
  };

  // Configure AWS SDK
  AWS.config.update({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: config.region
  });

  // Create AWS service instances
  const s3 = new AWS.S3();
  const mediaConvert = new AWS.MediaConvert({
    endpoint: config.mediaConvertEndpoint,
      region:  'us-east-1'
  });

  module.exports = {
    config,
    s3,
    mediaConvert
  };