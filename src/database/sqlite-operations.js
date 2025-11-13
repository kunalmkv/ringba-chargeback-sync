// SQLite database operations using functional programming
import Database from 'better-sqlite3';
import * as R from 'ramda';
import * as E from 'fp-ts/lib/Either.js';
import * as TE from 'fp-ts/lib/TaskEither.js';
import * as T from 'fp-ts/lib/Task.js';
import fs from 'fs/promises';
import path from 'path';
import { Config, CampaignCall, AdjustmentDetail, ScrapingSession } from '../types/schemas.js';

// SQLite database connection
const createConnection = (config) => {
  try {
    // Ensure data directory exists
    const dbDir = path.dirname(config.dbPath);
    fs.mkdir(dbDir, { recursive: true });
    
    const db = new Database(config.dbPath);
    
    // Enable foreign keys and WAL mode for better performance
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = 1000');
    db.pragma('temp_store = MEMORY');
    
    return db;
  } catch (error) {
    throw new Error(`Failed to create SQLite connection: ${error.message}`);
  }
};

// Database operations using TaskEither for error handling
export const withDatabase = (config) => (operation) =>
  TE.tryCatch(
    async () => {
      const db = createConnection(config);
      try {
        return await operation(db);
      } finally {
        db.close();
      }
    },
    (error) => new Error(`Database operation failed: ${error.message}`)
  );

