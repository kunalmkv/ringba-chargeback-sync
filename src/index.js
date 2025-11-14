// Main service orchestrator using functional programming
import * as R from 'ramda';
import * as E from 'fp-ts/lib/Either.js';
import * as TE from 'fp-ts/lib/TaskEither.js';
import * as T from 'fp-ts/lib/Task.js';
import { fileURLToPath } from 'url';
import { argv } from 'process';
import dotenv from 'dotenv';
import { dbOps } from './database/sqlite-operations.js';
import { scrapingOps } from './scrapers/elocal-scraper.js';
import { createScheduler } from './services/scheduler.js';
import { createMultiScheduler } from './services/multi-scheduler.js';
import { scrapeHistoricalData, scrapeCurrentDayData, scrapeHistoricalDataAPI, scrapeCurrentDayDataAPI } from './services/elocal-services.js';
import { optimizedConfig } from './config/optimized-config.js';
import {
  validateConfig,
  processCampaignCalls,
  processAdjustmentDetails,
  createSession,
  generateSessionId,
  logInfo,
  logError,
  logSuccess,
  delay,
  aggregateScrapingResults
} from './utils/helpers.js';

// Load environment variables
dotenv.config();

// Configuration from environment (optimized for small datasets)
const createConfig = () => optimizedConfig.create();

// Main scraping workflow
const scrapeElocalData = (config) => {
  const session = createSession();
  const db = dbOps(config);
  const scraper = scrapingOps(config);
  
  return TE.tryCatch(
    async () => {
      console.log(`[INFO] Starting scraping session: ${session.sessionId}`);
      
      // Create session in database
      await TE.getOrElse(() => T.of(null))(db.createSession(session))();
      
      // Launch browser
      const browser = await TE.getOrElse(() => {
        throw new Error('Failed to launch browser');
      })(scraper.createBrowser())();
      
      try {
        // Create downloads directory
        const fs = await import('fs/promises');
        const path = await import('path');
        const downloadPath = path.join(process.cwd(), 'downloads');
        try {
          await fs.mkdir(downloadPath, { recursive: true });
        } catch (error) {
          // Directory might already exist, that's fine
        }
        
        // Create and configure page
        const page = await browser.newPage();
        const configuredPage = await TE.getOrElse(() => {
          throw new Error('Failed to configure page');
        })(scraper.configurePage(page)(config))();
        
        // Setup download handler
        console.log('[INFO] Setting up download handler...');
        await TE.getOrElse(() => {
          throw new Error('Failed to setup download handler');
        })(scraper.setupDownloadHandler(configuredPage)(downloadPath))();
        
        // Login to eLocal
        console.log('[INFO] Logging into eLocal...');
        await TE.getOrElse(() => {
          throw new Error('Login failed');
        })(scraper.loginToElocal(configuredPage))();
        
        // Navigate to campaigns
        console.log('[INFO] Navigating to campaigns page...');
        await TE.getOrElse(() => {
          throw new Error('Failed to navigate to campaigns');
        })(scraper.navigateToCampaigns(configuredPage))();
        
        // Click on Appliance Repair campaign
        console.log('[INFO] Clicking on Appliance Repair campaign...');
        await TE.getOrElse(() => {
          throw new Error('Failed to click campaign');
        })(scraper.clickApplianceRepairCampaign(configuredPage))();
        
        // Export Calls to CSV
        console.log('[INFO] Clicking Export Calls button...');
        const exportResult = await TE.getOrElse(() => {
          throw new Error('Failed to export calls');
        })(scraper.exportCallsToCSV(configuredPage))();
        console.log('[INFO] Export button clicked:', exportResult.message);
        
        // Wait a bit more for download to complete
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Check if CSV file was downloaded
        console.log('[INFO] Checking for downloaded CSV file...');
        const downloadResult = await TE.getOrElse(() => {
          throw new Error('Failed to verify download');
        })(scraper.checkDownloadedFile(downloadPath))();
        console.log('[SUCCESS] CSV file downloaded:', downloadResult.message);
        console.log(`[INFO] File: ${downloadResult.file}, Size: ${downloadResult.size} bytes`);
        
        // Extract campaign calls
        console.log('[INFO] Extracting campaign calls...');
        const rawCalls = await TE.getOrElse(() => {
          throw new Error('Failed to extract campaign calls');
        })(scraper.extractCampaignCalls(configuredPage))();
        
        // Process and validate calls
        const processedCalls = processCampaignCalls(rawCalls);
        console.log(`[INFO] Processed ${processedCalls.length} campaign calls`);
        
        // Extract adjustment details
        console.log('[INFO] Extracting adjustment details...');
        const rawAdjustments = await TE.getOrElse(() => {
          throw new Error('Failed to extract adjustment details');
        })(scraper.extractAdjustmentDetails(configuredPage))();
        
        // Process and validate adjustments
        const processedAdjustments = processAdjustmentDetails(rawAdjustments);
        console.log(`[INFO] Processed ${processedAdjustments.length} adjustment details`);
        
        // Save data to database
        console.log('[INFO] Saving data to database...');
        
        // Save campaign calls
        if (processedCalls.length > 0) {
          const callsResult = await TE.getOrElse(() => {
            throw new Error('Failed to save campaign calls');
          })(db.insertCallsBatch(processedCalls))();
          console.log(`[SUCCESS] Saved ${callsResult.inserted} campaign calls`);
        }
        
        // Save adjustment details
        if (processedAdjustments.length > 0) {
          const adjustmentsResult = await TE.getOrElse(() => {
            throw new Error('Failed to save adjustment details');
          })(db.insertAdjustmentsBatch(processedAdjustments))();
          console.log(`[SUCCESS] Saved ${adjustmentsResult.inserted} adjustment details`);
        }
        
        // Update session status
        await TE.getOrElse(() => T.of(null))(
          db.updateSession(session.sessionId)({
            completed_at: new Date().toISOString(),
            status: 'completed',
            calls_scraped: processedCalls.length,
            adjustments_scraped: processedAdjustments.length
          })
        )();
        
        // Generate summary
        const summary = aggregateScrapingResults(processedCalls, processedAdjustments);
        console.log('[SUCCESS] Scraping completed successfully:', summary);
        
        return {
          sessionId: session.sessionId,
          summary,
          calls: processedCalls,
          adjustments: processedAdjustments,
          downloadedFile: downloadResult
        };
        
      } finally {
        await browser.close();
      }
    },
    (error) => {
      console.error('[ERROR] Scraping failed:', error.message);
      
      // Update session with error
      TE.getOrElse(() => T.of(null))(
        db.updateSession(session.sessionId)({
          completed_at: new Date().toISOString(),
          status: 'failed',
          error_message: error.message
        })
      )();
      
      return error;
    }
  );
};

