// PostgreSQL database client for revenue sync service
import pkg from 'pg';
const { Pool } = pkg;

// PostgreSQL connection configuration
const createPostgresPool = (config) => {
  const pool = new Pool({
    host: config.postgresHost || 'localhost',
    port: config.postgresPort || 5434,
    user: config.postgresUser || 'adi',
    password: config.postgresPassword || 'nobodyislove',
    database: config.postgresDatabase || 'postgres',
    max: 20, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000, // Increased to 10 seconds
    query_timeout: 30000, // 30 seconds for queries
    statement_timeout: 30000, // 30 seconds for statements
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  });

  // Handle pool errors
  pool.on('error', (err) => {
    console.error('Unexpected PostgreSQL pool error:', err);
  });

  return pool;
};

// Initialize summary table in PostgreSQL
export const initializeSummaryTable = async (pool) => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS revenue_summary (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL UNIQUE,
        ringba_static NUMERIC(10, 2) DEFAULT 0.00,
        ringba_api NUMERIC(10, 2) DEFAULT 0.00,
        ringba_total NUMERIC(10, 2) DEFAULT 0.00,
        elocal_static NUMERIC(10, 2) DEFAULT 0.00,
        elocal_api NUMERIC(10, 2) DEFAULT 0.00,
        elocal_total NUMERIC(10, 2) DEFAULT 0.00,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_revenue_summary_date ON revenue_summary(date);
      CREATE INDEX IF NOT EXISTS idx_revenue_summary_updated_at ON revenue_summary(updated_at);
    `);
    
    console.log('✅ Revenue summary table initialized');
    return { success: true };
  } catch (error) {
    console.error('❌ Failed to initialize summary table:', error.message);
    throw error;
  } finally {
    client.release();
  }
};

// Upsert revenue summary for a specific date
export const upsertRevenueSummary = async (pool, date, data) => {
  const client = await pool.connect();
  try {
    const query = `
      INSERT INTO revenue_summary (
        date, ringba_static, ringba_api, ringba_total,
        elocal_static, elocal_api, elocal_total, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
      ON CONFLICT (date) 
      DO UPDATE SET
        ringba_static = EXCLUDED.ringba_static,
        ringba_api = EXCLUDED.ringba_api,
        ringba_total = EXCLUDED.ringba_total,
        elocal_static = EXCLUDED.elocal_static,
        elocal_api = EXCLUDED.elocal_api,
        elocal_total = EXCLUDED.elocal_total,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;
    
    const values = [
      date,
      data.ringbaStatic || 0,
      data.ringbaApi || 0,
      (data.ringbaStatic || 0) + (data.ringbaApi || 0),
      data.elocalStatic || 0,
      data.elocalApi || 0,
      (data.elocalStatic || 0) + (data.elocalApi || 0)
    ];
    
    const result = await client.query(query, values);
    return result.rows[0];
  } catch (error) {
    console.error(`❌ Failed to upsert revenue summary for ${date}:`, error.message);
    throw error;
  } finally {
    client.release();
  }
};

// Get revenue summary for a date range
export const getRevenueSummary = async (pool, startDate, endDate) => {
  const client = await pool.connect();
  try {
    const query = `
      SELECT * FROM revenue_summary
      WHERE date >= $1 AND date <= $2
      ORDER BY date ASC;
    `;
    
    const result = await client.query(query, [startDate, endDate]);
    return result.rows;
  } catch (error) {
    console.error('❌ Failed to get revenue summary:', error.message);
    throw error;
  } finally {
    client.release();
  }
};