// Initialize database tables
export const initializeDatabase = (config) =>
  withDatabase(config)(async (db) => {
    // Migration: Check if old table name exists and rename it
    const oldTableExists = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='campaign_calls'
    `).get();
    
    const newTableExists = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='elocal_call_data'
    `).get();
    
    if (oldTableExists && !newTableExists) {
      console.log('🔄 Migrating table: campaign_calls -> elocal_call_data');
      try {
        // Rename table
        db.exec('ALTER TABLE campaign_calls RENAME TO elocal_call_data');
        console.log('✅ Table renamed successfully');
        
        // Drop old indexes (will be recreated with new names)
        try {
          db.exec('DROP INDEX IF EXISTS idx_campaign_calls_caller_id');
          db.exec('DROP INDEX IF EXISTS idx_campaign_calls_date');
          db.exec('DROP INDEX IF EXISTS idx_campaign_calls_phone');
        } catch (error) {
          // Ignore index errors
        }
      } catch (error) {
        console.error('❌ Migration failed:', error.message);
        throw error;
      }
    }
    
    // Create simplified table with only required fields
    // Check if table exists and has correct structure
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='elocal_call_data'
    `).get();
    
    if (tableExists) {
      // Check if table has required columns including adjustment fields
      const columns = db.prepare(`PRAGMA table_info(elocal_call_data)`).all();
      const columnNames = columns.map(col => col.name);
      const requiredColumns = ['date_of_call', 'campaign_phone', 'caller_id', 'payout', 'created_at', 'adjustment_time', 'adjustment_amount', 'adjustment_classification', 'adjustment_duration', 'unmatched', 'category', 'city_state', 'zip_code', 'screen_duration', 'post_screen_duration', 'total_duration', 'assessment', 'classification', 'ringba_inbound_call_id', 'ringba_sync_status', 'ringba_sync_at', 'ringba_sync_response'];
      const hasAllColumns = requiredColumns.every(col => columnNames.includes(col));
      if (!hasAllColumns) {
        console.log('Table structure outdated, adding missing columns...');
        // Add category column if it doesn't exist
        if (!columnNames.includes('category')) {
          db.exec(`ALTER TABLE elocal_call_data ADD COLUMN category TEXT;`);
          // Mark all existing rows as STATIC
          db.exec(`UPDATE elocal_call_data SET category = 'STATIC' WHERE category IS NULL;`);
          console.log('Added category column and marked existing data as STATIC');
        }
      }
    }
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS elocal_call_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date_of_call TEXT NOT NULL,
        campaign_phone TEXT NOT NULL,
        caller_id TEXT NOT NULL,
        payout REAL DEFAULT 0.00,
        category TEXT DEFAULT 'STATIC',
        city_state TEXT,
        zip_code TEXT,
        screen_duration INTEGER,
        post_screen_duration INTEGER,
        total_duration INTEGER,
        assessment TEXT,
        classification TEXT,
        adjustment_time TEXT,
        adjustment_amount REAL,
        adjustment_classification TEXT,
        adjustment_duration INTEGER,
        unmatched INTEGER DEFAULT 0,
        ringba_inbound_call_id TEXT,
        ringba_sync_status TEXT DEFAULT 'pending',
        ringba_sync_at TEXT,
        ringba_sync_response TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(caller_id, date_of_call, campaign_phone, category)
      );
      
      CREATE INDEX IF NOT EXISTS idx_caller_id ON elocal_call_data(caller_id);
      CREATE INDEX IF NOT EXISTS idx_date_of_call ON elocal_call_data(date_of_call);
      CREATE INDEX IF NOT EXISTS idx_campaign_phone ON elocal_call_data(campaign_phone);
      
      CREATE TABLE IF NOT EXISTS adjustment_details (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        time_of_call TEXT NOT NULL,
        adjustment_time TEXT NOT NULL,
        campaign_phone TEXT NOT NULL,
        caller_id TEXT NOT NULL,
        duration INTEGER NOT NULL,
        call_sid TEXT NOT NULL,
        amount REAL NOT NULL,
        classification TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS scraping_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT UNIQUE NOT NULL,
        started_at TEXT DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT,
        status TEXT DEFAULT 'running',
        calls_scraped INTEGER DEFAULT 0,
        adjustments_scraped INTEGER DEFAULT 0,
        error_message TEXT
      );
      
      CREATE TABLE IF NOT EXISTS ringba_sync_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_call_id INTEGER NOT NULL,
        date_of_call TEXT NOT NULL,
        caller_id TEXT NOT NULL,
        adjustment_amount REAL,
        adjustment_classification TEXT,
        ringba_inbound_call_id TEXT,
        sync_status TEXT NOT NULL,
        sync_attempted_at TEXT DEFAULT CURRENT_TIMESTAMP,
        sync_completed_at TEXT,
        revenue REAL,
        payout REAL,
        lookup_result TEXT,
        api_request TEXT,
        api_response TEXT,
        error_message TEXT,
        retry_count INTEGER DEFAULT 0,
        FOREIGN KEY (campaign_call_id) REFERENCES elocal_call_data(id)
      );
      
      -- Create indexes for better performance
      CREATE INDEX IF NOT EXISTS idx_elocal_call_data_caller_id ON elocal_call_data(caller_id);
      CREATE INDEX IF NOT EXISTS idx_elocal_call_data_date ON elocal_call_data(date_of_call);
      CREATE INDEX IF NOT EXISTS idx_elocal_call_data_phone ON elocal_call_data(campaign_phone);
      
      CREATE INDEX IF NOT EXISTS idx_adjustment_details_caller_id ON adjustment_details(caller_id);
      CREATE INDEX IF NOT EXISTS idx_adjustment_details_time ON adjustment_details(time_of_call);
      CREATE INDEX IF NOT EXISTS idx_adjustment_details_sid ON adjustment_details(call_sid);
      
      CREATE INDEX IF NOT EXISTS idx_sessions_id ON scraping_sessions(session_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_started ON scraping_sessions(started_at);
      
      CREATE INDEX IF NOT EXISTS idx_ringba_logs_campaign_call_id ON ringba_sync_logs(campaign_call_id);
      CREATE INDEX IF NOT EXISTS idx_ringba_logs_caller_id ON ringba_sync_logs(caller_id);
      CREATE INDEX IF NOT EXISTS idx_ringba_logs_sync_status ON ringba_sync_logs(sync_status);
      CREATE INDEX IF NOT EXISTS idx_ringba_logs_sync_attempted_at ON ringba_sync_logs(sync_attempted_at);
      CREATE INDEX IF NOT EXISTS idx_ringba_logs_inbound_call_id ON ringba_sync_logs(ringba_inbound_call_id);
      
      CREATE TABLE IF NOT EXISTS revenue_summary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        ringba_static REAL DEFAULT 0.00,
        ringba_api REAL DEFAULT 0.00,
        ringba_total REAL DEFAULT 0.00,
        elocal_static REAL DEFAULT 0.00,
        elocal_api REAL DEFAULT 0.00,
        elocal_total REAL DEFAULT 0.00,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_revenue_summary_date ON revenue_summary(date);
      CREATE INDEX IF NOT EXISTS idx_revenue_summary_updated_at ON revenue_summary(updated_at);
      
      CREATE TABLE IF NOT EXISTS ringba_cost_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        inbound_call_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        target_name TEXT,
        category TEXT NOT NULL,
        call_date TEXT NOT NULL,
        caller_id TEXT,
        revenue REAL DEFAULT 0.00,
        cost REAL DEFAULT 0.00,
        campaign_name TEXT,
        publisher_name TEXT,
        inbound_phone_number TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(inbound_call_id, category)
      );
      
      CREATE INDEX IF NOT EXISTS idx_ringba_cost_data_inbound_call_id ON ringba_cost_data(inbound_call_id);
      CREATE INDEX IF NOT EXISTS idx_ringba_cost_data_target_id ON ringba_cost_data(target_id);
      CREATE INDEX IF NOT EXISTS idx_ringba_cost_data_category ON ringba_cost_data(category);
      CREATE INDEX IF NOT EXISTS idx_ringba_cost_data_call_date ON ringba_cost_data(call_date);
      CREATE INDEX IF NOT EXISTS idx_ringba_cost_data_caller_id ON ringba_cost_data(caller_id);
    `);
    
    return { success: true };
  });

