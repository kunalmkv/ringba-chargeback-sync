// Service to sync and aggregate Ringba and Elocal revenue by date and category
import * as E from 'fp-ts/lib/Either.js';
import * as TE from 'fp-ts/lib/TaskEither.js';
import Database from 'better-sqlite3';
import { createPostgresPool, getRingbaCallData, closePostgresPool } from '../database/postgres-client.js';
import { withDatabase, dbOps } from '../database/sqlite-operations.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get Elocal call data from SQLite
const getElocalCallData = (config) => (startDate, endDate) =>
  withDatabase(config)(async (db) => {
    // SQLite date handling - date_of_call is stored as TEXT
    // Extract date part and compare
    // Include timestamp for more precise matching with Ringba calls
    const query = `
      SELECT 
        date(date_of_call) as date,
        caller_id,
        category,
        payout,
        ringba_inbound_call_id,
        date_of_call,
        datetime(date_of_call) as call_timestamp
      FROM elocal_call_data
      WHERE date(date_of_call) >= date(?) AND date(date_of_call) <= date(?)
      ORDER BY date_of_call ASC;
    `;
    
    const stmt = db.prepare(query);
    const rows = stmt.all(startDate, endDate);
    
    // Normalize date format (SQLite returns dates in YYYY-MM-DD format)
    return rows.map(row => ({
      ...row,
      date: row.date || (row.date_of_call ? row.date_of_call.split('T')[0].split(' ')[0] : null),
      // Parse timestamp for matching
      timestamp: row.call_timestamp ? new Date(row.call_timestamp).getTime() : null
    }));
  });

