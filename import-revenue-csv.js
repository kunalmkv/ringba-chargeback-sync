// Script to import revenue summary data from CSV file
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'elocal_scraper.db');
const CSV_PATH = path.join(__dirname, 'data', 'Ringba Update - Sheet1.csv');

// Helper to parse currency value (remove $ and commas)
const parseCurrency = (value) => {
  if (!value || value.trim() === '' || value === '#DIV/0!' || value === '#VALUE!') {
    return 0;
  }
  const cleaned = value.toString().replace(/[$,]/g, '').trim();
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
};

// Helper to parse percentage value
const parsePercentage = (value) => {
  if (!value || value.trim() === '' || value === '#DIV/0!' || value === '#VALUE!') {
    return 0;
  }
  const cleaned = value.toString().replace(/[%,]/g, '').trim();
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
};

// Helper to convert date from DD/MM/YYYY to YYYY-MM-DD
const convertDate = (dateStr) => {
  if (!dateStr || dateStr.trim() === '') {
    return null;
  }
  
  // Handle DD/MM/YYYY format (dates in CSV are in this format)
  const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    const [, day, month, year] = match; // Note: day comes first, then month
    // Validate date
    const dayNum = parseInt(day, 10);
    const monthNum = parseInt(month, 10);
    const yearNum = parseInt(year, 10);
    
    // Basic validation
    if (monthNum < 1 || monthNum > 12) {
      console.warn(`Invalid month in date: ${dateStr}`);
      return null;
    }
    if (dayNum < 1 || dayNum > 31) {
      console.warn(`Invalid day in date: ${dateStr}`);
      return null;
    }
    
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  // Try to parse as Date object (fallback)
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch (error) {
    // Ignore
  }
  
  return null;
};

// Parse CSV file
const parseCSV = (csvPath) => {
  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  if (lines.length < 3) {
    throw new Error('CSV file must have at least 3 lines (header + data)');
  }
  
  // Skip header rows (first 2 lines)
  const dataLines = lines.slice(2);
  
  const records = [];
  
  for (const line of dataLines) {
    // Parse CSV line (handle quoted values)
    const values = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim()); // Add last value
    
    // Skip empty rows
    if (values.length === 0 || values.every(v => !v || v.trim() === '')) {
      continue;
    }
    
    // Extract relevant columns:
    // Column 0: DATE
    // Column 1: RINGBA Static
    // Column 2: RINGBA API
    // Column 3: E-Local Static
    // Column 4: E-Local API
    // (Ignore rest of columns)
    
    const date = convertDate(values[0]);
    if (!date) {
      console.warn(`Skipping row with invalid date: ${values[0]}`);
      continue;
    }
    
    const ringbaStatic = parseCurrency(values[1] || '0');
    const ringbaApi = parseCurrency(values[2] || '0');
    const elocalStatic = parseCurrency(values[3] || '0');
    const elocalApi = parseCurrency(values[4] || '0');
    
    // Skip rows where all values are zero
    if (ringbaStatic === 0 && ringbaApi === 0 && elocalStatic === 0 && elocalApi === 0) {
      continue;
    }
    
    records.push({
      date,
      ringbaStatic,
      ringbaApi,
      elocalStatic,
      elocalApi
    });
  }
  
  return records;
};

// Main import function
const importRevenueData = async () => {
  console.log('========================================');
  console.log('Revenue Summary CSV Import');
  console.log('========================================');
  console.log(`CSV File: ${CSV_PATH}`);
  console.log(`Database: ${DB_PATH}`);
  console.log('');
  
  // Check if CSV file exists
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`CSV file not found: ${CSV_PATH}`);
  }
  
  // Check if database exists
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`Database file not found: ${DB_PATH}`);
  }
  
  // Parse CSV
  console.log('📄 Parsing CSV file...');
  const records = parseCSV(CSV_PATH);
  console.log(`✅ Parsed ${records.length} records from CSV`);
  console.log('');
  
  // Connect to database
  console.log('🔌 Connecting to database...');
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  
  try {
    // Delete all existing data
    console.log('🗑️  Deleting existing revenue_summary data...');
    const deleteResult = db.prepare('DELETE FROM revenue_summary').run();
    console.log(`✅ Deleted ${deleteResult.changes} existing records`);
    console.log('');
    
    // Prepare insert statement
    const insertStmt = db.prepare(`
      INSERT INTO revenue_summary (
        date, ringba_static, ringba_api, ringba_total,
        elocal_static, elocal_api, elocal_total, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    // Insert records in transaction
    console.log('💾 Inserting new records...');
    const insertMany = db.transaction((records) => {
      let inserted = 0;
      let skipped = 0;
      
      for (const record of records) {
        try {
          const ringbaTotal = record.ringbaStatic + record.ringbaApi;
          const elocalTotal = record.elocalStatic + record.elocalApi;
          
          insertStmt.run(
            record.date,
            record.ringbaStatic,
            record.ringbaApi,
            ringbaTotal,
            record.elocalStatic,
            record.elocalApi,
            elocalTotal
          );
          
          inserted++;
        } catch (error) {
          console.warn(`⚠️  Skipped record for ${record.date}: ${error.message}`);
          skipped++;
        }
      }
      
      return { inserted, skipped };
    });
    
    const result = insertMany(records);
    
    console.log('');
    console.log('========================================');
    console.log('✅ Import Completed');
    console.log('========================================');
    console.log(`Records inserted: ${result.inserted}`);
    console.log(`Records skipped: ${result.skipped}`);
    console.log(`Total processed: ${records.length}`);
    console.log('');
    
    // Verify import
    const count = db.prepare('SELECT COUNT(*) as count FROM revenue_summary').get();
    console.log(`📊 Total records in database: ${count.count}`);
    
    // Show date range
    const dateRange = db.prepare(`
      SELECT 
        MIN(date) as min_date,
        MAX(date) as max_date
      FROM revenue_summary
    `).get();
    
    if (dateRange.min_date && dateRange.max_date) {
      console.log(`📅 Date range: ${dateRange.min_date} to ${dateRange.max_date}`);
    }
    
    // Show summary totals
    const totals = db.prepare(`
      SELECT 
        SUM(ringba_static) as total_ringba_static,
        SUM(ringba_api) as total_ringba_api,
        SUM(ringba_total) as total_ringba,
        SUM(elocal_static) as total_elocal_static,
        SUM(elocal_api) as total_elocal_api,
        SUM(elocal_total) as total_elocal
      FROM revenue_summary
    `).get();
    
    console.log('');
    console.log('💰 Summary Totals:');
    console.log(`  Ringba Static: $${(totals.total_ringba_static || 0).toFixed(2)}`);
    console.log(`  Ringba API: $${(totals.total_ringba_api || 0).toFixed(2)}`);
    console.log(`  Ringba Total: $${(totals.total_ringba || 0).toFixed(2)}`);
    console.log(`  Elocal Static: $${(totals.total_elocal_static || 0).toFixed(2)}`);
    console.log(`  Elocal API: $${(totals.total_elocal_api || 0).toFixed(2)}`);
    console.log(`  Elocal Total: $${(totals.total_elocal || 0).toFixed(2)}`);
    console.log('========================================');
    
  } catch (error) {
    console.error('❌ Error during import:', error.message);
    throw error;
  } finally {
    db.close();
  }
};

// Run import
importRevenueData()
  .then(() => {
    console.log('');
    console.log('✅ Import completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('');
    console.error('❌ Import failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  });

