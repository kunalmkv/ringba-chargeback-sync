// Dashboard API Server for eLocal Scraper
import http from 'http';
import url from 'url';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const PORT = process.env.DASHBOARD_PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'elocal_scraper.db');

// Helper to get database connection
const getDb = () => {
  try {
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    return db;
  } catch (error) {
    console.error('Database connection error:', error);
    return null;
  }
};

// Helper to send JSON response
const sendJSON = (res, data, statusCode = 200) => {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};

// Helper to send error response
const sendError = (res, message, statusCode = 500) => {
  sendJSON(res, { error: message }, statusCode);
};

// Fetch all dashboard data directly from database
const fetchAllDashboardData = () => {
  const db = getDb();
  if (!db) {
    return null;
  }

  try {
    // Health data - get last runs for STATIC and API categories separately
    // Use case-insensitive matching for session_id
    const lastHistorical = db.prepare(`
      SELECT * FROM scraping_sessions 
      WHERE LOWER(session_id) LIKE '%historical%' 
        AND (LOWER(session_id) LIKE '%static%' OR LOWER(session_id) NOT LIKE '%api%')
      ORDER BY started_at DESC 
      LIMIT 1
    `).get();

    const lastHistoricalAPI = db.prepare(`
      SELECT * FROM scraping_sessions 
      WHERE LOWER(session_id) LIKE '%historical%' 
        AND LOWER(session_id) LIKE '%api%'
      ORDER BY started_at DESC 
      LIMIT 1
    `).get();

    const lastCurrent = db.prepare(`
      SELECT * FROM scraping_sessions 
      WHERE LOWER(session_id) LIKE '%current%' 
        AND (LOWER(session_id) LIKE '%static%' OR LOWER(session_id) NOT LIKE '%api%')
      ORDER BY started_at DESC 
      LIMIT 1
    `).get();

    const lastCurrentAPI = db.prepare(`
      SELECT * FROM scraping_sessions 
      WHERE LOWER(session_id) LIKE '%current%' 
        AND LOWER(session_id) LIKE '%api%'
      ORDER BY started_at DESC 
      LIMIT 1
    `).get();

    const lastRingbaSync = db.prepare(`
      SELECT * FROM ringba_sync_logs 
      ORDER BY sync_completed_at DESC, id DESC 
      LIMIT 1
    `).get();

    const totalSessions = db.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
             SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM scraping_sessions
    `).get();

    const successRate = totalSessions.total > 0 
      ? ((totalSessions.completed / totalSessions.total) * 100).toFixed(2)
      : 0;

    const health = {
      status: 'healthy',
      database: 'connected',
      services: {
        historical: {
          lastRun: lastHistorical?.started_at || null,
          status: lastHistorical?.status || 'unknown',
          lastStatus: lastHistorical?.status || 'unknown'
        },
        historicalAPI: {
          lastRun: lastHistoricalAPI?.started_at || null,
          status: lastHistoricalAPI?.status || 'unknown',
          lastStatus: lastHistoricalAPI?.status || 'unknown'
        },
        current: {
          lastRun: lastCurrent?.started_at || null,
          status: lastCurrent?.status || 'unknown',
          lastStatus: lastCurrent?.status || 'unknown'
        },
        currentAPI: {
          lastRun: lastCurrentAPI?.started_at || null,
          status: lastCurrentAPI?.status || 'unknown',
          lastStatus: lastCurrentAPI?.status || 'unknown'
        },
        ringba: {
          lastRun: lastRingbaSync?.sync_completed_at || lastRingbaSync?.sync_attempted_at || null,
          status: lastRingbaSync?.sync_status || 'unknown',
          lastStatus: lastRingbaSync?.sync_status || 'unknown'
        }
      },
      successRate: parseFloat(successRate)
    };

    // Stats data
    const totalCalls = db.prepare(`SELECT COUNT(*) as count FROM elocal_call_data`).get();
    const totalAdjustments = db.prepare(`SELECT COUNT(*) as count FROM adjustment_details`).get();
    const totalPayout = db.prepare(`SELECT SUM(payout) as total FROM elocal_call_data`).get();
    const callsToday = db.prepare(`
      SELECT COUNT(*) as count 
      FROM elocal_call_data 
      WHERE DATE(date_of_call) = DATE('now')
    `).get();
    const callsThisWeek = db.prepare(`
      SELECT COUNT(*) as count 
      FROM elocal_call_data 
      WHERE DATE(date_of_call) >= DATE('now', '-7 days')
    `).get();

    const ringbaStatsRecent = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN sync_status = 'success' THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN sync_status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN sync_status = 'pending' OR sync_status = 'not_found' OR sync_status = 'cannot_sync' THEN 1 ELSE 0 END) as pending,
        MAX(sync_completed_at) as last_sync_time
      FROM ringba_sync_logs
      WHERE sync_completed_at >= DATETIME('now', '-24 hours')
    `).get();
    
    const ringbaStats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN sync_status = 'success' THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN sync_status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN sync_status = 'pending' OR sync_status = 'not_found' OR sync_status = 'cannot_sync' THEN 1 ELSE 0 END) as pending
      FROM ringba_sync_logs
    `).get();
    
    const finalRingbaStats = ringbaStatsRecent.total > 0 ? ringbaStatsRecent : ringbaStats;

    const recentActivity = db.prepare(`
      SELECT COUNT(*) as count 
      FROM elocal_call_data 
      WHERE created_at >= DATETIME('now', '-1 day')
    `).get();

    const stats = {
      totalCalls: totalCalls.count || 0,
      totalAdjustments: totalAdjustments.count || 0,
      totalPayout: totalPayout.total || 0,
      callsToday: callsToday.count || 0,
      callsThisWeek: callsThisWeek.count || 0,
      recentActivity: recentActivity.count || 0,
      ringba: {
        total: finalRingbaStats.total || 0,
        success: finalRingbaStats.success || 0,
        failed: finalRingbaStats.failed || 0,
        pending: finalRingbaStats.pending || 0,
        successRate: finalRingbaStats.total > 0 
          ? ((finalRingbaStats.success / finalRingbaStats.total) * 100).toFixed(2)
          : 0,
        lastSyncTime: finalRingbaStats.last_sync_time || null
      }
    };

    // History data - unified view of all services
    const allSessions = [];

    // 1. Scraping sessions
    const scrapingSessions = db.prepare(`
      SELECT 
        id,
        session_id,
        started_at,
        completed_at,
        status,
        calls_scraped,
        adjustments_scraped,
        error_message
      FROM scraping_sessions 
      ORDER BY started_at DESC 
      LIMIT 30
    `).all();

    scrapingSessions.forEach(session => {
      let serviceType = 'unknown';
      let serviceName = 'Unknown Service';
      
      if (session.session_id) {
        const sessionIdLower = session.session_id.toLowerCase();
        if (sessionIdLower.includes('historical')) {
          if (sessionIdLower.includes('api')) {
            serviceType = 'historical-api';
            serviceName = 'Historical (API)';
          } else {
            serviceType = 'historical';
            serviceName = 'Historical (STATIC)';
          }
        } else if (sessionIdLower.includes('current')) {
          if (sessionIdLower.includes('api')) {
            serviceType = 'current-api';
            serviceName = 'Current Day (API)';
          } else {
            serviceType = 'current';
            serviceName = 'Current Day (STATIC)';
          }
        }
      }
      
      allSessions.push({
        id: session.id,
        session_id: session.session_id,
        service_type: serviceType,
        service_name: serviceName,
        service_source: 'scraping',
        started_at: session.started_at,
        completed_at: session.completed_at,
        status: session.status || 'unknown',
        calls_scraped: session.calls_scraped || 0,
        adjustments_scraped: session.adjustments_scraped || 0,
        error_message: session.error_message || null,
        calls: session.calls_scraped || 0,
        adjustments: session.adjustments_scraped || 0
      });
    });

    // 2. Ringba Sync sessions
    try {
      const ringbaSyncSessions = db.prepare(`
        SELECT 
          date(sync_completed_at) as sync_date,
          MIN(sync_completed_at) as started_at,
          MAX(sync_completed_at) as completed_at,
          COUNT(*) as total_syncs,
          SUM(CASE WHEN sync_status = 'success' THEN 1 ELSE 0 END) as successful_syncs,
          SUM(CASE WHEN sync_status = 'failed' THEN 1 ELSE 0 END) as failed_syncs
        FROM ringba_sync_logs
        WHERE sync_completed_at IS NOT NULL
        GROUP BY date(sync_completed_at) 
        ORDER BY completed_at DESC 
        LIMIT 10
      `).all();

      ringbaSyncSessions.forEach((session, index) => {
        const status = session.failed_syncs > 0 ? 'partial' : (session.successful_syncs > 0 ? 'success' : 'failed');
        allSessions.push({
          id: `ringba-sync-${session.sync_date}-${index}`,
          session_id: `ringba-sync-${session.sync_date}`,
          service_type: 'ringba-sync',
          service_name: 'Ringba Sync',
          service_source: 'ringba-sync',
          started_at: session.started_at,
          completed_at: session.completed_at,
          status: status,
          calls_scraped: session.total_syncs || 0,
          adjustments_scraped: session.successful_syncs || 0,
          error_message: session.failed_syncs > 0 ? `${session.failed_syncs} syncs failed` : null,
          calls: session.total_syncs || 0,
          adjustments: session.successful_syncs || 0
        });
      });
    } catch (error) {
      // Ignore if table doesn't exist or query fails
    }

    // 3. Revenue Sync sessions
    try {
      const revenueSyncSessions = db.prepare(`
        SELECT 
          date(updated_at) as sync_date,
          MIN(updated_at) as started_at,
          MAX(updated_at) as completed_at,
          COUNT(*) as days_processed
        FROM revenue_summary
        WHERE updated_at IS NOT NULL
        GROUP BY date(updated_at) 
        ORDER BY completed_at DESC 
        LIMIT 10
      `).all();

      revenueSyncSessions.forEach((session, index) => {
        allSessions.push({
          id: `revenue-sync-${session.sync_date}-${index}`,
          session_id: `revenue-sync-${session.sync_date}`,
          service_type: 'revenue-sync',
          service_name: 'Revenue Sync',
          service_source: 'revenue-sync',
          started_at: session.started_at,
          completed_at: session.completed_at,
          status: 'success',
          calls_scraped: session.days_processed || 0,
          adjustments_scraped: 0,
          calls: session.days_processed || 0,
          adjustments: 0
        });
      });
    } catch (error) {
      // Ignore if table doesn't exist or query fails
    }

    // 4. Ringba Cost Sync sessions
    try {
      const costSyncSessions = db.prepare(`
        SELECT 
          date(updated_at) as sync_date,
          MIN(updated_at) as started_at,
          MAX(updated_at) as completed_at,
          COUNT(*) as calls_processed
        FROM ringba_cost_data
        WHERE updated_at IS NOT NULL
        GROUP BY date(updated_at) 
        ORDER BY completed_at DESC 
        LIMIT 10
      `).all();

      costSyncSessions.forEach((session, index) => {
        allSessions.push({
          id: `ringba-cost-sync-${session.sync_date}-${index}`,
          session_id: `ringba-cost-sync-${session.sync_date}`,
          service_type: 'ringba-cost-sync',
          service_name: 'Ringba Cost Sync',
          service_source: 'ringba-cost-sync',
          started_at: session.started_at,
          completed_at: session.completed_at,
          status: 'success',
          calls_scraped: session.calls_processed || 0,
          adjustments_scraped: 0,
          calls: session.calls_processed || 0,
          adjustments: 0
        });
      });
    } catch (error) {
      // Ignore if table doesn't exist or query fails
    }

    // Sort all sessions by started_at (most recent first)
    allSessions.sort((a, b) => {
      const dateA = new Date(a.started_at || a.completed_at || 0);
      const dateB = new Date(b.started_at || b.completed_at || 0);
      return dateB - dateA;
    });

    const history = {
      sessions: allSessions.slice(0, 50),
      count: allSessions.length
    };

    // Activity data
    const recentCalls = db.prepare(`
      SELECT * FROM elocal_call_data 
      ORDER BY created_at DESC 
      LIMIT 20
    `).all();

    const recentAdjustments = db.prepare(`
      SELECT * FROM adjustment_details 
      ORDER BY time_of_call DESC 
      LIMIT 20
    `).all();

    const recentSessions = db.prepare(`
      SELECT * FROM scraping_sessions 
      ORDER BY started_at DESC 
      LIMIT 20
    `).all();

    const activity = {
      calls: recentCalls,
      adjustments: recentAdjustments,
      sessions: recentSessions
    };

    // Chargeback data - fetch all data (no date limit)
    const revenueData = db.prepare(`
      SELECT * FROM revenue_summary
      ORDER BY date DESC
    `).all();
    
    // Get date range from actual data
    const startDateStr = revenueData.length > 0 
      ? revenueData[revenueData.length - 1].date 
      : new Date().toISOString().split('T')[0];
    const endDateStr = revenueData.length > 0 
      ? revenueData[0].date 
      : new Date().toISOString().split('T')[0];
    
    const chargebackRows = revenueData.map(row => {
      const ringbaStatic = parseFloat(row.ringba_static || 0);
      const ringbaApi = parseFloat(row.ringba_api || 0);
      const elocalStatic = parseFloat(row.elocal_static || 0);
      const elocalApi = parseFloat(row.elocal_api || 0);
      
      const ringbaTotal = ringbaStatic + ringbaApi;
      const elocalTotal = elocalStatic + elocalApi;
      const adjustments = ringbaTotal - elocalTotal;
      const adjustmentStatic = (ringbaStatic - elocalStatic) / 100;
      const adjustmentApi = (ringbaApi - elocalApi) / 100;
      const adjustmentPercentage = ringbaTotal !== 0 ? (adjustments / ringbaTotal) * 100 : 0;
      
      return {
        ...row,
        adjustments,
        adjustmentStatic,
        adjustmentApi,
        adjustmentPercentage
      };
    });
    
    const chargebackSummary = chargebackRows.reduce((acc, row) => {
      acc.totalRingbaStatic += parseFloat(row.ringba_static || 0);
      acc.totalRingbaApi += parseFloat(row.ringba_api || 0);
      acc.totalElocalStatic += parseFloat(row.elocal_static || 0);
      acc.totalElocalApi += parseFloat(row.elocal_api || 0);
      acc.totalAdjustments += row.adjustments;
      acc.totalAdjustmentStatic += row.adjustmentStatic;
      acc.totalAdjustmentApi += row.adjustmentApi;
      return acc;
    }, {
      totalRingbaStatic: 0,
      totalRingbaApi: 0,
      totalElocalStatic: 0,
      totalElocalApi: 0,
      totalAdjustments: 0,
      totalAdjustmentStatic: 0,
      totalAdjustmentApi: 0
    });
    
    chargebackSummary.totalRingba = chargebackSummary.totalRingbaStatic + chargebackSummary.totalRingbaApi;
    chargebackSummary.totalElocal = chargebackSummary.totalElocalStatic + chargebackSummary.totalElocalApi;
    chargebackSummary.adjustmentPercentage = chargebackSummary.totalRingba !== 0 
      ? (chargebackSummary.totalAdjustments / chargebackSummary.totalRingba) * 100 
      : 0;

    const chargeback = {
      rows: chargebackRows,
      summary: chargebackSummary,
      dateRange: {
        startDate: startDateStr,
        endDate: endDateStr
      }
    };

    return {
      health,
      stats,
      history,
      activity,
      chargeback,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    return null;
  } finally {
    db?.close();
  }
};

// API Routes
const routes = {
  // Health status endpoint
  '/api/health': (req, res) => {
    const db = getDb();
    if (!db) {
      return sendError(res, 'Database connection failed', 503);
    }

    try {
      // Get service status from scraping_sessions
      const recentSessions = db.prepare(`
        SELECT * FROM scraping_sessions 
        ORDER BY started_at DESC 
        LIMIT 10
      `).all();

      // Get last run times - separate STATIC and API (case-insensitive)
      const lastHistorical = db.prepare(`
        SELECT * FROM scraping_sessions 
        WHERE LOWER(session_id) LIKE '%historical%' 
          AND (LOWER(session_id) LIKE '%static%' OR LOWER(session_id) NOT LIKE '%api%')
        ORDER BY started_at DESC 
        LIMIT 1
      `).get();

      const lastHistoricalAPI = db.prepare(`
        SELECT * FROM scraping_sessions 
        WHERE LOWER(session_id) LIKE '%historical%' 
          AND LOWER(session_id) LIKE '%api%'
        ORDER BY started_at DESC 
        LIMIT 1
      `).get();

      const lastCurrent = db.prepare(`
        SELECT * FROM scraping_sessions 
        WHERE LOWER(session_id) LIKE '%current%' 
          AND (LOWER(session_id) LIKE '%static%' OR LOWER(session_id) NOT LIKE '%api%')
        ORDER BY started_at DESC 
        LIMIT 1
      `).get();

      const lastCurrentAPI = db.prepare(`
        SELECT * FROM scraping_sessions 
        WHERE LOWER(session_id) LIKE '%current%' 
          AND LOWER(session_id) LIKE '%api%'
        ORDER BY started_at DESC 
        LIMIT 1
      `).get();

      // Get Ringba sync status - use sync_completed_at if available, otherwise use the most recent log entry
      const lastRingbaSync = db.prepare(`
        SELECT * FROM ringba_sync_logs 
        ORDER BY sync_completed_at DESC, id DESC 
        LIMIT 1
      `).get();
      
      // Get recent failed syncs for debugging
      const recentFailedSyncs = db.prepare(`
        SELECT id, sync_status, sync_attempted_at, error_message, caller_id, date_of_call
        FROM ringba_sync_logs 
        WHERE sync_status = 'failed'
        ORDER BY sync_attempted_at DESC 
        LIMIT 5
      `).all();
      
      // Get recent failed scraping sessions
      const recentFailedSessions = db.prepare(`
        SELECT id, session_id, status, error_message, started_at
        FROM scraping_sessions 
        WHERE status = 'failed'
        ORDER BY started_at DESC 
        LIMIT 5
      `).all();

      // Calculate success rates
      const totalSessions = db.prepare(`
        SELECT COUNT(*) as total,
               SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
               SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
        FROM scraping_sessions
      `).get();

      const successRate = totalSessions.total > 0 
        ? ((totalSessions.completed / totalSessions.total) * 100).toFixed(2)
        : 0;

      sendJSON(res, {
        status: 'healthy',
        database: 'connected',
        services: {
          historical: {
            lastRun: lastHistorical?.started_at || null,
            status: lastHistorical?.status || 'unknown',
            lastStatus: lastHistorical?.status || 'unknown',
            errorMessage: lastHistorical?.error_message || null
          },
          historicalAPI: {
            lastRun: lastHistoricalAPI?.started_at || null,
            status: lastHistoricalAPI?.status || 'unknown',
            lastStatus: lastHistoricalAPI?.status || 'unknown',
            errorMessage: lastHistoricalAPI?.error_message || null
          },
          current: {
            lastRun: lastCurrent?.started_at || null,
            status: lastCurrent?.status || 'unknown',
            lastStatus: lastCurrent?.status || 'unknown',
            errorMessage: lastCurrent?.error_message || null
          },
          currentAPI: {
            lastRun: lastCurrentAPI?.started_at || null,
            status: lastCurrentAPI?.status || 'unknown',
            lastStatus: lastCurrentAPI?.status || 'unknown',
            errorMessage: lastCurrentAPI?.error_message || null
          },
          ringba: {
            lastRun: lastRingbaSync?.sync_completed_at || lastRingbaSync?.sync_attempted_at || null,
            status: lastRingbaSync?.sync_status || 'unknown',
            lastStatus: lastRingbaSync?.sync_status || 'unknown',
            errorMessage: lastRingbaSync?.error_message || null
          }
        },
        successRate: parseFloat(successRate),
        recentSessions: recentSessions,
        debug: {
          recentFailedSyncs: recentFailedSyncs,
          recentFailedSessions: recentFailedSessions
        }
      });
    } catch (error) {
      sendError(res, error.message);
    } finally {
      db?.close();
    }
  },

  // Statistics endpoint
  '/api/stats': (req, res) => {
    const db = getDb();
    if (!db) {
      return sendError(res, 'Database connection failed', 503);
    }

    try {
      // Total calls
      const totalCalls = db.prepare('SELECT COUNT(*) as count FROM elocal_call_data').get();
      
      // Total adjustments
      const totalAdjustments = db.prepare('SELECT COUNT(*) as count FROM adjustment_details').get();
      
      // Total payout
      const totalPayout = db.prepare('SELECT SUM(payout) as total FROM elocal_call_data').get();
      
      // Calls today
      const callsToday = db.prepare(`
        SELECT COUNT(*) as count 
        FROM elocal_call_data 
        WHERE DATE(date_of_call) = DATE('now')
      `).get();

      // Calls this week
      const callsThisWeek = db.prepare(`
        SELECT COUNT(*) as count 
        FROM elocal_call_data 
        WHERE DATE(date_of_call) >= DATE('now', '-7 days')
      `).get();

      // Ringba sync stats - get recent stats (last 24 hours) and overall stats
      const ringbaStatsRecent = db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN sync_status = 'success' THEN 1 ELSE 0 END) as success,
          SUM(CASE WHEN sync_status = 'failed' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN sync_status = 'pending' OR sync_status = 'not_found' OR sync_status = 'cannot_sync' THEN 1 ELSE 0 END) as pending,
          MAX(sync_completed_at) as last_sync_time
        FROM ringba_sync_logs
        WHERE sync_completed_at >= DATETIME('now', '-24 hours')
      `).get();
      
      const ringbaStats = db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN sync_status = 'success' THEN 1 ELSE 0 END) as success,
          SUM(CASE WHEN sync_status = 'failed' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN sync_status = 'pending' OR sync_status = 'not_found' OR sync_status = 'cannot_sync' THEN 1 ELSE 0 END) as pending
        FROM ringba_sync_logs
      `).get();
      
      // Use recent stats if available, otherwise use overall stats
      const finalRingbaStats = ringbaStatsRecent.total > 0 ? ringbaStatsRecent : ringbaStats;

      // Recent activity (last 24 hours)
      const recentActivity = db.prepare(`
        SELECT COUNT(*) as count 
        FROM elocal_call_data 
        WHERE created_at >= DATETIME('now', '-1 day')
      `).get();

      sendJSON(res, {
        totalCalls: totalCalls.count || 0,
        totalAdjustments: totalAdjustments.count || 0,
        totalPayout: totalPayout.total || 0,
        callsToday: callsToday.count || 0,
        callsThisWeek: callsThisWeek.count || 0,
        recentActivity: recentActivity.count || 0,
        ringba: {
          total: finalRingbaStats.total || 0,
          success: finalRingbaStats.success || 0,
          failed: finalRingbaStats.failed || 0,
          pending: finalRingbaStats.pending || 0,
          successRate: finalRingbaStats.total > 0 
            ? ((finalRingbaStats.success / finalRingbaStats.total) * 100).toFixed(2)
            : 0,
          lastSyncTime: finalRingbaStats.last_sync_time || null
        }
      });
    } catch (error) {
      sendError(res, error.message);
    } finally {
      db?.close();
    }
  },

  // Service history endpoint - unified view of all services
  '/api/history': (req, res) => {
    const db = getDb();
    if (!db) {
      return sendError(res, 'Database connection failed', 503);
    }

    try {
      const queryParams = url.parse(req.url, true).query;
      const limit = parseInt(queryParams.limit) || 50;
      const service = queryParams.service || null;

      const allSessions = [];

      // 1. Scraping sessions (Historical, Current Day - STATIC and API)
      let scrapingQuery = `
        SELECT 
          id,
          session_id,
          started_at,
          completed_at,
          status,
          calls_scraped,
          adjustments_scraped,
          error_message,
          'scraping' as service_source
        FROM scraping_sessions 
        WHERE 1=1
      `;
      
      // Filter by service type if specified
      if (service === 'historical') {
        scrapingQuery += ` AND (LOWER(session_id) LIKE '%historical%' AND LOWER(session_id) NOT LIKE '%api%')`;
      } else if (service === 'current') {
        scrapingQuery += ` AND (LOWER(session_id) LIKE '%current%' AND LOWER(session_id) NOT LIKE '%api%')`;
      } else if (service === 'historical-api') {
        scrapingQuery += ` AND (LOWER(session_id) LIKE '%historical%' AND LOWER(session_id) LIKE '%api%')`;
      } else if (service === 'current-api') {
        scrapingQuery += ` AND (LOWER(session_id) LIKE '%current%' AND LOWER(session_id) LIKE '%api%')`;
      } else if (service === 'ringba-sync') {
        // Skip scraping sessions for ringba-sync filter
        scrapingQuery += ` AND 1=0`;
      } else if (service === 'revenue-sync') {
        // Skip scraping sessions for revenue-sync filter
        scrapingQuery += ` AND 1=0`;
      } else if (service === 'ringba-cost-sync') {
        // Skip scraping sessions for ringba-cost-sync filter
        scrapingQuery += ` AND 1=0`;
      }

      scrapingQuery += ` ORDER BY started_at DESC LIMIT ?`;
      const scrapingSessions = db.prepare(scrapingQuery).all(limit * 2); // Get more to account for other services

      // Process scraping sessions
      scrapingSessions.forEach(session => {
        let serviceType = 'unknown';
        let serviceName = 'Unknown Service';
        
        if (session.session_id) {
          const sessionIdLower = session.session_id.toLowerCase();
          if (sessionIdLower.includes('historical')) {
            if (sessionIdLower.includes('api')) {
              serviceType = 'historical-api';
              serviceName = 'Historical (API)';
            } else {
              serviceType = 'historical';
              serviceName = 'Historical (STATIC)';
            }
          } else if (sessionIdLower.includes('current')) {
            if (sessionIdLower.includes('api')) {
              serviceType = 'current-api';
              serviceName = 'Current Day (API)';
            } else {
              serviceType = 'current';
              serviceName = 'Current Day (STATIC)';
            }
          }
        }
        
        allSessions.push({
          id: session.id,
          session_id: session.session_id,
          service_type: serviceType,
          service_name: serviceName,
          service_source: 'scraping',
          started_at: session.started_at,
          completed_at: session.completed_at,
          status: session.status || 'unknown',
          calls_scraped: session.calls_scraped || 0,
          adjustments_scraped: session.adjustments_scraped || 0,
          error_message: session.error_message || null,
          // Additional fields for compatibility
          calls: session.calls_scraped || 0,
          adjustments: session.adjustments_scraped || 0
        });
      });

      // 2. Ringba Sync sessions (aggregate from ringba_sync_logs)
      if (!service || service === 'ringba-sync') {
        let ringbaQuery = `
          SELECT 
            date(sync_completed_at) as sync_date,
            MIN(sync_completed_at) as started_at,
            MAX(sync_completed_at) as completed_at,
            COUNT(*) as total_syncs,
            SUM(CASE WHEN sync_status = 'success' THEN 1 ELSE 0 END) as successful_syncs,
            SUM(CASE WHEN sync_status = 'failed' THEN 1 ELSE 0 END) as failed_syncs,
            SUM(CASE WHEN sync_status = 'not_found' THEN 1 ELSE 0 END) as not_found_syncs,
            GROUP_CONCAT(DISTINCT category) as categories
          FROM ringba_sync_logs
          WHERE sync_completed_at IS NOT NULL
        `;
        
        ringbaQuery += ` GROUP BY date(sync_completed_at) ORDER BY completed_at DESC LIMIT ?`;
        const ringbaSyncSessions = db.prepare(ringbaQuery).all(limit);

        // Get error messages for failed syncs in this date range
        ringbaSyncSessions.forEach((session, index) => {
          const status = session.failed_syncs > 0 ? 'partial' : (session.successful_syncs > 0 ? 'success' : 'failed');
          
          // Get sample error messages for this date
          let errorMessages = [];
          if (session.failed_syncs > 0) {
            try {
              const errorSamples = db.prepare(`
                SELECT DISTINCT error_message
                FROM ringba_sync_logs
                WHERE date(sync_completed_at) = date(?)
                  AND sync_status = 'failed'
                  AND error_message IS NOT NULL
                LIMIT 3
              `).all(session.completed_at);
              errorMessages = errorSamples.map(e => e.error_message).filter(Boolean);
            } catch (e) {
              // Ignore query errors
            }
          }
          
          allSessions.push({
            id: `ringba-sync-${session.sync_date}-${index}`,
            session_id: `ringba-sync-${session.sync_date}`,
            service_type: 'ringba-sync',
            service_name: 'Ringba Sync',
            service_source: 'ringba-sync',
            started_at: session.started_at,
            completed_at: session.completed_at,
            status: status,
            calls_scraped: session.total_syncs || 0,
            adjustments_scraped: session.successful_syncs || 0,
            error_message: session.failed_syncs > 0 ? 
              `${session.failed_syncs} syncs failed${errorMessages.length > 0 ? ': ' + errorMessages[0] : ''}` : null,
            error_samples: errorMessages,
            // Additional fields
            calls: session.total_syncs || 0,
            adjustments: session.successful_syncs || 0,
            total_syncs: session.total_syncs,
            successful_syncs: session.successful_syncs,
            failed_syncs: session.failed_syncs,
            not_found_syncs: session.not_found_syncs,
            categories: session.categories
          });
        });
      }

      // 3. Revenue Sync sessions (from revenue_summary updated_at)
      if (!service || service === 'revenue-sync') {
        let revenueQuery = `
          SELECT 
            date(updated_at) as sync_date,
            MIN(updated_at) as started_at,
            MAX(updated_at) as completed_at,
            COUNT(*) as days_processed
          FROM revenue_summary
          WHERE updated_at IS NOT NULL
        `;
        
        revenueQuery += ` GROUP BY date(updated_at) ORDER BY completed_at DESC LIMIT ?`;
        const revenueSyncSessions = db.prepare(revenueQuery).all(limit);

        revenueSyncSessions.forEach((session, index) => {
          allSessions.push({
            id: `revenue-sync-${session.sync_date}-${index}`,
            session_id: `revenue-sync-${session.sync_date}`,
            service_type: 'revenue-sync',
            service_name: 'Revenue Sync',
            service_source: 'revenue-sync',
            started_at: session.started_at,
            completed_at: session.completed_at,
            status: 'success',
            calls_scraped: session.days_processed || 0,
            adjustments_scraped: 0,
            error_message: null,
            // Additional fields
            calls: session.days_processed || 0,
            adjustments: 0,
            days_processed: session.days_processed
          });
        });
      }

      // 4. Ringba Cost Sync sessions (from ringba_cost_data updated_at)
      if (!service || service === 'ringba-cost-sync') {
        let costQuery = `
          SELECT 
            date(updated_at) as sync_date,
            MIN(updated_at) as started_at,
            MAX(updated_at) as completed_at,
            COUNT(*) as calls_processed
          FROM ringba_cost_data
          WHERE updated_at IS NOT NULL
        `;
        
        costQuery += ` GROUP BY date(updated_at) ORDER BY completed_at DESC LIMIT ?`;
        const costSyncSessions = db.prepare(costQuery).all(limit);

        costSyncSessions.forEach((session, index) => {
          allSessions.push({
            id: `ringba-cost-sync-${session.sync_date}-${index}`,
            session_id: `ringba-cost-sync-${session.sync_date}`,
            service_type: 'ringba-cost-sync',
            service_name: 'Ringba Cost Sync',
            service_source: 'ringba-cost-sync',
            started_at: session.started_at,
            completed_at: session.completed_at,
            status: 'success',
            calls_scraped: session.calls_processed || 0,
            adjustments_scraped: 0,
            error_message: null,
            // Additional fields
            calls: session.calls_processed || 0,
            adjustments: 0,
            calls_processed: session.calls_processed
          });
        });
      }

      // Sort all sessions by started_at (most recent first) and limit
      allSessions.sort((a, b) => {
        const dateA = new Date(a.started_at || a.completed_at || 0);
        const dateB = new Date(b.started_at || b.completed_at || 0);
        return dateB - dateA;
      });

      const limitedSessions = allSessions.slice(0, limit);

      sendJSON(res, {
        sessions: limitedSessions,
        count: limitedSessions.length,
        total: allSessions.length
      });
    } catch (error) {
      sendError(res, error.message);
    } finally {
      db?.close();
    }
  },

  // Service logs endpoint - detailed error logs for debugging
  '/api/service-logs': (req, res) => {
    const db = getDb();
    if (!db) {
      return sendError(res, 'Database connection failed', 503);
    }

    try {
      const queryParams = url.parse(req.url, true).query;
      const serviceType = queryParams.service || null;
      const sessionId = queryParams.session_id || null;
      const status = queryParams.status || null; // 'failed', 'partial', etc.
      const limit = parseInt(queryParams.limit) || 50;

      const logs = [];

      // 1. Scraping session errors
      if (!serviceType || serviceType.startsWith('historical') || serviceType.startsWith('current')) {
        let scrapingQuery = `
          SELECT 
            id,
            session_id,
            started_at,
            completed_at,
            status,
            error_message,
            calls_scraped,
            adjustments_scraped,
            'scraping' as log_source
          FROM scraping_sessions
          WHERE error_message IS NOT NULL
        `;

        if (sessionId) {
          scrapingQuery += ` AND session_id = ?`;
        }
        if (status) {
          scrapingQuery += ` AND status = ?`;
        }
        if (serviceType === 'historical' || serviceType === 'historical-api') {
          scrapingQuery += ` AND LOWER(session_id) LIKE '%historical%'`;
          if (serviceType === 'historical') {
            scrapingQuery += ` AND LOWER(session_id) NOT LIKE '%api%'`;
          } else {
            scrapingQuery += ` AND LOWER(session_id) LIKE '%api%'`;
          }
        } else if (serviceType === 'current' || serviceType === 'current-api') {
          scrapingQuery += ` AND LOWER(session_id) LIKE '%current%'`;
          if (serviceType === 'current') {
            scrapingQuery += ` AND LOWER(session_id) NOT LIKE '%api%'`;
          } else {
            scrapingQuery += ` AND LOWER(session_id) LIKE '%api%'`;
          }
        }

        scrapingQuery += ` ORDER BY started_at DESC LIMIT ?`;

        const params = [];
        if (sessionId) params.push(sessionId);
        if (status) params.push(status);
        params.push(limit);

        const scrapingLogs = db.prepare(scrapingQuery).all(...params);
        scrapingLogs.forEach(log => {
          logs.push({
            id: log.id,
            session_id: log.session_id,
            service_type: log.session_id?.toLowerCase().includes('api') ? 
              (log.session_id?.toLowerCase().includes('historical') ? 'historical-api' : 'current-api') :
              (log.session_id?.toLowerCase().includes('historical') ? 'historical' : 'current'),
            log_source: 'scraping',
            timestamp: log.started_at || log.completed_at,
            status: log.status,
            error_message: log.error_message,
            context: {
              calls_scraped: log.calls_scraped || 0,
              adjustments_scraped: log.adjustments_scraped || 0
            }
          });
        });
      }

      // 2. Ringba Sync errors
      if (!serviceType || serviceType === 'ringba-sync') {
        let ringbaQuery = `
          SELECT 
            id,
            campaign_call_id,
            date_of_call,
            caller_id,
            category,
            sync_status,
            sync_attempted_at,
            sync_completed_at,
            error_message,
            api_request,
            api_response,
            lookup_result
          FROM ringba_sync_logs
          WHERE error_message IS NOT NULL
        `;

        if (status) {
          ringbaQuery += ` AND sync_status = ?`;
        }

        ringbaQuery += ` ORDER BY sync_attempted_at DESC LIMIT ?`;

        const params = [];
        if (status) params.push(status);
        params.push(limit);

        const ringbaLogs = db.prepare(ringbaQuery).all(...params);
        ringbaLogs.forEach(log => {
          // Safely parse JSON fields
          let apiRequest = null;
          let apiResponse = null;
          let lookupResult = null;
          
          try {
            if (log.api_request) apiRequest = JSON.parse(log.api_request);
          } catch (e) {
            apiRequest = log.api_request; // Use as string if not valid JSON
          }
          
          try {
            if (log.api_response) apiResponse = JSON.parse(log.api_response);
          } catch (e) {
            apiResponse = log.api_response; // Use as string if not valid JSON
          }
          
          try {
            if (log.lookup_result) lookupResult = JSON.parse(log.lookup_result);
          } catch (e) {
            lookupResult = log.lookup_result; // Use as string if not valid JSON
          }
          
          logs.push({
            id: log.id,
            session_id: `ringba-sync-${log.campaign_call_id}`,
            service_type: 'ringba-sync',
            log_source: 'ringba-sync',
            timestamp: log.sync_attempted_at || log.sync_completed_at,
            status: log.sync_status,
            error_message: log.error_message,
            context: {
              campaign_call_id: log.campaign_call_id,
              caller_id: log.caller_id,
              date_of_call: log.date_of_call,
              category: log.category,
              api_request: apiRequest,
              api_response: apiResponse,
              lookup_result: lookupResult
            }
          });
        });
      }

      // Sort by timestamp (most recent first)
      logs.sort((a, b) => {
        const dateA = new Date(a.timestamp || 0);
        const dateB = new Date(b.timestamp || 0);
        return dateB - dateA;
      });

      sendJSON(res, {
        logs: logs.slice(0, limit),
        count: logs.length,
        filters: {
          service: serviceType,
          session_id: sessionId,
          status: status
        }
      });
    } catch (error) {
      sendError(res, error.message);
    } finally {
      db?.close();
    }
  },

  // Ringba sync logs endpoint
  '/api/ringba-logs': (req, res) => {
    const db = getDb();
    if (!db) {
      return sendError(res, 'Database connection failed', 503);
    }

    try {
      const queryParams = url.parse(req.url, true).query;
      const limit = parseInt(queryParams.limit) || 50;
      const status = queryParams.status || null;

      let query = `
        SELECT * FROM ringba_sync_logs 
        WHERE 1=1
      `;
      
      if (status) {
        query += ` AND sync_status = ?`;
      }

      query += ` ORDER BY sync_attempted_at DESC LIMIT ?`;

      const logs = status 
        ? db.prepare(query).all(status, limit)
        : db.prepare(query).all(limit);

      sendJSON(res, {
        logs: logs,
        count: logs.length
      });
    } catch (error) {
      sendError(res, error.message);
    } finally {
      db?.close();
    }
  },

  // Chargeback tracking endpoint
  '/api/chargeback': (req, res) => {
    const db = getDb();
    if (!db) {
      return sendError(res, 'Database connection failed', 503);
    }

    try {
      const queryParams = url.parse(req.url, true).query;
      const limit = parseInt(queryParams.limit); // If limit is provided, use it; otherwise fetch all
      
      let revenueData;
      let startDateStr, endDateStr;
      
      if (limit && limit > 0) {
        // Calculate date range based on limit
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - limit);
        
        startDateStr = startDate.toISOString().split('T')[0];
        endDateStr = endDate.toISOString().split('T')[0];
        
        // Fetch revenue summary data for date range
        revenueData = db.prepare(`
          SELECT * FROM revenue_summary
          WHERE date >= date(?) AND date <= date(?)
          ORDER BY date DESC
        `).all(startDateStr, endDateStr);
      } else {
        // Fetch all data if no limit specified
        revenueData = db.prepare(`
          SELECT * FROM revenue_summary
          ORDER BY date DESC
        `).all();
        
        // Get date range from actual data
        if (revenueData.length > 0) {
          startDateStr = revenueData[revenueData.length - 1].date;
          endDateStr = revenueData[0].date;
        } else {
          const today = new Date().toISOString().split('T')[0];
          startDateStr = today;
          endDateStr = today;
        }
      }
      
      // Calculate adjustments for each row
      const rows = revenueData.map(row => {
        const ringbaStatic = parseFloat(row.ringba_static || 0);
        const ringbaApi = parseFloat(row.ringba_api || 0);
        const elocalStatic = parseFloat(row.elocal_static || 0);
        const elocalApi = parseFloat(row.elocal_api || 0);
        
        const ringbaTotal = ringbaStatic + ringbaApi;
        const elocalTotal = elocalStatic + elocalApi;
        
        // Adjustments = Ringba Total - Elocal Total
        const adjustments = ringbaTotal - elocalTotal;
        
        // Adjustment (Static) = (Ringba Static - Elocal Static) / 100
        const adjustmentStatic = (ringbaStatic - elocalStatic) / 100;
        
        // Adjustment (API) = (Ringba API - Elocal API) / 100
        const adjustmentApi = (ringbaApi - elocalApi) / 100;
        
        // Adjustment % = (Adjustments / Ringba Total) * 100
        const adjustmentPercentage = ringbaTotal !== 0 
          ? (adjustments / ringbaTotal) * 100 
          : 0;
        
        return {
          ...row,
          adjustments,
          adjustmentStatic,
          adjustmentApi,
          adjustmentPercentage
        };
      });
      
      // Calculate summary totals
      const summary = rows.reduce((acc, row) => {
        acc.totalRingbaStatic += parseFloat(row.ringba_static || 0);
        acc.totalRingbaApi += parseFloat(row.ringba_api || 0);
        acc.totalElocalStatic += parseFloat(row.elocal_static || 0);
        acc.totalElocalApi += parseFloat(row.elocal_api || 0);
        acc.totalAdjustments += row.adjustments;
        acc.totalAdjustmentStatic += row.adjustmentStatic;
        acc.totalAdjustmentApi += row.adjustmentApi;
        return acc;
      }, {
        totalRingbaStatic: 0,
        totalRingbaApi: 0,
        totalElocalStatic: 0,
        totalElocalApi: 0,
        totalAdjustments: 0,
        totalAdjustmentStatic: 0,
        totalAdjustmentApi: 0
      });
      
      summary.totalRingba = summary.totalRingbaStatic + summary.totalRingbaApi;
      summary.totalElocal = summary.totalElocalStatic + summary.totalElocalApi;
      summary.adjustmentPercentage = summary.totalRingba !== 0 
        ? (summary.totalAdjustments / summary.totalRingba) * 100 
        : 0;
      
      sendJSON(res, {
        rows,
        summary,
        dateRange: {
          startDate: startDateStr,
          endDate: endDateStr
        }
      });
    } catch (error) {
      sendError(res, error.message);
    } finally {
      db?.close();
    }
  },

  // Recent activity endpoint
  '/api/activity': (req, res) => {
    const db = getDb();
    if (!db) {
      return sendError(res, 'Database connection failed', 503);
    }

    try {
      const queryParams = url.parse(req.url, true).query;
      const limit = parseInt(queryParams.limit) || 20;

      // Get recent calls
      const recentCalls = db.prepare(`
        SELECT id, date_of_call, caller_id, payout, created_at
        FROM elocal_call_data
        ORDER BY created_at DESC
        LIMIT ?
      `).all(limit);

      // Get recent adjustments
      const recentAdjustments = db.prepare(`
        SELECT id, time_of_call, caller_id, amount, created_at
        FROM adjustment_details
        ORDER BY created_at DESC
        LIMIT ?
      `).all(limit);

      // Get recent sessions
      const recentSessions = db.prepare(`
        SELECT * FROM scraping_sessions
        ORDER BY started_at DESC
        LIMIT ?
      `).all(limit);

      sendJSON(res, {
        calls: recentCalls,
        adjustments: recentAdjustments,
        sessions: recentSessions
      });
    } catch (error) {
      sendError(res, error.message);
    } finally {
      db?.close();
    }
  },

  // Diagnostic endpoint
  '/api/debug': (req, res) => {
    const buildDir = path.join(__dirname, 'dashboard-build');
    const buildPath = path.join(buildDir, 'index.html');
    const assetsDir = path.join(buildDir, 'assets');
    
    const debug = {
      server: {
        port: PORT,
        workingDir: __dirname,
        nodeVersion: process.version
      },
      build: {
        exists: fs.existsSync(buildDir),
        path: buildDir,
        indexHtmlExists: fs.existsSync(buildPath),
        indexHtmlPath: buildPath,
        assetsDirExists: fs.existsSync(assetsDir),
        assetsDirPath: assetsDir
      },
      files: {}
    };
    
    if (fs.existsSync(buildDir)) {
      try {
        const files = fs.readdirSync(buildDir);
        debug.files.root = files;
        
        if (fs.existsSync(assetsDir)) {
          const assetFiles = fs.readdirSync(assetsDir);
          debug.files.assets = assetFiles;
        }
      } catch (error) {
        debug.files.error = error.message;
      }
    }
    
    sendJSON(res, debug);
  },

  // Serve React build or fallback to HTML (handle both root and prefixed paths)
  // Nginx rewrites /ringba-sync-dashboard/ to /, so we serve on root
  '/': (req, res) => {
    const buildPath = path.join(__dirname, 'dashboard-build', 'index.html');
    const fallbackPath = path.join(__dirname, 'dashboard.html');
    
    console.log('[ROOT] Serving dashboard:', {
      buildPath,
      buildExists: fs.existsSync(buildPath),
      fallbackExists: fs.existsSync(fallbackPath),
      requestUrl: req.url,
      headers: {
        host: req.headers.host,
        referer: req.headers.referer
      }
    });
    
    // Try React build first, fallback to old HTML
    if (fs.existsSync(buildPath)) {
      let html = fs.readFileSync(buildPath, 'utf8');
      console.log('[ROOT] Serving React build, length:', html.length);
      
      // Fetch all dashboard data from database
      const dashboardData = fetchAllDashboardData();
      if (dashboardData) {
        // Embed data as JSON in HTML
        const dataScript = `<script id="dashboard-initial-data" type="application/json">${JSON.stringify(dashboardData)}</script>`;
        html = html.replace('</head>', `  ${dataScript}\n</head>`);
        console.log('[ROOT] Embedded dashboard data in HTML');
      } else {
        console.warn('[ROOT] Could not fetch dashboard data from database');
      }
      
      // Check if base tag exists and is correct
      const baseTagMatch = html.match(/<base[^>]*href=["']([^"']+)["']/i);
      if (baseTagMatch) {
        console.log('[ROOT] Base tag found:', baseTagMatch[1]);
      } else {
        html = html.replace('<head>', '<head>\n    <base href="/ringba-sync-dashboard/">');
        console.log('[ROOT] Added base tag to HTML');
      }
      
      // Log asset references in HTML for debugging
      const scriptMatches = html.match(/src=["']([^"']+\.js)["']/gi);
      const cssMatches = html.match(/href=["']([^"']+\.css)["']/gi);
      if (scriptMatches) {
        console.log('[ROOT] Script references:', scriptMatches);
      }
      if (cssMatches) {
        console.log('[ROOT] CSS references:', cssMatches);
      }
      
      res.writeHead(200, { 
        'Content-Type': 'text/html',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(html);
    } else if (fs.existsSync(fallbackPath)) {
      console.log('[ROOT] Serving fallback HTML');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(fallbackPath));
    } else {
      console.error('[ROOT] Neither build nor fallback exists!');
      sendError(res, 'Dashboard not found', 404);
    }
  }
};

// Create HTTP server
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  let pathname = parsedUrl.pathname;

  // Debug logging (can be removed in production)
  console.log(`[${req.method}] ${pathname}`, {
    headers: {
      host: req.headers.host,
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'x-forwarded-proto': req.headers['x-forwarded-proto']
    }
  });

  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Handle /ringba-sync-dashboard/api/* paths (strip prefix for direct access)
  if (pathname.startsWith('/ringba-sync-dashboard/api/')) {
    pathname = pathname.replace('/ringba-sync-dashboard', '');
  }
  
  // Normalize pathname: remove trailing slash and ensure it starts with /
  pathname = pathname.replace(/\/$/, '') || '/';

  // Check if this is an asset request BEFORE route handling
  const buildDir = path.join(__dirname, 'dashboard-build');
  const isAssetRequest = pathname.startsWith('/assets/') || 
                         pathname.startsWith('/ringba-sync-dashboard/assets/') ||
                         pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|map|json)$/i);
  
  if (isAssetRequest && fs.existsSync(buildDir)) {
    // Handle both /assets/... and /ringba-sync-dashboard/assets/... paths
    let filePath = pathname;
    
    // Strip /ringba-sync-dashboard prefix if present
    if (pathname.startsWith('/ringba-sync-dashboard/')) {
      filePath = pathname.replace('/ringba-sync-dashboard', '');
    }
    
    // Remove leading slash and join with build directory
    const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    const fullPath = path.join(buildDir, cleanPath);
    
    console.log(`[ASSET] Attempting to serve: ${pathname} -> ${fullPath}`);
    
    // Security check: ensure path is within build directory
    const resolvedPath = path.resolve(fullPath);
    const resolvedBuildDir = path.resolve(buildDir);
    if (!resolvedPath.startsWith(resolvedBuildDir)) {
      console.warn(`[WARN] Security: Path outside build directory: ${pathname}`);
      sendError(res, 'Not found', 404);
      return;
    }
    
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      const ext = path.extname(fullPath);
      const contentType = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.map': 'application/json'
      }[ext] || 'application/octet-stream';
      
      const fileSize = fs.statSync(fullPath).size;
      console.log(`[ASSET] ✓ Serving: ${pathname} -> ${fullPath} (${contentType}, ${fileSize} bytes)`);
      res.writeHead(200, { 
        'Content-Type': contentType,
        'Cache-Control': ext === '.map' ? 'no-cache' : 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(fs.readFileSync(fullPath));
      return;
    } else {
      console.warn(`[ASSET] ✗ File not found: ${pathname} -> ${fullPath}`);
      console.warn(`[ASSET]   - File exists: ${fs.existsSync(fullPath)}`);
      console.warn(`[ASSET]   - Is file: ${fs.existsSync(fullPath) ? fs.statSync(fullPath).isFile() : 'N/A'}`);
      
      // Try to list directory contents for debugging
      const dirPath = path.dirname(fullPath);
      if (fs.existsSync(dirPath)) {
        try {
          const dirContents = fs.readdirSync(dirPath);
          console.warn(`[ASSET]   - Directory contents (${dirPath}): ${dirContents.join(', ')}`);
        } catch (e) {
          console.warn(`[ASSET]   - Could not read directory: ${e.message}`);
        }
      } else {
        console.warn(`[ASSET]   - Directory does not exist: ${dirPath}`);
      }
    }
  }
  
  // Route handling
  // Try exact match first
  if (routes[pathname]) {
    try {
      console.log(`[ROUTE] Matched: ${pathname}`);
      routes[pathname](req, res);
    } catch (error) {
      console.error(`[ERROR] Route ${pathname}:`, error.message);
      sendError(res, error.message);
    }
  } else {
    // Debug: log available routes
    console.warn(`[WARN] Route not found: ${pathname}`);
    console.warn(`[DEBUG] Available routes: ${Object.keys(routes).join(', ')}`);
    
    // Fallback: try serving index.html for SPA routing
    if (pathname.startsWith('/ringba-sync-dashboard/') || pathname === '/ringba-sync-dashboard') {
      const indexPath = path.join(__dirname, 'dashboard-build', 'index.html');
      if (fs.existsSync(indexPath)) {
        console.log(`[SPA] Serving index.html for: ${pathname}`);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fs.readFileSync(indexPath));
        return;
      }
    }
    
    sendError(res, 'Not found', 404);
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`Dashboard server running on http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down dashboard server...');
  server.close(() => {
    console.log('Dashboard server closed');
    process.exit(0);
  });
});

