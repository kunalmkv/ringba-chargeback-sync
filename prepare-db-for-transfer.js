// Script to checkpoint WAL and prepare database for transfer
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, 'data', 'elocal_scraper.db');

console.log('========================================');
console.log('Preparing Database for Transfer');
console.log('========================================');
console.log(`Database: ${DB_PATH}`);
console.log('');

const db = new Database(DB_PATH);

try {
  // Check current journal mode
  const journalMode = db.pragma('journal_mode', { simple: true });
  console.log(`Current journal mode: ${journalMode}`);
  
  // Checkpoint WAL to merge all changes into main database
  console.log('Checkpointing WAL...');
  const checkpointResult = db.pragma('wal_checkpoint(FULL)', { simple: false });
  console.log(`Checkpoint result:`, checkpointResult);
  
  // Close the database connection
  db.close();
  
  // Reopen and switch to DELETE mode (no WAL file)
  console.log('Switching to DELETE journal mode...');
  const db2 = new Database(DB_PATH);
  db2.pragma('journal_mode = DELETE');
  
  // Verify row count
  const count = db2.prepare('SELECT COUNT(*) as count FROM revenue_summary').get();
  console.log(`✅ Revenue summary rows: ${count.count}`);
  
  // Get date range
  const dateRange = db2.prepare(`
    SELECT MIN(date) as min_date, MAX(date) as max_date
    FROM revenue_summary
  `).get();
  console.log(`📅 Date range: ${dateRange.min_date} to ${dateRange.max_date}`);
  
  db2.close();
  
  console.log('');
  console.log('========================================');
  console.log('✅ Database prepared for transfer!');
  console.log('========================================');
  console.log('You can now safely copy the database file.');
  console.log('The WAL file has been merged into the main database.');
  console.log('');
  
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}

