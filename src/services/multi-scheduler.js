// Multi-scheduler system for running multiple eLocal services
import cron from 'node-cron';
import * as R from 'ramda';
import * as E from 'fp-ts/lib/Either.js';
import * as TE from 'fp-ts/lib/TaskEither.js';
import * as T from 'fp-ts/lib/Task.js';
import { createLogger } from '../utils/error-handling.js';
import { createConfig, initializeDatabase } from '../index.js';
import { 
  scrapeHistoricalData, 
  scrapeCurrentDayData, 
  getServiceInfo 
} from './elocal-services.js';
import { refreshAuthSession } from './auth-refresh.js';
import { syncAdjustmentsToRingba } from './ringba-sync.js';

// Job execution function
const executeJob = (config) => (logger) => (jobId) => (serviceFunction) =>
  TE.tryCatch(
    async () => {
      logger.info(`Starting job: ${jobId}`);
      
      const startTime = Date.now();
      const result = await TE.getOrElse(() => {
        throw new Error('Job execution failed');
      })(serviceFunction(config))();
      
      const duration = Date.now() - startTime;
      logger.info(`Job ${jobId} completed successfully`, {
        duration: `${duration}ms`,
        callsScraped: result.summary?.totalCalls || 0,
        adjustmentsScraped: result.summary?.totalAdjustments || 0,
        dateRange: result.dateRange
      });
      
      return { jobId, result, duration };
    },
    (error) => {
      logger.error(`Job ${jobId} failed`, error.message);
      return { jobId, error: error.message };
    }
  );

// Multi-scheduler class
export class MultiScheduler {
  constructor(config) {
    this.config = config;
    this.logger = createLogger(config);
    this.scheduledTasks = new Map();
    this.jobStats = new Map();
    this.isRunning = false;
  }

  // Initialize scheduler
  initialize() {
    this.logger.info('Initializing multi-scheduler...');
    return E.right(this);
  }

  // Schedule historical data service (runs every 5 minutes for testing)
  scheduleHistoricalService() {
    const serviceInfo = getServiceInfo('historical');
    const cronExpression = '*/5 * * * *'; // Every 5 minutes
    
    if (!cron.validate(cronExpression)) {
      return E.left(new Error(`Invalid cron expression for historical service: ${cronExpression}`));
    }

    const task = cron.schedule(
      cronExpression,
      () => this.runHistoricalJob(),
      {
        scheduled: false,
        timezone: 'Asia/Kolkata' // Indian Standard Time (IST)
      }
    );

    this.scheduledTasks.set('historical', task);
    this.jobStats.set('historical', {
      name: serviceInfo.name,
      cronExpression,
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      lastRun: null,
      nextRun: this.getNextRunTime(cronExpression)
    });

    this.logger.info('Historical service scheduled', {
      cron: cronExpression,
      timezone: 'Asia/Kolkata (IST)',
      schedule: 'Every 5 minutes (for testing)',
      description: serviceInfo.description,
      dateRange: `${serviceInfo.dateRange.startDateFormatted} to ${serviceInfo.dateRange.endDateFormatted}`
    });

    return E.right(task);
  }

  // Schedule current day service (runs every 5 minutes for testing)
  scheduleCurrentDayService() {
    const serviceInfo = getServiceInfo('current');
    const cronExpression = '*/5 * * * *'; // Every 5 minutes
    
    if (!cron.validate(cronExpression)) {
      return E.left(new Error(`Invalid cron expression for current day service: ${cronExpression}`));
    }

    const task = cron.schedule(
      cronExpression,
      () => this.runCurrentDayJob(),
      {
        scheduled: false,
        timezone: 'Asia/Kolkata' // Indian Standard Time (IST)
      }
    );

    this.scheduledTasks.set('current', task);
    this.jobStats.set('current', {
      name: serviceInfo.name,
      cronExpression,
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      lastRun: null,
      nextRun: this.getNextRunTime(cronExpression)
    });

    this.logger.info('Current day service scheduled', {
      cron: cronExpression,
      timezone: 'Asia/Kolkata (IST)',
      schedule: 'Every 5 minutes (for testing)',
      description: serviceInfo.description,
      dateRange: `${serviceInfo.dateRange.startDateFormatted} to ${serviceInfo.dateRange.endDateFormatted}`
    });

    return E.right(task);
  }

  // Schedule auth refresh (once a week on Sunday at 2 AM IST)
  scheduleAuthRefresh() {
    const cronExpression = '0 2 * * 0'; // Every Sunday at 2:00 AM
    if (!cron.validate(cronExpression)) {
      return E.left(new Error(`Invalid cron expression for auth refresh: ${cronExpression}`));
    }
    const task = cron.schedule(
      cronExpression,
      async () => {
        this.logger.info('Running auth refresh job...');
        try {
          await refreshAuthSession(this.config)();
          this.logger.info('Auth refresh completed');
        } catch (e) {
          this.logger.error('Auth refresh failed', e.message);
        }
      },
      {
        scheduled: false,
        timezone: 'Asia/Kolkata' // Indian Standard Time (IST)
      }
    );
    this.scheduledTasks.set('authRefresh', task);
    this.jobStats.set('authRefresh', {
      name: 'Auth Refresh',
      cronExpression,
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      lastRun: null,
      nextRun: this.getNextRunTime(cronExpression)
    });
    this.logger.info('Auth refresh scheduled', { 
      cron: cronExpression,
      timezone: 'Asia/Kolkata (IST)',
      schedule: 'Once a week on Sunday at 2:00 AM IST'
    });
    return E.right(task);
  }