// Get Ringba call data from PostgreSQL
export const getRingbaCallData = async (pool, startDate, endDate) => {
  const client = await pool.connect();
  try {
    // Query to get Ringba call data with latestPayout from ringba_call_data table
    // Based on actual table structure:
    // - phoneNumber (caller_id)
    // - inboundCallId (inbound_call_id)
    // - callCompletedDt or callDay/callMonth/callYear (date)
    // - revenue (as text, needs conversion)
    // - latestPayout (as text, needs conversion) - THIS IS THE KEY FIELD
    const query = `
      SELECT 
        CASE 
          WHEN "callCompletedDt" IS NOT NULL AND "callCompletedDt" != '' THEN
            DATE(TO_TIMESTAMP("callCompletedDt", 'YYYY-MM-DD HH24:MI:SS'))
          WHEN "callYear" IS NOT NULL AND "callMonth" IS NOT NULL AND "callDay" IS NOT NULL THEN
            DATE("callYear" || '-' || LPAD("callMonth", 2, '0') || '-' || LPAD("callDay", 2, '0'))
          ELSE NULL
        END as date,
        "phoneNumber" as caller_id,
        "inboundCallId" as inbound_call_id,
        CASE 
          WHEN "revenue" IS NOT NULL AND "revenue" != '' THEN
            CAST("revenue" AS NUMERIC)
          WHEN "conversionAmount" IS NOT NULL AND "conversionAmount" != '' THEN
            CAST("conversionAmount" AS NUMERIC)
          ELSE 0
        END as revenue,
        CASE 
          WHEN "latestPayout" IS NOT NULL AND "latestPayout" != '' THEN
            CAST("latestPayout" AS NUMERIC)
          ELSE 0
        END as latest_payout,
        CASE 
          WHEN "callCompletedDt" IS NOT NULL AND "callCompletedDt" != '' THEN
            TO_TIMESTAMP("callCompletedDt", 'YYYY-MM-DD HH24:MI:SS')
          ELSE NULL
        END as call_timestamp,
        COALESCE("callCompletedDt", 
                 "callYear" || '-' || LPAD("callMonth", 2, '0') || '-' || LPAD("callDay", 2, '0')) as call_date
      FROM ringba_call_data
      WHERE (
        CASE 
          WHEN "callCompletedDt" IS NOT NULL AND "callCompletedDt" != '' THEN
            DATE(TO_TIMESTAMP("callCompletedDt", 'YYYY-MM-DD HH24:MI:SS'))
          WHEN "callYear" IS NOT NULL AND "callMonth" IS NOT NULL AND "callDay" IS NOT NULL THEN
            DATE("callYear" || '-' || LPAD("callMonth", 2, '0') || '-' || LPAD("callDay", 2, '0'))
          ELSE NULL
        END
      ) >= $1 
        AND (
        CASE 
          WHEN "callCompletedDt" IS NOT NULL AND "callCompletedDt" != '' THEN
            DATE(TO_TIMESTAMP("callCompletedDt", 'YYYY-MM-DD HH24:MI:SS'))
          WHEN "callYear" IS NOT NULL AND "callMonth" IS NOT NULL AND "callDay" IS NOT NULL THEN
            DATE("callYear" || '-' || LPAD("callMonth", 2, '0') || '-' || LPAD("callDay", 2, '0'))
          ELSE NULL
        END
      ) <= $2
      ORDER BY date ASC, call_timestamp ASC;
    `;
    
    const result = await client.query(query, [startDate, endDate]);
    console.log(`[PostgreSQL] Fetched ${result.rows.length} rows from ringba_call_data`);
    
    // Process rows to include timestamp for matching
    return result.rows.map(row => ({
      ...row,
      // Convert timestamp to milliseconds for easier matching
      timestamp: row.call_timestamp ? new Date(row.call_timestamp).getTime() : null,
      // Use latestPayout as the payout value
      payout: parseFloat(row.latest_payout || 0)
    }));
  } catch (error) {
    console.error('❌ Failed to get Ringba call data:', error.message);
    console.error('   Query attempted:', error.query || 'N/A');
    throw error;
  } finally {
    client.release();
  }
};

// Close PostgreSQL pool
export const closePostgresPool = (pool) => {
  return pool.end();
};

export { createPostgresPool };

