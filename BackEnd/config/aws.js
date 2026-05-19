  const { S3Client } = require('@aws-sdk/client-s3');
  const { MediaConvertClient } = require('@aws-sdk/client-mediaconvert');
  const vaultService = require('./vault');

  let s3 = null;
  let mediaConvert = null;
  let config = null;

  async function initAWS() {
    if (s3 && mediaConvert) {
      return { config, s3, mediaConvert };
    }

    try {
      // ✅ Initialize Vault and get AWS config
      await vaultService.initialize();
      const awsConfig = vaultService.getAWSConfig();

      console.log('☁️  Initializing AWS services...');

      // Update config object
      config = {
        region: awsConfig.region || 'ap-southeast-1',
        credentials: awsConfig.credentials,
        uploadsBucket: awsConfig.uploadsBucket,
        hlsOutputBucket: awsConfig.hlsOutputBucket,
        mediaConvert: awsConfig.mediaConvert,
        cloudFront: {
          domain: vaultService.get('CLOUDFRONT_DOMAIN'),
          keyPairId: vaultService.get('CLOUDFRONT_KEY_PAIR_ID'),
          privateKeyPath: vaultService.get('CLOUDFRONT_PRIVATE_KEY_PATH')
        }
      };

      // Create AWS service instances (SDK v3)
      s3 = new S3Client({
        region: config.region,
        credentials: config.credentials
      });
      
      mediaConvert = new MediaConvertClient({
        region: 'us-east-1',
        credentials: config.credentials,
        endpoint: config.mediaConvert.endpoint
      });

      console.log('✅ AWS services initialized');

      return { config, s3, mediaConvert };
    } catch (error) {
      console.error('❌ Failed to initialize AWS:', error.message);
      throw error;
    }
  }

  module.exports = {
    initAWS,
    get config() { return config; },
    get s3() { return s3; },
    get mediaConvert() { return mediaConvert; }
  };