// Match Ringba calls with Elocal calls to determine category
// Uses caller_id and timestamp for precise matching to determine STATIC or API category
const matchCallsWithCategory = (ringbaCalls, elocalCalls) => {
  // Create lookup maps for efficient matching
  // Map 1: by ringba_inbound_call_id (most reliable)
  const elocalByRingbaId = new Map();
  elocalCalls.forEach(elocal => {
    if (elocal.ringba_inbound_call_id) {
      elocalByRingbaId.set(elocal.ringba_inbound_call_id, elocal);
    }
  });
  
  // Map 2: by caller_id and date (for date-based matching)
  const elocalByCallerAndDate = new Map();
  elocalCalls.forEach(elocal => {
    const key = `${elocal.caller_id}_${elocal.date}`;
    if (!elocalByCallerAndDate.has(key)) {
      elocalByCallerAndDate.set(key, []);
    }
    elocalByCallerAndDate.get(key).push(elocal);
  });
  
  // Map 3: by caller_id only (for timestamp-based matching within same day)
  const elocalByCallerId = new Map();
  elocalCalls.forEach(elocal => {
    if (elocal.caller_id) {
      if (!elocalByCallerId.has(elocal.caller_id)) {
        elocalByCallerId.set(elocal.caller_id, []);
      }
      elocalByCallerId.get(elocal.caller_id).push(elocal);
    }
  });
  
  // Match Ringba calls with Elocal calls
  const matchedCalls = [];
  const TIME_WINDOW_MS = 5 * 60 * 1000; // 5 minutes window for timestamp matching
  
  for (const ringbaCall of ringbaCalls) {
    let matchedElocal = null;
    let matchMethod = null;
    
    // Try matching by inbound_call_id first (most reliable)
    // Note: ringbaCall.inbound_call_id comes from PostgreSQL query (aliased from inboundCallId)
    if (ringbaCall.inbound_call_id) {
      matchedElocal = elocalByRingbaId.get(ringbaCall.inbound_call_id);
      if (matchedElocal) {
        matchMethod = 'inbound_call_id';
      }
    }
    
    // Fallback 1: match by caller_id and timestamp (within 5 minute window)
    // This is more precise than just date matching
    if (!matchedElocal && ringbaCall.caller_id && ringbaCall.timestamp) {
      const candidates = elocalByCallerId.get(ringbaCall.caller_id) || [];
      let bestMatch = null;
      let bestTimeDiff = Infinity;
      
      for (const candidate of candidates) {
        if (candidate.timestamp) {
          const timeDiff = Math.abs(ringbaCall.timestamp - candidate.timestamp);
          if (timeDiff < TIME_WINDOW_MS && timeDiff < bestTimeDiff) {
            bestTimeDiff = timeDiff;
            bestMatch = candidate;
          }
        }
      }
      
      if (bestMatch) {
        matchedElocal = bestMatch;
        matchMethod = 'caller_id_timestamp';
      }
    }
    
    // Fallback 2: match by caller_id and date (if timestamp matching failed)
    // Note: ringbaCall.caller_id comes from PostgreSQL query (aliased from phoneNumber)
    if (!matchedElocal && ringbaCall.caller_id) {
      const key = `${ringbaCall.caller_id}_${ringbaCall.date}`;
      const candidates = elocalByCallerAndDate.get(key) || [];
      
      // If multiple candidates, prefer the one with matching inbound_call_id
      if (candidates.length > 0) {
        if (candidates.length === 1) {
          matchedElocal = candidates[0];
          matchMethod = 'caller_id_date';
        } else {
          // Multiple candidates - try to match by inbound_call_id first
          const exactMatch = candidates.find(c => 
            c.ringba_inbound_call_id === ringbaCall.inbound_call_id
          );
          if (exactMatch) {
            matchedElocal = exactMatch;
            matchMethod = 'caller_id_date_inbound_id';
          } else {
            // If timestamp available, use closest timestamp match
            if (ringbaCall.timestamp) {
              let bestMatch = null;
              let bestTimeDiff = Infinity;
              for (const candidate of candidates) {
                if (candidate.timestamp) {
                  const timeDiff = Math.abs(ringbaCall.timestamp - candidate.timestamp);
                  if (timeDiff < bestTimeDiff) {
                    bestTimeDiff = timeDiff;
                    bestMatch = candidate;
                  }
                }
              }
              matchedElocal = bestMatch || candidates[0];
              matchMethod = 'caller_id_date_timestamp';
            } else {
              matchedElocal = candidates[0]; // Use first if no exact match
              matchMethod = 'caller_id_date_multiple';
            }
          }
        }
      }
    }
    
    // Determine category from matched Elocal call
    let category = null;
    if (matchedElocal) {
      category = matchedElocal.category || 'STATIC'; // Default to STATIC if not set
    } else {
      // If no match found, we can't determine category - skip
      continue; // Skip unmatched calls
    }
    
    // Use latestPayout from PostgreSQL ringba_call_data table
    const ringbaPayout = parseFloat(ringbaCall.payout || ringbaCall.latest_payout || 0);
    const ringbaRevenue = parseFloat(ringbaCall.revenue || 0);
    
    matchedCalls.push({
      date: ringbaCall.date,
      category,
      ringbaRevenue: ringbaRevenue,
      ringbaPayout: ringbaPayout, // This is latestPayout from PostgreSQL
      elocalPayout: matchedElocal ? parseFloat(matchedElocal.payout || 0) : 0,
      matchMethod,
      ringbaInboundCallId: ringbaCall.inbound_call_id,
      callerId: ringbaCall.caller_id
    });
  }
  
  // Also include Elocal calls that don't have matching Ringba calls
  // Track which Ringba inbound_call_ids we've already matched
  const matchedRingbaIds = new Set();
  matchedCalls.forEach(call => {
    // Extract ringba inbound_call_id from the matched call if available
    // We need to track this from the original ringbaCalls
  });
  
  // Create a map of matched elocal calls by their ringba_inbound_call_id
  const matchedElocalByRingbaId = new Set();
  matchedCalls.forEach(call => {
    // Find the elocal call that was matched
    const matchedElocal = elocalCalls.find(e => 
      (e.ringba_inbound_call_id && call.ringbaInboundCallId === e.ringba_inbound_call_id) ||
      (e.caller_id === call.callerId && e.date === call.date)
    );
    if (matchedElocal && matchedElocal.ringba_inbound_call_id) {
      matchedElocalByRingbaId.add(matchedElocal.ringba_inbound_call_id);
    }
  });
  
  for (const elocalCall of elocalCalls) {
    // Skip if this elocal call was already matched
    if (elocalCall.ringba_inbound_call_id && matchedElocalByRingbaId.has(elocalCall.ringba_inbound_call_id)) {
      continue;
    }
    
    // Check if there's a matching Ringba call we haven't processed yet
    const hasMatchingRingba = ringbaCalls.some(r => 
      r.inbound_call_id === elocalCall.ringba_inbound_call_id ||
      (r.caller_id === elocalCall.caller_id && r.date === elocalCall.date)
    );
    
    if (!hasMatchingRingba) {
      // This Elocal call doesn't have a matching Ringba call
      // We still want to include it in the summary
      matchedCalls.push({
        date: elocalCall.date,
        category: elocalCall.category || 'STATIC',
        ringbaRevenue: 0,
        ringbaPayout: 0,
        elocalPayout: parseFloat(elocalCall.payout || 0),
        matchMethod: 'elocal_only'
      });
    }
  }
  
  return matchedCalls;
};

