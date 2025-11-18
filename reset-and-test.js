import Database from 'better-sqlite3';

const db = new Database('data/elocal_scraper.db');

// Reset the call to pending status so we can test again
db.prepare("UPDATE elocal_call_data SET ringba_sync_status = 'pending', payout = 210 WHERE id = 1145").run();
const call = db.prepare('SELECT id, payout, ringba_sync_status FROM elocal_call_data WHERE id = 1145').get();
console.log('Call reset:');
console.log('  ID:', call.id);
console.log('  Payout:', call.payout);
console.log('  Status:', call.ringba_sync_status);
db.close();

