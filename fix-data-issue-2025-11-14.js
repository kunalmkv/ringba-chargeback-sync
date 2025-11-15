// Script to analyze and provide recommendations for fixing data issues
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
  console.log('Data Issue Analysis for 2025-11-14');
  console.log('========================================\n');
  
  const db = new Database(DB_PATH);
  
  // Current totals
  const stats = db.prepare(`
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
  for (const stat of stats) {
    console.log(`  ${stat.category}: ${stat.count} calls, Total: $${parseFloat(stat.total_payout || 0).toFixed(2)}`);
    if (stat.category === 'STATIC') currentStatic = parseFloat(stat.total_payout || 0);
    if (stat.category === 'API') currentApi = parseFloat(stat.total_payout || 0);
  }
  
  console.log('\nExpected Totals:');
  console.log(`  STATIC: $282.10 (missing $${(282.10 - currentStatic).toFixed(2)})`);
  console.log(`  API: $385.50 (extra $${(currentApi - 385.50).toFixed(2)})`);
  
  // Find duplicates
  const duplicates = db.prepare(`
    SELECT 
      a.caller_id,
      a.date_of_call as api_time,
      a.payout as api_payout,
      a.id as api_id,
      s.date_of_call as static_time,
      s.payout as static_payout,
      s.id as static_id,
      ABS((julianday(a.date_of_call) - julianday(s.date_of_call)) * 24 * 60) as time_diff_minutes
    FROM elocal_call_data a
    INNER JOIN elocal_call_data s ON a.caller_id = s.caller_id
    WHERE date(a.date_of_call) = '2025-11-14'
      AND date(s.date_of_call) = '2025-11-14'
      AND a.category = 'API'
      AND s.category = 'STATIC'
      AND a.payout > 0
      AND s.payout > 0
    ORDER BY a.caller_id
  `).all();
  
  console.log('\n========================================');
  console.log('Duplicate Calls (in both categories)');
  console.log('========================================\n');
  
  let duplicateApiTotal = 0;
  for (const dup of duplicates) {
    const timeDiff = parseFloat(dup.time_diff_minutes).toFixed(1);
    console.log(`${dup.caller_id}:`);
    console.log(`  API: ID=${dup.api_id}, Time=${dup.api_time}, Payout=$${dup.api_payout} (${timeDiff} min difference)`);
    console.log(`  STATIC: ID=${dup.static_id}, Time=${dup.static_time}, Payout=$${dup.static_payout}`);
    duplicateApiTotal += parseFloat(dup.api_payout);
  }
  
  console.log(`\nTotal duplicates in API: $${duplicateApiTotal.toFixed(2)}`);
  
  // Calculate what totals would be
  const apiWithoutDuplicates = currentApi - duplicateApiTotal;
  console.log(`\nIf we remove duplicates from API:`);
  console.log(`  API would be: $${apiWithoutDuplicates.toFixed(2)}`);
  console.log(`  Still missing: $${(385.50 - apiWithoutDuplicates).toFixed(2)} from expected`);
  
  console.log('\n========================================');
  console.log('Analysis Summary');
  console.log('========================================\n');
  console.log('Issues identified:');
  console.log(`1. ${duplicates.length} duplicate calls appear in both categories ($${duplicateApiTotal.toFixed(2)} in API)`);
  console.log(`2. STATIC missing $${(282.10 - currentStatic).toFixed(2)} (${((282.10 - currentStatic) / 282.10 * 100).toFixed(1)}% of expected)`);
  console.log(`3. API has extra $${(currentApi - 385.50).toFixed(2)} (${((currentApi - 385.50) / 385.50 * 100).toFixed(1)}% more than expected)`);
  
  console.log('\nPossible causes:');
  console.log('- Some calls appear in BOTH campaigns on eLocal (duplicates)');
  console.log('- Some calls may not be scraped (pagination issue or filtering)');
  console.log('- Some calls may be in wrong category');
  console.log('- Expected totals might include adjustments or other factors');
  
  console.log('\nRecommendations:');
  console.log('1. Determine which category each duplicate should belong to');
  console.log('2. Check eLocal website directly to verify expected totals');
  console.log('3. Verify if adjustments should be included in totals');
  console.log('4. Check if there are more pages to fetch');
  
  // Show SQL to remove duplicates from API (if needed)
  if (duplicates.length > 0) {
    console.log('\n========================================');
    console.log('SQL to Remove Duplicates from API');
    console.log('========================================\n');
    console.log('-- WARNING: This will delete duplicate calls from API category');
    console.log('-- Review the IDs below before executing\n');
    const apiIds = duplicates.map(d => d.api_id).join(', ');
    console.log(`DELETE FROM ringba_sync_logs WHERE campaign_call_id IN (${apiIds});`);
    console.log(`DELETE FROM elocal_call_data WHERE id IN (${apiIds});`);
    console.log('\nAfter removal, API total would be: $' + apiWithoutDuplicates.toFixed(2));
  }
  
  db.close();
};

main();