// Insert campaign call (only required fields)
export const insertCampaignCall = (config) => (call) =>
  withDatabase(config)(async (db) => {
    const stmt = db.prepare(`
      INSERT INTO elocal_call_data (
        date_of_call, campaign_phone, caller_id, payout
      ) VALUES (?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      call.dateOfCall,
      call.campaignPhone,
      call.callerId,
      call.payout
    );
    
    return { id: result.lastInsertRowid, ...call };
  });

// Insert adjustment detail
export const insertAdjustmentDetail = (config) => (adjustment) =>
  withDatabase(config)(async (db) => {
    const stmt = db.prepare(`
      INSERT INTO adjustment_details (
        time_of_call, adjustment_time, campaign_phone, caller_id,
        duration, call_sid, amount, classification
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      adjustment.timeOfCall,
      adjustment.adjustmentTime,
      adjustment.campaignPhone,
      adjustment.callerId,
      adjustment.duration,
      adjustment.callSid,
      adjustment.amount,
      adjustment.classification || null
    );
    
    return { id: result.lastInsertRowid, ...adjustment };
  });

// Batch insert/update campaign calls with UPSERT logic
// If record exists (same caller_id + date_of_call + campaign_phone), update payout
// If record doesn't exist, insert new record
export const insertCampaignCallsBatch = (config) => (calls) =>
  withDatabase(config)(async (db) => {
    if (R.isEmpty(calls)) return { inserted: 0, updated: 0 };
    
    // Use INSERT OR REPLACE or INSERT ... ON CONFLICT DO UPDATE
    // SQLite 3.24+ supports INSERT ... ON CONFLICT DO UPDATE
    const upsertStmt = db.prepare(`
      INSERT INTO elocal_call_data (
        date_of_call, campaign_phone, caller_id, payout,
        category, city_state, zip_code,
        screen_duration, post_screen_duration, total_duration,
        assessment, classification,
        adjustment_time, adjustment_amount, adjustment_classification, adjustment_duration,
        unmatched
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(caller_id, date_of_call, campaign_phone, category) 
      DO UPDATE SET 
        payout = excluded.payout,
        category = COALESCE(excluded.category, category),
        city_state = COALESCE(excluded.city_state, city_state),
        zip_code = COALESCE(excluded.zip_code, zip_code),
        screen_duration = COALESCE(excluded.screen_duration, screen_duration),
        post_screen_duration = COALESCE(excluded.post_screen_duration, post_screen_duration),
        total_duration = COALESCE(excluded.total_duration, total_duration),
        assessment = COALESCE(excluded.assessment, assessment),
        classification = COALESCE(excluded.classification, classification),
        adjustment_time = COALESCE(excluded.adjustment_time, adjustment_time),
        adjustment_amount = COALESCE(excluded.adjustment_amount, adjustment_amount),
        adjustment_classification = COALESCE(excluded.adjustment_classification, adjustment_classification),
        adjustment_duration = COALESCE(excluded.adjustment_duration, adjustment_duration),
        unmatched = CASE WHEN unmatched = 1 THEN 1 ELSE COALESCE(excluded.unmatched, unmatched) END,
        created_at = CURRENT_TIMESTAMP
    `);
    
    const insertMany = db.transaction((calls) => {
      let inserted = 0;
      let updated = 0;
      
      for (const call of calls) {
        try {
          // Ensure category is set (default to 'STATIC' if not provided)
          const callCategory = call.category || 'STATIC';
          
          // Check if record exists to determine if it's insert or update
          const existing = db.prepare(`
            SELECT id, payout FROM elocal_call_data 
            WHERE caller_id = ? AND date_of_call = ? AND campaign_phone = ? AND category = ?
            LIMIT 1
          `).get(call.callerId, call.dateOfCall, call.campaignPhone, callCategory);
          
          const wasExisting = existing !== undefined;
          const payoutChanged = wasExisting && existing.payout !== call.payout;
          
          // Insert or update
          upsertStmt.run(
            call.dateOfCall,
            call.campaignPhone,
            call.callerId,
            call.payout,
            callCategory, // Use ensured category
            call.cityState || null,
            call.zipCode || null,
            call.screenDuration || null,
            call.postScreenDuration || null,
            call.totalDuration || null,
            call.assessment || null,
            call.classification || null,
            call.adjustmentTime || null,
            call.adjustmentAmount || call.amount || null,
            call.adjustmentClassification || call.classification || null,
            call.adjustmentDuration || call.duration || null,
            call.unmatched ? 1 : 0
          );
          
          if (wasExisting) {
            if (payoutChanged) {
              updated++;
              console.log(`Updated payout for caller ${call.callerId}: ${existing.payout} -> ${call.payout}`);
            } else {
              // Record exists but payout unchanged
            }
          } else {
            inserted++;
          }
        } catch (error) {
          console.warn(`Error processing call: ${error.message}`);
          // Continue with next record
        }
      }
      return { inserted, updated };
    });
    
    return insertMany(calls);
  });

// Batch insert adjustment details (optimized for SQLite with duplicate prevention)
export const insertAdjustmentDetailsBatch = (config) => (adjustments) =>
  withDatabase(config)(async (db) => {
    if (R.isEmpty(adjustments)) return { inserted: 0, skipped: 0 };
    
    // Check for existing records by call_sid (unique identifier)
    const checkStmt = db.prepare(`
      SELECT id FROM adjustment_details 
      WHERE call_sid = ?
      LIMIT 1
    `);
    
    const insertStmt = db.prepare(`
      INSERT INTO adjustment_details (
        time_of_call, adjustment_time, campaign_phone, caller_id,
        duration, call_sid, amount, classification
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertMany = db.transaction((adjustments) => {
      let inserted = 0;
      let skipped = 0;
      
      for (const adjustment of adjustments) {
        try {
          // Check if record already exists by call_sid
          const existing = checkStmt.get(adjustment.callSid);
          
          if (existing) {
            skipped++;
            continue;
          }
          
          // Insert new record
          insertStmt.run(
            adjustment.timeOfCall,
            adjustment.adjustmentTime,
            adjustment.campaignPhone,
            adjustment.callerId,
            adjustment.duration,
            adjustment.callSid,
            adjustment.amount,
            adjustment.classification || null
          );
          inserted++;
        } catch (error) {
          skipped++;
        }
      }
      return { inserted, skipped };
    });
    
    return insertMany(adjustments);
  });

// Create scraping session
export const createScrapingSession = (config) => (session) =>
  withDatabase(config)(async (db) => {
    const stmt = db.prepare(`
      INSERT INTO scraping_sessions (
        session_id, started_at, status, calls_scraped, adjustments_scraped
      ) VALUES (?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      session.sessionId,
      session.startedAt,
      session.status,
      session.callsScraped,
      session.adjustmentsScraped
    );
    
    return { id: result.lastInsertRowid, ...session };
  });

// Update scraping session
export const updateScrapingSession = (config) => (sessionId) => (updates) =>
  withDatabase(config)(async (db) => {
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    
    const stmt = db.prepare(`UPDATE scraping_sessions SET ${fields} WHERE session_id = ?`);
    const result = stmt.run(...values, sessionId);
    
    return { affectedRows: result.changes };
  });

// Get scraping session
export const getScrapingSession = (config) => (sessionId) =>
  withDatabase(config)(async (db) => {
    const stmt = db.prepare('SELECT * FROM scraping_sessions WHERE session_id = ?');
    const row = stmt.get(sessionId);
    return row || null;
  });

// Check if caller ID already exists
export const callerIdExists = (config) => (callerId) =>
  withDatabase(config)(async (db) => {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM elocal_call_data WHERE caller_id = ?');
    const result = stmt.get(callerId);
    return result.count > 0;
  });

// Check if adjustment already exists by call SID
export const adjustmentExists = (config) => (callSid) =>
  withDatabase(config)(async (db) => {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM adjustment_details WHERE call_sid = ?');
    const result = stmt.get(callSid);
    return result.count > 0;
  });

// Get statistics for monitoring
export const getStatistics = (config) =>
  withDatabase(config)(async (db) => {
    const stats = {};
    
    // Campaign calls stats
    const callsStats = db.prepare(`
      SELECT 
        COUNT(*) as total_calls,
        COUNT(DISTINCT caller_id) as unique_callers,
        SUM(payout) as total_payout,
        AVG(payout) as avg_payout
      FROM elocal_call_data
    `).get();
    
    // Adjustment details stats
    const adjustmentsStats = db.prepare(`
      SELECT 
        COUNT(*) as total_adjustments,
        SUM(amount) as total_amount,
        AVG(amount) as avg_amount
      FROM adjustment_details
    `).get();
    
    // Recent sessions stats
    const sessionsStats = db.prepare(`
      SELECT 
        COUNT(*) as total_sessions,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_sessions,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_sessions
      FROM scraping_sessions
      WHERE started_at > datetime('now', '-7 days')
    `).get();
    
    return {
      calls: callsStats,
      adjustments: adjustmentsStats,
      sessions: sessionsStats,
      timestamp: new Date().toISOString()
    };
  });

// Log Ringba sync attempt
export const logRingbaSyncAttempt = (config) => (logData) =>
  withDatabase(config)(async (db) => {
    const stmt = db.prepare(`
      INSERT INTO ringba_sync_logs (
        campaign_call_id, date_of_call, caller_id, adjustment_amount,
        adjustment_classification, ringba_inbound_call_id, sync_status,
        sync_completed_at, revenue, payout, lookup_result, api_request,
        api_response, error_message, retry_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      logData.campaignCallId,
      logData.dateOfCall,
      logData.callerId,
      logData.adjustmentAmount || null,
      logData.adjustmentClassification || null,
      logData.ringbaInboundCallId || null,
      logData.syncStatus,
      logData.revenue || null,
      logData.payout || null,
      logData.lookupResult ? JSON.stringify(logData.lookupResult) : null,
      logData.apiRequest ? JSON.stringify(logData.apiRequest) : null,
      logData.apiResponse ? JSON.stringify(logData.apiResponse) : null,
      logData.errorMessage || null,
      logData.retryCount || 0
    );
    
    return { id: result.lastInsertRowid, ...logData };
  });

// Get Ringba sync logs
export const getRingbaSyncLogs = (config) => (filters = {}) =>
  withDatabase(config)(async (db) => {
    let query = 'SELECT * FROM ringba_sync_logs WHERE 1=1';
    const params = [];
    
    if (filters.campaignCallId) {
      query += ' AND campaign_call_id = ?';
      params.push(filters.campaignCallId);
    }
    if (filters.callerId) {
      query += ' AND caller_id = ?';
      params.push(filters.callerId);
    }
    if (filters.syncStatus) {
      query += ' AND sync_status = ?';
      params.push(filters.syncStatus);
    }
    if (filters.ringbaInboundCallId) {
      query += ' AND ringba_inbound_call_id = ?';
      params.push(filters.ringbaInboundCallId);
    }
    if (filters.startDate) {
      query += ' AND sync_attempted_at >= ?';
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      query += ' AND sync_attempted_at <= ?';
      params.push(filters.endDate);
    }
    
    query += ' ORDER BY sync_attempted_at DESC';
    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }
    
    const stmt = db.prepare(query);
    return stmt.all(...params);
  });

// Database operation composition helpers
export const dbOps = (config) => ({
  initialize: () => initializeDatabase(config),
  insertCall: insertCampaignCall(config),
  insertAdjustment: insertAdjustmentDetail(config),
  insertCallsBatch: insertCampaignCallsBatch(config),
  insertAdjustmentsBatch: insertAdjustmentDetailsBatch(config),
  applyAdjustmentsBatch: (adjustments) => withDatabase(config)(async (db) => {
    if (R.isEmpty(adjustments)) return { updated: 0, unmatched: adjustments.length };
    const updateStmt = db.prepare(`
      UPDATE elocal_call_data
      SET adjustment_time = ?, adjustment_amount = ?, adjustment_classification = ?, adjustment_duration = ?
      WHERE substr(date_of_call,1,16) = substr(?,1,16) AND caller_id = ?
    `);
    const applyMany = db.transaction((rows) => {
      let updated = 0; let unmatched = 0;
      for (const a of rows) {
        const res = updateStmt.run(a.adjustmentTime, a.amount, a.classification || null, a.duration || null, a.timeOfCall, a.callerId);
        if (res.changes > 0) updated++; else unmatched++;
      }
      return { updated, unmatched };
    });
    return applyMany(adjustments);
  }),
  applyAdjustmentsByTriple: (updates) => withDatabase(config)(async (db) => {
    if (R.isEmpty(updates)) return { updated: 0 };
    const stmt = db.prepare(`
      UPDATE elocal_call_data
      SET adjustment_time = ?, adjustment_amount = ?, adjustment_classification = ?, adjustment_duration = ?
      WHERE date_of_call = ? AND caller_id = ? AND campaign_phone = ?
    `);
    const applyMany = db.transaction((rows) => {
      let updated = 0;
      for (const u of rows) {
        const res = stmt.run(u.adjustmentTime, u.amount, u.classification || null, u.duration || null, u.dateOfCall, u.callerId, u.campaignPhone);
        if (res.changes > 0) updated++;
      }
      return { updated };
    });
    return applyMany(updates);
  }),
  createSession: createScrapingSession(config),
  updateSession: updateScrapingSession(config),
  getSession: getScrapingSession(config),
  callerIdExists: callerIdExists(config),
  adjustmentExists: adjustmentExists(config),
  getStatistics: getStatistics(config),
  // Revenue summary operations
  upsertRevenueSummary: (date, data) => withDatabase(config)(async (db) => {
    const stmt = db.prepare(`
      INSERT INTO revenue_summary (
        date, ringba_static, ringba_api, ringba_total,
        elocal_static, elocal_api, elocal_total, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(date) 
      DO UPDATE SET
        ringba_static = excluded.ringba_static,
        ringba_api = excluded.ringba_api,
        ringba_total = excluded.ringba_total,
        elocal_static = excluded.elocal_static,
        elocal_api = excluded.elocal_api,
        elocal_total = excluded.elocal_total,
        updated_at = CURRENT_TIMESTAMP
    `);
    
    const ringbaTotal = (data.ringbaStatic || 0) + (data.ringbaApi || 0);
    const elocalTotal = (data.elocalStatic || 0) + (data.elocalApi || 0);
    
    const result = stmt.run(
      date,
      data.ringbaStatic || 0,
      data.ringbaApi || 0,
      ringbaTotal,
      data.elocalStatic || 0,
      data.elocalApi || 0,
      elocalTotal
    );
    
    return { id: result.lastInsertRowid, date, ...data };
  }),
  getRevenueSummary: (startDate, endDate) => withDatabase(config)(async (db) => {
    const stmt = db.prepare(`
      SELECT * FROM revenue_summary
      WHERE date >= date(?) AND date <= date(?)
      ORDER BY date ASC
    `);
    return stmt.all(startDate, endDate);
  }),
  
  // Ringba cost data operations
  upsertRingbaCostData: (costData) => withDatabase(config)(async (db) => {
    const stmt = db.prepare(`
      INSERT INTO ringba_cost_data (
        inbound_call_id, target_id, target_name, category,
        call_date, caller_id, revenue, cost,
        campaign_name, publisher_name, inbound_phone_number,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(inbound_call_id, category) 
      DO UPDATE SET
        target_id = excluded.target_id,
        target_name = excluded.target_name,
        call_date = excluded.call_date,
        caller_id = excluded.caller_id,
        revenue = excluded.revenue,
        cost = excluded.cost,
        campaign_name = excluded.campaign_name,
        publisher_name = excluded.publisher_name,
        inbound_phone_number = excluded.inbound_phone_number,
        updated_at = CURRENT_TIMESTAMP
    `);
    
    const result = stmt.run(
      costData.inboundCallId,
      costData.targetId,
      costData.targetName || null,
      costData.category,
      costData.callDate,
      costData.callerId || null,
      costData.revenue || 0,
      costData.cost || 0,
      costData.campaignName || null,
      costData.publisherName || null,
      costData.inboundPhoneNumber || null
    );
    
    return { id: result.lastInsertRowid, ...costData };
  }),
  
  batchUpsertRingbaCostData: (costDataArray) => withDatabase(config)(async (db) => {
    if (R.isEmpty(costDataArray)) return { inserted: 0, updated: 0 };
    
    const stmt = db.prepare(`
      INSERT INTO ringba_cost_data (
        inbound_call_id, target_id, target_name, category,
        call_date, caller_id, revenue, cost,
        campaign_name, publisher_name, inbound_phone_number,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(inbound_call_id, category) 
      DO UPDATE SET
        target_id = excluded.target_id,
        target_name = excluded.target_name,
        call_date = excluded.call_date,
        caller_id = excluded.caller_id,
        revenue = excluded.revenue,
        cost = excluded.cost,
        campaign_name = excluded.campaign_name,
        publisher_name = excluded.publisher_name,
        inbound_phone_number = excluded.inbound_phone_number,
        updated_at = CURRENT_TIMESTAMP
    `);
    
    const insertMany = db.transaction((dataArray) => {
      let inserted = 0;
      let updated = 0;
      
      for (const costData of dataArray) {
        try {
          // Check if record exists
          const existing = db.prepare(`
            SELECT id FROM ringba_cost_data 
            WHERE inbound_call_id = ? AND category = ?
            LIMIT 1
          `).get(costData.inboundCallId, costData.category);
          
          const wasExisting = existing !== undefined;
          
          stmt.run(
            costData.inboundCallId,
            costData.targetId,
            costData.targetName || null,
            costData.category,
            costData.callDate,
            costData.callerId || null,
            costData.revenue || 0,
            costData.cost || 0,
            costData.campaignName || null,
            costData.publisherName || null,
            costData.inboundPhoneNumber || null
          );
          
          if (wasExisting) {
            updated++;
          } else {
            inserted++;
          }
        } catch (error) {
          console.warn(`Error processing ringba cost data: ${error.message}`);
        }
      }
      return { inserted, updated };
    });
    
    return insertMany(costDataArray);
  }),
  
  getRingbaCostData: (startDate, endDate, category = null) => withDatabase(config)(async (db) => {
    // Fetch all records and filter by date in JavaScript
    // This is necessary because call_date is stored as MM/DD/YYYY HH:MM:SS AM/PM format
    let query = `SELECT * FROM ringba_cost_data WHERE 1=1`;
    const params = [];
    
    if (category) {
      query += ` AND category = ?`;
      params.push(category);
    }
    
    query += ` ORDER BY call_date DESC, id DESC`;
    
    const stmt = db.prepare(query);
    const allResults = stmt.all(...params);
    
    // Helper function to parse MM/DD/YYYY format to YYYY-MM-DD
    const parseDate = (dateStr) => {
      if (!dateStr) return null;
      const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (match) {
        const [, month, day, year] = match;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }
      // Try standard date parsing as fallback
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
    
    // Filter results by date range
    const filteredResults = allResults.filter(row => {
      if (!row.call_date) return false;
      
      const recordDate = parseDate(row.call_date);
      if (!recordDate) return false;
      
      return recordDate >= startDate && recordDate <= endDate;
    });
    
    return filteredResults;
  }),

  // Get list of dates that already have Ringba cost data
  getRingbaCostDataDates: () => withDatabase(config)(async (db) => {
    // Fetch all records and extract unique dates
    const query = `SELECT DISTINCT call_date FROM ringba_cost_data WHERE call_date IS NOT NULL`;
    const stmt = db.prepare(query);
    const allResults = stmt.all();
    
    // Helper function to parse MM/DD/YYYY format to YYYY-MM-DD
    const parseDate = (dateStr) => {
      if (!dateStr) return null;
      const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (match) {
        const [, month, day, year] = match;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }
      // Try standard date parsing as fallback
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
    
    // Extract unique dates
    const datesSet = new Set();
    for (const row of allResults) {
      const date = parseDate(row.call_date);
      if (date) {
        datesSet.add(date);
      }
    }
    
    return Array.from(datesSet).sort();
  })
});
