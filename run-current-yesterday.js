// Script to run current day service for previous day (yesterday)
import { createConfig } from './src/index.js';
import { initializeDatabase } from './src/database/sqlite-operations.js';
import { scrapeElocalDataWithDateRange } from './src/services/elocal-services.js';
import { formatDateForElocal, formatDateForURL } from './src/utils/date-utils.js';
import * as TE from 'fp-ts/lib/TaskEither.js';
import * as E from 'fp-ts/lib/Either.js';
import { optimizedConfig } from './src/config/optimized-config.js';

// Get yesterday's date range
const getYesterdayRange = () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  
  const endDate = new Date(yesterday);
  endDate.setHours(23, 59, 59, 999);
  
  return {
    startDate: yesterday,
    endDate: endDate,
    startDateFormatted: formatDateForElocal(yesterday),
    endDateFormatted: formatDateForElocal(yesterday),
    startDateURL: formatDateForURL(yesterday),
    endDateURL: formatDateForURL(yesterday),
    days: 1
  };
};

const main = async () => {
  try {
    console.log('[INFO] Running current day service for YESTERDAY...');
    
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
    
    // Get yesterday's date range
    const dateRange = getYesterdayRange();
    console.log(`[INFO] Date range: ${dateRange.startDateFormatted} to ${dateRange.endDateFormatted} (1 day)`);
    
    // Run the scraping service for yesterday using the date range directly
    const result = await TE.getOrElse(() => {
      throw new Error('Current day service execution failed');
    })(scrapeElocalDataWithDateRange(validConfig)(dateRange)('current')('STATIC'))();
    
    console.log('[SUCCESS] Current day service for YESTERDAY completed successfully');
    console.log('Result:', {
      dateRange: result.dateRange,
      summary: result.summary,
      databaseResults: result.databaseResults
    });
    
    process.exit(0);
  } catch (error) {
    console.error('[ERROR] Service failed:', error.message);
    process.exit(1);
  }
};

main();

