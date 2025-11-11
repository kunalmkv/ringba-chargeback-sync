// Scheduler service using functional programming
import cron from 'node-cron';
import * as R from 'ramda';
import * as E from 'fp-ts/lib/Either.js';
import * as TE from 'fp-ts/lib/TaskEither.js';
import * as T from 'fp-ts/lib/Task.js';
import { createLogger } from '../utils/error-handling.js';
import { scrapeElocalData, createConfig } from '../index.js';

// Scheduler configuration
const SchedulerConfigSchema = {
  enabled: Boolean,
  cron: String,
  timezone: String,
  maxConcurrentJobs: Number,
  retryOnFailure: Boolean,
  maxRetries: Number
};

// Scheduler state management
class SchedulerState {
  constructor() {
    this.isRunning = false;
    this.activeJobs = new Set();
    this.jobHistory = [];
    this.stats = {
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      lastRun: null,
      nextRun: null
    };
  }

  addJob(jobId) {
    this.activeJobs.add(jobId);
  }

  removeJob(jobId) {
    this.activeJobs.delete(jobId);
  }

  updateStats(success) {
    this.stats.totalRuns++;
    if (success) {
      this.stats.successfulRuns++;
    } else {
      this.stats.failedRuns++;
    }
    this.stats.lastRun = new Date().toISOString();
  }

  getStats() {
    return {
      ...this.stats,
      activeJobs: this.activeJobs.size,
      successRate: this.stats.totalRuns > 0 
        ? (this.stats.successfulRuns / this.stats.totalRuns * 100).toFixed(2) + '%'
        : '0%'
    };
  }
}

// Job execution with error handling
const executeScrapingJob = (config) => (logger) => (jobId) =>
  TE.tryCatch(
    async () => {
      logger.info(`Starting scheduled scraping job: ${jobId}`);
      
      const startTime = Date.now();
      const result = await TE.getOrElse(() => {
        throw new Error('Scraping job failed');
      })(scrapeElocalData(config))();
      
      const duration = Date.now() - startTime;
      logger.info(`Scraping job ${jobId} completed successfully`, {
        duration: `${duration}ms`,
        callsScraped: result.summary.totalCalls,
        adjustmentsScraped: result.summary.totalAdjustments
      });
      
      return { jobId, result, duration };
    },
    (error) => {
      logger.error(`Scraping job ${jobId} failed`, error.message);
      return { jobId, error: error.message };
    }
  );

