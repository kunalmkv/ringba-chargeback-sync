import Database from 'better-sqlite3';
import { optimizedConfig } from './src/config/optimized-config.js';
import { getCallDetails } from './src/http/ringba-client.js';
import * as TE from 'fp-ts/lib/TaskEither.js';

const config = optimizedConfig.create();
const db = new Database('./data/elocal_scraper.db');

const accountId = config.ringbaAccountId;
const apiToken = config.ringbaApiToken;

console.log('\n=== Ringba Values Verification ===\n');

// Get recently synced calls
const rows = db.prepare(`
  SELECT id, caller_id, adjustment_amount, ringba_inbound_call_id, payout
  FROM campaign_calls
  WHERE ringba_sync_status = 'success'
    AND ringba_inbound_call_id IS NOT NULL
  ORDER BY id DESC
  LIMIT 15
`).all();

console.log(`Checking ${rows.length} recently synced calls...\n`);

let checked = 0;
let matches = 0;
let mismatches = 0;

for (const row of rows) {
  try {
    console.log(`[${row.id}] Caller: ${row.caller_id}`);
    console.log(`  Adjustment: $${row.adjustment_amount}`);
    console.log(`  eLocal payout: $${row.payout}`);
    console.log(`  Ringba Call ID: ${row.ringba_inbound_call_id}`);
    
    // Get current values from Ringba
    const detailsEither = await getCallDetails(accountId, apiToken)(row.ringba_inbound_call_id)();
    
    if (detailsEither._tag === 'Left') {
      console.log(`  ❌ ERROR: Failed to get Ringba call details: ${detailsEither.left.message}`);
      console.log('');
      continue;
    }
    
    const details = detailsEither.right;
    const currentRevenue = Number(details.revenue || 0);
    const currentPayout = Number(details.payout || 0);
    
    console.log(`  Current Ringba values:`);
    console.log(`    Revenue: $${currentRevenue}`);
    console.log(`    Payout: $${currentPayout}`);
    
    // Expected values after adjustment (should be 0 for voided calls with negative adjustments)
    const expectedRevenue = 0;
    const expectedPayout = 0;
    
    const revenueMatches = Math.abs(currentRevenue - expectedRevenue) < 0.01;
    const payoutMatches = Math.abs(currentPayout - expectedPayout) < 0.01;
    
    if (revenueMatches && payoutMatches) {
      console.log(`  ✅ Values match expected: revenue=$${expectedRevenue}, payout=$${expectedPayout}`);
      matches++;
    } else {
      console.log(`  ⚠️  Values don't match expected:`);
      console.log(`     Expected: revenue=$${expectedRevenue}, payout=$${expectedPayout}`);
      console.log(`     Actual:   revenue=$${currentRevenue}, payout=$${currentPayout}`);
      console.log(`     Difference: revenue=\$${Math.abs(currentRevenue - expectedRevenue)}, payout=\$${Math.abs(currentPayout - expectedPayout)}`);
      mismatches++;
    }
    
    checked++;
    console.log('');
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 800));
    
  } catch (error) {
    console.log(`  ❌ ERROR: ${error.message}`);
    console.log('');
  }
}

console.log('=== Summary ===');
console.log(`Total checked: ${checked}`);
console.log(`✅ Matches expected (0.00): ${matches}`);
console.log(`⚠️  Mismatches: ${mismatches}`);

db.close();


