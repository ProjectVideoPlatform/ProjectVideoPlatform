const vault = require('node-vault');

class VaultService {
  constructor() {
    this.client = null;
    this.secrets = null;
    this.initialized = false;
    this.tokenTTL = 3600;
  }

  async initialize() {
    if (this.initialized) {
      return this.secrets;
    }

    try {
      const endpoint = process.env.VAULT_ADDR || 'http://127.0.0.1:8200';
      
      // ✅ สร้าง client แบบ AppRole
      if (process.env.VAULT_ROLE_ID && process.env.VAULT_SECRET_ID) {
        console.log('🔐 Using AppRole authentication...');
        
        const tempClient = vault({
          apiVersion: 'v1',
          endpoint: endpoint
        });

        // 🔥 แก้จุดที่ 1: เปลี่ยนมาใช้ write ยิงตรงหา endpoint ของ approle login
        const authResult = await tempClient.write('auth/approle/login', {
          role_id: process.env.VAULT_ROLE_ID,
          secret_id: process.env.VAULT_SECRET_ID
        });

        // สร้าง authenticated client ด้วย token ที่ได้มา
        this.client = vault({
          apiVersion: 'v1',
          endpoint: endpoint,
          token: authResult.auth.client_token
        });

        this.tokenTTL = authResult.auth.lease_duration || 3600;
        this.setupTokenRenewal();
        
        console.log('✅ AppRole authenticated (TTL: ' + this.tokenTTL + 's)');
      } else if (process.env.VAULT_TOKEN) {
        // ⚠️ Fallback: Token-based authentication (สำหรับ development)
        console.log('⚠️  Using token-based authentication (development only)');
        
        this.client = vault({
          apiVersion: 'v1',
          endpoint: endpoint,
          token: process.env.VAULT_TOKEN
        });
      } else {
        throw new Error('Neither AppRole nor Token credentials provided');
      }

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

  // ✅ ตั้ง token renewal สำหรับ AppRole
  setupTokenRenewal() {
    if (!this.tokenTTL) return;

    // Renew token ที่ 50% ของ TTL (แก้บั๊กหน่วยมิลลิวินาที: TTL วินาที * 1000 * 0.5)
    const renewalInterval = Math.max((this.tokenTTL * 1000) * 0.5, 300000);

    setInterval(async () => {
      try {
        console.log('🔄 Renewing Vault token...');
        // 🔥 แก้จุดที่ 2: เปลี่ยนท่อนต่ออายุ token มาใช้ท่ายิงตรงเช่นกัน ป้องกันสิทธิ์พัง
        const result = await this.client.write('auth/token/renew-self', {});
        this.tokenTTL = result.auth.lease_duration || 3600;
        console.log('✅ Token renewed (TTL: ' + this.tokenTTL + 's)');
      } catch (error) {
        console.error('⚠️  Token renewal failed:', error.message);
        // Re-authenticate หากการต่ออายุล้มเหลว
        this.initialized = false;
        await this.initialize();
      }
    }, renewalInterval);
  }

async loadSecrets() {
    try {
      console.log('📚 Loading structured secrets from Vault...');
      
      // 1. ดึงข้อมูลจากแต่ละ Path ตามสิทธิ์ใน Policy
      const dbData = await this.client.read('secret/data/database/mongodb');
      const redisData = await this.client.read('secret/data/redis/main');
      const stripeData = await this.client.read('secret/data/stripe/production');
      const elasticData = await this.client.read('secret/data/elasticsearch/backend');

      // 2. แตกข้อมูลดิบออกมา (.data.data)
      const db = dbData.data.data;
      const redis = redisData.data.data;
      const stripe = stripeData.data.data;
      const elastic = elasticData.data.data;

      // 3. รวบรวมและ Map คีย์ทั้งหมดให้อยู่ในออบเจกต์เดียว เพื่อให้ฟังก์ชัน get() ทำงานได้สมบูรณ์
      this.secrets = {
        // Database (MongoDB)
        MONGO_URI: db.MONGO_URI,
        MONGO_REPLICA_SET: db.MONGO_REPLICA_SET,
        MONGO_DB: db.MONGO_DB,

        // Redis
        REDIS_URL: redis.REDIS_URL,
        REDIS_HOST: redis.REDIS_HOST,
        REDIS_PORT: redis.REDIS_PORT,
        REDIS_PASSWORD: redis.REDIS_PASSWORD,

        // Stripe
        STRIPE_SECRET_KEY: stripe.STRIPE_SECRET_KEY,
        STRIPE_WEBHOOK_SECRET: stripe.STRIPE_WEBHOOK_SECRET,

        // Elasticsearch & APM
        ELASTICSEARCH_URL: elastic.ELASTICSEARCH_URL,
        ELASTIC_PASSWORD: elastic.ELASTIC_PASSWORD,
        ELASTIC_CLOUD_ID: elastic.ELASTIC_CLOUD_ID,
        ELASTICSEARCH_API_KEY: elastic.ELASTICSEARCH_API_KEY,
        ELASTIC_APM_SERVER_URL: elastic.ELASTIC_APM_SERVER_URL,
        ELASTIC_APM_SECRET_TOKEN: elastic.ELASTIC_APM_SECRET_TOKEN,

        // 💡 หมายเหตุ: คีย์ที่เป็น Static/Non-sensitive เช่น PORT, NODE_ENV, EMAIL 
        // หรือคีย์ที่ยังไม่ได้ยัดเข้า Vault สามารถดึงประคองจาก process.env ควบคู่ไปด้วยได้ครับ
        PORT: process.env.PORT || 3000,
        JWT_SECRET: process.env.JWT_SECRET,
        JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '1d',
        AWS_REGION: process.env.AWS_REGION,
        AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
        AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
        CLOUDFRONT_DOMAIN: process.env.CLOUDFRONT_DOMAIN,
        CLOUDFRONT_KEY_PAIR_ID: process.env.CLOUDFRONT_KEY_PAIR_ID,
        CLOUDFRONT_PRIVATE_KEY_PATH: process.env.CLOUDFRONT_PRIVATE_KEY_PATH,
        KPAY_CONSUMER_ID: process.env.KPAY_CONSUMER_ID,
        KPAY_CONSUMER_SECRET: process.env.KPAY_CONSUMER_SECRET
      };
      
      console.log(`✅ Successfully loaded ${Object.keys(this.secrets).length} keys into Service memory.`);
      return this.secrets;
    } catch (error) {
      console.error('❌ Failed to load secrets from Vault:', error.message);
      throw error;
    }
  }
  // ฟังก์ชันสำหรับ rotate JWT secret
  async rotateJWTSecret() {
    try {
      const newSecret = this.generateSecureSecret();
      
      await this.client.write('secret/data/video-platform', {
        data: {
          ...this.secrets,
          JWT_SECRET: newSecret,
          JWT_SECRET_ROTATED_AT: new Date().toISOString()
        }
      });

      await this.loadSecrets();
      
      console.log('✅ JWT Secret rotated successfully');
      return newSecret;
    } catch (error) {
      console.error('Failed to rotate JWT secret:', error.message);
      throw error;
    }
  }

  generateSecureSecret(length = 64) {
    const crypto = require('crypto');
    return crypto.randomBytes(length).toString('base64');
  }

  get(key) {
    if (!this.initialized) {
      throw new Error('Vault not initialized. Call initialize() first.');
    }
    return this.secrets ? this.secrets[key] : null;
  }

  getAWSCredentials() {
    return {
      region: this.get('AWS_REGION'),
      accessKeyId: this.get('AWS_ACCESS_KEY_ID'),
      secretAccessKey: this.get('AWS_SECRET_ACCESS_KEY')
    };
  }

  getDatabaseConfig() {
    return {
      uri: this.get('MONGO_URI')
    };
  }

  getJWTConfig() {
    return {
      secret: this.get('JWT_SECRET'),
      expiresIn: this.get('JWT_EXPIRES_IN') || '7d'
    };
  }

  getKPayConfig() {
    return {
      consumerId: this.get('KPAY_CONSUMER_ID'),
      consumerSecret: this.get('KPAY_CONSUMER_SECRET'),
      baseUrl: this.get('KPAY_BASE_URL'),
      callbackUrl: this.get('KPAY_CALLBACK_URL')
    };
  }

  getCloudfrontConfig() {
    return {
      domain: this.get('CLOUDFRONT_DOMAIN'),
      keyPairId: this.get('CLOUDFRONT_KEY_PAIR_ID'),
      privateKeyPath: this.get('CLOUDFRONT_PRIVATE_KEY_PATH')
    };
  }

  // ✅ Redis Configuration
  getRedisConfig() {
    return {
      host: this.get('REDIS_HOST'),
      port: this.get('REDIS_PORT'),
      password: this.get('REDIS_PASSWORD'),
      url: this.get('REDIS_URL')
    };
  }

  // ✅ Elasticsearch Configuration
  getElasticsearchConfig() {
    return {
      node: this.get('ELASTICSEARCH_URL'),
      auth: {
        apiKey: this.get('ELASTICSEARCH_API_KEY')
      }
    };
  }

  // ✅ MongoDB Configuration
  getMongoConfig() {
    return {
      uri: this.get('MONGO_URI'),
      replicaSet: this.get('MONGO_REPLICA_SET'),
      database: this.get('MONGO_DB')
    };
  }

  // ✅ Stripe Configuration
  getStripeConfig() {
    return {
      secretKey: this.get('STRIPE_SECRET_KEY'),
      webhookSecret: this.get('STRIPE_WEBHOOK_SECRET')
    };
  }

  // ✅ ClickHouse Configuration (placeholder)
  getClickHouseConfig() {
    return {
      url: this.get('CLICKHOUSE_URL') || 'http://clickhouse:8123',
      username: this.get('CLICKHOUSE_USER') || 'default',
      password: this.get('CLICKHOUSE_PASSWORD') || '',
      database: this.get('CLICKHOUSE_DB') || 'default'
    };
  }

  // ✅ AWS S3 & MediaConvert Configuration
  getAWSConfig() {
    return {
      region: this.get('AWS_REGION'),
      credentials: {
        accessKeyId: this.get('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.get('AWS_SECRET_ACCESS_KEY')
      },
      uploadsBucket: this.get('AWS_UPLOADS_BUCKET'),
      hlsOutputBucket: this.get('AWS_HLS_OUTPUT_BUCKET'),
      mediaConvert: {
        endpoint: this.get('AWS_MEDIACONVERT_ENDPOINT'),
        role: this.get('AWS_MEDIACONVERT_ROLE'),
        queueArn: this.get('AWS_MEDIACONVERT_QUEUE_ARN')
      }
    };
  }

  // ✅ Server Configuration
  getServerConfig() {
    return {
      port: this.get('PORT') || 3000,
      nodeEnv: this.get('NODE_ENV') || 'production'
    };
  }
}

const vaultService = new VaultService();
module.exports = vaultService;