// Script to analyze and fix data issues for 2025-11-14
import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'elocal_scraper.db');

const main = () => {
  console.log('========================================');
  console.log('Data Analysis for 2025-11-14');
  console.log('========================================\n');
  
  const db = new Database(DB_PATH);
  
  // Current totals
  const currentStats = db.prepare(`
    SELECT 
      category,
      COUNT(*) as count,
      ROUND(SUM(payout), 2) as total_payout
    FROM elocal_call_data
    WHERE date(date_of_call) = '2025-11-14'
    GROUP BY category
  `).all();
  
  console.log('Current Database Totals:');
  let currentStatic = 0;
  let currentApi = 0;
  for (const stat of currentStats) {
    console.log(`  ${stat.category}: ${stat.count} calls, Total: $${parseFloat(stat.total_payout || 0).toFixed(2)}`);
    if (stat.category === 'STATIC') currentStatic = parseFloat(stat.total_payout || 0);
    if (stat.category === 'API') currentApi = parseFloat(stat.total_payout || 0);
  }
  
  console.log('\nExpected Totals:');
  console.log(`  STATIC: $282.10`);
  console.log(`  API: $385.50`);
  
  console.log('\nDifferences:');
  console.log(`  STATIC: Missing $${(282.10 - currentStatic).toFixed(2)}`);
  console.log(`  API: Extra $${(currentApi - 385.50).toFixed(2)}`);
  
  // Find duplicate calls (same caller ID in both categories)
  console.log('\n========================================');
  console.log('Duplicate Calls Analysis');
  console.log('========================================\n');
  
  const duplicates = db.prepare(`
    SELECT 
      a.caller_id,
      a.date_of_call as api_time,
      a.payout as api_payout,
      s.date_of_call as static_time,
      s.payout as static_payout,
      ABS((julianday(a.date_of_call) - julianday(s.date_of_call)) * 24 * 60) as time_diff_minutes
    FROM elocal_call_data a
    INNER JOIN elocal_call_data s ON a.caller_id = s.caller_id
    WHERE date(a.date_of_call) = '2025-11-14'
      AND date(s.date_of_call) = '2025-11-14'
      AND a.category = 'API'
      AND s.category = 'STATIC'
      AND a.payout > 0
      AND s.payout > 0
    ORDER BY a.caller_id, a.date_of_call
  `).all();
  
  console.log(`Found ${duplicates.length} duplicate caller IDs in both categories:\n`);
  let duplicateApiTotal = 0;
  for (const dup of duplicates) {
    const timeDiff = parseFloat(dup.time_diff_minutes).toFixed(1);
    console.log(`  ${dup.caller_id}:`);
    console.log(`    API: ${dup.api_time} - $${dup.api_payout} (${timeDiff} min difference)`);
    console.log(`    STATIC: ${dup.static_time} - $${dup.static_payout}`);
    duplicateApiTotal += parseFloat(dup.api_payout);
  }
  
  console.log(`\nTotal of duplicate API calls: $${duplicateApiTotal.toFixed(2)}`);
  
  // Calculate what totals would be if we remove duplicates from API
  const apiWithoutDuplicates = currentApi - duplicateApiTotal;
  console.log(`\nIf we remove duplicates from API:`);
  console.log(`  API would be: $${apiWithoutDuplicates.toFixed(2)}`);
  console.log(`  Still missing: $${(385.50 - apiWithoutDuplicates).toFixed(2)} from expected $385.50`);
  
  // Show all STATIC calls with payout
  console.log('\n========================================');
  console.log('STATIC Calls (with payout > 0)');
  console.log('========================================\n');
  
  const staticCalls = db.prepare(`
    SELECT caller_id, date_of_call, payout
    FROM elocal_call_data
    WHERE date(date_of_call) = '2025-11-14'
      AND category = 'STATIC'
      AND payout > 0
    ORDER BY payout DESC
  `).all();
  
  let staticSum = 0;
  for (const call of staticCalls) {
    console.log(`  ${call.caller_id} - ${call.date_of_call} - $${call.payout}`);
    staticSum += parseFloat(call.payout);
  }
  console.log(`\n  Sum: $${staticSum.toFixed(2)} (should be $282.10, missing $${(282.10 - staticSum).toFixed(2)})`);
  
  // Show all API calls with payout
  console.log('\n========================================');
  console.log('API Calls (with payout > 0)');
  console.log('========================================\n');
  
  const apiCalls = db.prepare(`
    SELECT 
      caller_id, 
      date_of_call, 
      payout,
      CASE 
        WHEN caller_id IN (
          SELECT DISTINCT caller_id 
          FROM elocal_call_data 
          WHERE date(date_of_call) = '2025-11-14' 
          AND category = 'STATIC'
          AND payout > 0
        ) THEN 'DUPLICATE'
        ELSE ''
      END as is_duplicate
    FROM elocal_call_data
    WHERE date(date_of_call) = '2025-11-14'
      AND category = 'API'
      AND payout > 0
    ORDER BY payout DESC
  `).all();
  
  let apiSum = 0;
  let duplicateSum = 0;
  for (const call of apiCalls) {
    const dupLabel = call.is_duplicate ? ' [DUPLICATE]' : '';
    console.log(`  ${call.caller_id} - ${call.date_of_call} - $${call.payout}${dupLabel}`);
    apiSum += parseFloat(call.payout);
    if (call.is_duplicate) {
      duplicateSum += parseFloat(call.payout);
    }
  }
  console.log(`\n  Sum: $${apiSum.toFixed(2)} (should be $385.50)`);
  console.log(`  Duplicates: $${duplicateSum.toFixed(2)}`);
  console.log(`  Without duplicates: $${(apiSum - duplicateSum).toFixed(2)} (still missing $${(385.50 - (apiSum - duplicateSum)).toFixed(2)})`);
  
  console.log('\n========================================');
  console.log('Recommendation');
  console.log('========================================\n');
  console.log('The issue appears to be:');
  console.log('1. Some calls appear in BOTH campaigns on eLocal (duplicates)');
  console.log('2. Some calls may be missing from STATIC (missing $17.50)');
  console.log('3. Some calls may be missing from API (missing $78.00 after removing duplicates)');
  console.log('\nNext steps:');
  console.log('- Need to determine which category each duplicate call should belong to');
  console.log('- Re-fetch data to ensure all calls are captured');
  console.log('- Possibly need to check eLocal website directly to verify expected totals');
  
  db.close();
};

main();

