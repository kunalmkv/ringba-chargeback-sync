// Service to sync adjustment data from elocal_call_data to Ringba
import * as R from 'ramda';
import * as E from 'fp-ts/lib/Either.js';
import * as TE from 'fp-ts/lib/TaskEither.js';
import * as T from 'fp-ts/lib/Task.js';
import { withDatabase, logRingbaSyncAttempt } from '../database/sqlite-operations.js';
import { findCallByCallerIdAndTime, updateCallPayment, resolvePaymentLegs } from '../http/ringba-client.js';

// Get pending sync rows
// For STATIC category: rows with adjustment_amount
// For API category: all rows (need to check payout against Ringba)
const getPendingSyncRows = (config) => (category = null) =>
  withDatabase(config)(async (db) => {
    let query = '';       
    let params = [];
    
    if (category === 'API') {
      // API category: sync all rows to ensure payout matches Ringba
      query = `
        SELECT 
          id, date_of_call, campaign_phone, caller_id, payout,
          adjustment_amount, adjustment_classification, category,
          ringba_inbound_call_id, ringba_sync_status
        FROM elocal_call_data
        WHERE category = 'API'
          AND (ringba_sync_status IS NULL 
               OR ringba_sync_status = ''
               OR ringba_sync_status = 'pending' 
               OR ringba_sync_status = 'failed')
          AND (ringba_sync_status IS NULL OR ringba_sync_status != 'cannot_sync')
        ORDER BY id ASC
        LIMIT 100
      `;
    } else if (category === 'STATIC') {
      // STATIC category: rows with adjustment_amount OR all rows (for payout verification)
      // This includes:
      // 1. Rows with adjustments (chargebacks, refunds, modifications) - always sync
      // 2. All rows without adjustments that haven't been synced yet (to check for payout mismatches with Ringba, similar to API category)
      query = `
        SELECT 
          id, date_of_call, campaign_phone, caller_id, payout,
          adjustment_amount, adjustment_classification, category,
          ringba_inbound_call_id, ringba_sync_status
        FROM elocal_call_data
        WHERE category = 'STATIC'
          AND (
            adjustment_amount IS NOT NULL
            OR ringba_sync_status IS NULL
            OR ringba_sync_status = ''
            OR ringba_sync_status = 'pending'
            OR ringba_sync_status = 'failed'
          )
          AND (ringba_sync_status IS NULL OR ringba_sync_status != 'cannot_sync')
        ORDER BY 
          CASE WHEN adjustment_amount IS NOT NULL THEN 0 ELSE 1 END,
          id ASC
        LIMIT 100
      `;
    } else {
      // Default: both categories (backward compatibility)
      // STATIC: rows with adjustments OR all rows (for payout verification)
      // API: all rows (for payout verification)
      query = `
        SELECT 
          id, date_of_call, campaign_phone, caller_id, payout,
          adjustment_amount, adjustment_classification, category,
          ringba_inbound_call_id, ringba_sync_status
        FROM elocal_call_data
        WHERE (
          (category = 'STATIC' AND (
            adjustment_amount IS NOT NULL
            OR ringba_sync_status IS NULL
            OR ringba_sync_status = ''
            OR ringba_sync_status = 'pending'
            OR ringba_sync_status = 'failed'
          ))
          OR (category = 'API')
        )
          AND (ringba_sync_status IS NULL 
               OR ringba_sync_status = ''
               OR ringba_sync_status = 'pending' 
               OR ringba_sync_status = 'failed')
          AND (ringba_sync_status IS NULL OR ringba_sync_status != 'cannot_sync')
        ORDER BY 
          CASE 
            WHEN category = 'STATIC' AND adjustment_amount IS NOT NULL THEN 0
            ELSE 1
          END,
          id ASC
        LIMIT 100
      `;
    }
    
    const stmt = db.prepare(query);
    return stmt.all(...params);
  });

// Update sync status in database
const updateSyncStatus = (config) => (rowId) => (status, inboundCallId, response) =>
  withDatabase(config)(async (db) => {
    const stmt = db.prepare(`
      UPDATE elocal_call_data
      SET ringba_sync_status = ?,
          ringba_inbound_call_id = COALESCE(?, ringba_inbound_call_id),
          ringba_sync_at = CURRENT_TIMESTAMP,
          ringba_sync_response = ?
      WHERE id = ?
    `);
    const result = stmt.run(
      status,
      inboundCallId || null,
      response ? JSON.stringify(response) : null,
      rowId
    );
    return { updated: result.changes };
  });

