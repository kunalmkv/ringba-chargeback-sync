import Database from 'better-sqlite3';

const db = new Database('data/elocal_scraper.db');

// Check the call status
const call = db.prepare('SELECT id, date_of_call, caller_id, category, payout, ringba_sync_status FROM elocal_call_data WHERE id = 1145').get();
console.log('Call Status:');
console.log('  ID:', call.id);
console.log('  Payout:', call.payout);
console.log('  Sync Status:', call.ringba_sync_status);

// Check sync logs
const logs = db.prepare('SELECT * FROM ringba_sync_logs WHERE campaign_call_id = 1145 ORDER BY sync_attempted_at DESC LIMIT 1').get();
if (logs) {
  console.log('\nSync Log Found:');
  console.log('  Status:', logs.sync_status);
  console.log('  Revenue:', logs.revenue);
  console.log('  Payout:', logs.payout);
  console.log('  Attempted:', logs.sync_attempted_at);
  if (logs.revenue !== null && logs.payout !== null) {
    const rev = parseFloat(logs.revenue);
    const pay = parseFloat(logs.payout);
    const match = Math.abs(rev - pay) < 0.01;
    console.log('  ✅ Match:', match ? 'YES - Both are same!' : 'NO - Different values');
    if (match) {
      console.log(`  ✅ Both revenue and payout are $${rev}`);
    } else {
      console.log(`  ❌ Revenue: $${rev}, Payout: $${pay}`);
    }
  }
} else {
  console.log('\n⚠️  No sync log found yet - call has not been processed by sync service');
  console.log('   The sync service was processing other calls when it was canceled.');
}

db.close();

