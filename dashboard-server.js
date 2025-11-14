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

    // History data
    const sessions = db.prepare(`
      SELECT * FROM scraping_sessions 
      ORDER BY started_at DESC 
      LIMIT 50
    `).all();

    const sessionsWithType = sessions.map(session => {
      let serviceType = 'unknown';
      if (session.session_id) {
        if (session.session_id.startsWith('historical_') || session.session_id.includes('historical')) {
          serviceType = 'historical';
        } else if (session.session_id.startsWith('current_') || session.session_id.includes('current')) {
          serviceType = 'current';
        }
      }
      return { ...session, serviceType };
    });

    const history = {
      sessions: sessionsWithType,
      count: sessionsWithType.length
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

  // Service history endpoint
  '/api/history': (req, res) => {
    const db = getDb();
    if (!db) {
      return sendError(res, 'Database connection failed', 503);
    }

    try {
      const queryParams = url.parse(req.url, true).query;
      const limit = parseInt(queryParams.limit) || 50;
      const service = queryParams.service || null;

      let query = `
        SELECT * FROM scraping_sessions 
        WHERE 1=1
      `;
      
      // Improved filter: check if session_id starts with service type or contains it
      if (service === 'historical') {
        query += ` AND (session_id LIKE 'historical_%' OR session_id LIKE '%_historical_%' OR session_id LIKE '%historical%')`;
      } else if (service === 'current') {
        query += ` AND (session_id LIKE 'current_%' OR session_id LIKE '%_current_%' OR session_id LIKE '%current%')`;
      }

      query += ` ORDER BY started_at DESC LIMIT ?`;

      const sessions = db.prepare(query).all(limit);

      // Add service type to each session for frontend display
      const sessionsWithType = sessions.map(session => {
        let serviceType = 'unknown';
        if (session.session_id) {
          if (session.session_id.startsWith('historical_') || session.session_id.includes('historical')) {
            serviceType = 'historical';
          } else if (session.session_id.startsWith('current_') || session.session_id.includes('current')) {
            serviceType = 'current';
          }
        }
        return { ...session, serviceType };
      });

      sendJSON(res, {
        sessions: sessionsWithType,
        count: sessionsWithType.length
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

