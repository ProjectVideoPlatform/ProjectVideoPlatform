// Utility functions

/**
 * Format file size in bytes to human readable format
 * @param {number} bytes - File size in bytes
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted file size
 */
const formatFileSize = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

/**
 * Format duration in seconds to HH:MM:SS format
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration
 */
const formatDuration = (seconds) => {
  if (!seconds || seconds < 0) return '00:00:00';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  return [hours, minutes, secs]
    .map(val => val.toString().padStart(2, '0'))
    .join(':');
};

/**
 * Generate a random string
 * @param {number} length - Length of the string
 * @returns {string} Random string
 */
const generateRandomString = (length = 32) => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
};

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid email
 */
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Sanitize filename for safe storage
 * @param {string} filename - Original filename
 * @returns {string} Sanitized filename
 */
const sanitizeFilename = (filename) => {
  return filename
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .replace(/_{2,}/g, '_')
    .toLowerCase();
};

/**
 * Calculate pagination info
 * @param {number} page - Current page
 * @param {number} limit - Items per page
 * @param {number} total - Total items
 * @returns {object} Pagination info
 */
const calculatePagination = (page, limit, total) => {
  const totalPages = Math.ceil(total / limit);
  const hasNext = page < totalPages;
  const hasPrev = page > 1;
  
  return {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    totalPages,
    hasNext,
    hasPrev,
    skip: (page - 1) * limit
  };
};

/**
 * Validate video file type
 * @param {string} mimetype - File mimetype
 * @returns {boolean} True if valid video type
 */
const isValidVideoType = (mimetype) => {
  const allowedTypes = [
    'video/mp4',
    'video/mpeg',
    'video/quicktime',
    'video/x-msvideo',
    'video/x-ms-wmv',
    'video/webm',
    'video/3gpp',
    'video/x-flv'
  ];
  
  return allowedTypes.includes(mimetype);
};

/**
 * Create error response object
 * @param {string} message - Error message
 * @param {number} code - Error code
 * @param {object} details - Additional error details
 * @returns {object} Error response object
 */
const createErrorResponse = (message, code = 500, details = null) => {
  const error = {
    success: false,
    error: message,
    code,
    timestamp: new Date().toISOString()
  };
  
  if (details) {
    error.details = details;
  }
  
  return error;
};

/**
 * Create success response object
 * @param {object} data - Response data
 * @param {string} message - Success message
 * @returns {object} Success response object
 */
const createSuccessResponse = (data, message = 'Success') => {
  return {
    success: true,
    message,
    data,
    timestamp: new Date().toISOString()
  };
};

/**
 * Validate required fields in request body
 * @param {object} body - Request body
 * @param {array} requiredFields - Array of required field names
 * @returns {object|null} Error object if validation fails, null if success
 */
const validateRequiredFields = (body, requiredFields) => {
  const missingFields = requiredFields.filter(field => !body[field]);
  
  if (missingFields.length > 0) {
    return createErrorResponse(
      `Missing required fields: ${missingFields.join(', ')}`,
      400,
      { missingFields }
    );
  }
  
  return null;
};

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} Promise that resolves after sleep
 */
const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Retry function with exponential backoff
 * @param {function} fn - Function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} baseDelay - Base delay in milliseconds
 * @returns {Promise} Promise with function result or final error
 */
const retryWithBackoff = async (fn, maxRetries = 3, baseDelay = 1000) => {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries) {
        break;
      }
      
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }
  
  throw lastError;
};

/**
 * Deep clone an object
 * @param {object} obj - Object to clone
 * @returns {object} Cloned object
 */
const deepClone = (obj) => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime());
  if (obj instanceof Array) return obj.map(item => deepClone(item));
  if (typeof obj === 'object') {
    const clonedObj = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clonedObj[key] = deepClone(obj[key]);
      }
    }
    return clonedObj;
  }
};

module.exports = {
  formatFileSize,
  formatDuration,
  generateRandomString,
  isValidEmail,
  sanitizeFilename,
  calculatePagination,
  isValidVideoType,
  createErrorResponse,
  createSuccessResponse,
  validateRequiredFields,
  sleep,
  retryWithBackoff,
  deepClone
};