// Script to fetch a single category for 2025-11-14
import { createConfig } from './src/index.js';
import { initializeDatabase } from './src/database/sqlite-operations.js';
import { scrapeElocalDataWithDateRange } from './src/services/elocal-services.js';
import { formatDateForElocal, formatDateForURL } from './src/utils/date-utils.js';
import * as TE from 'fp-ts/lib/TaskEither.js';
import * as E from 'fp-ts/lib/Either.js';
import { optimizedConfig } from './src/config/optimized-config.js';

const category = process.argv[2] || 'STATIC'; // STATIC or API

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
    console.log(`[INFO] Fetching ${category} category for 2025-11-14...\n`);
    
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
    console.log(`[INFO] Date range: ${dateRange.startDateFormatted}\n`);
    
    // Fetch the category
    const result = await TE.getOrElse(() => {
      throw new Error(`${category} category scraping failed`);
    })(scrapeElocalDataWithDateRange(validConfig)(dateRange)('current')(category))();
    
    console.log('\n========================================');
    console.log(`✅ ${category} Category Completed`);
    console.log('========================================');
    console.log(`Total calls: ${result.summary.totalCalls}`);
    console.log(`Total payout: $${result.summary.totalPayout.toFixed(2)}`);
    console.log(`Unique callers: ${result.summary.uniqueCallers}`);
    console.log(`Database: ${result.databaseResults.callsInserted} inserted, ${result.databaseResults.callsUpdated} updated`);
    
    // Verify totals
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(validConfig.dbPath);
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as count,
        ROUND(SUM(payout), 2) as total_payout
      FROM elocal_call_data
      WHERE date(date_of_call) = '2025-11-14' AND category = ?
    `).get(category);
    
    console.log(`\nDatabase verification:`);
    console.log(`  ${category}: ${stats.count} calls, Total: $${parseFloat(stats.total_payout || 0).toFixed(2)}`);
    
    db.close();
    
    process.exit(0);
  } catch (error) {
    console.error(`[ERROR] Failed:`, error.message);
    console.error(error.stack);
    process.exit(1);
  }
};

main();

