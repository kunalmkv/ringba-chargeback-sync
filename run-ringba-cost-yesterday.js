// Script to run ringba-cost-sync service for previous day (yesterday)
import { createConfig } from './src/index.js';
import { syncRingbaCostForDateRange } from './src/services/ringba-cost-sync.js';
import * as TE from 'fp-ts/lib/TaskEither.js';
import * as E from 'fp-ts/lib/Either.js';
import { optimizedConfig } from './src/config/optimized-config.js';

// Get yesterday's date range (start and end of day)
// Returns date strings in YYYY-MM-DD format
// Note: To cover the full day, we need to pass the end date as the next day at midnight
// This ensures the Ringba API query covers the entire 24-hour period
const getYesterdayDateRange = () => {
  // Get yesterday in local time
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  
  // Format as YYYY-MM-DD for the sync function
  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  const startDate = formatDate(yesterday);
  
  // End date should be the next day at midnight to cover the full day
  // This ensures the Ringba API query covers from 00:00:00 to 23:59:59.999
  const nextDay = new Date(yesterday);
  nextDay.setDate(nextDay.getDate() + 1);
  const endDate = formatDate(nextDay);
  
  return {
    startDate: startDate,
    endDate: endDate
  };
};

const main = async () => {
  try {
    console.log('[INFO] Running Ringba cost sync service for YESTERDAY...');
    
    const config = createConfig();
    const validConfig = E.fold(
      (error) => {
        console.error('[ERROR] Configuration validation failed:', error.message);
        process.exit(1);
        return null;
      },
      (cfg) => cfg
    )(optimizedConfig.validate(config));
    
    if (!validConfig) {
      process.exit(1);
    }
    
    // Get yesterday's date range
    const dateRange = getYesterdayDateRange();
    console.log(`[INFO] Date range: ${dateRange.startDate} to ${dateRange.endDate} (yesterday - end date is next day at midnight to cover full day)`);
    
    // Run the Ringba cost sync service for yesterday
    const resultEither = await syncRingbaCostForDateRange(validConfig)(dateRange.startDate, dateRange.endDate)();
    
    if (resultEither._tag === 'Right') {
      const result = resultEither.right;
      console.log('\n========================================');
      console.log('✅ Ringba Cost Sync Completed (Yesterday)');
      console.log('========================================');
      console.log(`Date: ${dateRange.startDate} (yesterday)`);
      console.log(`Total Calls Processed: ${result.summary.totalCalls}`);
      console.log(`Total Cost: $${result.summary.totalCost.toFixed(2)}`);
      console.log(`Total Revenue: $${result.summary.totalRevenue.toFixed(2)}`);
      console.log('');
      console.log('By Category:');
      if (result.summary.byCategory) {
        console.log(`  STATIC: ${result.summary.byCategory.STATIC?.calls || 0} calls, Cost: $${(result.summary.byCategory.STATIC?.cost || 0).toFixed(2)}, Revenue: $${(result.summary.byCategory.STATIC?.revenue || 0).toFixed(2)}`);
        console.log(`  API: ${result.summary.byCategory.API?.calls || 0} calls, Cost: $${(result.summary.byCategory.API?.cost || 0).toFixed(2)}, Revenue: $${(result.summary.byCategory.API?.revenue || 0).toFixed(2)}`);
      }
      console.log('');
      console.log('By Target:');
      if (result.summary.byTarget) {
        for (const [targetId, data] of Object.entries(result.summary.byTarget)) {
          console.log(`  ${data.targetName} (${data.category}): ${data.calls} calls, Cost: $${data.cost.toFixed(2)}, Revenue: $${data.revenue.toFixed(2)}`);
        }
      }
      console.log('');
      console.log('Database:');
      console.log(`  Inserted: ${result.summary.saved?.inserted || 0}`);
      console.log(`  Updated: ${result.summary.saved?.updated || 0}`);
      console.log(`  Total: ${result.summary.saved?.total || 0}`);
      console.log(`  Targets Processed: ${result.summary.targetsProcessed || 0}`);
      console.log(`  Targets Failed: ${result.summary.targetsFailed || 0}`);
      console.log('========================================\n');
      
      process.exit(0);
    } else {
      const error = resultEither.left;
      const errorMsg = error instanceof Error ? error.message : (typeof error === 'string' ? error : JSON.stringify(error));
      console.error('[ERROR] Ringba cost sync failed:', errorMsg);
      process.exit(1);
    }
  } catch (error) {
    console.error('[ERROR] Service failed:', error.message);
    process.exit(1);
  }
};

main();

