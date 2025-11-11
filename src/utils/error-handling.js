// Comprehensive error handling and logging utilities
import * as R from 'ramda';
import * as E from 'fp-ts/lib/Either.js';
import * as TE from 'fp-ts/lib/TaskEither.js';
import * as T from 'fp-ts/lib/Task.js';
import fs from 'fs/promises';
import path from 'path';

// Log levels
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

// Logger class
class Logger {
  constructor(config) {
    this.config = config;
    this.logLevel = LOG_LEVELS[config.logLevel?.toUpperCase()] || LOG_LEVELS.INFO;
    this.logFile = config.logFile || 'logs/scraper.log';
  }

  shouldLog(level) {
    return LOG_LEVELS[level] <= this.logLevel;
  }

  formatMessage(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` | Data: ${JSON.stringify(data)}` : '';
    return `[${timestamp}] [${level}] ${message}${dataStr}`;
  }

  async writeToFile(message) {
    try {
      const logDir = path.dirname(this.logFile);
      await fs.mkdir(logDir, { recursive: true });
      await fs.appendFile(this.logFile, message + '\n');
    } catch (error) {
      console.error('Failed to write to log file:', error.message);
    }
  }

  log(level, message, data = null) {
    if (!this.shouldLog(level)) return;

    const formattedMessage = this.formatMessage(level, message, data);
    
    // Console output
    if (level === 'ERROR') {
      console.error(formattedMessage);
    } else if (level === 'WARN') {
      console.warn(formattedMessage);
    } else {
      console.log(formattedMessage);
    }

    // File output
    this.writeToFile(formattedMessage);
  }

  error(message, data = null) {
    this.log('ERROR', message, data);
  }

  warn(message, data = null) {
    this.log('WARN', message, data);
  }

  info(message, data = null) {
    this.log('INFO', message, data);
  }

  debug(message, data = null) {
    this.log('DEBUG', message, data);
  }
}

// Error types
export const ErrorTypes = {
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  SCRAPING_ERROR: 'SCRAPING_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

// Custom error class
export class ScrapingError extends Error {
  constructor(type, message, originalError = null, context = {}) {
    super(message);
    this.name = 'ScrapingError';
    this.type = type;
    this.originalError = originalError;
    this.context = context;
    this.timestamp = new Date().toISOString();
  }
}

// Error handling utilities
export const createErrorHandler = (logger) => (error) => {
  if (error instanceof ScrapingError) {
    logger.error(`[${error.type}] ${error.message}`, {
      context: error.context,
      originalError: error.originalError?.message,
      timestamp: error.timestamp
    });
  } else {
    logger.error('Unknown error occurred', {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }
  return E.left(error);
};

// Retry with exponential backoff
export const withRetryAndBackoff = (maxRetries) => (baseDelay) => (operation) =>
  TE.tryCatch(
    async () => {
      let lastError;
      for (let i = 0; i < maxRetries; i++) {
        try {
          return await operation();
        } catch (error) {
          lastError = error;
          if (i < maxRetries - 1) {
            const delay = baseDelay * Math.pow(2, i);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
      throw lastError;
    },
    (error) => new ScrapingError(
      ErrorTypes.NETWORK_ERROR,
      `Operation failed after ${maxRetries} retries`,
      error,
      { maxRetries, baseDelay }
    )
  );

// Timeout wrapper
export const withTimeout = (timeoutMs) => (operation) =>
  TE.tryCatch(
    async () => {
      return Promise.race([
        operation(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Operation timeout')), timeoutMs)
        )
      ]);
    },
    (error) => new ScrapingError(
      ErrorTypes.TIMEOUT_ERROR,
      `Operation timed out after ${timeoutMs}ms`,
      error,
      { timeoutMs }
    )
  );

// Database error handler
export const handleDatabaseError = (logger) => (error) => {
  logger.error('Database operation failed', {
    message: error.message,
    code: error.code,
    errno: error.errno,
    sqlState: error.sqlState
  });
  
  return E.left(new ScrapingError(
    ErrorTypes.DATABASE_ERROR,
    'Database operation failed',
    error,
    { code: error.code, errno: error.errno }
  ));
};

// Scraping error handler
export const handleScrapingError = (logger) => (error) => {
  logger.error('Scraping operation failed', {
    message: error.message,
    stack: error.stack
  });
  
  return E.left(new ScrapingError(
    ErrorTypes.SCRAPING_ERROR,
    'Scraping operation failed',
    error
  ));
};

// Validation error handler
export const handleValidationError = (logger) => (error) => {
  logger.error('Data validation failed', {
    message: error.message,
    data: error.data
  });
  
  return E.left(new ScrapingError(
    ErrorTypes.VALIDATION_ERROR,
    'Data validation failed',
    error,
    { data: error.data }
  ));
};

// Configuration error handler
export const handleConfigurationError = (logger) => (error) => {
  logger.error('Configuration error', {
    message: error.message,
    missingFields: error.missingFields
  });
  
  return E.left(new ScrapingError(
    ErrorTypes.CONFIGURATION_ERROR,
    'Configuration error',
    error,
    { missingFields: error.missingFields }
  ));
};

// Error recovery strategies
export const recoverWithDefault = (defaultValue) => (error) => {
  console.warn('Recovering with default value:', error.message);
  return E.right(defaultValue);
};

export const recoverWithRetry = (maxRetries) => (operation) => (error) => {
  console.warn(`Retrying operation (${maxRetries} attempts remaining):`, error.message);
  if (maxRetries > 0) {
    return TE.chain(
      recoverWithRetry(maxRetries - 1)(operation)
    )(operation);
  }
  return TE.left(error);
};

// Error aggregation
export const aggregateErrors = (errors) => {
  const errorCounts = R.countBy(R.prop('type'), errors);
  const errorMessages = R.map(R.prop('message'), errors);
  
  return {
    totalErrors: errors.length,
    errorCounts,
    errorMessages,
    timestamp: new Date().toISOString()
  };
};

// Safe execution wrapper
export const safeExecute = (logger) => (operation) => (context) =>
  TE.tryCatch(
    async () => {
      logger.debug('Executing operation', { context });
      const result = await operation();
      logger.debug('Operation completed successfully', { context });
      return result;
    },
    (error) => {
      logger.error('Operation failed', { context, error: error.message });
      return error;
    }
  );

// Circuit breaker pattern
export class CircuitBreaker {
  constructor(threshold = 5, timeout = 60000) {
    this.threshold = threshold;
    this.timeout = timeout;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
  }

  async execute(operation) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new ScrapingError(
          ErrorTypes.NETWORK_ERROR,
          'Circuit breaker is OPEN',
          null,
          { state: this.state, failureCount: this.failureCount }
        );
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.threshold) {
      this.state = 'OPEN';
    }
  }
}

// Error monitoring and alerting
export const createErrorMonitor = (logger) => {
  const errorCounts = new Map();
  const alertThreshold = 10;
  
  return (error) => {
    const errorType = error.type || 'UNKNOWN_ERROR';
    const count = errorCounts.get(errorType) || 0;
    errorCounts.set(errorType, count + 1);
    
    if (count + 1 >= alertThreshold) {
      logger.warn(`Error threshold reached for ${errorType}`, {
        count: count + 1,
        threshold: alertThreshold
      });
    }
    
    return error;
  };
};

// Export logger factory
export const createLogger = (config) => new Logger(config);
