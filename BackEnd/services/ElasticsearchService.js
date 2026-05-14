const { esClient } = require('../config/elasticsearch');

/**
 * Elasticsearch Service for indexing and searching documents
 */
class ElasticsearchService {
  /**
   * Create or update an index with mapping
   */
  static async createIndex(indexName, mapping) {
    try {
      const exists = await esClient.indices.exists({ index: indexName });
      
      if (!exists) {
        await esClient.indices.create({
          index: indexName,
          body: mapping
        });
        console.log(`✅ Index '${indexName}' created`);
      }
    } catch (error) {
      console.error(`❌ Error creating index '${indexName}':`, error.message);
      throw error;
    }
  }

  /**
   * Index a single document
   */
  static async indexDocument(indexName, documentId, document) {
    try {
      const response = await esClient.index({
        index: indexName,
        id: documentId,
        body: document
      });
      console.log(`✅ Document indexed in ${indexName}:`, documentId);
      return response;
    } catch (error) {
      console.error(`❌ Error indexing document in ${indexName}:`, error.message);
      throw error;
    }
  }

  /**
   * Update a document
   */
  static async updateDocument(indexName, documentId, updates) {
    try {
      const response = await esClient.update({
        index: indexName,
        id: documentId,
        body: {
          doc: updates,
          doc_as_upsert: true // Create if not exists
        }
      });
      console.log(`✅ Document updated in ${indexName}:`, documentId);
      return response;
    } catch (error) {
      console.error(`❌ Error updating document in ${indexName}:`, error.message);
      throw error;
    }
  }

  /**
   * Delete a document
   */
  static async deleteDocument(indexName, documentId) {
    try {
      const response = await esClient.delete({
        index: indexName,
        id: documentId
      });
      console.log(`✅ Document deleted from ${indexName}:`, documentId);
      return response;
    } catch (error) {
      if (error.statusCode === 404) {
        console.log(`⚠️  Document not found in ${indexName}:`, documentId);
        return null;
      }
      console.error(`❌ Error deleting document from ${indexName}:`, error.message);
      throw error;
    }
  }

  /**
   * Search documents
   */
  static async searchDocuments(indexName, query) {
    try {
      const response = await esClient.search({
        index: indexName,
        body: query
      });
      return response;
    } catch (error) {
      console.error(`❌ Error searching in ${indexName}:`, error.message);
      throw error;
    }
  }

  /**
   * Bulk index documents (for initial sync)
   */
  static async bulkIndex(indexName, documents) {
    try {
      const body = documents.flatMap(doc => [
        { index: { _index: indexName, _id: doc._id.toString() } },
        doc
      ]);

      const response = await esClient.bulk({ body });
      
      if (response.errors) {
        console.error(`⚠️  Some documents failed to index in ${indexName}`);
      } else {
        console.log(`✅ Bulk indexed ${documents.length} documents in ${indexName}`);
      }
      
      return response;
    } catch (error) {
      console.error(`❌ Error bulk indexing in ${indexName}:`, error.message);
      throw error;
    }
  }

  /**
   * Get document by ID
   */
  static async getDocument(indexName, documentId) {
    try {
      const response = await esClient.get({
        index: indexName,
        id: documentId
      });
      return response._source;
    } catch (error) {
      if (error.statusCode === 404) {
        return null;
      }
      console.error(`❌ Error getting document from ${indexName}:`, error.message);
      throw error;
    }
  }

  /**
   * Delete entire index
   */
  static async deleteIndex(indexName) {
    try {
      await esClient.indices.delete({ index: indexName });
      console.log(`✅ Index '${indexName}' deleted`);
    } catch (error) {
      if (error.statusCode === 404) {
        console.log(`⚠️  Index '${indexName}' not found`);
        return;
      }
      console.error(`❌ Error deleting index '${indexName}':`, error.message);
      throw error;
    }
  }

  /**
   * Get index stats
   */
  static async getIndexStats(indexName) {
    try {
      const stats = await esClient.indices.stats({ index: indexName });
      return stats.indices[indexName];
    } catch (error) {
      console.error(`❌ Error getting stats for ${indexName}:`, error.message);
      throw error;
    }
  }
}

module.exports = ElasticsearchService;