// Sync a single row to Ringba
const syncRowToRingba = (config) => (row) =>
  TE.tryCatch(
    async () => {
      const accountId = config.ringbaAccountId;
      const apiToken = config.ringbaApiToken;

      if (!accountId || !apiToken) {
        throw new Error('Ringba account ID and API token are required');
      }

      // Check if caller_id can be converted to E.164 format (skip anonymous/invalid caller IDs)
      const callerIdLower = (row.caller_id || '').toLowerCase();
      if (callerIdLower.includes('anonymous') || callerIdLower === '' || !row.caller_id) {
        const errorMsg = 'Anonymous or invalid caller ID cannot be synced to Ringba';
        await TE.getOrElse(() => T.of(null))(updateSyncStatus(config)(row.id)('cannot_sync', null, { error: errorMsg }))();
        // Log the cannot_sync attempt
        await TE.getOrElse(() => T.of(null))(logRingbaSyncAttempt(config)({
          campaignCallId: row.id,
          dateOfCall: row.date_of_call,
          callerId: row.caller_id,
          category: row.category,
          adjustmentAmount: row.adjustment_amount,
          adjustmentClassification: row.adjustment_classification,
          syncStatus: 'cannot_sync',
          errorMessage: errorMsg
        }))();
        throw new Error(`Cannot sync anonymous or invalid caller ID: ${row.caller_id}`);
      }

      // Step 1: Always lookup call to get current revenue and payout values
      // Even if we have inboundCallId from previous sync, we need current values to calculate adjustments
      // Also match by payout value to ensure we're updating the correct call
      // For API category: Always search in Ringba by caller ID and time
      const expectedPayout = row.payout ? Number(row.payout) : null;
      const categoryLabel = row.category === 'API' ? ' (API category)' : '';
      console.log(`[Ringba]${categoryLabel} Looking up call for ${row.caller_id} at ${row.date_of_call}${expectedPayout !== null ? ` with expected payout=$${expectedPayout}` : ''}...`);
      const lookupEither = await findCallByCallerIdAndTime(accountId, apiToken)(row.caller_id, row.date_of_call, 60, expectedPayout)();
      
      if (lookupEither._tag === 'Left') {
        const error = lookupEither.left;
        const errorMsg = `Call lookup failed: ${error.message || error}`;
        // Log lookup failure
        await TE.getOrElse(() => T.of(null))(logRingbaSyncAttempt(config)({
          campaignCallId: row.id,
          dateOfCall: row.date_of_call,
          callerId: row.caller_id,
          category: row.category,
          adjustmentAmount: row.adjustment_amount,
          adjustmentClassification: row.adjustment_classification,
          syncStatus: 'failed',
          errorMessage: errorMsg
        }))();
        throw new Error(errorMsg);
      }
      
      const lookupResult = lookupEither.right;
      if (!lookupResult) {
        const errorMsg = 'Call not found in Ringba';
        await TE.getOrElse(() => T.of(null))(updateSyncStatus(config)(row.id)('not_found', null, { error: errorMsg }))();
        // Log not_found
        await TE.getOrElse(() => T.of(null))(logRingbaSyncAttempt(config)({
          campaignCallId: row.id,
          dateOfCall: row.date_of_call,
          callerId: row.caller_id,
          category: row.category,
          adjustmentAmount: row.adjustment_amount,
          adjustmentClassification: row.adjustment_classification,
          syncStatus: 'not_found',
          errorMessage: errorMsg
        }))();
        throw new Error(`Call not found in Ringba for caller ${row.caller_id} at ${row.date_of_call}`);
      }

      const inboundCallId = lookupResult.inboundCallId;
      const payoutMatchInfo = lookupResult.payoutMatch !== undefined
        ? (lookupResult.payoutMatch ? `, exact payout match ($${lookupResult.payout})` : `, payout diff=$${lookupResult.payoutDiff?.toFixed(2) || 'N/A'} (Ringba=$${lookupResult.payout || 'N/A'}, expected=$${lookupResult.expectedPayout || 'N/A'})`)
        : '';
      console.log(`[Ringba] Found call: ${inboundCallId} (time diff: ${lookupResult.timeDiffMinutes} min${payoutMatchInfo})`);
      
      // Warn if payout doesn't match (but still proceed with update)
      if (lookupResult.payoutMatch === false && expectedPayout !== null) {
        console.warn(`[Ringba] WARNING: Payout mismatch for call ${inboundCallId}. Ringba payout=$${lookupResult.payout || 'N/A'}, expected=$${expectedPayout}. Proceeding with update anyway.`);
      }

      // Update DB with inboundCallId if not already set
      // For API category: Always update the inbound call ID when found
      if (!row.ringba_inbound_call_id || row.category === 'API') {
        await TE.getOrElse(() => T.of(null))(updateSyncStatus(config)(row.id)('pending', inboundCallId, { lookup: lookupResult }))();
      }

      // Step 2: Resolve payment legs (handles multi-leg calls from reroutes/transfers)
      console.log(`[Ringba] Resolving payment legs for ${inboundCallId}...`);
      const legsEither = await resolvePaymentLegs(accountId, apiToken)(inboundCallId)();
      
      if (legsEither._tag === 'Left') {
        const error = legsEither.left;
        const errorMsg = `Cannot resolve payment legs: ${error.message || error}`;
        
        await TE.getOrElse(() => T.of(null))(logRingbaSyncAttempt(config)({
          campaignCallId: row.id,
          dateOfCall: row.date_of_call,
          callerId: row.caller_id,
          category: row.category,
          adjustmentAmount: row.adjustment_amount,
          adjustmentClassification: row.adjustment_classification,
          ringbaInboundCallId: inboundCallId,
          syncStatus: 'failed',
          lookupResult,
          errorMessage: errorMsg
        }))();
        
        throw new Error(errorMsg);
      }
      
      const legResolution = legsEither.right;
      const { payoutLegId, revenueLegId, payoutLeg, revenueLeg, isMultiLeg } = legResolution;
      
      console.log(`[Ringba] Leg resolution: ${isMultiLeg ? 'Multi-leg call' : 'Single leg'}`);
      console.log(`[Ringba]   - Payout leg: ${payoutLegId} (current=$${payoutLeg.payout}, connected=${payoutLeg.connected})`);
      console.log(`[Ringba]   - Revenue leg: ${revenueLegId} (current=$${revenueLeg.revenue}, connected=${revenueLeg.connected})`);
      
      // Step 2a: Get current values from the correct legs
      let updateResult, finalRevenue, finalPayout, apiRequest;
      const currentRevenue = Number(revenueLeg.revenue || 0);
      const currentPayout = Number(payoutLeg.payout || 0);
      const isConnected = !!revenueLeg.connected; // Revenue leg must be connected to update revenue
      
      console.log(`[Ringba] Current values: revenue=$${currentRevenue}, payout=$${currentPayout}, revenue leg connected=${isConnected}`);
      
      // Step 2b: Use payout value directly from database row
      // For STATIC category: Use payout from row (may have been adjusted or verified during scraping)
      // For API category: Use payout from row (fetched from Ringba during scraping, but may have changed)
      const payoutValue = Math.max(0, Number(row.payout || 0));
      
      // For API and STATIC categories: Compare with Ringba payout to see if update is needed
      // If payout matches and there's no adjustment, skip the update
      if ((row.category === 'API' || row.category === 'STATIC') && !row.adjustment_amount) {
        const currentRingbaPayout = Number(payoutLeg.payout || 0);
        const eLocalPayout = payoutValue;
        
        console.log(`[Ringba] ${row.category} category: Comparing payouts - Ringba=$${currentRingbaPayout.toFixed(2)}, eLocal=$${eLocalPayout.toFixed(2)}`);
        
        // Only update if payout differs (with small tolerance for floating point)
        const payoutDiff = Math.abs(currentRingbaPayout - eLocalPayout);
        if (payoutDiff < 0.01) {
          console.log(`[Ringba] ${row.category} category: Payout matches (diff=$${payoutDiff.toFixed(2)}), no update needed`);
          // Mark as synced without updating (payout already correct in Ringba)
          await TE.getOrElse(() => T.of(null))(updateSyncStatus(config)(row.id)('success', inboundCallId, { 
            message: 'Payout already matches, no update needed',
            ringbaPayout: currentRingbaPayout,
            eLocalPayout: eLocalPayout,
            payoutDiff: payoutDiff
          }))();
          
          // Log successful check (even though no update was needed)
          await TE.getOrElse(() => T.of(null))(logRingbaSyncAttempt(config)({
            campaignCallId: row.id,
            dateOfCall: row.date_of_call,
            callerId: row.caller_id,
            category: row.category,
            adjustmentAmount: row.adjustment_amount,
            adjustmentClassification: row.adjustment_classification,
            ringbaInboundCallId: inboundCallId,
            syncStatus: 'success',
            revenue: currentRevenue,
            payout: currentRingbaPayout,
            lookupResult,
            apiRequest: { message: 'No update needed - payout matches' },
            apiResponse: { skipped: 'payout_matches' }
          }))();
          
          return {
            rowId: row.id,
            inboundCallId,
            revenue: currentRevenue,
            payout: currentRingbaPayout,
            status: 'success',
            isMultiLeg,
            isConnected,
            skipped: 'payout_matches'
          };
        }
        console.log(`[Ringba] ${row.category} category: Payout differs by $${payoutDiff.toFixed(2)} (Ringba=$${currentRingbaPayout.toFixed(2)}, eLocal=$${eLocalPayout.toFixed(2)}), updating Ringba...`);
      } else if (row.category === 'STATIC' && row.adjustment_amount) {
        // STATIC category with adjustment: Always update (adjustment takes priority)
        console.log(`[Ringba] STATIC category: Adjustment detected (amount=$${row.adjustment_amount}), proceeding with update...`);
      }
      
      // Set both revenue and payout to the same value from database
      const newPayout = payoutValue;
      const newRevenue = payoutValue; // Same as payout
      
      // Snap tiny float residue to exact zeros (fix floating-point precision issues)
      const isZeroish = (n, eps = 0.005) => Math.abs(n) < eps;
      finalPayout = isZeroish(newPayout) ? 0 : newPayout;
      finalRevenue = isZeroish(newRevenue) ? 0 : newRevenue;
      
      console.log(`[Ringba] Using payout from database: $${finalPayout}`);
      console.log(`[Ringba] New values: revenue=$${finalRevenue}, payout=$${finalPayout} (both set to same value)`);
      
      // Step 2c: Update each leg with correct amounts
      // CRITICAL: Never send newConversionAmount for non-connected calls
      // Always use /calls/payments/override endpoint (even for zero values)
      const apiRequests = [];
      const updateResults = [];
      
      // Determine if we're dealing with single-leg or multi-leg call
      const isSameLeg = payoutLegId === revenueLegId;
      
      if (isSameLeg) {
        // Single leg: Update both payout and revenue together (if connected)
        // Always use /calls/payments/override endpoint (even for zero values)
        const payload = { reason: 'Call payments adjusted by eLocal sync service.' };
        
        // Update both payout and revenue to the same value (if connected)
        if (isConnected) {
          // Connected: can update both revenue and payout
          payload.newConversionAmount = Number(finalRevenue);
          payload.newPayoutAmount = Number(finalPayout);
          console.log(`[Ringba] Updating single leg ${payoutLegId}: revenue=$${finalRevenue}, payout=$${finalPayout} (connected)`);
        } else {
          // Not connected: only update payout (omit revenue to avoid Ringba ignoring the update)
          payload.newPayoutAmount = Number(finalPayout);
          console.log(`[Ringba] Updating single leg ${payoutLegId}: payout=$${finalPayout} only (not connected, skipping revenue)`);
        }
        
        apiRequest = {
          url: `POST /v2/${accountId}/calls/payments/override`,
          inboundCallId: payoutLegId,
          ...payload
        };
        apiRequests.push(apiRequest);
        
        const updateEither = await updateCallPayment(accountId, apiToken)(payoutLegId, payload)();
        
        if (updateEither._tag === 'Left') {
          const error = updateEither.left;
          const errorMsg = `Update single leg failed: ${error.message || error}`;
          await TE.getOrElse(() => T.of(null))(logRingbaSyncAttempt(config)({
            campaignCallId: row.id,
            dateOfCall: row.date_of_call,
            callerId: row.caller_id,
            category: row.category,
            adjustmentAmount: row.adjustment_amount,
            adjustmentClassification: row.adjustment_classification,
            ringbaInboundCallId: inboundCallId,
            syncStatus: 'failed',
            revenue: finalRevenue,
            payout: finalPayout,
            lookupResult: { ...lookupResult, currentRevenue, currentPayout },
            apiRequest: apiRequests,
            errorMessage: errorMsg
          }))();
          throw new Error(errorMsg);
        }
        updateResults.push({ leg: 'both', result: updateEither.right });
      } else {
        // Multi-leg: Update payout and revenue on separate legs
        console.log(`[Ringba] Multi-leg call detected - updating payout and revenue separately`);
        
        // Update payout leg
        // Always use /calls/payments/override endpoint (even for zero values)
        console.log(`[Ringba] Updating payout leg ${payoutLegId} to $${finalPayout}...`);
        apiRequest = {
          url: `POST /v2/${accountId}/calls/payments/override`,
          inboundCallId: payoutLegId,
          newPayoutAmount: Number(finalPayout),
          reason: 'Call payments adjusted by eLocal sync service.'
        };
        apiRequests.push(apiRequest);
        
        const payoutUpdateEither = await updateCallPayment(accountId, apiToken)(payoutLegId, {
          newPayoutAmount: Number(finalPayout),
          reason: 'Call payments adjusted by eLocal sync service.'
        })();
        
        if (payoutUpdateEither._tag === 'Left') {
          const error = payoutUpdateEither.left;
          const errorMsg = `Update payout leg failed: ${error.message || error}`;
          await TE.getOrElse(() => T.of(null))(logRingbaSyncAttempt(config)({
            campaignCallId: row.id,
            dateOfCall: row.date_of_call,
            callerId: row.caller_id,
            category: row.category,
            adjustmentAmount: row.adjustment_amount,
            adjustmentClassification: row.adjustment_classification,
            ringbaInboundCallId: inboundCallId,
            syncStatus: 'failed',
            revenue: finalRevenue,
            payout: finalPayout,
            lookupResult: { ...lookupResult, currentRevenue, currentPayout },
            apiRequest: apiRequests,
            errorMessage: errorMsg
          }))();
          throw new Error(errorMsg);
        }
        updateResults.push({ leg: 'payout', result: payoutUpdateEither.right });
        
        // Update revenue leg ONLY if connected
        // CRITICAL: Never send newConversionAmount for non-connected calls
        if (isConnected) {
          console.log(`[Ringba] Updating revenue leg ${revenueLegId} to $${finalRevenue} (connected call)...`);
          apiRequest = {
            url: `POST /v2/${accountId}/calls/payments/override`,
            inboundCallId: revenueLegId,
            newConversionAmount: Number(finalRevenue),
            reason: 'Call payments adjusted by eLocal sync service.'
          };
          apiRequests.push(apiRequest);
          
          const revenueUpdateEither = await updateCallPayment(accountId, apiToken)(revenueLegId, {
            newConversionAmount: Number(finalRevenue),
            reason: 'Call payments adjusted by eLocal sync service.'
          })();
          
          if (revenueUpdateEither._tag === 'Left') {
            const error = revenueUpdateEither.left;
            const errorMsg = `Update revenue leg failed: ${error.message || error}`;
            await TE.getOrElse(() => T.of(null))(logRingbaSyncAttempt(config)({
              campaignCallId: row.id,
              dateOfCall: row.date_of_call,
              callerId: row.caller_id,
              category: row.category,
              adjustmentAmount: row.adjustment_amount,
              adjustmentClassification: row.adjustment_classification,
              ringbaInboundCallId: inboundCallId,
              syncStatus: 'failed',
              revenue: finalRevenue,
              payout: finalPayout,
              lookupResult: { ...lookupResult, currentRevenue, currentPayout },
              apiRequest: apiRequests,
              errorMessage: errorMsg
            }))();
            throw new Error(errorMsg);
          }
          updateResults.push({ leg: 'revenue', result: revenueUpdateEither.right });
        } else {
          // Not connected - DO NOT send revenue update
          console.log(`[Ringba] Skipping revenue update for ${revenueLegId}: call not connected (Ringba will ignore revenue on non-connected calls)`);
        }
      }
      
      updateResult = {
        isSameLeg,
        isMultiLeg,
        payoutLeg: { id: payoutLegId, result: updateResults.find(r => r.leg === 'payout' || r.leg === 'both')?.result },
        revenueLeg: isConnected 
          ? { id: revenueLegId, result: updateResults.find(r => r.leg === 'revenue' || r.leg === 'both')?.result } 
          : { id: revenueLegId, skipped: 'not connected' }
      };
      
      // Set final values
      finalRevenue = isConnected ? finalRevenue : currentRevenue; // Don't claim to update revenue if call wasn't connected
      finalPayout = finalPayout; // Payout updated from database row

      // Step 3: Mark as synced and log success
      await TE.getOrElse(() => T.of(null))(updateSyncStatus(config)(row.id)('success', inboundCallId, updateResult))();
      
      // Log successful sync with leg resolution details
      await TE.getOrElse(() => T.of(null))(logRingbaSyncAttempt(config)({
        campaignCallId: row.id,
        dateOfCall: row.date_of_call,
        callerId: row.caller_id,
        category: row.category,
        adjustmentAmount: row.adjustment_amount,
        adjustmentClassification: row.adjustment_classification,
        ringbaInboundCallId: inboundCallId,
        syncStatus: 'success',
        revenue: finalRevenue,
        payout: finalPayout,
        lookupResult,
        apiRequest: apiRequests,
        apiResponse: updateResult,
        legResolution: {
          isMultiLeg,
          payoutLegId,
          revenueLegId,
          isConnected
        }
      }))();

      return {
        rowId: row.id,
        inboundCallId,
        revenue: finalRevenue,
        payout: finalPayout,
        status: 'success',
        isMultiLeg,
        isConnected
      };
    },
    async (error) => {
      console.error(`[Ringba] Sync failed for row ${row.id}:`, error.message);
      const errorMsg = error.message || String(error);
      // Update status to failed
      try {
        await TE.getOrElse(() => T.of(null))(updateSyncStatus(config)(row.id)('failed', null, { error: errorMsg }))();
        // Log unexpected error
        await TE.getOrElse(() => T.of(null))(logRingbaSyncAttempt(config)({
          campaignCallId: row.id,
          dateOfCall: row.date_of_call,
          callerId: row.caller_id,
          category: row.category,
          adjustmentAmount: row.adjustment_amount,
          adjustmentClassification: row.adjustment_classification,
          syncStatus: 'failed',
          errorMessage: errorMsg
        }))();
      } catch (e) {
        // Ignore DB update errors on failure
      }
      return error;
    }
  );