// Aggregate revenue by date and category
// Ringba revenue and payout come from PostgreSQL ringba_call_data table (latestPayout)
// Category (STATIC/API) is determined from Elocal table by matching caller_id and timestamp
const aggregateRevenueByDate = (matchedCalls) => {
  const dailyRevenue = new Map();
  
  for (const call of matchedCalls) {
    const date = call.date;
    
    if (!dailyRevenue.has(date)) {
      dailyRevenue.set(date, {
        date,
        ringbaStaticRevenue: 0,    // Ringba revenue for STATIC category
        ringbaStaticPayout: 0,     // Ringba latestPayout for STATIC category
        ringbaApiRevenue: 0,       // Ringba revenue for API category
        ringbaApiPayout: 0,        // Ringba latestPayout for API category
        elocalStatic: 0,           // Elocal payout for STATIC category
        elocalApi: 0               // Elocal payout for API category
      });
    }
    
    const dayData = dailyRevenue.get(date);
    
    // Aggregate by category (determined from Elocal table)
    if (call.category === 'STATIC') {
      dayData.ringbaStaticRevenue += call.ringbaRevenue;
      dayData.ringbaStaticPayout += call.ringbaPayout;  // latestPayout from PostgreSQL
      dayData.elocalStatic += call.elocalPayout;
    } else if (call.category === 'API') {
      dayData.ringbaApiRevenue += call.ringbaRevenue;
      dayData.ringbaApiPayout += call.ringbaPayout;     // latestPayout from PostgreSQL
      dayData.elocalApi += call.elocalPayout;
    }
  }
  
  // Calculate totals and format for database
  return Array.from(dailyRevenue.values()).map(dayData => ({
    date: dayData.date,
    ringbaStatic: dayData.ringbaStaticPayout,  // Use latestPayout for Ringba Static
    ringbaApi: dayData.ringbaApiPayout,       // Use latestPayout for Ringba API
    elocalStatic: dayData.elocalStatic,
    elocalApi: dayData.elocalApi,
    // Also store revenue for reference (optional, can be added to table if needed)
    ringbaStaticRevenue: dayData.ringbaStaticRevenue,
    ringbaApiRevenue: dayData.ringbaApiRevenue
  }));
};

