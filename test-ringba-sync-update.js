// Test script to verify ringba-sync service updates both revenue and payout to the same value
// Test case: Update payout and revenue to 250 for call on 11/17/25 11:25 AM EST, caller (929) 406-3629, STATIC category

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { syncAdjustmentsToRingba } from './src/services/ringba-sync.js';
import { optimizedConfig } from './src/config/optimized-config.js';
import * as TE from 'fp-ts/lib/TaskEither.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const config = optimizedConfig.create();

// Test parameters
const TEST_CALLER_ID = '(929) 406-3629';
const TEST_DATE_EST = '11/17/25 11:25 AM EST';
const TEST_CATEGORY = 'STATIC';
const TEST_PAYOUT = 250; // Updated to test both revenue and payout set to same value

// Convert EST date to database format
// EST is UTC-5, but we need to handle the date properly
// 11/17/25 11:25 AM EST = November 17, 2025, 11:25 AM Eastern Time
function convertESTToDatabaseFormat(dateStr) {
  // Parse: "11/17/25 11:25 AM EST"
  // Format: YYYY-MM-DD HH:MM:SS
  try {
    // Parse the date string
    // Month is 11 (November), day is 17, year is 2025
    // Time is 11:25 AM
    const parts = dateStr.split(' ');
    const datePart = parts[0]; // "11/17/25"
    const timePart = parts[1] + ' ' + parts[2]; // "11:25 AM"
    
    const [month, day, year] = datePart.split('/');
    const fullYear = '20' + year; // 2025
    
    // Parse time
    const [time, ampm] = timePart.split(' ');
    const [hours, minutes] = time.split(':');
    let hour24 = parseInt(hours);
    if (ampm === 'PM' && hour24 !== 12) hour24 += 12;
    if (ampm === 'AM' && hour24 === 12) hour24 = 0;
    
    // Format as YYYY-MM-DD HH:MM:SS
    const formattedDate = `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${hour24.toString().padStart(2, '0')}:${minutes}:00`;
    
    console.log(`[TEST] Converted date: "${dateStr}" -> "${formattedDate}"`);
    return formattedDate;
  } catch (error) {
    console.error(`[TEST] Error parsing date: ${error.message}`);
    throw error;
  }
}

