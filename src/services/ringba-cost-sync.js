// Service to fetch and save Ringba cost data by target ID
import * as E from 'fp-ts/lib/Either.js';
import * as TE from 'fp-ts/lib/TaskEither.js';
import { getCallsByTargetId, TARGET_IDS, getCategoryFromTargetId } from '../http/ringba-target-calls.js';
import { withDatabase, dbOps } from '../database/sqlite-operations.js';

/**
 * Helper function to parse date from MM/DD/YYYY format to YYYY-MM-DD
 */
const parseDate = (dateStr) => {
  if (!dateStr) return null;
  const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    const [, month, day, year] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  // Try standard date parsing as fallback
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch (error) {
    // Ignore
  }
  return null;
};

/**
 * Get dates that need to be synced (dates that don't have data yet)
 */
const getDatesToSync = async (db, startDate, endDate) => {
  // Get all dates that already have data
  const existingDatesEither = await db.getRingbaCostDataDates()();
  const existingDates = existingDatesEither._tag === 'Right' 
    ? new Set(existingDatesEither.right) 
    : new Set();
  
  // Generate all dates in the range
  const datesToSync = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    if (!existingDates.has(dateStr)) {
      datesToSync.push(dateStr);
    }
  }
  
  return datesToSync;
};

/**
 * Fetch and save Ringba cost data for all target IDs
 * Only fetches data for dates that don't already exist in the database
 * @param {Object} config - Application configuration
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Promise<Either<Error, {success, summary}>>}
 */
