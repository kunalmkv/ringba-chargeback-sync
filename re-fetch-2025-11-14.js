// Script to re-fetch eLocal data for 2025-11-14 for both STATIC and API categories
import { createConfig } from './src/index.js';
import { initializeDatabase } from './src/database/sqlite-operations.js';
import { scrapeElocalDataWithDateRange } from './src/services/elocal-services.js';
import { formatDateForElocal, formatDateForURL } from './src/utils/date-utils.js';
import * as TE from 'fp-ts/lib/TaskEither.js';
import * as E from 'fp-ts/lib/Either.js';
import { optimizedConfig } from './src/config/optimized-config.js';

// Get date range for 2025-11-14
const getDateRange = () => {
  const targetDate = new Date('2025-11-14');
  targetDate.setHours(0, 0, 0, 0);
  
  const endDate = new Date(targetDate);
  endDate.setHours(23, 59, 59, 999);
  
  return {
    startDate: targetDate,
    endDate: endDate,
    startDateFormatted: formatDateForElocal(targetDate),
    endDateFormatted: formatDateForElocal(targetDate),
    startDateURL: formatDateForURL(targetDate),
    endDateURL: formatDateForURL(targetDate),
    days: 1
  };
};

const main = async () => {
  try {
    console.log('[INFO] Re-fetching eLocal data for 2025-11-14...');
    console.log('[INFO] This will re-scrape both STATIC and API categories\n');
    
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
    
    // Initialize database
    await TE.getOrElse(() => {
      throw new Error('Failed to initialize database');
    })(initializeDatabase(validConfig))();
    
    // Get date range
    const dateRange = getDateRange();
    console.log(`[INFO] Date range: ${dateRange.startDateFormatted} to ${dateRange.endDateFormatted} (1 day)\n`);
    
    // First, delete existing data for this date to avoid duplicates
    // Need to delete related records first due to foreign key constraints
    console.log('[INFO] Deleting existing data for 2025-11-14...');
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(validConfig.dbPath);
    
    // Disable foreign key checks temporarily
    db.pragma('foreign_keys = OFF');
    
    // Delete related records first
    const deleteLogs = db.prepare(`
      DELETE FROM ringba_sync_logs 
      WHERE campaign_call_id IN (
        SELECT id FROM elocal_call_data WHERE date(date_of_call) = '2025-11-14'
      )
    `).run();
    console.log(`[INFO] Deleted ${deleteLogs.changes} related ringba_sync_logs records`);
    
    // Now delete the main records
    const deleteResult = db.prepare(`
      DELETE FROM elocal_call_data 
      WHERE date(date_of_call) = '2025-11-14'
    `).run();
    console.log(`[INFO] Deleted ${deleteResult.changes} existing elocal_call_data records for 2025-11-14`);
    
    // Re-enable foreign key checks
    db.pragma('foreign_keys = ON');
    db.close();
    console.log('');
    
    // Re-fetch STATIC category
    console.log('========================================');
    console.log('Re-fetching STATIC category...');
    console.log('========================================');
    const staticResult = await TE.getOrElse(() => {
      throw new Error('STATIC category scraping failed');
    })(scrapeElocalDataWithDateRange(validConfig)(dateRange)('current')('STATIC'))();
    
    console.log('\n[SUCCESS] STATIC category completed');
    console.log(`  Total calls: ${staticResult.summary.totalCalls}`);
    console.log(`  Total payout: $${staticResult.summary.totalPayout.toFixed(2)}\n`);
    
    // Wait a bit before fetching API
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Re-fetch API category
    console.log('========================================');
    console.log('Re-fetching API category...');
    console.log('========================================');
    const apiResult = await TE.getOrElse(() => {
      throw new Error('API category scraping failed');
    })(scrapeElocalDataWithDateRange(validConfig)(dateRange)('current')('API'))();
    
    console.log('\n[SUCCESS] API category completed');
    console.log(`  Total calls: ${apiResult.summary.totalCalls}`);
    console.log(`  Total payout: $${apiResult.summary.totalPayout.toFixed(2)}\n`);
    
    // Verify totals
    console.log('========================================');
    console.log('Verification Summary');
    console.log('========================================');
    const verifyDb = new Database(validConfig.dbPath);
    const stats = verifyDb.prepare(`
      SELECT 
        category,
        COUNT(*) as count,
        SUM(payout) as total_payout
      FROM elocal_call_data
      WHERE date(date_of_call) = '2025-11-14'
      GROUP BY category
    `).all();
    
    console.log('\nDatabase totals after re-fetch:');
    let staticTotal = 0;
    let apiTotal = 0;
    for (const stat of stats) {
      console.log(`  ${stat.category}: ${stat.count} calls, Total payout: $${parseFloat(stat.total_payout || 0).toFixed(2)}`);
      if (stat.category === 'STATIC') staticTotal = parseFloat(stat.total_payout || 0);
      if (stat.category === 'API') apiTotal = parseFloat(stat.total_payout || 0);
    }
    
    console.log('\nExpected vs Actual:');
    console.log(`  STATIC: Expected $282.10, Actual $${staticTotal.toFixed(2)}, Difference: $${(staticTotal - 282.10).toFixed(2)}`);
    console.log(`  API: Expected $385.50, Actual $${apiTotal.toFixed(2)}, Difference: $${(apiTotal - 385.50).toFixed(2)}`);
    
    verifyDb.close();
    
    console.log('\n[SUCCESS] Re-fetch completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('[ERROR] Re-fetch failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
};

main();

