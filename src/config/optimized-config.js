// Optimized configuration for small data volumes (2000-3000 records)
import * as R from 'ramda';
import * as E from 'fp-ts/lib/Either.js';

// Optimized configuration for small data volumes
export const createOptimizedConfig = () => ({
  // Database Configuration (SQLite optimized for small datasets)
  dbPath: process.env.DB_PATH || './data/elocal_scraper.db',
  
  // Website Configuration
  elocalBaseUrl: process.env.ELOCAL_BASE_URL || 'https://elocal.com',
  elocalUsername: process.env.ELOCAL_USERNAME || '',
  elocalPassword: process.env.ELOCAL_PASSWORD || '',
  
  // Scraping Configuration (optimized for small volumes)
  headlessBrowser: process.env.HEADLESS_BROWSER === 'true',
  requestDelayMs: parseInt(process.env.REQUEST_DELAY_MS) || 500, // Faster for small datasets
  maxRetries: parseInt(process.env.MAX_RETRIES) || 2, // Fewer retries for small datasets
  timeoutMs: parseInt(process.env.TIMEOUT_MS) || 20000, // Shorter timeout
  
  // Batch processing optimization
  batchSize: parseInt(process.env.BATCH_SIZE) || 100, // Smaller batches for better memory usage
  maxConcurrentOperations: parseInt(process.env.MAX_CONCURRENT_OPS) || 1, // Sequential processing
  
  // Scheduling Configuration
  scheduleEnabled: process.env.SCHEDULE_ENABLED === 'true',
  scheduleCron: process.env.SCHEDULE_CRON || '0 */6 * * *', // Every 6 hours
  scheduleTimezone: process.env.SCHEDULE_TIMEZONE || 'Asia/Kolkata', // Indian Standard Time (IST)
  maxConcurrentJobs: parseInt(process.env.MAX_CONCURRENT_JOBS) || 1,
  retryOnFailure: process.env.RETRY_ON_FAILURE !== 'false',
  
  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
  logFile: process.env.LOG_FILE || 'logs/scraper.log',
  
  // Ringba Configuration
  ringbaAccountId: process.env.RINGBA_ACCOUNT_ID || '',
  ringbaApiToken: process.env.RINGBA_API_TOKEN || '',
  ringbaSyncEnabled: process.env.RINGBA_SYNC_ENABLED === 'true',
  ringbaSyncCron: process.env.RINGBA_SYNC_CRON || '0 */1 * * *', // Every hour
  
  // Performance optimizations for small datasets
  enableDataCompression: process.env.ENABLE_COMPRESSION === 'true',
  enableDataDeduplication: process.env.ENABLE_DEDUPLICATION !== 'false',
  enableDataValidation: process.env.ENABLE_VALIDATION !== 'false',
  
  // Memory management
  maxMemoryUsage: parseInt(process.env.MAX_MEMORY_MB) || 512, // 512MB max
  garbageCollectionInterval: parseInt(process.env.GC_INTERVAL_MS) || 30000, // 30 seconds
});

// Validation for optimized configuration
export const validateOptimizedConfig = (config) => {
  const requiredFields = [
    'elocalUsername', 'elocalPassword', 'dbPath'
  ];
  
  const missingFields = requiredFields.filter(field => !config[field]);
  
  if (missingFields.length > 0) {
    return E.left(new Error(`Missing required configuration fields: ${missingFields.join(', ')}`));
  }
  
  // Validate numeric fields
  const numericFields = [
    'requestDelayMs', 'maxRetries', 'timeoutMs', 'batchSize',
    'maxConcurrentOperations', 'maxConcurrentJobs', 'maxMemoryUsage', 'garbageCollectionInterval'
  ];
  
  const invalidNumericFields = numericFields.filter(field => 
    isNaN(config[field]) || config[field] < 0
  );
  
  if (invalidNumericFields.length > 0) {
    return E.left(new Error(`Invalid numeric configuration fields: ${invalidNumericFields.join(', ')}`));
  }
  
  // Validate batch size for small datasets
  if (config.batchSize > 500) {
    return E.left(new Error('Batch size too large for small datasets. Maximum recommended: 500'));
  }
  
  // Validate memory usage
  if (config.maxMemoryUsage > 1024) {
    return E.left(new Error('Memory usage too high for small datasets. Maximum recommended: 1024MB'));
  }
  
  return E.right(config);
};