  // Schedule Ringba sync service (runs every 5 minutes for testing)
  scheduleRingbaSync() {
    if (!this.config.ringbaSyncEnabled || !this.config.ringbaAccountId || !this.config.ringbaApiToken) {
      this.logger.info('Ringba sync skipped: not enabled or credentials missing');
      return E.right(null);
    }

    const cronExpression = '*/5 * * * *'; // Every 5 minutes
    if (!cron.validate(cronExpression)) {
      return E.left(new Error(`Invalid cron expression for Ringba sync: ${cronExpression}`));
    }

    const task = cron.schedule(
      cronExpression,
      () => this.runRingbaSyncJob(),
      {
        scheduled: false,
        timezone: 'Asia/Kolkata' // Indian Standard Time (IST)
      }
    );

    this.scheduledTasks.set('ringbaSync', task);
    this.jobStats.set('ringbaSync', {
      name: 'Ringba Sync',
      cronExpression,
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      lastRun: null,
      nextRun: this.getNextRunTime(cronExpression)
    });
    this.logger.info('Ringba sync scheduled', { 
      cron: cronExpression,
      timezone: 'Asia/Kolkata (IST)',
      schedule: 'Every 5 minutes (for testing)'
    });
    return E.right(task);
  }

  // Run historical data job
  async runHistoricalJob() {
    const jobId = `historical_${Date.now()}`;
    const stats = this.jobStats.get('historical');
    
    stats.totalRuns++;
    stats.lastRun = new Date().toISOString();

    try {
      const result = await TE.getOrElse(() => ({ error: 'Job failed' }))(
        executeJob(this.config)(this.logger)(jobId)(scrapeHistoricalData)
      )();
      
      if (result.error) {
        stats.failedRuns++;
        this.logger.error(`Historical job ${jobId} failed: ${result.error}`);
      } else {
        stats.successfulRuns++;
        this.logger.info(`Historical job ${jobId} completed successfully`);
      }
    } catch (error) {
      stats.failedRuns++;
      this.logger.error(`Historical job ${jobId} failed with exception: ${error.message}`);
    }
  }

  // Run current day job
  async runCurrentDayJob() {
    const jobId = `current_${Date.now()}`;
    const stats = this.jobStats.get('current');
    
    stats.totalRuns++;
    stats.lastRun = new Date().toISOString();

    try {
      const result = await TE.getOrElse(() => ({ error: 'Job failed' }))(
        executeJob(this.config)(this.logger)(jobId)(scrapeCurrentDayData)
      )();
      
      if (result.error) {
        stats.failedRuns++;
        this.logger.error(`Current day job ${jobId} failed: ${result.error}`);
      } else {
        stats.successfulRuns++;
        this.logger.info(`Current day job ${jobId} completed successfully`);
      }
    } catch (error) {
      stats.failedRuns++;
      this.logger.error(`Current day job ${jobId} failed with exception: ${error.message}`);
    }
  }

  // Run Ringba sync job
  async runRingbaSyncJob() {
    const jobId = `ringbaSync_${Date.now()}`;
    const stats = this.jobStats.get('ringbaSync');
    
    if (!stats) {
      this.logger.error('Ringba sync stats not found');
      return;
    }
    
    stats.totalRuns++;
    stats.lastRun = new Date().toISOString();

    try {
      this.logger.info(`Running Ringba sync job: ${jobId}`);
      const resultEither = await syncAdjustmentsToRingba(this.config)(null)(); // null = all categories
      
      if (resultEither._tag === 'Right') {
        const result = resultEither.right;
        stats.successfulRuns++;
        this.logger.info(`Ringba sync job ${jobId} completed successfully: ${result.synced} synced, ${result.failed} failed, ${result.skipped} skipped`);
      } else {
        stats.failedRuns++;
        const error = resultEither.left;
        const errorMsg = error instanceof Error ? error.message : (typeof error === 'string' ? error : JSON.stringify(error));
        this.logger.error(`Ringba sync job ${jobId} failed: ${errorMsg}`);
      }
    } catch (error) {
      stats.failedRuns++;
      this.logger.error(`Ringba sync job ${jobId} failed with exception: ${error.message}`);
    }
  }

