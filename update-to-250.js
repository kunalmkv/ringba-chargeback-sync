import Database from 'better-sqlite3';

const db = new Database('data/elocal_scraper.db');

// Update the call payout to 250 and reset sync status
db.prepare("UPDATE elocal_call_data SET ringba_sync_status = 'pending', payout = 250 WHERE id = 1145").run();
const call = db.prepare('SELECT id, date_of_call, caller_id, category, payout, ringba_sync_status FROM elocal_call_data WHERE id = 1145').get();
console.log('Call updated:');
console.log('  ID:', call.id);
console.log('  Date:', call.date_of_call);
console.log('  Caller ID:', call.caller_id);
console.log('  Category:', call.category);
console.log('  Payout:', call.payout);
console.log('  Status:', call.ringba_sync_status);
console.log('\n✅ Call updated to $250 and reset to pending status');
db.close();

