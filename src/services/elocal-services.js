// Separate service functions for historical and current day data
import * as R from 'ramda';
import * as E from 'fp-ts/lib/Either.js';
import * as TE from 'fp-ts/lib/TaskEither.js';
import * as T from 'fp-ts/lib/Task.js';
import { dbOps } from '../database/sqlite-operations.js';
import { scrapingOps } from '../scrapers/elocal-scraper.js';
import { fetchCampaignResultsHtmlWithSavedSession, fetchAllCampaignResultsPages } from '../http/elocal-client.js';
import { extractCampaignCallsFromHtml, extractAdjustmentDetailsFromHtml } from '../scrapers/html-extractor.js';
import { processAdjustmentDetails } from '../utils/helpers.js';
import {
  processCampaignCalls,
  createSession,
  aggregateScrapingResults
} from '../utils/helpers.js';
import {
  getPast10DaysRange,
  getCurrentDayRange,
  getDateRangeDescription,
  getServiceScheduleInfo
} from '../utils/date-utils.js';

  // Base scraping workflow with date range support
const scrapeElocalDataWithDateRange = (config) => (dateRange) => (serviceType = 'unknown') => (category = 'STATIC') => {
  const session = createSession();
  // Include service type (historical/current) and category in session_id for filtering
  session.sessionId = `${serviceType}_${category.toLowerCase()}_${session.sessionId}_${dateRange.startDateFormatted.replace(/\//g, '-')}_to_${dateRange.endDateFormatted.replace(/\//g, '-')}`;
  
  const db = dbOps(config);
  const scraper = scrapingOps(config);
  
  // Determine campaign ID and whether to include adjustments based on category
  const campaignId = category === 'API' ? '46775' : '50033';
  const includeAdjustments = category === 'STATIC';
  
  return TE.tryCatch(
    async () => {
      console.log(`[INFO] Starting scraping session: ${session.sessionId}`);
      console.log(`[INFO] Category: ${category}, Campaign ID: ${campaignId}`);
      console.log(`[INFO] Date range: ${getDateRangeDescription(dateRange)}`);
      
      // Create session in database
      await TE.getOrElse(() => T.of(null))(db.createSession(session))();
      
      // NO-PUPPETEER path using saved cookies with pagination support
      try {
        console.log(`[INFO] Running ${category} category via HTTP only (no Puppeteer)...`);
        
        // Fetch all pages with pagination support
        const paginatedData = await fetchAllCampaignResultsPages(config, dateRange, campaignId, includeAdjustments);
        const rawCalls = paginatedData.calls;
        const rawAdjustments = paginatedData.adjustments;
        
        console.log(`[INFO] Fetched ${paginatedData.pagesFetched} page(s) with ${rawCalls.length} total calls${includeAdjustments ? ` and ${rawAdjustments.length} total adjustments` : ''}`);
        
        const processedAdjustments = includeAdjustments ? processAdjustmentDetails(rawAdjustments) : [];
        const processedCalls = processCampaignCalls(rawCalls);
        // Add category to all calls - ensure it's set before any processing
        processedCalls.forEach(call => { 
          call.category = category;
          // Debug: verify category is set
          if (!call.category) {
            console.warn(`[WARN] Category not set for call: ${call.callerId}`);
          }
        });
        
        console.log(`[INFO] Processed ${processedCalls.length} campaign calls (category: ${category})`);
        if (processedCalls.length > 0) {
          console.log(`[INFO] Sample call category: ${processedCalls[0].category}`);
        }
        if (includeAdjustments) {
          console.log(`[INFO] Parsed ${processedAdjustments.length} adjustment rows`);
        }

        // Save to DB (upsert)
        console.log('[INFO] Saving data to database...');
        
        // For API category: Look up payout from Ringba for each caller ID
        // API category uses "call price" from eLocal, but we need to get actual payout from Ringba
        if (category === 'API' && config.ringbaAccountId && config.ringbaApiToken) {
          console.log('[INFO] API category: Looking up payout values from Ringba for all calls...');
          const { findCallByCallerIdAndTime, getCallDetails } = await import('../http/ringba-client.js');
          
          let payoutLookups = 0;
          let payoutFound = 0;
          let payoutNotFound = 0;
          
          for (const call of processedCalls) {
            try {
              // Skip anonymous/invalid caller IDs
              const callerIdLower = (call.callerId || '').toLowerCase();
              if (callerIdLower.includes('anonymous') || callerIdLower === '' || !call.callerId) {
                console.log(`[INFO] API category: Skipping anonymous/invalid caller ID: ${call.callerId}`);
                continue;
              }
              
              payoutLookups++;
              console.log(`[INFO] API category: Looking up call for ${call.callerId} at ${call.dateOfCall}...`);
              
              // Look up call in Ringba by caller ID and time
              const lookupEither = await findCallByCallerIdAndTime(config.ringbaAccountId, config.ringbaApiToken)(
                call.callerId,
                call.dateOfCall,
                60, // 60 minute window
                null // No expected payout for initial lookup
              )();
              
              if (lookupEither._tag === 'Right' && lookupEither.right) {
                // Get call details to fetch payout
                const inboundCallId = lookupEither.right.inboundCallId;
                console.log(`[INFO] API category: Found call in Ringba: ${inboundCallId}`);
                
                const detailsEither = await getCallDetails(config.ringbaAccountId, config.ringbaApiToken)(inboundCallId)();
                
                if (detailsEither._tag === 'Right' && detailsEither.right) {
                  const ringbaPayout = detailsEither.right.payout || 0;
                  // Update payout from Ringba (overwrite the "call price" from eLocal)
                  call.payout = ringbaPayout;
                  payoutFound++;
                  
                  // Store Ringba inbound call ID for future reference
                  call.ringbaInboundCallId = inboundCallId;
                  
                  console.log(`[INFO] API category: Updated payout for ${call.callerId}: $${ringbaPayout} (from Ringba)`);
                } else {
                  payoutNotFound++;
                  console.warn(`[WARN] API category: Could not get call details for ${inboundCallId}`);
                }
              } else {
                payoutNotFound++;
                const error = lookupEither._tag === 'Left' ? lookupEither.left : null;
                console.warn(`[WARN] API category: Call not found in Ringba for ${call.callerId}: ${error?.message || 'Not found'}`);
                // Keep the original "call price" value from eLocal if Ringba lookup fails
              }
              
              // Small delay to avoid rate limiting
              await new Promise(resolve => setTimeout(resolve, 300));
            } catch (error) {
              payoutNotFound++;
              console.warn(`[WARN] API category: Failed to lookup payout for ${call.callerId}: ${error.message}`);
              // Continue with next call, keep original "call price" value
            }
          }
          
          console.log(`[INFO] API category: Ringba lookup summary - Looked up: ${payoutLookups}, Found: ${payoutFound}, Not found: ${payoutNotFound}`);
          console.log(`[INFO] API category: ${payoutFound} calls updated with Ringba payout, ${payoutNotFound} calls keeping eLocal "call price" value`);
        }
        
        // Save adjustment details to separate adjustment_details table (only for STATIC category)
        if (includeAdjustments && processedAdjustments.length > 0) {
          const adjustmentsResult = await TE.getOrElse(() => { 
            console.warn('[WARN] Failed to save adjustment details to adjustment_details table');
            return { inserted: 0, skipped: 0 };
          })(db.insertAdjustmentsBatch(processedAdjustments))();
          console.log(`[SUCCESS] Saved ${adjustmentsResult.inserted || 0} adjustment details to adjustment_details table (${adjustmentsResult.skipped || 0} skipped as duplicates)`);
        }
        
        let callsInserted = 0; let callsUpdated = 0;
        
        // For STATIC category: Fuzzy merge adjustments with calls
        // For API category: No adjustments to merge
        let callsMerged = processedCalls;
        
        // Ensure category is preserved for API category (no merge needed)
        if (!includeAdjustments) {
          // For API category, ensure all calls have category set
          callsMerged = processedCalls.map(c => ({
            ...c,
            category: c.category || category // Ensure category is set
          }));
          console.log(`[INFO] API category: Prepared ${callsMerged.length} calls for database (category: ${category})`);
          if (callsMerged.length > 0) {
            console.log(`[INFO] Sample merged call category: ${callsMerged[0].category}`);
          }
        }
        
        if (includeAdjustments && processedAdjustments.length > 0) {
          // Fuzzy merge: same caller_id and within ±60 minutes on same day
          const toDate = (s) => { try { return new Date(s); } catch { return null; } };
          const sameDay = (d1, d2) => d1 && d2 && d1.toISOString().substring(0,10) === d2.toISOString().substring(0,10);
          const diffMinutes = (d1, d2) => Math.abs(d1.getTime() - d2.getTime()) / 60000;
          const WINDOW_MIN = 30;

          const callerToCalls = new Map();
          for (const c of processedCalls) {
            const list = callerToCalls.get(c.callerId) || [];
            list.push({ ...c, dt: toDate(c.dateOfCall) });
            callerToCalls.set(c.callerId, list);
          }

          const matchMap = new Map(); // key: caller|date_of_call
          for (const a of processedAdjustments) {
            const adjDt = toDate(a.timeOfCall);
            const candidates = callerToCalls.get(a.callerId) || [];
            let best = null;
            for (const cand of candidates) {
              if (!cand.dt || !adjDt) continue;
              if (!sameDay(cand.dt, adjDt)) continue;
              const dm = diffMinutes(cand.dt, adjDt);
              if (dm <= WINDOW_MIN) {
                if (!best || dm < best.diff) best = { diff: dm, call: cand };
              }
            }
            if (best && best.call) {
              matchMap.set(`${best.call.callerId}|${best.call.dateOfCall}`, a);
            }
          }

          callsMerged = processedCalls.map(c => {
            const a = matchMap.get(`${c.callerId}|${c.dateOfCall}`);
            if (a) {
              return {
                ...c,
                category: c.category || category, // Ensure category is preserved
                adjustmentTime: a.adjustmentTime,
                adjustmentAmount: a.amount,
                adjustmentClassification: a.classification,
                adjustmentDuration: a.duration
              };
            }
            return {
              ...c,
              category: c.category || category // Ensure category is preserved
            };
          });
        }

        if (callsMerged.length > 0) {
          // Debug: Log category before insert
          const categoryCounts = callsMerged.reduce((acc, c) => {
            acc[c.category || 'null'] = (acc[c.category || 'null'] || 0) + 1;
            return acc;
          }, {});
          console.log(`[INFO] About to save ${callsMerged.length} calls with categories:`, categoryCounts);
          
          const callsResult = await TE.getOrElse(() => { throw new Error('Failed to save campaign calls'); })(db.insertCallsBatch(callsMerged))();
          callsInserted = callsResult.inserted || 0;
          callsUpdated = callsResult.updated || 0;
          console.log(`[SUCCESS] Saved ${callsInserted} new campaign calls (category: ${category}), updated ${callsUpdated} existing`);
        } else {
          console.log(`[WARN] No calls to save for category: ${category}`);
        }

        // Count applied adjustments (only for STATIC category)
        const adjustmentsApplied = includeAdjustments 
          ? callsMerged.filter(c => c.adjustmentAmount != null).length 
          : 0;
        let adjustmentsUnmatched = includeAdjustments 
          ? processedAdjustments.length - adjustmentsApplied 
          : 0;

        // For unmatched adjustments, insert new rows with unmatched=true (only for STATIC category)
        if (includeAdjustments && adjustmentsUnmatched > 0) {
          const matchedKeys = new Set(
            callsMerged.filter(c => c.adjustmentAmount != null)
              .map(c => `${c.callerId}|${c.dateOfCall}`)
          );
          const toInsert = processedAdjustments
            .filter(a => !Array.from(matchedKeys).some(k => k.startsWith(`${a.callerId}|`)))
            .map(a => ({
              dateOfCall: a.timeOfCall,
              campaignPhone: a.campaignPhone,
              callerId: a.callerId,
              payout: 0,
              category: 'STATIC',
              adjustmentTime: a.adjustmentTime,
              adjustmentAmount: a.amount,
              adjustmentClassification: a.classification,
              adjustmentDuration: a.duration,
              unmatched: true
            }));
          if (toInsert.length > 0) {
            const ins = await TE.getOrElse(() => { throw new Error('Failed to insert unmatched adjustments'); })(db.insertCallsBatch(toInsert))();
            console.log(`[INFO] Inserted ${ins.inserted || 0} unmatched adjustment rows as new calls`);
          }
        }
        
        if (includeAdjustments) {
          console.log(`[SUCCESS] Applied adjustments to ${adjustmentsApplied} calls (${adjustmentsUnmatched} unmatched)`);
        }

        await TE.getOrElse(() => T.of(null))(db.updateSession(session.sessionId)({
          completed_at: new Date().toISOString(), status: 'completed', calls_scraped: processedCalls.length, adjustments_scraped: adjustmentsApplied
        }))();

        const summary = {
          totalCalls: processedCalls.length,
          totalPayout: processedCalls.reduce((sum, call) => sum + (call.payout || 0), 0),
          uniqueCallers: new Set(processedCalls.map(call => call.callerId)).size,
          adjustmentsApplied
        };
        return { sessionId: session.sessionId, dateRange: getDateRangeDescription(dateRange), summary, calls: processedCalls, downloadedFile: { file: 'skipped', size: 0 }, databaseResults: { callsInserted, callsUpdated } };
      } catch (noPuppeteerErr) {
        throw new Error(`Historical HTTP-only flow failed: ${noPuppeteerErr.message}`);
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

// Historical data service (past 10 days, excluding today) - STATIC category
export const scrapeHistoricalData = (config) => {
  const dateRange = getPast10DaysRange();
  console.log(`[INFO] Historical Data Service (STATIC): ${getDateRangeDescription(dateRange)}`);
  return scrapeElocalDataWithDateRange(config)(dateRange)('historical')('STATIC');
};

// Current day service (current day only) - STATIC category
export const scrapeCurrentDayData = (config) => {
  const dateRange = getCurrentDayRange();
  console.log(`[INFO] Current Day Service (STATIC): ${getDateRangeDescription(dateRange)}`);
  return scrapeElocalDataWithDateRange(config)(dateRange)('current')('STATIC');
};

// Historical data service for API category (past 10 days, excluding today)
export const scrapeHistoricalDataAPI = (config) => {
  const dateRange = getPast10DaysRange();
  console.log(`[INFO] Historical Data Service (API): ${getDateRangeDescription(dateRange)}`);
  return scrapeElocalDataWithDateRange(config)(dateRange)('historical')('API');
};

// Current day service for API category (current day only)
export const scrapeCurrentDayDataAPI = (config) => {
  const dateRange = getCurrentDayRange();
  console.log(`[INFO] Current Day Service (API): ${getDateRangeDescription(dateRange)}`);
  return scrapeElocalDataWithDateRange(config)(dateRange)('current')('API');
};

// Get service info
export const getServiceInfo = (serviceType) => {
  return getServiceScheduleInfo(serviceType);
};

// Export
export const elocalServices = {
  scrapeHistoricalData,
  scrapeCurrentDayData,
  scrapeHistoricalDataAPI,
  scrapeCurrentDayDataAPI,
  getServiceInfo,
  getPast10DaysRange,
  getCurrentDayRange
};
