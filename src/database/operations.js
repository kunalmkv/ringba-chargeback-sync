// Database connection and operations using functional programming
import mysql from 'mysql2/promise';
import * as R from 'ramda';
import * as E from 'fp-ts/Either';
import * as TE from 'fp-ts/TaskEither';
import { Config, CampaignCall, AdjustmentDetail, ScrapingSession } from '../types/schemas.js';

// Database connection configuration
const createConnection = (config) => 
  mysql.createConnection({
    host: config.dbHost,
    port: config.dbPort,
    user: config.dbUser,
    password: config.dbPassword,
    database: config.dbName,
    charset: 'utf8mb4'
  });

// Database operations using TaskEither for error handling
export const withDatabase = (config) => (operation) =>
  TE.tryCatch(
    async () => {
      const connection = await createConnection(config);
      try {
        return await operation(connection);
      } finally {
        await connection.end();
      }
    },
    (error) => new Error(`Database operation failed: ${error.message}`)
  );

// Initialize database tables
export const initializeDatabase = (config) =>
  withDatabase(config)(async (connection) => {
    const { createTables } = await import('./schema.js');
    await connection.execute(createTables);
    return { success: true };
  });

// Insert campaign call
export const insertCampaignCall = (config) => (call) =>
  withDatabase(config)(async (connection) => {
    const query = `
      INSERT INTO campaign_calls (
        date_of_call, campaign_phone, caller_id, category, city, state, zip_code,
        screen_duration, post_screen_duration, total_duration, call_screen,
        assessment, classification, payout
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const values = [
      call.dateOfCall,
      call.campaignPhone,
      call.callerId,
      call.category || null,
      call.city || null,
      call.state || null,
      call.zipCode || null,
      call.screenDuration,
      call.postScreenDuration,
      call.totalDuration,
      call.callScreen || null,
      call.assessment || null,
      call.classification || null,
      call.payout
    ];
    
    const [result] = await connection.execute(query, values);
    return { id: result.insertId, ...call };
  });

// Insert adjustment detail
export const insertAdjustmentDetail = (config) => (adjustment) =>
  withDatabase(config)(async (connection) => {
    const query = `
      INSERT INTO adjustment_details (
        time_of_call, adjustment_time, campaign_phone, caller_id,
        duration, call_sid, amount, classification
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const values = [
      adjustment.timeOfCall,
      adjustment.adjustmentTime,
      adjustment.campaignPhone,
      adjustment.callerId,
      adjustment.duration,
      adjustment.callSid,
      adjustment.amount,
      adjustment.classification || null
    ];
    
    const [result] = await connection.execute(query, values);
    return { id: result.insertId, ...adjustment };
  });

// Batch insert campaign calls
export const insertCampaignCallsBatch = (config) => (calls) =>
  withDatabase(config)(async (connection) => {
    if (R.isEmpty(calls)) return { inserted: 0 };
    
    const query = `
      INSERT INTO campaign_calls (
        date_of_call, campaign_phone, caller_id, category, city, state, zip_code,
        screen_duration, post_screen_duration, total_duration, call_screen,
        assessment, classification, payout
      ) VALUES ?
    `;
    
    const values = calls.map(call => [
      call.dateOfCall,
      call.campaignPhone,
      call.callerId,
      call.category || null,
      call.city || null,
      call.state || null,
      call.zipCode || null,
      call.screenDuration,
      call.postScreenDuration,
      call.totalDuration,
      call.callScreen || null,
      call.assessment || null,
      call.classification || null,
      call.payout
    ]);
    
    const [result] = await connection.execute(query, [values]);
    return { inserted: result.affectedRows };
  });

// Batch insert adjustment details
export const insertAdjustmentDetailsBatch = (config) => (adjustments) =>
  withDatabase(config)(async (connection) => {
    if (R.isEmpty(adjustments)) return { inserted: 0 };
    
    const query = `
      INSERT INTO adjustment_details (
        time_of_call, adjustment_time, campaign_phone, caller_id,
        duration, call_sid, amount, classification
      ) VALUES ?
    `;
    
    const values = adjustments.map(adjustment => [
      adjustment.timeOfCall,
      adjustment.adjustmentTime,
      adjustment.campaignPhone,
      adjustment.callerId,
      adjustment.duration,
      adjustment.callSid,
      adjustment.amount,
      adjustment.classification || null
    ]);
    
    const [result] = await connection.execute(query, [values]);
    return { inserted: result.affectedRows };
  });

// Create scraping session
export const createScrapingSession = (config) => (session) =>
  withDatabase(config)(async (connection) => {
    const query = `
      INSERT INTO scraping_sessions (
        session_id, started_at, status, calls_scraped, adjustments_scraped
      ) VALUES (?, ?, ?, ?, ?)
    `;
    
    const values = [
      session.sessionId,
      session.startedAt,
      session.status,
      session.callsScraped,
      session.adjustmentsScraped
    ];
    
    const [result] = await connection.execute(query, values);
    return { id: result.insertId, ...session };
  });

// Update scraping session
export const updateScrapingSession = (config) => (sessionId) => (updates) =>
  withDatabase(config)(async (connection) => {
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    
    const query = `UPDATE scraping_sessions SET ${fields} WHERE session_id = ?`;
    const [result] = await connection.execute(query, [...values, sessionId]);
    
    return { affectedRows: result.affectedRows };
  });

// Get scraping session
export const getScrapingSession = (config) => (sessionId) =>
  withDatabase(config)(async (connection) => {
    const query = 'SELECT * FROM scraping_sessions WHERE session_id = ?';
    const [rows] = await connection.execute(query, [sessionId]);
    return R.head(rows) || null;
  });

// Check if caller ID already exists
export const callerIdExists = (config) => (callerId) =>
  withDatabase(config)(async (connection) => {
    const query = 'SELECT COUNT(*) as count FROM campaign_calls WHERE caller_id = ?';
    const [rows] = await connection.execute(query, [callerId]);
    return rows[0].count > 0;
  });

// Check if adjustment already exists by call SID
export const adjustmentExists = (config) => (callSid) =>
  withDatabase(config)(async (connection) => {
    const query = 'SELECT COUNT(*) as count FROM adjustment_details WHERE call_sid = ?';
    const [rows] = await connection.execute(query, [callSid]);
    return rows[0].count > 0;
  });

// Database operation composition helpers
export const dbOps = (config) => ({
  initialize: () => initializeDatabase(config),
  insertCall: insertCampaignCall(config),
  insertAdjustment: insertAdjustmentDetail(config),
  insertCallsBatch: insertCampaignCallsBatch(config),
  insertAdjustmentsBatch: insertAdjustmentDetailsBatch(config),
  createSession: createScrapingSession(config),
  updateSession: updateScrapingSession(config),
  getSession: getScrapingSession(config),
  callerIdExists: callerIdExists(config),
  adjustmentExists: adjustmentExists(config)
});

