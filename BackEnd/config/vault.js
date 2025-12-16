const vault = require('node-vault');

class VaultService {
  constructor() {
    this.client = null;
    this.secrets = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) {
      return this.secrets;
    }

    try {
      // Initialize Vault client
      this.client = vault({
        apiVersion: 'v1',
        endpoint: process.env.VAULT_ADDR || 'http://127.0.0.1:8200',
        token: process.env.VAULT_TOKEN
      });

      // ดึง secrets จาก Vault
      await this.loadSecrets();
      
      this.initialized = true;
      console.log('✅ Vault initialized successfully');
      
      return this.secrets;
    } catch (error) {
      console.error('❌ Failed to initialize Vault:', error.message);
      throw error;
    }
  }

  async loadSecrets() {
    try {
      // อ่าน secrets จาก Vault path
      const result = await this.client.read('secret/data/video-platform');
      this.secrets = result.data.data;
      
      return this.secrets;
    } catch (error) {
      console.error('Failed to load secrets from Vault:', error.message);
      throw error;
    }
  }

  // ฟังก์ชันสำหรับ rotate JWT secret
  async rotateJWTSecret() {
    try {
      const newSecret = this.generateSecureSecret();
      
      // อัปเดต secret ใน Vault
      await this.client.write('secret/data/video-platform', {
        data: {
          ...this.secrets,
          JWT_SECRET: newSecret,
          JWT_SECRET_ROTATED_AT: new Date().toISOString()
        }
      });

      // Reload secrets
      await this.loadSecrets();
      
      console.log('✅ JWT Secret rotated successfully');
      return newSecret;
    } catch (error) {
      console.error('Failed to rotate JWT secret:', error.message);
      throw error;
    }
  }

  // สร้าง secure random secret
  generateSecureSecret(length = 64) {
    const crypto = require('crypto');
    return crypto.randomBytes(length).toString('base64');
  }

  // ฟังก์ชัน helper สำหรับดึงค่า secret
  get(key) {
    if (!this.initialized) {
      throw new Error('Vault not initialized. Call initialize() first.');
    }
    return this.secrets[key];
  }

  // ดึง AWS credentials
  getAWSCredentials() {
    return {
      region: this.get('AWS_REGION'),
      accessKeyId: this.get('AWS_ACCESS_KEY_ID'),
      secretAccessKey: this.get('AWS_SECRET_ACCESS_KEY')
    };
  }

  // ดึง Database config
  getDatabaseConfig() {
    return {
      uri: this.get('MONGO_URI')
    };
  }

  // ดึง JWT config
  getJWTConfig() {
    return {
      secret: this.get('JWT_SECRET'),
      expiresIn: this.get('JWT_EXPIRES_IN') || '7d'
    };
  }

  // ดึง K Plus Payment config
  getKPayConfig() {
    return {
      consumerId: this.get('KPAY_CONSUMER_ID'),
      consumerSecret: this.get('KPAY_CONSUMER_SECRET'),
      baseUrl: this.get('KPAY_BASE_URL'),
      callbackUrl: this.get('KPAY_CALLBACK_URL')
    };
  }

  // ดึง CloudFront config
  getCloudfrontConfig() {
    return {
      domain: this.get('CLOUDFRONT_DOMAIN'),
      keyPairId: this.get('CLOUDFRONT_KEY_PAIR_ID'),
      privateKeyPath: this.get('CLOUDFRONT_PRIVATE_KEY_PATH')
    };
  }
}

// Export singleton instance
const vaultService = new VaultService();
module.exports = vaultService;