// Initialize database
const initializeDatabase = (config) => {
  const db = dbOps(config);
  return db.initialize();
};

// Main service function
const runService = () => {
  const config = createConfig();
  
  return E.fold(
    (error) => {
      console.error('[ERROR] Configuration validation failed:', error.message);
      return TE.left(error);
    },
    (validConfig) => {
      console.log('[INFO] Configuration validated successfully');
      
      return TE.chain(
        () => scrapeElocalData(validConfig)
      )(
        initializeDatabase(validConfig)
      );
    }
  )(optimizedConfig.validate(config));
};

// Historical data service function (STATIC)
const runHistoricalService = () => {
  const config = createConfig();
  
  return E.fold(
    (error) => {
      console.error('[ERROR] Configuration validation failed:', error.message);
      return TE.left(error);
    },
    (validConfig) => {
      console.log('[INFO] Starting historical data service (past 10 days)...');
      
      return TE.chain(
        () => scrapeHistoricalData(validConfig)
      )(
        initializeDatabase(validConfig)
      );
    }
  )(optimizedConfig.validate(config));
};

// Current day service function (STATIC)
const runCurrentDayService = () => {
  const config = createConfig();
  
  return E.fold(
    (error) => {
      console.error('[ERROR] Configuration validation failed:', error.message);
      return TE.left(error);
    },
    (validConfig) => {
      console.log('[INFO] Starting current day service...');
      
      return TE.chain(
        () => scrapeCurrentDayData(validConfig)
      )(
        initializeDatabase(validConfig)
      );
    }
  )(optimizedConfig.validate(config));
};

