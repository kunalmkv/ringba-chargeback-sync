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
const scrapeElocalDataWithDateRange = (config) => (dateRange) => (serviceType = 'unknown') => {
  const session = createSession();
  // Include service type (historical/current) in session_id for filtering
  session.sessionId = `${serviceType}_${session.sessionId}_${dateRange.startDateFormatted.replace(/\//g, '-')}_to_${dateRange.endDateFormatted.replace(/\//g, '-')}`;
  
  const db = dbOps(config);
  const scraper = scrapingOps(config);
  
  return TE.tryCatch(
    async () => {
      console.log(`[INFO] Starting scraping session: ${session.sessionId}`);
      console.log(`[INFO] Date range: ${getDateRangeDescription(dateRange)}`);
      
      // Create session in database
      await TE.getOrElse(() => T.of(null))(db.createSession(session))();
      
      // NO-PUPPETEER path using saved cookies with pagination support
      try {
        console.log('[INFO] Running historical via HTTP only (no Puppeteer)...');
        
        // Fetch all pages with pagination support
        const paginatedData = await fetchAllCampaignResultsPages(config, dateRange);
        const rawCalls = paginatedData.calls;
        const rawAdjustments = paginatedData.adjustments;
        
        console.log(`[INFO] Fetched ${paginatedData.pagesFetched} page(s) with ${rawCalls.length} total calls and ${rawAdjustments.length} total adjustments`);
        
        const processedAdjustments = processAdjustmentDetails(rawAdjustments);
        const processedCalls = processCampaignCalls(rawCalls);
        console.log(`[INFO] Processed ${processedCalls.length} campaign calls`);
        console.log(`[INFO] Parsed ${processedAdjustments.length} adjustment rows`);

        // Save to DB (upsert)
        console.log('[INFO] Saving data to database...');
        
        // Save adjustment details to separate adjustment_details table
        if (processedAdjustments.length > 0) {
          const adjustmentsResult = await TE.getOrElse(() => { 
            console.warn('[WARN] Failed to save adjustment details to adjustment_details table');
            return { inserted: 0, skipped: 0 };
          })(db.insertAdjustmentsBatch(processedAdjustments))();
          console.log(`[SUCCESS] Saved ${adjustmentsResult.inserted || 0} adjustment details to adjustment_details table (${adjustmentsResult.skipped || 0} skipped as duplicates)`);
        }
        let callsInserted = 0; let callsUpdated = 0;
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

        const callsMerged = processedCalls.map(c => {
          const a = matchMap.get(`${c.callerId}|${c.dateOfCall}`);
          if (a) {
            return {
              ...c,
              adjustmentTime: a.adjustmentTime,
              adjustmentAmount: a.amount,
              adjustmentClassification: a.classification,
              adjustmentDuration: a.duration
            };
          }
          return c;
        });

        if (callsMerged.length > 0) {
          const callsResult = await TE.getOrElse(() => { throw new Error('Failed to save campaign calls'); })(db.insertCallsBatch(callsMerged))();
          callsInserted = callsResult.inserted || 0;
          callsUpdated = callsResult.updated || 0;
          console.log(`[SUCCESS] Saved ${callsInserted} new campaign calls, updated ${callsUpdated} existing`);
        }

        // Count applied adjustments
        const adjustmentsApplied = callsMerged.filter(c => c.adjustmentAmount != null).length;
        let adjustmentsUnmatched = processedAdjustments.length - adjustmentsApplied;

        // For unmatched adjustments, insert new rows with unmatched=true
        if (adjustmentsUnmatched > 0) {
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
        console.log(`[SUCCESS] Applied adjustments to ${adjustmentsApplied} calls (${adjustmentsUnmatched} unmatched)`);

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

// Historical data service (past 10 days, excluding today)
export const scrapeHistoricalData = (config) => {
  const dateRange = getPast10DaysRange();
  console.log(`[INFO] Historical Data Service: ${getDateRangeDescription(dateRange)}`);
  return scrapeElocalDataWithDateRange(config)(dateRange)('historical');
};

// Current day service (current day only)
export const scrapeCurrentDayData = (config) => {
  const dateRange = getCurrentDayRange();
  console.log(`[INFO] Current Day Service: ${getDateRangeDescription(dateRange)}`);
  return scrapeElocalDataWithDateRange(config)(dateRange)('current');
};

// Get service info
export const getServiceInfo = (serviceType) => {
  return getServiceScheduleInfo(serviceType);
};

// Export
export const elocalServices = {
  scrapeHistoricalData,
  scrapeCurrentDayData,
  getServiceInfo,
  getPast10DaysRange,
  getCurrentDayRange
};