// Retry logic for failed jobs
const withRetry = (maxRetries) => (delayMs) => (operation) =>
  TE.tryCatch(
    async () => {
      let lastError;
      for (let i = 0; i < maxRetries; i++) {
        try {
          return await operation();
        } catch (error) {
          lastError = error;
          if (i < maxRetries - 1) {
            logger.warn(`Job retry ${i + 1}/${maxRetries} after ${delayMs}ms delay`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        }
      }
      throw lastError;
    },
    (error) => new Error(`Job failed after ${maxRetries} retries: ${error.message}`)
  );

// Scheduler service
export class SchedulerService {
  constructor(config) {
    this.config = config;
    this.logger = createLogger(config);
    this.state = new SchedulerState();
    this.task = null;
    this.isInitialized = false;
  }

  // Initialize scheduler
  initialize() {
    if (this.isInitialized) {
      this.logger.warn('Scheduler already initialized');
      return E.right(this);
    }

    if (!this.config.scheduleEnabled) {
      this.logger.info('Scheduling is disabled');
      return E.right(this);
    }

    if (!cron.validate(this.config.scheduleCron)) {
      return E.left(new Error(`Invalid cron expression: ${this.config.scheduleCron}`));
    }

    this.isInitialized = true;
    this.logger.info('Scheduler initialized', {
      cron: this.config.scheduleCron,
      timezone: this.config.scheduleTimezone
    });

    return E.right(this);
  }

  // Start the scheduler
  start() {
    if (!this.isInitialized) {
      const initResult = this.initialize();
      if (initResult._tag === 'Left') {
        return initResult;
      }
    }

    if (this.state.isRunning) {
      this.logger.warn('Scheduler is already running');
      return E.right(this);
    }

    try {
      this.task = cron.schedule(
        this.config.scheduleCron,
        () => this.runScheduledJob(),
        {
          scheduled: false,
          timezone: this.config.scheduleTimezone
        }
      );

      this.task.start();
      this.state.isRunning = true;
      
      // Calculate next run time
      const nextRun = this.getNextRunTime();
      this.state.stats.nextRun = nextRun;

      this.logger.info('Scheduler started', {
        cron: this.config.scheduleCron,
        timezone: this.config.scheduleTimezone,
        nextRun
      });

      return E.right(this);
    } catch (error) {
      return E.left(new Error(`Failed to start scheduler: ${error.message}`));
    }
  }

  // Stop the scheduler
  stop() {
    if (!this.state.isRunning) {
      this.logger.warn('Scheduler is not running');
      return E.right(this);
    }

    if (this.task) {
      this.task.stop();
      this.task.destroy();
      this.task = null;
    }

    this.state.isRunning = false;
    this.logger.info('Scheduler stopped');

    return E.right(this);
  }

  // Run a scheduled job
  async runScheduledJob() {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Check if we're already at max concurrent jobs
    if (this.state.activeJobs.size >= this.config.maxConcurrentJobs) {
      this.logger.warn(`Skipping job ${jobId} - max concurrent jobs reached`);
      return;
    }

    this.state.addJob(jobId);

    try {
      const config = createConfig();
      const jobOperation = executeScrapingJob(config)(this.logger)(jobId);
      
      let result;
      if (this.config.retryOnFailure) {
        const retryOperation = withRetry(this.config.maxRetries)(5000)(jobOperation);
        result = await TE.getOrElse(() => ({ jobId, error: 'Job failed after retries' }))(retryOperation)();
      } else {
        result = await TE.getOrElse(() => ({ jobId, error: 'Job failed' }))(jobOperation)();
      }

      const success = !result.error;
      this.state.updateStats(success);

      if (success) {
        this.logger.info(`Scheduled job ${jobId} completed successfully`);
      } else {
        this.logger.error(`Scheduled job ${jobId} failed: ${result.error}`);
      }

    } catch (error) {
      this.logger.error(`Scheduled job ${jobId} failed with exception: ${error.message}`);
      this.state.updateStats(false);
    } finally {
      this.state.removeJob(jobId);
    }
  }

  // Get next run time
  getNextRunTime() {
    if (!this.task || !this.state.isRunning) {
      return null;
    }

    try {
      // This is a simplified calculation - in production you might want to use a proper cron parser
      const now = new Date();
      const nextRun = new Date(now.getTime() + 6 * 60 * 60 * 1000); // Approximate for every 6 hours
      return nextRun.toISOString();
    } catch (error) {
      this.logger.warn('Could not calculate next run time', error.message);
      return null;
    }
  }

  // Get scheduler status
  getStatus() {
    return {
      isRunning: this.state.isRunning,
      isInitialized: this.isInitialized,
      config: {
        enabled: this.config.scheduleEnabled,
        cron: this.config.scheduleCron,
        timezone: this.config.scheduleTimezone,
        maxConcurrentJobs: this.config.maxConcurrentJobs,
        retryOnFailure: this.config.retryOnFailure,
        maxRetries: this.config.maxRetries
      },
      stats: this.state.getStats(),
      nextRun: this.getNextRunTime()
    };
  }

  // Run job manually (for testing)
  async runManualJob() {
    const jobId = `manual_${Date.now()}`;
    this.logger.info(`Running manual job: ${jobId}`);
    
    this.state.addJob(jobId);
    
    try {
      const config = createConfig();
      const result = await TE.getOrElse(() => ({ jobId, error: 'Manual job failed' }))(
        executeScrapingJob(config)(this.logger)(jobId)
      )();
      
      const success = !result.error;
      this.state.updateStats(success);
      
      return E.right(result);
    } catch (error) {
      this.logger.error(`Manual job ${jobId} failed: ${error.message}`);
      this.state.updateStats(false);
      return E.left(error);
    } finally {
      this.state.removeJob(jobId);
    }
  }
}

// Scheduler factory function
export const createScheduler = (config) => {
  const schedulerConfig = {
    scheduleEnabled: config.scheduleEnabled || false,
    scheduleCron: config.scheduleCron || '0 */6 * * *', // Every 6 hours
    scheduleTimezone: config.scheduleTimezone || 'America/New_York',
    maxConcurrentJobs: config.maxConcurrentJobs || 1,
    retryOnFailure: config.retryOnFailure || true,
    maxRetries: config.maxRetries || 3,
    ...config
  };

  return new SchedulerService(schedulerConfig);
};

// Common cron expressions for reference
export const CronExpressions = {
  EVERY_MINUTE: '* * * * *',
  EVERY_5_MINUTES: '*/5 * * * *',
  EVERY_15_MINUTES: '*/15 * * * *',
  EVERY_HOUR: '0 * * * *',
  EVERY_6_HOURS: '0 */6 * * *',
  EVERY_12_HOURS: '0 */12 * * *',
  DAILY: '0 0 * * *',
  WEEKLY: '0 0 * * 0',
  MONTHLY: '0 0 1 * *'
};
