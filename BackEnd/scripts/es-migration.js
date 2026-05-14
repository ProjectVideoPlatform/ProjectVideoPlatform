/**
 * Elasticsearch Migration Script
 * ใช้เพื่อ initialize และ sync ข้อมูลจาก MongoDB ไป Elasticsearch
 * 
 * Usage:
 *   node scripts/es-migration.js --action sync --model all
 *   node scripts/es-migration.js --action sync --model videos
 *   node scripts/es-migration.js --action recreate --model purchases
 *   node scripts/es-migration.js --action delete --model videos
 */

require('dotenv').config();
const connectDB = require('../config/database');
const { connectES, esClient } = require('../config/elasticsearch');
const ElasticsearchService = require('../services/ElasticsearchService');
const Video = require('../models/Video');
const Purchase = require('../models/Purchase');

const args = process.argv.slice(2);
const options = {};

// Parse command line arguments
for (let i = 0; i < args.length; i += 2) {
  const key = args[i].replace('--', '');
  const value = args[i + 1];
  options[key] = value;
}

const action = options.action || 'sync'; // sync | recreate | delete
const model = options.model || 'all'; // all | videos | purchases
const batchSize = parseInt(options.batchSize || '500');

console.log(`
╔════════════════════════════════════════════════════════════╗
║          Elasticsearch Migration Script                     ║
╠════════════════════════════════════════════════════════════╣
║ Action:    ${action.padEnd(40)}
║ Model:     ${model.padEnd(40)}
║ Batch:     ${batchSize.toString().padEnd(40)}
╚════════════════════════════════════════════════════════════╝
`);

// ===== SYNC FUNCTIONS =====
async function syncVideos() {
  console.log('📹 Syncing Videos to Elasticsearch...');
  try {
    const count = await Video.countDocuments();
    console.log(`Total videos to sync: ${count}`);

    let processed = 0;
    const stream = Video.find().batchSize(batchSize).lean().cursor();

    for (let doc = await stream.next(); doc != null; doc = await stream.next()) {
      try {
        await ElasticsearchService.indexDocument(
          'videos',
          doc._id.toString(),
          {
            title: doc.title,
            description: doc.description,
            tags: doc.tags,
            accessType: doc.accessType,
            price: doc.price,
            duration: doc.duration,
            fileSize: doc.fileSize,
            uploadStatus: doc.uploadStatus,
            isActive: doc.isActive,
            thumbnailPath: doc.thumbnailPath,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt
          }
        );

        processed++;
        if (processed % 100 === 0) {
          console.log(`✅ Processed ${processed}/${count} videos`);
        }
      } catch (error) {
        console.error(`❌ Error syncing video ${doc._id}:`, error.message);
      }
    }

    console.log(`✅ Completed syncing ${processed} videos`);
  } catch (error) {
    console.error('❌ Error syncing videos:', error.message);
    throw error;
  }
}

async function syncPurchases() {
  console.log('💳 Syncing Purchases to Elasticsearch...');
  try {
    const count = await Purchase.countDocuments();
    console.log(`Total purchases to sync: ${count}`);

    let processed = 0;
    const stream = Purchase.find().batchSize(batchSize).lean().cursor();

    for (let doc = await stream.next(); doc != null; doc = await stream.next()) {
      try {
        await ElasticsearchService.indexDocument(
          'purchases',
          doc._id.toString(),
          {
            userId: doc.userId.toString(),
            videoId: doc.videoId.toString(),
            amount: doc.amount,
            currency: doc.currency,
            paymentMethod: doc.paymentMethod,
            status: doc.status,
            purchaseDate: doc.purchaseDate,
            expiresAt: doc.expiresAt,
            processedAt: doc.processedAt,
            refundedAt: doc.refundedAt,
            transactionId: doc.transactionId,
            bulkId: doc.bulkId,
            accessCount: doc.accessCount,
            watchDuration: doc.watchDuration,
            completionRate: doc.completionRate,
            lastAccessedAt: doc.lastAccessedAt,
            originalPrice: doc.originalPrice,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt
          }
        );

        processed++;
        if (processed % 100 === 0) {
          console.log(`✅ Processed ${processed}/${count} purchases`);
        }
      } catch (error) {
        console.error(`❌ Error syncing purchase ${doc._id}:`, error.message);
      }
    }

    console.log(`✅ Completed syncing ${processed} purchases`);
  } catch (error) {
    console.error('❌ Error syncing purchases:', error.message);
    throw error;
  }
}

async function recreateIndex(indexName, IndexModel) {
  console.log(`🔄 Recreating index: ${indexName}`);
  try {
    // Delete old index
    await ElasticsearchService.deleteIndex(indexName);
    console.log(`✅ Deleted old index: ${indexName}`);

    // Create new index
    await IndexModel.initializeESIndex();
    console.log(`✅ Created new index: ${indexName}`);

    // Sync data
    await IndexModel.syncToElasticsearch();
    console.log(`✅ Synced data to ${indexName}`);
  } catch (error) {
    console.error(`❌ Error recreating index ${indexName}:`, error.message);
    throw error;
  }
}

async function deleteIndex(indexName) {
  console.log(`🗑️  Deleting index: ${indexName}`);
  try {
    await ElasticsearchService.deleteIndex(indexName);
    console.log(`✅ Deleted index: ${indexName}`);
  } catch (error) {
    console.error(`❌ Error deleting index ${indexName}:`, error.message);
    throw error;
  }
}

async function getIndexStats(indexName) {
  console.log(`📊 Getting stats for index: ${indexName}`);
  try {
    const stats = await ElasticsearchService.getIndexStats(indexName);
    console.log(`\n✅ Index Stats for '${indexName}':`);
    console.log(`   Documents: ${stats.primaries.docs.count}`);
    console.log(`   Deleted: ${stats.primaries.docs.deleted}`);
    console.log(`   Size: ${(stats.primaries.store.size_in_bytes / 1024 / 1024).toFixed(2)} MB`);
  } catch (error) {
    console.error(`❌ Error getting stats for ${indexName}:`, error.message);
  }
}

// ===== MAIN EXECUTION =====
async function main() {
  try {
    await connectDB();
    await connectES();
    console.log('✅ Connected to MongoDB and Elasticsearch\n');

    if (action === 'sync') {
      if (model === 'all') {
        await syncVideos();
        console.log('');
        await syncPurchases();
      } else if (model === 'videos') {
        await syncVideos();
      } else if (model === 'purchases') {
        await syncPurchases();
      }
    } else if (action === 'recreate') {
      if (model === 'all') {
        await recreateIndex('videos', Video);
        console.log('');
        await recreateIndex('purchases', Purchase);
      } else if (model === 'videos') {
        await recreateIndex('videos', Video);
      } else if (model === 'purchases') {
        await recreateIndex('purchases', Purchase);
      }
    } else if (action === 'delete') {
      if (model === 'all') {
        await deleteIndex('videos');
        await deleteIndex('purchases');
      } else if (model === 'videos') {
        await deleteIndex('videos');
      } else if (model === 'purchases') {
        await deleteIndex('purchases');
      }
    } else if (action === 'stats') {
      if (model === 'all') {
        await getIndexStats('videos');
        console.log('');
        await getIndexStats('purchases');
      } else if (model === 'videos') {
        await getIndexStats('videos');
      } else if (model === 'purchases') {
        await getIndexStats('purchases');
      }
    }

    console.log('\n✅ Migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

main();