// Multi-scheduler service function
const runMultiSchedulerService = () => {
  const config = createConfig();
  
  return E.fold(
    (error) => {
      console.error('[ERROR] Configuration validation failed:', error.message);
      return TE.left(error);
    },
    (validConfig) => {
      console.log('[INFO] Starting multi-scheduler service...');
      
      // Initialize database first
      return TE.chain(
        () => {
          const scheduler = createMultiScheduler(validConfig);
          
          // Initialize scheduler
          const initResult = scheduler.initialize();
          if (initResult._tag === 'Left') {
            return TE.left(initResult.left);
          }
          
          // Start scheduler
          const startResult = scheduler.start();
          if (startResult._tag === 'Left') {
            return TE.left(startResult.left);
          }
          
          console.log('[INFO] Multi-scheduler service started successfully');
          console.log('[INFO] Scheduler status:', JSON.stringify(scheduler.getStatus(), null, 2));
          
          // Keep the process running
          return TE.right({
            scheduler,
            status: 'running',
            message: 'Multi-scheduler service is running. Press Ctrl+C to stop.'
          });
        }
      )(initializeDatabase(validConfig));
    }
  )(optimizedConfig.validate(config));
};

// Scheduler service function (legacy)
const runSchedulerService = () => {
  const config = createConfig();
  
  return E.fold(
    (error) => {
      console.error('[ERROR] Configuration validation failed:', error.message);
      return TE.left(error);
    },
    (validConfig) => {
      console.log('[INFO] Starting scheduler service...');
      
      const scheduler = createScheduler(validConfig);
      
      // Initialize scheduler
      const initResult = scheduler.initialize();
      if (initResult._tag === 'Left') {
        return TE.left(initResult.left);
      }
      
      // Start scheduler
      const startResult = scheduler.start();
      if (startResult._tag === 'Left') {
        return TE.left(startResult.left);
      }
      
      console.log('[INFO] Scheduler service started successfully');
      console.log('[INFO] Scheduler status:', scheduler.getStatus());
      
      // Keep the process running
      return TE.right({
        scheduler,
        status: 'running',
        message: 'Scheduler service is running. Press Ctrl+C to stop.'
      });
    }
  )(optimizedConfig.validate(config));
};