// Main revenue sync service
export const syncRevenueSummary = (config) => (dateRange = null) =>
  TE.tryCatch(
    async () => {
      console.log('[Revenue Sync] Starting revenue summary sync...');
      
      // Determine date range (default: last 30 days)
      let startDate, endDate;
      if (dateRange) {
        startDate = dateRange.startDate;
        endDate = dateRange.endDate;
      } else {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 30); // Last 30 days
        startDate = start.toISOString().split('T')[0];
        endDate = end.toISOString().split('T')[0];
      }
      
      console.log(`[Revenue Sync] Date range: ${startDate} to ${endDate}`);
      
      // Create PostgreSQL pool
      const postgresConfig = {
        postgresHost: config.postgresHost || 'localhost',
        postgresPort: config.postgresPort || 5434,
        postgresUser: config.postgresUser || 'adi',
        postgresPassword: config.postgresPassword || 'nobodyislove',
        postgresDatabase: config.postgresDatabase || 'postgres'
      };
      
      // Initialize SQLite database (ensures revenue_summary table exists)
      console.log('[Revenue Sync] Initializing SQLite database...');
      const { initializeDatabase } = await import('../database/sqlite-operations.js');
      await TE.getOrElse(() => {
        throw new Error('Failed to initialize database');
      })(initializeDatabase(config))();
      console.log('[Revenue Sync] ✅ SQLite database initialized');
      
      // Get database operations
      const db = dbOps(config);
      
      // Get Ringba cost data from SQLite (ringba_cost_data table - already has categories determined)
      console.log('[Revenue Sync] Fetching Ringba cost data from SQLite (ringba_cost_data table)...');
      const ringbaCostDataEither = await db.getRingbaCostData(startDate, endDate, null)();
      const ringbaCostData = ringbaCostDataEither._tag === 'Right' 
        ? ringbaCostDataEither.right 
        : [];
      console.log(`[Revenue Sync] Found ${ringbaCostData.length} Ringba cost records`);
      
      // Get Elocal call data from SQLite
      console.log('[Revenue Sync] Fetching Elocal call data from SQLite...');
      const elocalCallsEither = await getElocalCallData(config)(startDate, endDate)();
      const elocalCalls = elocalCallsEither._tag === 'Right' 
        ? elocalCallsEither.right 
        : [];
      console.log(`[Revenue Sync] Found ${elocalCalls.length} Elocal calls`);
      
      // Helper function to parse date from ringba_cost_data format (MM/DD/YYYY HH:MM:SS AM/PM)
      const parseRingbaDate = (dateStr) => {
        if (!dateStr) return null;
        try {
          // Try parsing MM/DD/YYYY format
          const date = new Date(dateStr);
          if (!isNaN(date.getTime())) {
            return date.toISOString().split('T')[0]; // Return YYYY-MM-DD
          }
        } catch (error) {
          // If parsing fails, try to extract date parts
          const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
          if (match) {
            const [, month, day, year] = match;
            return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
          }
        }
        return null;
      };
      
      // Aggregate Ringba cost data by date and category
      console.log('[Revenue Sync] Aggregating Ringba cost data by date and category...');
      const ringbaDailyCost = new Map();
      for (const costRecord of ringbaCostData) {
        const date = parseRingbaDate(costRecord.call_date);
        if (!date) {
          console.warn(`[Revenue Sync] Skipping record with invalid date: ${costRecord.call_date}`);
          continue;
        }
        
        if (!ringbaDailyCost.has(date)) {
          ringbaDailyCost.set(date, {
            date,
            ringbaStatic: 0,
            ringbaApi: 0
          });
        }
        
        const dayData = ringbaDailyCost.get(date);
        if (costRecord.category === 'STATIC') {
          dayData.ringbaStatic += parseFloat(costRecord.cost || 0);
        } else if (costRecord.category === 'API') {
          dayData.ringbaApi += parseFloat(costRecord.cost || 0);
        }
      }
      
      console.log(`[Revenue Sync] Aggregated Ringba cost data for ${ringbaDailyCost.size} days`);
      
      // Aggregate Elocal data by date and category
      console.log('[Revenue Sync] Aggregating Elocal data by date and category...');
      const elocalDailyRevenue = new Map();
      for (const elocalCall of elocalCalls) {
        const date = elocalCall.date;
        if (!date) continue;
        
        if (!elocalDailyRevenue.has(date)) {
          elocalDailyRevenue.set(date, {
            date,
            elocalStatic: 0,
            elocalApi: 0
          });
        }
        
        const dayData = elocalDailyRevenue.get(date);
        const category = elocalCall.category || 'STATIC';
        if (category === 'STATIC') {
          dayData.elocalStatic += parseFloat(elocalCall.payout || 0);
        } else if (category === 'API') {
          dayData.elocalApi += parseFloat(elocalCall.payout || 0);
        }
      }
      
      console.log(`[Revenue Sync] Aggregated Elocal data for ${elocalDailyRevenue.size} days`);
      
      // Combine Ringba and Elocal data by date
      console.log('[Revenue Sync] Combining Ringba and Elocal data...');
      const allDates = new Set([
        ...Array.from(ringbaDailyCost.keys()),
        ...Array.from(elocalDailyRevenue.keys())
      ]);
      
      const dailyRevenue = Array.from(allDates).map(date => {
        const ringbaData = ringbaDailyCost.get(date) || { ringbaStatic: 0, ringbaApi: 0 };
        const elocalData = elocalDailyRevenue.get(date) || { elocalStatic: 0, elocalApi: 0 };
        
        return {
          date,
          ringbaStatic: ringbaData.ringbaStatic,
          ringbaApi: ringbaData.ringbaApi,
          elocalStatic: elocalData.elocalStatic,
          elocalApi: elocalData.elocalApi
        };
      });
      
      console.log(`[Revenue Sync] Aggregated ${dailyRevenue.length} days of data`);
      
      // Update summary table in SQLite (local database)
      console.log('[Revenue Sync] Updating revenue summary table in SQLite...');
      let updated = 0;
      
      for (const dayData of dailyRevenue) {
        try {
          const resultEither = await db.upsertRevenueSummary(dayData.date, {
            ringbaStatic: dayData.ringbaStatic,
            ringbaApi: dayData.ringbaApi,
            elocalStatic: dayData.elocalStatic,
            elocalApi: dayData.elocalApi
          })();
          
          if (resultEither._tag === 'Right') {
            updated++;
            console.log(`[Revenue Sync] Updated summary for ${dayData.date}: Ringba Static=$${dayData.ringbaStatic.toFixed(2)}, API=$${dayData.ringbaApi.toFixed(2)}, Elocal Static=$${dayData.elocalStatic.toFixed(2)}, API=$${dayData.elocalApi.toFixed(2)}`);
          } else {
            console.error(`[Revenue Sync] Failed to update summary for ${dayData.date}:`, resultEither.left.message);
          }
        } catch (error) {
          console.error(`[Revenue Sync] Failed to update summary for ${dayData.date}:`, error.message);
        }
      }
      
      console.log(`[Revenue Sync] ✅ Sync completed: ${updated} days updated in SQLite`);
      
      return {
        success: true,
        daysProcessed: updated,
        ringbaCostRecords: ringbaCostData.length,
        elocalCalls: elocalCalls.length,
        dateRange: { startDate, endDate }
      };
    },
    (error) => new Error(`Revenue sync failed: ${error.message}`)
  );

// Sync revenue for a specific date range
export const syncRevenueForDateRange = (config) => (startDate, endDate) =>
  syncRevenueSummary(config)({ startDate, endDate });

// Sync revenue for today
export const syncRevenueForToday = (config) =>
  syncRevenueSummary(config)({
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0]
  });

// Sync revenue for last N days
export const syncRevenueForLastDays = (config) => (days = 30) => {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  
  return syncRevenueSummary(config)({
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0]
  });
};