// Find and update the call in database
function findAndUpdateCall() {
  const dbPath = join(__dirname, config.databasePath || 'data/elocal_scraper.db');
  console.log(`[TEST] Opening database: ${dbPath}`);
  
  const db = new Database(dbPath);
  
  try {
    // Convert date to database format
    const dbDate = convertESTToDatabaseFormat(TEST_DATE_EST);
    
    // First, try to find the call with exact date match
    console.log(`[TEST] Searching for call:`);
    console.log(`  - Caller ID: ${TEST_CALLER_ID}`);
    console.log(`  - Date: ${dbDate}`);
    console.log(`  - Category: ${TEST_CATEGORY}`);
    
    // Search for calls matching the criteria
    // Date might be stored in different formats, so we'll search with LIKE
    const dateOnly = dbDate.split(' ')[0]; // YYYY-MM-DD
    
    // Also try alternative date formats
    // Format: 11/17/2025 or 2025-11-17 or 2025-11-17 16:25:00 (UTC)
    const [month, day, year] = dateOnly.split('-');
    const altDate1 = `${month}/${day}/${year}`; // MM/DD/YYYY
    const altDate2 = `${year}-${month}-${day}`; // YYYY-MM-DD (already have this)
    
    let query = `
      SELECT 
        id, date_of_call, caller_id, category, payout, 
        ringba_sync_status, ringba_inbound_call_id,
        campaign_phone
      FROM elocal_call_data
      WHERE caller_id = ?
        AND category = ?
        AND (
          date_of_call LIKE ? 
          OR date_of_call = ?
          OR date_of_call LIKE ?
          OR date(date_of_call) = date(?)
        )
      ORDER BY id DESC
      LIMIT 10
    `;
    
    const results = db.prepare(query).all(
      TEST_CALLER_ID,
      TEST_CATEGORY,
      `${dateOnly}%`, // Match any time on that date (YYYY-MM-DD HH:MM:SS)
      dbDate, // Exact match
      `${altDate1}%`, // Match MM/DD/YYYY format
      dateOnly // Date only match
    );
    
    console.log(`[TEST] Found ${results.length} matching call(s):`);
    results.forEach((row, idx) => {
      console.log(`  ${idx + 1}. ID: ${row.id}, Date: ${row.date_of_call}, Payout: $${row.payout}, Status: ${row.ringba_sync_status || 'NULL'}`);
    });
    
    if (results.length === 0) {
      console.error(`[TEST] ❌ No call found matching the criteria!`);
      console.log(`[TEST] Searching for similar calls...`);
      
      // Try searching without exact date match
      const similarQuery = `
        SELECT 
          id, date_of_call, caller_id, category, payout, 
          ringba_sync_status, ringba_inbound_call_id
        FROM elocal_call_data
        WHERE caller_id = ?
          AND category = ?
        ORDER BY date_of_call DESC
        LIMIT 10
      `;
      
      const similarResults = db.prepare(similarQuery).all(TEST_CALLER_ID, TEST_CATEGORY);
      if (similarResults.length > 0) {
        console.log(`[TEST] Found ${similarResults.length} call(s) with same caller ID and category:`);
        similarResults.forEach((row, idx) => {
          console.log(`  ${idx + 1}. ID: ${row.id}, Date: ${row.date_of_call}, Payout: $${row.payout}`);
        });
      }
      
      db.close();
      throw new Error('No matching call found in database');
    }
    
    // Use the first result (most recent)
    const callToUpdate = results[0];
    console.log(`[TEST] ✅ Found call to update:`);
    console.log(`  - ID: ${callToUpdate.id}`);
    console.log(`  - Date: ${callToUpdate.date_of_call}`);
    console.log(`  - Current Payout: $${callToUpdate.payout}`);
    console.log(`  - Current Status: ${callToUpdate.ringba_sync_status || 'NULL'}`);
    console.log(`  - Ringba Inbound Call ID: ${callToUpdate.ringba_inbound_call_id || 'NULL'}`);
    
    // Update payout to TEST_PAYOUT (250) and reset sync status to pending
    // Note: The database only has a 'payout' column, but the sync service will set both revenue and payout to the same value
    console.log(`[TEST] Updating call:`);
    console.log(`  - Setting payout to $${TEST_PAYOUT}`);
    console.log(`  - Revenue will also be set to $${TEST_PAYOUT} by sync service (same value)`);
    console.log(`  - Resetting sync status to 'pending'`);
    
    const updateStmt = db.prepare(`
      UPDATE elocal_call_data
      SET payout = ?,
          ringba_sync_status = 'pending',
          ringba_sync_at = NULL,
          ringba_sync_response = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    
    const updateResult = updateStmt.run(TEST_PAYOUT, callToUpdate.id);
    
    if (updateResult.changes === 0) {
      db.close();
      throw new Error('Failed to update call in database');
    }
    
    console.log(`[TEST] ✅ Successfully updated call ID ${callToUpdate.id}`);
    
    // Verify the update
    const verifyStmt = db.prepare(`
      SELECT id, date_of_call, caller_id, category, payout, ringba_sync_status
      FROM elocal_call_data
      WHERE id = ?
    `);
    
    const verified = verifyStmt.get(callToUpdate.id);
    console.log(`[TEST] ✅ Verification - Updated call:`);
    console.log(`  - ID: ${verified.id}`);
    console.log(`  - Payout: $${verified.payout}`);
    console.log(`  - Status: ${verified.ringba_sync_status}`);
    
    db.close();
    
    return {
      callId: callToUpdate.id,
      dateOfCall: callToUpdate.date_of_call,
      callerId: callToUpdate.caller_id,
      category: callToUpdate.category,
      oldPayout: callToUpdate.payout,
      newPayout: TEST_PAYOUT,
      ringbaInboundCallId: callToUpdate.ringba_inbound_call_id
    };
    
  } catch (error) {
    db.close();
    throw error;
  }
}

// Run the sync service
async function runSyncService() {
  console.log(`\n[TEST] ========================================`);
  console.log(`[TEST] Running Ringba Sync Service...`);
  console.log(`[TEST] ========================================\n`);
  
  const resultEither = await syncAdjustmentsToRingba(config)(TEST_CATEGORY)();
  
  if (resultEither._tag === 'Left') {
    const error = resultEither.left;
    throw new Error(`Sync service failed: ${error.message || error}`);
  }
  
  const result = resultEither.right;
  console.log(`\n[TEST] ✅ Sync service completed:`);
  console.log(`  - Synced: ${result.synced}`);
  console.log(`  - Failed: ${result.failed}`);
  console.log(`  - Skipped: ${result.skipped}`);
  
  return result;
}

// Check sync logs to verify the update
function checkSyncLogs(callId) {
  const dbPath = join(__dirname, config.databasePath || 'data/elocal_scraper.db');
  const db = new Database(dbPath);
  
  try {
    console.log(`\n[TEST] ========================================`);
    console.log(`[TEST] Checking sync logs for call ID ${callId}...`);
    console.log(`[TEST] ========================================\n`);
    
    const query = `
      SELECT 
        id, campaign_call_id, date_of_call, caller_id, category,
        sync_status, revenue, payout,
        ringba_inbound_call_id,
        api_request, api_response,
        error_message,
        sync_attempted_at, sync_completed_at
      FROM ringba_sync_logs
      WHERE campaign_call_id = ?
      ORDER BY sync_attempted_at DESC
      LIMIT 5
    `;
    
    const logs = db.prepare(query).all(callId);
    
    if (logs.length === 0) {
      console.log(`[TEST] ⚠️  No sync logs found for call ID ${callId}`);
      db.close();
      return null;
    }
    
    console.log(`[TEST] Found ${logs.length} sync log(s):\n`);
    
    logs.forEach((log, idx) => {
      console.log(`[TEST] Log ${idx + 1}:`);
      console.log(`  - Sync Status: ${log.sync_status}`);
      console.log(`  - Revenue: $${log.revenue || 'NULL'}`);
      console.log(`  - Payout: $${log.payout || 'NULL'}`);
      console.log(`  - Ringba Inbound Call ID: ${log.ringba_inbound_call_id || 'NULL'}`);
      console.log(`  - Attempted At: ${log.sync_attempted_at || 'NULL'}`);
      console.log(`  - Completed At: ${log.sync_completed_at || 'NULL'}`);
      
      if (log.api_request) {
        try {
          const apiReq = JSON.parse(log.api_request);
          console.log(`  - API Request:`, JSON.stringify(apiReq, null, 2));
        } catch (e) {
          console.log(`  - API Request: ${log.api_request}`);
        }
      }
      
      if (log.api_response) {
        try {
          const apiResp = JSON.parse(log.api_response);
          console.log(`  - API Response:`, JSON.stringify(apiResp, null, 2));
        } catch (e) {
          console.log(`  - API Response: ${log.api_response}`);
        }
      }
      
      if (log.error_message) {
        console.log(`  - Error: ${log.error_message}`);
      }
      
      // Verify both revenue and payout are the same
      if (log.revenue !== null && log.payout !== null) {
        const revenue = parseFloat(log.revenue);
        const payout = parseFloat(log.payout);
        const areEqual = Math.abs(revenue - payout) < 0.01;
        
        console.log(`\n  ✅ VERIFICATION:`);
        if (areEqual) {
          console.log(`     ✅ Revenue ($${revenue}) and Payout ($${payout}) are the SAME value!`);
        } else {
          console.log(`     ❌ Revenue ($${revenue}) and Payout ($${payout}) are DIFFERENT!`);
          console.log(`     ❌ Expected both to be $${TEST_PAYOUT}`);
        }
      } else {
        console.log(`\n  ⚠️  VERIFICATION: Revenue or Payout is NULL`);
      }
      
      console.log('');
    });
    
    db.close();
    return logs[0]; // Return most recent log
  } catch (error) {
    db.close();
    throw error;
  }
}

// Main test function
async function runTest() {
  try {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[TEST] Ringba Sync Update Test`);
    console.log(`${'='.repeat(60)}`);
    console.log(`[TEST] Test Parameters:`);
    console.log(`  - Caller ID: ${TEST_CALLER_ID}`);
    console.log(`  - Date: ${TEST_DATE_EST}`);
    console.log(`  - Category: ${TEST_CATEGORY}`);
    console.log(`  - New Payout Value: $${TEST_PAYOUT}`);
    console.log(`  - New Revenue Value: $${TEST_PAYOUT} (same as payout)`);
    console.log(`${'='.repeat(60)}\n`);
    
    // Step 1: Find and update the call
    console.log(`[TEST] Step 1: Finding and updating call in database...\n`);
    const updatedCall = findAndUpdateCall();
    
    // Step 2: Run sync service
    console.log(`\n[TEST] Step 2: Running sync service...\n`);
    const syncResult = await runSyncService();
    
    // Step 3: Check sync logs
    console.log(`\n[TEST] Step 3: Checking sync logs...\n`);
    const latestLog = checkSyncLogs(updatedCall.callId);
    
    // Final summary
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[TEST] Test Summary`);
    console.log(`${'='.repeat(60)}`);
    console.log(`[TEST] ✅ Call updated in database:`);
    console.log(`  - Call ID: ${updatedCall.callId}`);
    console.log(`  - Payout set to: $${updatedCall.newPayout}`);
    console.log(`\n[TEST] ✅ Sync service results:`);
    console.log(`  - Synced: ${syncResult.synced}`);
    console.log(`  - Failed: ${syncResult.failed}`);
    console.log(`  - Skipped: ${syncResult.skipped}`);
    
    if (latestLog) {
      console.log(`\n[TEST] ✅ Sync log verification:`);
      if (latestLog.revenue !== null && latestLog.payout !== null) {
        const revenue = parseFloat(latestLog.revenue);
        const payout = parseFloat(latestLog.payout);
        const areEqual = Math.abs(revenue - payout) < 0.01;
        const matchesExpected = Math.abs(revenue - TEST_PAYOUT) < 0.01;
        
        if (areEqual && matchesExpected) {
          console.log(`  ✅ SUCCESS: Both revenue and payout are $${revenue} (as expected)`);
          console.log(`  ✅ TEST PASSED: Both values are the same and match expected value of $${TEST_PAYOUT}!`);
        } else if (areEqual) {
          console.log(`  ⚠️  PARTIAL: Both revenue and payout are the same ($${revenue}), but don't match expected ($${TEST_PAYOUT})`);
          console.log(`  ⚠️  This might be because Ringba rejected the revenue update for non-connected calls`);
        } else {
          console.log(`  ❌ FAILED: Revenue ($${revenue}) and Payout ($${payout}) are different!`);
          console.log(`  ❌ Expected both to be $${TEST_PAYOUT}`);
        }
      } else {
        console.log(`  ⚠️  Cannot verify: Revenue or Payout is NULL in sync log`);
      }
    } else {
      console.log(`\n[TEST] ⚠️  No sync logs found - cannot verify update`);
    }
    
    console.log(`${'='.repeat(60)}\n`);
    
  } catch (error) {
    console.error(`\n[TEST] ❌ Test failed: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
runTest();