// Performance monitoring for small datasets
export const createPerformanceMonitor = (config) => {
  const stats = {
    startTime: Date.now(),
    recordsProcessed: 0,
    memoryUsage: 0,
    errors: 0,
    warnings: 0
  };
  
  return {
    start: () => {
      stats.startTime = Date.now();
      stats.recordsProcessed = 0;
      stats.errors = 0;
      stats.warnings = 0;
    },
    
    recordProcessed: (count = 1) => {
      stats.recordsProcessed += count;
    },
    
    recordError: () => {
      stats.errors++;
    },
    
    recordWarning: () => {
      stats.warnings++;
    },
    
    getStats: () => {
      const duration = Date.now() - stats.startTime;
      const recordsPerSecond = stats.recordsProcessed / (duration / 1000);
      
      return {
        ...stats,
        duration,
        recordsPerSecond: recordsPerSecond.toFixed(2),
        memoryUsage: process.memoryUsage(),
        efficiency: stats.errors === 0 ? '100%' : `${((stats.recordsProcessed - stats.errors) / stats.recordsProcessed * 100).toFixed(2)}%`
      };
    },
    
    logStats: (logger) => {
      const performanceStats = stats.getStats();
      logger.info('Performance Statistics', performanceStats);
    }
  };
};

// Memory management utilities
export const createMemoryManager = (config) => {
  let lastGcTime = Date.now();
  
  return {
    checkMemoryUsage: () => {
      const memUsage = process.memoryUsage();
      const memUsageMB = memUsage.heapUsed / 1024 / 1024;
      
      if (memUsageMB > config.maxMemoryUsage) {
        return {
          exceeded: true,
          usage: memUsageMB,
          limit: config.maxMemoryUsage
        };
      }
      
      return {
        exceeded: false,
        usage: memUsageMB,
        limit: config.maxMemoryUsage
      };
    },
    
    forceGarbageCollection: () => {
      if (global.gc) {
        global.gc();
        lastGcTime = Date.now();
        return true;
      }
      return false;
    },
    
    shouldRunGarbageCollection: () => {
      const now = Date.now();
      return (now - lastGcTime) > config.garbageCollectionInterval;
    },
    
    optimizeForSmallDataset: () => {
      // Reduce memory footprint for small datasets
      if (global.gc) {
        global.gc();
      }
      
      // Clear any unnecessary caches
      if (global.clearImmediate) {
        global.clearImmediate();
      }
    }
  };
};

// Data processing optimization for small volumes
export const optimizeDataProcessing = (config) => {
  return {
    // Process data in smaller chunks to reduce memory usage
    processInChunks: (data, chunkSize = config.batchSize) => {
      const chunks = [];
      for (let i = 0; i < data.length; i += chunkSize) {
        chunks.push(data.slice(i, i + chunkSize));
      }
      return chunks;
    },
    
    // Deduplicate data efficiently for small datasets
    deduplicateEfficiently: (data, keyField) => {
      const seen = new Set();
      return data.filter(item => {
        const key = item[keyField];
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    },
    
    // Validate data efficiently
    validateEfficiently: (data, validator) => {
      const valid = [];
      const invalid = [];
      
      for (const item of data) {
        try {
          const result = validator(item);
          if (result._tag === 'Right') {
            valid.push(result.right);
          } else {
            invalid.push({ item, error: result.left });
          }
        } catch (error) {
          invalid.push({ item, error: error.message });
        }
      }
      
      return { valid, invalid };
    }
  };
};

// Export optimized configuration utilities
export const optimizedConfig = {
  create: createOptimizedConfig,
  validate: validateOptimizedConfig,
  performance: createPerformanceMonitor,
  memory: createMemoryManager,
  processing: optimizeDataProcessing
};
