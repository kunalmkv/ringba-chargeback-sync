// Complete re-fetch script for 2025-11-14 with duplicate handling
import { createConfig } from './src/index.js';
import { initializeDatabase } from './src/database/sqlite-operations.js';
import { scrapeElocalDataWithDateRange } from './src/services/elocal-services.js';
import { formatDateForElocal, formatDateForURL } from './src/utils/date-utils.js';
import * as TE from 'fp-ts/lib/TaskEither.js';
import * as E from 'fp-ts/lib/Either.js';
import { optimizedConfig } from './src/config/optimized-config.js';
import Database from 'better-sqlite3';

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
    console.log('========================================');
    console.log('Complete Re-fetch for 2025-11-14');
    console.log('========================================\n');
    
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
    console.log(`[INFO] Target date: 2025-11-14\n`);
    
    // Delete existing data for this date
    console.log('[INFO] Step 1: Deleting existing data for 2025-11-14...');
    const db = new Database(validConfig.dbPath);
    db.pragma('foreign_keys = OFF');
    
    // Delete related records
    const deleteLogs = db.prepare(`
      DELETE FROM ringba_sync_logs 
      WHERE campaign_call_id IN (
        SELECT id FROM elocal_call_data WHERE date(date_of_call) = '2025-11-14'
      )
    `).run();
    console.log(`  Deleted ${deleteLogs.changes} ringba_sync_logs records`);
    
    // Delete main records
    const deleteResult = db.prepare(`
      DELETE FROM elocal_call_data 
      WHERE date(date_of_call) = '2025-11-14'
    `).run();
    console.log(`  Deleted ${deleteResult.changes} elocal_call_data records`);
    
    db.pragma('foreign_keys = ON');
    db.close();
    console.log('  ✅ Existing data deleted\n');
    
    // Re-fetch STATIC category
    console.log('========================================');
    console.log('Step 2: Re-fetching STATIC category...');
    console.log('========================================\n');
    const staticResult = await TE.getOrElse(() => {
      throw new Error('STATIC category scraping failed');
    })(scrapeElocalDataWithDateRange(validConfig)(dateRange)('current')('STATIC'))();
    
    console.log(`\n✅ STATIC completed: ${staticResult.summary.totalCalls} calls, $${staticResult.summary.totalPayout.toFixed(2)} total\n`);
    
    // Wait before fetching API
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Re-fetch API category
    console.log('========================================');
    console.log('Step 3: Re-fetching API category...');
    console.log('========================================\n');
    const apiResult = await TE.getOrElse(() => {
      throw new Error('API category scraping failed');
    })(scrapeElocalDataWithDateRange(validConfig)(dateRange)('current')('API'))();
    
    console.log(`\n✅ API completed: ${apiResult.summary.totalCalls} calls, $${apiResult.summary.totalPayout.toFixed(2)} total\n`);
    
    // Final verification
    console.log('========================================');
    console.log('Final Verification');
    console.log('========================================\n');
    const verifyDb = new Database(validConfig.dbPath);
    const stats = verifyDb.prepare(`
      SELECT 
        category,
        COUNT(*) as count,
        ROUND(SUM(payout), 2) as total_payout
      FROM elocal_call_data
      WHERE date(date_of_call) = '2025-11-14'
      GROUP BY category
    `).all();
    
    let staticTotal = 0;
    let apiTotal = 0;
    for (const stat of stats) {
      console.log(`${stat.category}: ${stat.count} calls, Total: $${parseFloat(stat.total_payout || 0).toFixed(2)}`);
      if (stat.category === 'STATIC') staticTotal = parseFloat(stat.total_payout || 0);
      if (stat.category === 'API') apiTotal = parseFloat(stat.total_payout || 0);
    }
    
    console.log('\nExpected vs Actual:');
    console.log(`  STATIC: Expected $282.10, Actual $${staticTotal.toFixed(2)}, Difference: $${(staticTotal - 282.10).toFixed(2)}`);
    console.log(`  API: Expected $385.50, Actual $${apiTotal.toFixed(2)}, Difference: $${(apiTotal - 385.50).toFixed(2)}`);
    
    // Check for duplicates
    const duplicates = verifyDb.prepare(`
      SELECT 
        a.caller_id,
        a.date_of_call as api_time,
        a.payout as api_payout,
        s.date_of_call as static_time,
        s.payout as static_payout
      FROM elocal_call_data a
      INNER JOIN elocal_call_data s ON a.caller_id = s.caller_id
      WHERE date(a.date_of_call) = '2025-11-14'
        AND date(s.date_of_call) = '2025-11-14'
        AND a.category = 'API'
        AND s.category = 'STATIC'
        AND a.payout > 0
        AND s.payout > 0
    `).all();
    
    if (duplicates.length > 0) {
      console.log(`\n⚠️  Found ${duplicates.length} duplicate caller IDs in both categories:`);
      let dupApiTotal = 0;
      for (const dup of duplicates) {
        console.log(`  ${dup.caller_id}: API $${dup.api_payout} (${dup.api_time}) + STATIC $${dup.static_payout} (${dup.static_time})`);
        dupApiTotal += parseFloat(dup.api_payout);
      }
      console.log(`  Total duplicates in API: $${dupApiTotal.toFixed(2)}`);
      console.log(`  If removed from API, API total would be: $${(apiTotal - dupApiTotal).toFixed(2)}`);
    }
    
    verifyDb.close();
    
    console.log('\n========================================');
    console.log('✅ Re-fetch completed!');
    console.log('========================================\n');
    
    process.exit(0);
  } catch (error) {
    console.error('[ERROR] Re-fetch failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
};

main();

