#!/usr/bin/env node

/**
 * Test Vault AppRole Connection
 * Run: node test-vault.js or npm run test-vault
 */

require('dotenv').config();
const vaultService = require('./config/vault');

async function testVault() {
  console.log('\n' + '='.repeat(50));
  console.log('🧪 Testing Vault AppRole Connection');
  console.log('='.repeat(50) + '\n');

  try {
    // 1. Check environment variables
    console.log('📋 Checking environment variables...');
    const required = ['VAULT_ADDR', 'VAULT_ROLE_ID', 'VAULT_SECRET_ID'];
    
    for (const env of required) {
      if (!process.env[env]) {
        console.log(`   ❌ ${env} is not set`);
        throw new Error(`Missing ${env}`);
      }
      const value = process.env[env];
      const masked = value.substring(0, 5) + '...' + value.substring(value.length - 5);
      console.log(`   ✅ ${env}: ${masked}`);
    }
    console.log('');

    // 2. Initialize Vault
    console.log('🔐 Initializing Vault...');
    const secrets = await vaultService.initialize();
    console.log('✅ Vault initialized successfully\n');

    // 3. Check loaded secrets
    console.log('📚 Checking loaded secrets...');
    if (secrets && Object.keys(secrets).length > 0) {
      console.log(`   ✅ Loaded ${Object.keys(secrets).length} secrets`);
      console.log(`   Available keys: ${Object.keys(secrets).join(', ')}`);
    } else {
      console.log('   ⚠️  No secrets loaded. Make sure you created them in Vault.');
    }
    console.log('');

    // 4. Test helper methods
    console.log('🧪 Testing helper methods...');
    
    try {
      const dbConfig = vaultService.getDatabaseConfig();
      if (dbConfig.uri) {
        console.log('   ✅ getDatabaseConfig(): ' + (dbConfig.uri.substring(0, 20) + '...'));
      }
    } catch (e) {
      console.log('   ℹ️  getDatabaseConfig(): Not configured');
    }

    try {
      const jwtConfig = vaultService.getJWTConfig();
      if (jwtConfig.secret) {
        console.log('   ✅ getJWTConfig(): Secret set');
      }
    } catch (e) {
      console.log('   ℹ️  getJWTConfig(): Not configured');
    }

    console.log('');

    // 5. Final status
    console.log('='.repeat(50));
    console.log('✅ All tests passed!');
    console.log('='.repeat(50) + '\n');

    console.log('ℹ️  Next steps:');
    console.log('   1. Start your backend: npm start');
    console.log('   2. Check logs for: 🔐 Using AppRole authentication...');
    console.log('   3. Verify secrets are loaded properly\n');

    process.exit(0);

  } catch (error) {
    console.log('\n' + '='.repeat(50));
    console.log('❌ Test failed!');
    console.log('='.repeat(50));
    console.log('\nError:', error.message);
    console.log('\n📖 Troubleshooting:');
    
    if (error.message.includes('VAULT_ROLE_ID')) {
      console.log('   1. Run setup script: .\\setup-vault-agent.ps1');
      console.log('   2. Copy credentials to .env file');
    } else if (error.message.includes('auth/approle')) {
      console.log('   1. Make sure AppRole is enabled: docker exec vault vault auth list');
      console.log('   2. Re-run setup script if needed');
    } else if (error.message.includes('connection')) {
      console.log('   1. Check Vault is running: docker-compose -f docker-compose-vault.yml ps');
      console.log('   2. Check VAULT_ADDR is correct in .env');
    }
    
    console.log('\n');
    process.exit(1);
  }
}

// Run test
testVault();