export const syncRingbaCostData = (config) => (startDate, endDate) =>
  TE.tryCatch(
    async () => {
      console.log('[Ringba Cost Sync] Starting Ringba cost data sync...');
      console.log(`[Ringba Cost Sync] Date range: ${startDate} to ${endDate}`);
      
      const accountId = config.ringbaAccountId;
      const apiToken = config.ringbaApiToken;
      
      if (!accountId || !apiToken) {
        throw new Error('Ringba account ID and API token are required');
      }
      
      // Initialize database to ensure table exists
      const { initializeDatabase } = await import('../database/sqlite-operations.js');
      await TE.getOrElse(() => {
        throw new Error('Failed to initialize database');
      })(initializeDatabase(config))();
      
      const db = dbOps(config);
      
      // Get dates that need to be synced (dates without existing data)
      const datesToSync = await getDatesToSync(db, startDate, endDate);
      
      if (datesToSync.length === 0) {
        console.log(`[Ringba Cost Sync] ✅ All dates from ${startDate} to ${endDate} already have data. Skipping sync.`);
        return {
          success: true,
          summary: {
            totalCalls: 0,
            totalCost: 0,
            totalRevenue: 0,
            byCategory: {
              STATIC: { calls: 0, cost: 0, revenue: 0 },
              API: { calls: 0, cost: 0, revenue: 0 }
            },
            byTarget: {},
            saved: {
              inserted: 0,
              updated: 0,
              total: 0
            },
            skippedDates: `${startDate} to ${endDate} (all dates already have data)`
          }
        };
      }
      
      // Use the first and last date from datesToSync as the actual range to fetch
      const actualStartDate = datesToSync[0];
      const actualEndDate = datesToSync[datesToSync.length - 1];
      
      console.log(`[Ringba Cost Sync] Found ${datesToSync.length} dates that need syncing (out of ${Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1} total dates)`);
      console.log(`[Ringba Cost Sync] Fetching data for date range: ${actualStartDate} to ${actualEndDate}`);
      
      const allCostData = [];
      const summary = {
        totalCalls: 0,
        totalCost: 0,
        totalRevenue: 0,
        byCategory: {
          STATIC: { calls: 0, cost: 0, revenue: 0 },
          API: { calls: 0, cost: 0, revenue: 0 }
        },
        byTarget: {},
        skippedDates: datesToSync.length < (Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1) 
          ? `${startDate} to ${endDate} (some dates already have data)` 
          : null
      };
      
      // Fetch data for each target ID
      for (const [targetId, targetName] of Object.entries(TARGET_IDS)) {
        const category = getCategoryFromTargetId(targetId);
        console.log(`[Ringba Cost Sync] Fetching data for target: ${targetId} (${targetName}) - Category: ${category}`);
        
        try {
          const resultEither = await getCallsByTargetId(accountId, apiToken)(targetId, {
            startDate: actualStartDate,
            endDate: actualEndDate,
            pageSize: 1000
          })();
          
          if (resultEither._tag === 'Right') {
            const result = resultEither.right;
            const { calls } = result;
            
            console.log(`[Ringba Cost Sync] Retrieved ${calls.length} calls for target ${targetId}`);
            
            // Transform calls to cost data format
            // Filter out calls for dates that already have data
            for (const call of calls) {
              const callDate = parseDate(call.callDate);
              
              // Skip if this date already has data
              if (!callDate || !datesToSync.includes(callDate)) {
                continue;
              }
              
              const costData = {
                inboundCallId: call.inboundCallId,
                targetId: targetId,
                targetName: call.targetName || targetName,
                category: category,
                callDate: call.callDate,
                callerId: call.callerId,
                revenue: call.revenue || 0,
                cost: call.ringbaCost || call.payout || 0, // Use ringbaCost if available, fallback to payout
                campaignName: call.campaignName,
                publisherName: call.publisherName,
                inboundPhoneNumber: call.inboundPhoneNumber
              };
              
              allCostData.push(costData);
              
              // Update summary
              summary.totalCalls++;
              summary.totalCost += costData.cost;
              summary.totalRevenue += costData.revenue;
              
              if (!summary.byCategory[category]) {
                summary.byCategory[category] = { calls: 0, cost: 0, revenue: 0 };
              }
              summary.byCategory[category].calls++;
              summary.byCategory[category].cost += costData.cost;
              summary.byCategory[category].revenue += costData.revenue;
              
              if (!summary.byTarget[targetId]) {
                summary.byTarget[targetId] = {
                  targetName,
                  category,
                  calls: 0,
                  cost: 0,
                  revenue: 0
                };
              }
              summary.byTarget[targetId].calls++;
              summary.byTarget[targetId].cost += costData.cost;
              summary.byTarget[targetId].revenue += costData.revenue;
            }
          } else {
            const error = resultEither.left;
            console.error(`[Ringba Cost Sync] Failed to fetch data for target ${targetId}:`, error.message);
            throw error;
          }
        } catch (error) {
          console.error(`[Ringba Cost Sync] Error processing target ${targetId}:`, error.message);
          throw error;
        }
      }
      
      if (allCostData.length === 0) {
        console.log(`[Ringba Cost Sync] No new data to save (all calls were for dates that already have data)`);
        return {
          success: true,
          summary: {
            ...summary,
            saved: {
              inserted: 0,
              updated: 0,
              total: 0
            }
          }
        };
      }
      
      // Save to database
      console.log(`[Ringba Cost Sync] Saving ${allCostData.length} records to database...`);
      const saveResult = await db.batchUpsertRingbaCostData(allCostData)();
      
      if (saveResult._tag === 'Right') {
        const result = saveResult.right;
        console.log(`[Ringba Cost Sync] ✅ Saved ${result.inserted} new records, updated ${result.updated} existing records`);
        
        return {
          success: true,
          summary: {
            ...summary,
            saved: {
              inserted: result.inserted,
              updated: result.updated,
              total: result.inserted + result.updated
            }
          }
        };
      } else {
        throw new Error(`Failed to save data: ${saveResult.left.message}`);
      }
    },
    (error) => new Error(`Ringba cost sync failed: ${error.message}`)
  );

/**
 * Sync Ringba cost data for a specific date range
 * @param {Object} config - Application configuration
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 */
export const syncRingbaCostForDateRange = (config) => (startDate, endDate) =>
  syncRingbaCostData(config)(startDate, endDate);

/**
 * Sync Ringba cost data for last N days
 * @param {Object} config - Application configuration
 * @param {number} days - Number of days to sync (default: 30)
 */
export const syncRingbaCostForLastDays = (config) => (days = 30) => {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  
  return syncRingbaCostData(config)(
    start.toISOString().split('T')[0],
    end.toISOString().split('T')[0]
  );
};

