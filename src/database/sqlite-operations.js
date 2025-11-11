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
    // Create simplified table with only required fields
    // Check if table exists and has correct structure
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='campaign_calls'
    `).get();
    
    if (tableExists) {
      // Check if table has required columns including adjustment fields
      const columns = db.prepare(`PRAGMA table_info(campaign_calls)`).all();
      const columnNames = columns.map(col => col.name);
      const requiredColumns = ['date_of_call', 'campaign_phone', 'caller_id', 'payout', 'created_at', 'adjustment_time', 'adjustment_amount', 'adjustment_classification', 'adjustment_duration', 'unmatched', 'category', 'city_state', 'zip_code', 'screen_duration', 'post_screen_duration', 'total_duration', 'assessment', 'classification', 'ringba_inbound_call_id', 'ringba_sync_status', 'ringba_sync_at', 'ringba_sync_response'];
      const hasAllColumns = requiredColumns.every(col => columnNames.includes(col));
      if (!hasAllColumns) {
        console.log('Table structure outdated, recreating...');
        db.exec(`DROP TABLE IF EXISTS campaign_calls;`);
      }
    }
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS campaign_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date_of_call TEXT NOT NULL,
        campaign_phone TEXT NOT NULL,
        caller_id TEXT NOT NULL,
        payout REAL DEFAULT 0.00,
        category TEXT,
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
        UNIQUE(caller_id, date_of_call, campaign_phone)
      );
      
      CREATE INDEX IF NOT EXISTS idx_caller_id ON campaign_calls(caller_id);
      CREATE INDEX IF NOT EXISTS idx_date_of_call ON campaign_calls(date_of_call);
      CREATE INDEX IF NOT EXISTS idx_campaign_phone ON campaign_calls(campaign_phone);
      
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
        FOREIGN KEY (campaign_call_id) REFERENCES campaign_calls(id)
      );
      
      -- Create indexes for better performance
      CREATE INDEX IF NOT EXISTS idx_campaign_calls_caller_id ON campaign_calls(caller_id);
      CREATE INDEX IF NOT EXISTS idx_campaign_calls_date ON campaign_calls(date_of_call);
      CREATE INDEX IF NOT EXISTS idx_campaign_calls_phone ON campaign_calls(campaign_phone);
      
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
    `);
    
    return { success: true };
  });

// Insert campaign call (only required fields)
export const insertCampaignCall = (config) => (call) =>
  withDatabase(config)(async (db) => {
    const stmt = db.prepare(`
      INSERT INTO campaign_calls (
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
      INSERT INTO campaign_calls (
        date_of_call, campaign_phone, caller_id, payout,
        category, city_state, zip_code,
        screen_duration, post_screen_duration, total_duration,
        assessment, classification,
        adjustment_time, adjustment_amount, adjustment_classification, adjustment_duration,
        unmatched
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(caller_id, date_of_call, campaign_phone) 
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
          // Check if record exists to determine if it's insert or update
          const existing = db.prepare(`
            SELECT id, payout FROM campaign_calls 
            WHERE caller_id = ? AND date_of_call = ? AND campaign_phone = ?
            LIMIT 1
          `).get(call.callerId, call.dateOfCall, call.campaignPhone);
          
          const wasExisting = existing !== undefined;
          const payoutChanged = wasExisting && existing.payout !== call.payout;
          
          // Insert or update
          upsertStmt.run(
            call.dateOfCall,
            call.campaignPhone,
            call.callerId,
            call.payout,
            call.category || null,
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
    const stmt = db.prepare('SELECT COUNT(*) as count FROM campaign_calls WHERE caller_id = ?');
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
      FROM campaign_calls
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
      UPDATE campaign_calls
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
      UPDATE campaign_calls
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
  getStatistics: getStatistics(config)
});
