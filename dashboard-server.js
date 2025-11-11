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

      // Get last run times
      const lastHistorical = db.prepare(`
        SELECT * FROM scraping_sessions 
        WHERE session_id LIKE '%historical%' 
        ORDER BY started_at DESC 
        LIMIT 1
      `).get();

      const lastCurrent = db.prepare(`
        SELECT * FROM scraping_sessions 
        WHERE session_id LIKE '%current%' 
        ORDER BY started_at DESC 
        LIMIT 1
      `).get();

      // Get Ringba sync status
      const lastRingbaSync = db.prepare(`
        SELECT * FROM ringba_sync_logs 
        ORDER BY sync_attempted_at DESC 
        LIMIT 1
      `).get();

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
            lastStatus: lastHistorical?.status || 'unknown'
          },
          current: {
            lastRun: lastCurrent?.started_at || null,
            status: lastCurrent?.status || 'unknown',
            lastStatus: lastCurrent?.status || 'unknown'
          },
          ringba: {
            lastRun: lastRingbaSync?.sync_attempted_at || null,
            lastStatus: lastRingbaSync?.sync_status || 'unknown'
          }
        },
        successRate: parseFloat(successRate),
        recentSessions: recentSessions
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
      const totalCalls = db.prepare('SELECT COUNT(*) as count FROM campaign_calls').get();
      
      // Total adjustments
      const totalAdjustments = db.prepare('SELECT COUNT(*) as count FROM adjustment_details').get();
      
      // Total payout
      const totalPayout = db.prepare('SELECT SUM(payout) as total FROM campaign_calls').get();
      
      // Calls today
      const callsToday = db.prepare(`
        SELECT COUNT(*) as count 
        FROM campaign_calls 
        WHERE DATE(date_of_call) = DATE('now')
      `).get();

      // Calls this week
      const callsThisWeek = db.prepare(`
        SELECT COUNT(*) as count 
        FROM campaign_calls 
        WHERE DATE(date_of_call) >= DATE('now', '-7 days')
      `).get();

      // Ringba sync stats
      const ringbaStats = db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN sync_status = 'success' THEN 1 ELSE 0 END) as success,
          SUM(CASE WHEN sync_status = 'failed' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN sync_status = 'pending' THEN 1 ELSE 0 END) as pending
        FROM ringba_sync_logs
      `).get();

      // Recent activity (last 24 hours)
      const recentActivity = db.prepare(`
        SELECT COUNT(*) as count 
        FROM campaign_calls 
        WHERE created_at >= DATETIME('now', '-1 day')
      `).get();

      // Top callers
      const topCallers = db.prepare(`
        SELECT caller_id, COUNT(*) as call_count, SUM(payout) as total_payout
        FROM campaign_calls
        GROUP BY caller_id
        ORDER BY call_count DESC
        LIMIT 10
      `).all();

      sendJSON(res, {
        totalCalls: totalCalls.count || 0,
        totalAdjustments: totalAdjustments.count || 0,
        totalPayout: totalPayout.total || 0,
        callsToday: callsToday.count || 0,
        callsThisWeek: callsThisWeek.count || 0,
        recentActivity: recentActivity.count || 0,
        ringba: {
          total: ringbaStats.total || 0,
          success: ringbaStats.success || 0,
          failed: ringbaStats.failed || 0,
          pending: ringbaStats.pending || 0,
          successRate: ringbaStats.total > 0 
            ? ((ringbaStats.success / ringbaStats.total) * 100).toFixed(2)
            : 0
        },
        topCallers: topCallers
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
        FROM campaign_calls
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

  // Dashboard HTML
  '/': (req, res) => {
    const dashboardPath = path.join(__dirname, 'dashboard.html');
    if (fs.existsSync(dashboardPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(dashboardPath));
    } else {
      sendError(res, 'Dashboard not found', 404);
    }
  },

  // Serve CSS and JS files
  '/dashboard.css': (req, res) => {
    const cssPath = path.join(__dirname, 'dashboard.css');
    if (fs.existsSync(cssPath)) {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      res.end(fs.readFileSync(cssPath));
    } else {
      sendError(res, 'CSS not found', 404);
    }
  },

  '/dashboard.js': (req, res) => {
    const jsPath = path.join(__dirname, 'dashboard.js');
    if (fs.existsSync(jsPath)) {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(fs.readFileSync(jsPath));
    } else {
      sendError(res, 'JavaScript not found', 404);
    }
  }
};

// Create HTTP server
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Route handling
  if (routes[pathname]) {
    try {
      routes[pathname](req, res);
    } catch (error) {
      sendError(res, error.message);
    }
  } else {
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