  // Start all scheduled services
  start() {
    if (this.isRunning) {
      this.logger.warn('Multi-scheduler is already running');
      return E.right(this);
    }

    // Schedule all services
    const historicalResult = this.scheduleHistoricalService();
    const currentResult = this.scheduleCurrentDayService();
    const authResult = this.scheduleAuthRefresh();
    const ringbaResult = this.scheduleRingbaSync();

    if (historicalResult._tag === 'Left' || currentResult._tag === 'Left' || authResult._tag === 'Left' || (ringbaResult && ringbaResult._tag === 'Left')) {
      return E.left(new Error('Failed to schedule services'));
    }

    // Start both tasks
    for (const [name, task] of this.scheduledTasks.entries()) {
      task.start();
      this.logger.info(`Started ${name} service`);
    }

    this.isRunning = true;
    this.logger.info('Multi-scheduler started successfully');
    
    return E.right(this);
  }

  // Stop all scheduled services
  stop() {
    if (!this.isRunning) {
      this.logger.warn('Multi-scheduler is not running');
      return E.right(this);
    }

    for (const [name, task] of this.scheduledTasks.entries()) {
      task.stop();
      task.destroy();
      this.logger.info(`Stopped ${name} service`);
    }

    this.scheduledTasks.clear();
    this.isRunning = false;
    this.logger.info('Multi-scheduler stopped');

    return E.right(this);
  }

  // Get scheduler status
  getStatus() {
    const status = {
      isRunning: this.isRunning,
      services: []
    };

    for (const [name, stats] of this.jobStats.entries()) {
      status.services.push({
        name: stats.name,
        cron: stats.cronExpression,
        totalRuns: stats.totalRuns,
        successfulRuns: stats.successfulRuns,
        failedRuns: stats.failedRuns,
        successRate: stats.totalRuns > 0 
          ? ((stats.successfulRuns / stats.totalRuns) * 100).toFixed(2) + '%'
          : '0%',
        lastRun: stats.lastRun,
        nextRun: stats.nextRun
      });
    }

    return status;
  }

  // Calculate next run time (simplified)
  getNextRunTime(cronExpression) {
    // This is a simplified calculation
    // In production, you might want to use a proper cron parser
    try {
      const now = new Date();
      if (cronExpression === '*/5 * * * *') {
        // Every 5 minutes
        const next = new Date(now);
        const currentMinutes = next.getMinutes();
        const nextMinute = Math.ceil((currentMinutes + 1) / 5) * 5;
        if (nextMinute >= 60) {
          next.setHours(next.getHours() + 1);
          next.setMinutes(0);
        } else {
          next.setMinutes(nextMinute);
        }
        next.setSeconds(0);
        next.setMilliseconds(0);
        return next.toISOString();
      } else if (cronExpression === '0 0 * * *') {
        // Every day at 12:00 AM (midnight) IST
        const next = new Date(now);
        next.setHours(0, 0, 0, 0);
        if (next <= now) {
          next.setDate(next.getDate() + 1);
        }
        return next.toISOString();
      } else if (cronExpression === '0 21,0,3,6 * * *') {
        // Every 3 hours from 9 PM to 6 AM IST (21:00, 00:00, 03:00, 06:00)
        const hours = [21, 0, 3, 6];
        const currentHour = now.getHours();
        let nextHour = hours.find(h => h > currentHour) || hours[0];
        const next = new Date(now);
        next.setHours(nextHour, 0, 0, 0);
        if (next <= now) {
          // If we've passed all hours today, go to first hour tomorrow
          next.setDate(next.getDate() + 1);
          next.setHours(hours[0], 0, 0, 0);
        }
        return next.toISOString();
      } else if (cronExpression === '0 2 * * 0') {
        // Every Sunday at 2:00 AM IST
        const next = new Date(now);
        const daysUntilSunday = (7 - next.getDay()) % 7;
        next.setDate(next.getDate() + (daysUntilSunday || 7));
        next.setHours(2, 0, 0, 0);
        if (next <= now) {
          next.setDate(next.getDate() + 7);
        }
        return next.toISOString();
      } else if (cronExpression === '0 6 * * *') {
        // Every day at 6:00 AM IST
        const next = new Date(now);
        next.setHours(6, 0, 0, 0);
        if (next <= now) {
          next.setDate(next.getDate() + 1);
        }
        return next.toISOString();
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  // Run job manually (for testing)
  async runManualJob(serviceType) {
    const jobId = `manual_${serviceType}_${Date.now()}`;
    this.logger.info(`Running manual ${serviceType} job: ${jobId}`);
    
    try {
      let result;
      if (serviceType === 'historical') {
        result = await TE.getOrElse(() => ({ error: 'Manual job failed' }))(
          executeJob(this.config)(this.logger)(jobId)(scrapeHistoricalData)
        )();
      } else if (serviceType === 'current') {
        result = await TE.getOrElse(() => ({ error: 'Manual job failed' }))(
          executeJob(this.config)(this.logger)(jobId)(scrapeCurrentDayData)
        )();
      } else {
        throw new Error(`Unknown service type: ${serviceType}`);
      }
      
      return E.right(result);
    } catch (error) {
      this.logger.error(`Manual ${serviceType} job failed: ${error.message}`);
      return E.left(error);
    }
  }
}

// Factory function
export const createMultiScheduler = (config) => {
  return new MultiScheduler(config);
};
