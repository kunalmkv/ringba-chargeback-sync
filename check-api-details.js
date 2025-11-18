import Database from 'better-sqlite3';

const db = new Database('data/elocal_scraper.db');

const log = db.prepare(`
  SELECT 
    api_request, 
    api_response, 
    error_message,
    lookup_result,
    revenue,
    payout
  FROM ringba_sync_logs 
  WHERE campaign_call_id = 1145 
  ORDER BY sync_attempted_at DESC 
  LIMIT 1
`).get();

if (log) {
  console.log('=== Sync Log Details ===\n');
  
  if (log.api_request) {
    try {
      const req = JSON.parse(log.api_request);
      console.log('API Request:');
      console.log(JSON.stringify(req, null, 2));
      console.log('\nContains newConversionAmount:', req.newConversionAmount !== undefined);
      console.log('Contains newPayoutAmount:', req.newPayoutAmount !== undefined);
    } catch (e) {
      console.log('API Request (raw):', log.api_request);
    }
  }
  
  if (log.api_response) {
    try {
      const resp = JSON.parse(log.api_response);
      console.log('\nAPI Response:');
      console.log(JSON.stringify(resp, null, 2));
    } catch (e) {
      console.log('\nAPI Response (raw):', log.api_response);
    }
  }
  
  if (log.lookup_result) {
    try {
      const lookup = JSON.parse(log.lookup_result);
      console.log('\nLookup Result:');
      console.log('  Inbound Call ID:', lookup.inboundCallId);
      console.log('  Payout Match:', lookup.payoutMatch);
    } catch (e) {
      console.log('\nLookup Result (raw):', log.lookup_result);
    }
  }
  
  console.log('\nLogged Values:');
  console.log('  Revenue:', log.revenue);
  console.log('  Payout:', log.payout);
  
  if (log.error_message) {
    console.log('\nError:', log.error_message);
  }
} else {
  console.log('No sync log found');
}

db.close();

