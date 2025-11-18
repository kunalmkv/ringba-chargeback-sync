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
    // Check if revenue column exists in the table
    const tableInfo = db.prepare(`PRAGMA table_info(elocal_call_data)`).all();
    const hasRevenueColumn = tableInfo.some(col => col.name === 'revenue');
    
    let query = '';       
    let params = [];
    
    // Build SELECT clause - include revenue only if column exists
    const revenueSelect = hasRevenueColumn ? ', revenue' : '';
    
    if (category === 'API') {
      // API category: sync all rows to ensure payout matches Ringba
      // Select both payout and revenue (if revenue column exists) to handle cases where one might be null
      query = `
        SELECT 
          id, date_of_call, campaign_phone, caller_id, payout${revenueSelect},
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
      // Select both payout and revenue (if revenue column exists) to handle cases where one might be null
      query = `
        SELECT 
          id, date_of_call, campaign_phone, caller_id, payout${revenueSelect},
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
      // Select both payout and revenue (if revenue column exists) to handle cases where one might be null
      query = `
        SELECT 
          id, date_of_call, campaign_phone, caller_id, payout${revenueSelect},
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
      
      // Step 2b: Get value from database row - handle null/undefined/empty values
      // CRITICAL LOGIC: Use whichever value exists (payout or revenue) for BOTH revenue and payout
      // - If payout exists (not null), use payout for both
      // - If payout is null but revenue exists, use revenue for both
      // - If both are null, use 0 for both
      // This ensures both revenue and payout are ALWAYS set to the same value
      const getValueFromRow = (value) => {
        // Handle null, undefined, or empty string first
        if (value === null || value === undefined || value === '') {
          return null; // Return null to indicate value doesn't exist
        }
        // Convert to number and check if valid
        const numValue = Number(value);
        // If conversion results in NaN, return null
        if (isNaN(numValue)) {
          return null;
        }
        // Return the valid number (can be negative, zero, or positive)
        return numValue;
      };
      
      // Get both payout and revenue from database (handle null/undefined/empty)
      // Note: row.revenue may be null if revenue column doesn't exist, or if it's actually null
      const dbPayout = getValueFromRow(row.payout);
      const dbRevenue = getValueFromRow(row.revenue); // May be null if column doesn't exist or is null
      
      // CRITICAL: Use whichever value exists for BOTH revenue and payout
      // Priority: payout > revenue > 0
      // If payout exists, use it for both
      // If payout is null but revenue exists, use revenue for both
      // If both are null, use 0 for both
      let valueToUse;
      let valueSource;
      
      if (dbPayout !== null) {
        valueToUse = dbPayout;
        valueSource = 'payout';
      } else if (dbRevenue !== null) {
        valueToUse = dbRevenue;
        valueSource = 'revenue';
      } else {
        valueToUse = 0;
        valueSource = 'default (both null)';
      }
      
      // Log which value is being used (for debugging)
      if (dbPayout === null && dbRevenue !== null) {
        console.log(`[Ringba] Database payout is null for row ${row.id}, using revenue value ($${valueToUse}) for both revenue and payout`);
      } else if (dbRevenue === null && dbPayout !== null) {
        console.log(`[Ringba] Database revenue is null for row ${row.id}, using payout value ($${valueToUse}) for both revenue and payout`);
      } else if (dbPayout === null && dbRevenue === null) {
        console.log(`[Ringba] Database payout and revenue are both null for row ${row.id}, using 0 for both revenue and payout`);
      }
      
      // This value will be used for BOTH revenue and payout
      const payoutValue = valueToUse;
      
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
          
          // Even when skipping update, ensure both revenue and payout are set to same value from database
          // This maintains consistency: both values should always be the same
          const skippedRevenue = payoutValue; // Use database value for both
          const skippedPayout = payoutValue; // Use database value for both
          
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
            revenue: skippedRevenue, // Use database value (same as payout)
            payout: skippedPayout,   // Use database value
            lookupResult,
            apiRequest: { message: 'No update needed - payout matches' },
            apiResponse: { skipped: 'payout_matches' }
          }))();
          
          return {
            rowId: row.id,
            inboundCallId,
            revenue: skippedRevenue, // Both set to same value from database
            payout: skippedPayout,   // Both set to same value from database
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
      // CRITICAL: Even if payout is null/undefined/empty in DB, we still use that value (0) for BOTH
      // This ensures both revenue and payout are ALWAYS the same value, regardless of what's in the database
      // If database has null for payout, both revenue and payout will be set to 0
      // If database has a value for payout, both revenue and payout will be set to that same value
      const newPayout = payoutValue;
      const newRevenue = payoutValue; // Always same as payout - even if payout is null/0/absent
      
      // Snap tiny float residue to exact zeros (fix floating-point precision issues)
      const isZeroish = (n, eps = 0.005) => Math.abs(n) < eps;
      finalPayout = isZeroish(newPayout) ? 0 : newPayout;
      finalRevenue = isZeroish(newRevenue) ? 0 : newRevenue;
      
      // CRITICAL: Force both to be exactly the same (in case of any rounding or edge cases)
      // This is the key guarantee: both revenue and payout are ALWAYS identical
      finalRevenue = finalPayout; // Force both to be identical
      
      // Log the value being used (helpful for debugging null cases)
      const dbValueStatus = valueSource === 'payout' 
        ? ' (from payout column)'
        : valueSource === 'revenue'
        ? ' (from revenue column, payout was null)'
        : ' (both null, using default 0)';
      console.log(`[Ringba] Using value from database${dbValueStatus}: $${finalPayout}`);
      console.log(`[Ringba] New values: revenue=$${finalRevenue}, payout=$${finalPayout} (both set to same value: $${finalPayout})`);
      
      // Step 2c: Update each leg with correct amounts
      // CRITICAL: Never send newConversionAmount for non-connected calls
      // Always use /calls/payments/override endpoint (even for zero values)
      const apiRequests = [];
      const updateResults = [];
      
      // Determine if we're dealing with single-leg or multi-leg call
      const isSameLeg = payoutLegId === revenueLegId;
      
      if (isSameLeg) {
        // Single leg: Update both payout and revenue together
        // Always use /calls/payments/override endpoint (even for zero values)
        // Always send both revenue and payout to the same value, even if call is not connected
        // (Ringba may reject revenue update for non-connected calls, but we still try)
        const payload = { 
          reason: 'Call payments adjusted by eLocal sync service.',
          newConversionAmount: Number(finalRevenue), // Always include revenue
          newPayoutAmount: Number(finalPayout)        // Always include payout
        };
        
        console.log(`[Ringba] Updating single leg ${payoutLegId}: revenue=$${finalRevenue}, payout=$${finalPayout} (both same${isConnected ? ', connected' : ', not connected - Ringba may reject revenue update'})`);
        
        apiRequest = {
          url: `POST /v2/${accountId}/calls/payments/override`,
          inboundCallId: payoutLegId,
          ...payload
        };
        apiRequests.push(apiRequest);
        
        const updateEither = await updateCallPayment(accountId, apiToken)(payoutLegId, payload)();
        
        if (updateEither._tag === 'Left') {
          const error = updateEither.left;
          // If call is not connected and Ringba rejects revenue update, try with payout only
          if (!isConnected && (error.message?.includes('not connected') || error.message?.includes('revenue') || error.message?.includes('conversion'))) {
            console.log(`[Ringba] Revenue update rejected for non-connected call, retrying with payout only: ${error.message}`);
            // Retry with payout only
            const payoutOnlyPayload = {
              reason: 'Call payments adjusted by eLocal sync service.',
              newPayoutAmount: Number(finalPayout)
            };
            const retryEither = await updateCallPayment(accountId, apiToken)(payoutLegId, payoutOnlyPayload)();
            if (retryEither._tag === 'Left') {
              const retryError = retryEither.left;
              const errorMsg = `Update single leg failed (payout only): ${retryError.message || retryError}`;
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
            updateResults.push({ leg: 'both', result: retryEither.right, revenueSkipped: 'not connected' });
          } else {
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
        } else {
          updateResults.push({ leg: 'both', result: updateEither.right });
        }
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
        
        // Update revenue leg to same value as payout
        // Always set both to the same value from database, even if one was absent
        // Always try to update revenue, even if call is not connected (Ringba may reject it, but we try)
        console.log(`[Ringba] Updating revenue leg ${revenueLegId} to $${finalRevenue} (same as payout${isConnected ? ', connected call' : ', not connected - Ringba may reject'})...`);
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
          // If call is not connected and Ringba rejects revenue update, log warning but don't fail
          // This is expected behavior for non-connected calls
          if (!isConnected && (error.message?.includes('not connected') || error.message?.includes('revenue'))) {
            console.log(`[Ringba] Revenue update rejected for non-connected call (expected): ${error.message}`);
            updateResults.push({ leg: 'revenue', skipped: 'not connected', error: error.message });
          } else {
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
        } else {
          updateResults.push({ leg: 'revenue', result: revenueUpdateEither.right });
        }
      }
      
      updateResult = {
        isSameLeg,
        isMultiLeg,
        payoutLeg: { id: payoutLegId, result: updateResults.find(r => r.leg === 'payout' || r.leg === 'both')?.result },
        revenueLeg: { 
          id: revenueLegId, 
          result: updateResults.find(r => r.leg === 'revenue' || r.leg === 'both')?.result,
          skipped: updateResults.find(r => r.leg === 'revenue' || r.leg === 'both')?.skipped || null
        }
      };
      
      // Set final values - both always set to same value from database
      // Even if revenue couldn't be updated in Ringba (not connected), we still record both as same value
      // This ensures consistency: both revenue and payout are always the same value from DB
      finalRevenue = finalPayout; // Always same as payout (from database)
      finalPayout = finalPayout; // From database row

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