// CLI interface
const main = async () => {
  try {
    const args = process.argv.slice(2);
    const command = args[0] || 'scrape';
    
    if (command === 'multi-scheduler' || command === 'multi') {
      const config = createConfig();
      console.log('[INFO] Starting multi-scheduler service...');
      console.log('[INFO] This will run:');
      console.log('  - Historical data service (STATIC): Daily at 12:00 AM IST');
      console.log('  - Historical data service (API): Daily at 12:30 AM IST');
      console.log('  - Current day service (STATIC): Every 3 hours at 21:00, 00:00, 03:00, 06:00 IST');
      console.log('  - Current day service (API): Every 3 hours at 21:15, 00:15, 03:15, 06:15 IST');
      console.log('  - Auth refresh: Sunday at 2:00 AM IST');
      if (config.ringbaAccountId && config.ringbaApiToken) {
        console.log('  - Ringba cost sync: Every 3 hours at 21:45, 00:45, 03:45, 06:45 IST');
        console.log('  - Revenue sync: Every 3 hours at 21:50, 00:50, 03:50, 06:50 IST');
      }
      if (config.ringbaSyncEnabled && config.ringbaAccountId && config.ringbaApiToken) {
        console.log('  - Ringba sync: Every 3 hours at 22:00, 01:00, 04:00, 07:00 IST');
      }
      
      const result = await TE.getOrElse(() => {
        throw new Error('Multi-scheduler service execution failed');
      })(runMultiSchedulerService())();
      
      console.log('[SUCCESS] Multi-scheduler service started');
      console.log('Scheduler status:', JSON.stringify(result.scheduler.getStatus(), null, 2));
      
      // Keep the process running
      process.on('SIGINT', () => {
        console.log('\n[INFO] Stopping multi-scheduler service...');
        result.scheduler.stop();
        process.exit(0);
      });
      
      // Log status periodically
      setInterval(() => {
        const status = result.scheduler.getStatus();
        console.log(`[INFO] Multi-scheduler status:`);
        status.services.forEach(service => {
          console.log(`  ${service.name}: ${service.successRate} success rate, Last run: ${service.lastRun || 'Never'}`);
        });
      }, 60000); // Log status every minute
      
    } else if (command === 'historical' || command === 'history') {
      console.log('[INFO] Running historical data service (past 10 days, excluding today)...');
      
      const result = await TE.getOrElse(() => {
        throw new Error('Historical service execution failed');
      })(runHistoricalService())();
      
      console.log('[SUCCESS] Historical service completed successfully');
      console.log('Result:', {
        dateRange: result.dateRange,
        summary: result.summary,
        databaseResults: result.databaseResults
      });
      
      process.exit(0);
      
    } else if (command === 'current' || command === 'today') {
      console.log('[INFO] Running current day service...');
      
      const result = await TE.getOrElse(() => {
        throw new Error('Current day service execution failed');
      })(runCurrentDayService())();
      
      console.log('[SUCCESS] Current day service completed successfully');
      console.log('Result:', {
        dateRange: result.dateRange,
        summary: result.summary,
        databaseResults: result.databaseResults
      });
      
      process.exit(0);
      
    } else if (command === 'historical-api' || command === 'history-api') {
      console.log('[INFO] Running historical data service (API category, past 10 days, excluding today)...');
      
      const config = createConfig();
      const validConfig = E.fold(
        (error) => {
          console.error('[ERROR] Configuration validation failed:', error.message);
          process.exit(1);
          return null;
        },
        (cfg) => cfg
      )(optimizedConfig.validate(config));
      
      const result = await TE.getOrElse(() => {
        throw new Error('Historical API service execution failed');
      })(scrapeHistoricalDataAPI(validConfig))();
      
      console.log('[SUCCESS] Historical API service completed successfully');
      console.log('Result:', {
        dateRange: result.dateRange,
        summary: result.summary,
        databaseResults: result.databaseResults
      });
      
      process.exit(0);
      
    } else if (command === 'current-api' || command === 'today-api') {
      console.log('[INFO] Running current day service (API category)...');
      
      const config = createConfig();
      const validConfig = E.fold(
        (error) => {
          console.error('[ERROR] Configuration validation failed:', error.message);
          process.exit(1);
          return null;
        },
        (cfg) => cfg
      )(optimizedConfig.validate(config));
      
      const result = await TE.getOrElse(() => {
        throw new Error('Current day API service execution failed');
      })(scrapeCurrentDayDataAPI(validConfig))();
      
      console.log('[SUCCESS] Current day API service completed successfully');
      console.log('Result:', {
        dateRange: result.dateRange,
        summary: result.summary,
        databaseResults: result.databaseResults
      });
      
      process.exit(0);
      
    } else if (command === 'scheduler' || command === 'schedule') {
      console.log('[INFO] Starting legacy scheduler service...');
      
      const result = await TE.getOrElse(() => {
        throw new Error('Scheduler service execution failed');
      })(runSchedulerService())();
      
      console.log('[SUCCESS] Scheduler service started');
      console.log('Result:', result);
      
      // Keep the process running
      process.on('SIGINT', () => {
        console.log('\n[INFO] Stopping scheduler service...');
        result.scheduler.stop();
        process.exit(0);
      });
      
      // Keep alive
      setInterval(() => {
        const status = result.scheduler.getStatus();
        console.log(`[INFO] Scheduler status: ${status.stats.successRate} success rate, ${status.stats.activeJobs} active jobs`);
      }, 60000); // Log status every minute
      
    } else if (command === 'refresh-auth') {
      console.log('[INFO] Refreshing auth session (3-day TTL)...');
      const { refreshAuthSession } = await import('./services/auth-refresh.js');
      const result = await (await refreshAuthSession(createConfig())())._tag === 'Right'
        ? (await refreshAuthSession(createConfig())()).right
        : null;
      if (result && result.success) {
        console.log('[SUCCESS] Auth session refreshed. Expires at:', new Date(result.expiresAt).toISOString());
      } else {
        console.log('[ERROR] Auth refresh failed');
      }
      process.exit(0);
    } else if (command === 'ringba-cost-sync' || command === 'sync-ringba-cost') {
      console.log('[INFO] Starting Ringba cost sync service...');
      const config = createConfig();
      
      // Check if --today flag is provided (for current day only, skips existing calls)
      const todayOnly = process.argv.includes('--today');
      
      if (todayOnly) {
        // Use the new "today only" function (skips existing calls, doesn't update)
        const { syncRingbaCostDataForToday } = await import('./services/ringba-cost-sync.js');
        console.log('[INFO] Mode: Current day only (will skip existing calls, no updates)');
        
        const resultEither = await syncRingbaCostDataForToday(config)();
        
        if (resultEither._tag === 'Right') {
          const result = resultEither.right;
          console.log('\n========================================');
          console.log('✅ Ringba Cost Sync Completed (Today Only)');
          console.log('========================================');
          console.log(`New Calls Processed: ${result.summary.totalCalls}`);
          console.log(`Existing Calls Skipped: ${result.summary.skippedCalls || 0}`);
          console.log(`Total Cost: $${result.summary.totalCost.toFixed(2)}`);
          console.log(`Total Revenue: $${result.summary.totalRevenue.toFixed(2)}`);
          console.log('');
          console.log('By Category:');
          console.log(`  STATIC: ${result.summary.byCategory.STATIC.calls} calls, Cost: $${result.summary.byCategory.STATIC.cost.toFixed(2)}, Revenue: $${result.summary.byCategory.STATIC.revenue.toFixed(2)}`);
          console.log(`  API: ${result.summary.byCategory.API.calls} calls, Cost: $${result.summary.byCategory.API.cost.toFixed(2)}, Revenue: $${result.summary.byCategory.API.revenue.toFixed(2)}`);
          console.log('');
          console.log('By Target:');
          for (const [targetId, data] of Object.entries(result.summary.byTarget)) {
            console.log(`  ${data.targetName} (${data.category}): ${data.calls} calls, Cost: $${data.cost.toFixed(2)}, Revenue: $${data.revenue.toFixed(2)}`);
          }
          console.log('');
          console.log('Database:');
          console.log(`  Inserted: ${result.summary.saved.inserted}`);
          console.log(`  Updated: ${result.summary.saved.updated} (should be 0 - no updates)`);
          console.log(`  Total: ${result.summary.saved.total}`);
          console.log(`  Targets Processed: ${result.summary.targetsProcessed}`);
          console.log(`  Targets Failed: ${result.summary.targetsFailed}`);
          console.log('========================================\n');
          process.exit(0);
        } else {
          console.error('❌ Error:', resultEither.left.message);
          process.exit(1);
        }
      } else {
        // Use date range function (for manual/backfill operations)
        const { syncRingbaCostForDateRange } = await import('./services/ringba-cost-sync.js');
        
        // Parse date range from arguments or use defaults
        const startDateArg = process.argv.find(arg => arg.startsWith('--start='));
        const endDateArg = process.argv.find(arg => arg.startsWith('--end='));
        
        let startDate, endDate;
        if (startDateArg && endDateArg) {
          startDate = startDateArg.split('=')[1];
          endDate = endDateArg.split('=')[1];
        } else {
          // Default to last 30 days
          const end = new Date();
          const start = new Date();
          start.setDate(start.getDate() - 30);
          startDate = start.toISOString().split('T')[0];
          endDate = end.toISOString().split('T')[0];
        }
        
        console.log(`[INFO] Date range: ${startDate} to ${endDate}`);
        console.log('[INFO] Mode: Date range (will update existing records)');
        
        const resultEither = await syncRingbaCostForDateRange(config)(startDate, endDate)();
        
        if (resultEither._tag === 'Right') {
          const result = resultEither.right;
          console.log('\n========================================');
          console.log('✅ Ringba Cost Sync Completed');
          console.log('========================================');
          console.log(`Total Calls: ${result.summary.totalCalls}`);
          console.log(`Total Cost: $${result.summary.totalCost.toFixed(2)}`);
          console.log(`Total Revenue: $${result.summary.totalRevenue.toFixed(2)}`);
          console.log('');
          console.log('By Category:');
          console.log(`  STATIC: ${result.summary.byCategory.STATIC.calls} calls, Cost: $${result.summary.byCategory.STATIC.cost.toFixed(2)}, Revenue: $${result.summary.byCategory.STATIC.revenue.toFixed(2)}`);
          console.log(`  API: ${result.summary.byCategory.API.calls} calls, Cost: $${result.summary.byCategory.API.cost.toFixed(2)}, Revenue: $${result.summary.byCategory.API.revenue.toFixed(2)}`);
          console.log('');
          console.log('By Target:');
          for (const [targetId, data] of Object.entries(result.summary.byTarget)) {
            console.log(`  ${data.targetName} (${data.category}): ${data.calls} calls, Cost: $${data.cost.toFixed(2)}, Revenue: $${data.revenue.toFixed(2)}`);
          }
          console.log('');
          console.log('Database:');
          console.log(`  Inserted: ${result.summary.saved.inserted}`);
          console.log(`  Updated: ${result.summary.saved.updated}`);
          console.log(`  Total: ${result.summary.saved.total}`);
          console.log('========================================\n');
          process.exit(0);
        } else {
          console.error('❌ Error:', resultEither.left.message);
          process.exit(1);
        }
      }
    } else if (command === 'revenue-sync' || command === 'sync-revenue') {
      console.log('[INFO] Starting revenue sync service...');
      
      const config = createConfig();
      const { syncRevenueForLastDays } = await import('./services/revenue-sync.js');
      
      // Get days parameter from command line (default: 10)
      const daysArg = process.argv.find(arg => arg.startsWith('--days='));
      const days = daysArg ? parseInt(daysArg.split('=')[1]) : 10;
      
      const resultEither = await syncRevenueForLastDays(config)(days)();
      
      if (resultEither._tag === 'Right') {
        const result = resultEither.right;
        console.log('[SUCCESS] Revenue sync completed successfully!');
        console.log('  - Days processed:', result.daysProcessed);
        console.log('  - Ringba cost records:', result.ringbaCostRecords || 0);
        console.log('  - Elocal calls:', result.elocalCalls || 0);
        console.log('  - Date range:', result.dateRange.startDate, 'to', result.dateRange.endDate);
        process.exit(0);
      } else {
        const error = resultEither.left;
        const errorMsg = error instanceof Error ? error.message : (typeof error === 'string' ? error : JSON.stringify(error));
        console.error('[ERROR] Revenue sync failed:', errorMsg);
        process.exit(1);
      }
    } else if (command === 'ringba-sync' || command === 'sync-ringba') {
      console.log('[INFO] Running Ringba sync service (all categories)...');
      const { syncAdjustmentsToRingba } = await import('./services/ringba-sync.js');
      const config = createConfig();
      
      // Check for category filter
      const args = process.argv.slice(2);
      const categoryIdx = args.indexOf('--category');
      const category = categoryIdx >= 0 && args[categoryIdx + 1] ? args[categoryIdx + 1].toUpperCase() : null;
      
      const resultEither = await syncAdjustmentsToRingba(config)(category)();
      
      if (resultEither._tag === 'Right') {
        const result = resultEither.right;
        console.log('[SUCCESS] Ringba sync completed:', result);
        console.log(`  - Synced: ${result.synced || 0}`);
        console.log(`  - Failed: ${result.failed || 0}`);
        console.log(`  - Skipped: ${result.skipped || 0}`);
      } else {
        const error = resultEither.left;
        const errorMsg = error instanceof Error ? error.message : (typeof error === 'string' ? error : JSON.stringify(error));
        console.log('[ERROR] Ringba sync failed:', errorMsg);
      }
      process.exit(0);
    } else if (command === 'ringba-logs' || command === 'view-ringba-logs') {
      console.log('[INFO] Fetching Ringba sync logs...');
      const { getRingbaSyncLogs } = await import('./database/sqlite-operations.js');
      const config = createConfig();
      const filters = {};
      
      // Parse optional filters from command line args
      const args = process.argv.slice(2);
      if (args.includes('--status')) {
        const statusIdx = args.indexOf('--status');
        if (args[statusIdx + 1]) filters.syncStatus = args[statusIdx + 1];
      }
      if (args.includes('--limit')) {
        const limitIdx = args.indexOf('--limit');
        if (args[limitIdx + 1]) filters.limit = parseInt(args[limitIdx + 1]);
      }
      
      const logs = await TE.getOrElse(() => [])(getRingbaSyncLogs(config)(filters))();
      
      if (!Array.isArray(logs) || logs.length === 0) {
        console.log('[INFO] No logs found');
      } else {
        console.log(`\n[INFO] Found ${logs.length} log entries:\n`);
        console.table(logs.map(log => ({
          id: log.id,
          'Campaign Call ID': log.campaign_call_id,
          'Caller ID': log.caller_id,
          'Adjustment Amount': log.adjustment_amount,
          'Sync Status': log.sync_status,
          'Ringba Call ID': log.ringba_inbound_call_id || 'N/A',
          'Attempted At': new Date(log.sync_attempted_at).toLocaleString(),
          'Error': log.error_message || 'N/A'
        })));
      }
      process.exit(0);
    } else if (command === 'run-all' || command === 'all') {
      console.log('[INFO] Running all services sequentially...');
      console.log('[INFO] This will run:');
      console.log('  1. Historical data service (past 10 days)');
      console.log('  2. Current day service');
      console.log('  3. Ringba sync service');
      console.log('');
      
      const config = createConfig();
      const results = {
        historical: null,
        current: null,
        historicalAPI: null,
        currentAPI: null,
        ringbaSync: null
      };
      
      // 1. Historical data service (STATIC)
      try {
        console.log('[INFO] [1/5] Running historical data service (STATIC)...');
        const historicalResult = await TE.getOrElse(() => {
          throw new Error('Historical service execution failed');
        })(runHistoricalService())();
        results.historical = { success: true, result: historicalResult };
        console.log('[SUCCESS] [1/5] Historical service (STATIC) completed');
        console.log('  - Date range:', historicalResult.dateRange);
        console.log('  - Total calls:', historicalResult.summary.totalCalls);
        console.log('  - Adjustments applied:', historicalResult.summary.adjustmentsApplied);
      } catch (error) {
        results.historical = { success: false, error: error.message };
        console.log('[ERROR] [1/5] Historical service (STATIC) failed:', error.message);
      }
      
      console.log('');
      
      // 2. Current day service (STATIC)
      try {
        console.log('[INFO] [2/5] Running current day service (STATIC)...');
        const currentResult = await TE.getOrElse(() => {
          throw new Error('Current day service execution failed');
        })(runCurrentDayService())();
        results.current = { success: true, result: currentResult };
        console.log('[SUCCESS] [2/5] Current day service (STATIC) completed');
        console.log('  - Date range:', currentResult.dateRange);
        console.log('  - Total calls:', currentResult.summary.totalCalls);
        console.log('  - Adjustments applied:', currentResult.summary.adjustmentsApplied);
      } catch (error) {
        results.current = { success: false, error: error.message };
        console.log('[ERROR] [2/5] Current day service (STATIC) failed:', error.message);
      }
      
      console.log('');
      
      // 3. Historical data service (API)
      try {
        console.log('[INFO] [3/5] Running historical data service (API)...');
        const historicalAPIResult = await TE.getOrElse(() => {
          throw new Error('Historical API service execution failed');
        })(scrapeHistoricalDataAPI(config))();
        results.historicalAPI = { success: true, result: historicalAPIResult };
        console.log('[SUCCESS] [3/5] Historical service (API) completed');
        console.log('  - Date range:', historicalAPIResult.dateRange);
        console.log('  - Total calls:', historicalAPIResult.summary.totalCalls);
      } catch (error) {
        results.historicalAPI = { success: false, error: error.message };
        console.log('[ERROR] [3/5] Historical service (API) failed:', error.message);
      }
      
      console.log('');
      
      // 4. Current day service (API)
      try {
        console.log('[INFO] [4/5] Running current day service (API)...');
        const currentAPIResult = await TE.getOrElse(() => {
          throw new Error('Current day API service execution failed');
        })(scrapeCurrentDayDataAPI(config))();
        results.currentAPI = { success: true, result: currentAPIResult };
        console.log('[SUCCESS] [4/5] Current day service (API) completed');
        console.log('  - Date range:', currentAPIResult.dateRange);
        console.log('  - Total calls:', currentAPIResult.summary.totalCalls);
      } catch (error) {
        results.currentAPI = { success: false, error: error.message };
        console.log('[ERROR] [4/5] Current day service (API) failed:', error.message);
      }
      
      console.log('');
      
      // 5. Ringba sync service (all categories)
      try {
        console.log('[INFO] [5/5] Running Ringba sync service (all categories)...');
        const { syncAdjustmentsToRingba } = await import('./services/ringba-sync.js');
        const ringbaEither = await syncAdjustmentsToRingba(config)(null)(); // null = all categories
        
        if (ringbaEither._tag === 'Right') {
          const ringbaResult = ringbaEither.right;
          results.ringbaSync = { success: true, result: ringbaResult };
          console.log('[SUCCESS] [5/5] Ringba sync completed');
          console.log('  - Synced:', ringbaResult.synced || 0);
          console.log('  - Failed:', ringbaResult.failed || 0);
          console.log('  - Skipped:', ringbaResult.skipped || 0);
        } else {
          const error = ringbaEither.left;
          const errorMsg = error instanceof Error ? error.message : (typeof error === 'string' ? error : JSON.stringify(error));
          results.ringbaSync = { success: false, error: errorMsg };
          console.log('[ERROR] [5/5] Ringba sync failed:', errorMsg);
        }
      } catch (error) {
        results.ringbaSync = { success: false, error: error.message };
        console.log('[ERROR] [5/5] Ringba sync failed:', error.message);
      }
      
      console.log('');
      console.log('=== ALL SERVICES COMPLETED ===');
      console.log('Summary:');
      console.log(`  Historical (STATIC): ${results.historical?.success ? '✓ Success' : '✗ Failed'}`);
      console.log(`  Current Day (STATIC): ${results.current?.success ? '✓ Success' : '✗ Failed'}`);
      console.log(`  Historical (API): ${results.historicalAPI?.success ? '✓ Success' : '✗ Failed'}`);
      console.log(`  Current Day (API): ${results.currentAPI?.success ? '✓ Success' : '✗ Failed'}`);
      console.log(`  Ringba Sync: ${results.ringbaSync?.success ? '✓ Success' : '✗ Failed'}`);
      
      const allSuccess = results.historical?.success && 
                        results.current?.success && 
                        results.historicalAPI?.success &&
                        results.currentAPI?.success &&
                        results.ringbaSync?.success;
      
      if (allSuccess) {
        console.log('[SUCCESS] All services completed successfully!');
      } else {
        console.log('[WARNING] Some services failed. Check the logs above for details.');
      }
      
      process.exit(allSuccess ? 0 : 1);
      
    } else if (command === 'scrape' || command === 'run') {
      console.log('[INFO] Starting eLocal scraper service...');
      
      const result = await TE.getOrElse(() => {
        throw new Error('Service execution failed');
      })(runService())();
      
      console.log('[SUCCESS] Service completed successfully');
      console.log('Result:', result);
      
      process.exit(0);
    } else {
      console.log('Usage:');
      console.log('  npm start                    - Run scraper once');
      console.log('  npm start scrape             - Run scraper once');
      console.log('  npm start run-all            - Run all services sequentially (STATIC + API + ringba)');
      console.log('  npm start historical         - Run historical data service (STATIC, past 10 days)');
      console.log('  npm start current            - Run current day service (STATIC)');
      console.log('  npm start historical-api     - Run historical data service (API, past 10 days)');
      console.log('  npm start current-api       - Run current day service (API)');
      console.log('  npm start ringba-sync       - Run Ringba sync (all categories)');
      console.log('  npm start ringba-sync --category STATIC  - Run Ringba sync (STATIC only)');
      console.log('  npm start ringba-sync --category API      - Run Ringba sync (API only)');
      console.log('  npm start revenue-sync      - Sync revenue summary (Ringba + Elocal by date/category)');
      console.log('  npm start multi-scheduler    - Start multi-scheduler (scheduled services)');
      console.log('  npm start scheduler          - Start legacy scheduler service');
      console.log('  npm run refresh-auth         - Refresh auth session (3-day TTL)');
      console.log('  npm run ringba-sync          - Sync adjustments to Ringba');
      console.log('  npm run ringba-logs          - View Ringba sync logs (use --status success/--limit 10)');
      console.log('  npm run dev                  - Run scraper in development mode');
      process.exit(0);
    }
  } catch (error) {
    console.error('[ERROR] Service failed:', error.message);
    process.exit(1);
  }
};

// Export for testing and programmatic use
export {
  scrapeElocalData,
  initializeDatabase,
  runService,
  runSchedulerService,
  runHistoricalService,
  runCurrentDayService,
  runMultiSchedulerService,
  createConfig
};

// Run if called directly (check if this is the main module)
const isMainModule = () => {
  const modulePath = fileURLToPath(import.meta.url);
  const processPath = argv[1];
  return modulePath === processPath || (processPath && processPath.includes('index.js'));
};

if (isMainModule()) {
  main();
}