// Main sync service
export const syncAdjustmentsToRingba = (config) => (category = null) =>
  TE.tryCatch(
    async () => {
      if (!config.ringbaAccountId || !config.ringbaApiToken) {
        console.log('[Ringba] Sync skipped: Ringba credentials not configured');
        return { synced: 0, failed: 0, skipped: 0 };
      }

      const categoryLabel = category ? ` (${category} category)` : ' (all categories)';
      console.log(`[Ringba] Starting sync${categoryLabel}...`);
      
      // Get pending rows
      const pendingRows = await TE.getOrElse(() => [])(getPendingSyncRows(config)(category))();
      
      if (pendingRows.length === 0) {
        console.log('[Ringba] No pending adjustments to sync');
        return { synced: 0, failed: 0, skipped: 0 };
      }

      console.log(`[Ringba] Found ${pendingRows.length} pending adjustments to sync`);

      let synced = 0;
      let failed = 0;
      let skipped = 0;

      // Process each row (with small delay to avoid rate limiting)
      for (const row of pendingRows) {
        try {
          const either = await syncRowToRingba(config)(row)();
          
          if (either._tag === 'Right') {
            const result = either.right;
            // Check if this was skipped (payout already matches for API category)
            if (result.skipped === 'payout_matches') {
              skipped++;
              console.log(`[Ringba] Skipped row ${row.id} (payout already matches in Ringba)`);
            } else {
              synced++;
              console.log(`[Ringba] Successfully synced row ${row.id} -> ${result.inboundCallId || 'N/A'}`);
            }
          } else {
            failed++;
            const error = either.left;
            const errorMsg = error instanceof Error ? error.message : (typeof error === 'string' ? error : JSON.stringify(error));
            console.error(`[Ringba] Failed to sync row ${row.id}:`, errorMsg);
          }
          
          // Small delay between requests
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          failed++;
          console.error(`[Ringba] Exception syncing row ${row.id}:`, error.message || error);
        }
      }
      
      console.log(`[Ringba] Sync completed: ${synced} synced, ${failed} failed, ${skipped} skipped`);
      return { synced, failed, skipped };
    },
    (error) => new Error(`Ringba sync service failed: ${error.message}`)
  );

