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

      // Get Ringba sync status - use sync_completed_at if available, otherwise use the most recent log entry
      const lastRingbaSync = db.prepare(`
        SELECT * FROM ringba_sync_logs 
        ORDER BY sync_completed_at DESC, id DESC 
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
            lastRun: lastRingbaSync?.sync_completed_at || lastRingbaSync?.sync_attempted_at || null,
            status: lastRingbaSync?.sync_status || 'unknown',
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
          total: finalRingbaStats.total || 0,
          success: finalRingbaStats.success || 0,
          failed: finalRingbaStats.failed || 0,
          pending: finalRingbaStats.pending || 0,
          successRate: finalRingbaStats.total > 0 
            ? ((finalRingbaStats.success / finalRingbaStats.total) * 100).toFixed(2)
            : 0,
          lastSyncTime: finalRingbaStats.last_sync_time || null
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
      fallbackExists: fs.existsSync(fallbackPath)
    });
    
    // Try React build first, fallback to old HTML
    if (fs.existsSync(buildPath)) {
      let html = fs.readFileSync(buildPath, 'utf8');
      console.log('[ROOT] Serving React build, length:', html.length);
      
      // Ensure base tag is set correctly for path prefix
      if (!html.includes('<base href=')) {
        html = html.replace('<head>', '<head>\n    <base href="/ringba-sync-dashboard/">');
        console.log('[ROOT] Added base tag to HTML');
      }
      
      res.writeHead(200, { 
        'Content-Type': 'text/html',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
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

  // Route handling
  if (routes[pathname]) {
    try {
      routes[pathname](req, res);
    } catch (error) {
      console.error(`[ERROR] Route ${pathname}:`, error.message);
      sendError(res, error.message);
    }
  } else {
    // Try to serve static files from React build
    const buildDir = path.join(__dirname, 'dashboard-build');
    if (fs.existsSync(buildDir)) {
      // Handle both /assets/... and /ringba-sync-dashboard/assets/... paths
      let filePath = pathname;
      
      // Strip /ringba-sync-dashboard prefix if present
      if (pathname.startsWith('/ringba-sync-dashboard/')) {
        filePath = pathname.replace('/ringba-sync-dashboard', '');
      }
      
      // Remove leading slash and join with build directory
      const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
      const fullPath = path.join(buildDir, cleanPath);
      
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
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon',
          '.woff': 'font/woff',
          '.woff2': 'font/woff2',
          '.ttf': 'font/ttf',
          '.map': 'application/json'
        }[ext] || 'application/octet-stream';
        
        console.log(`[ASSET] Serving: ${pathname} -> ${fullPath} (${contentType}, ${fs.statSync(fullPath).size} bytes)`);
        res.writeHead(200, { 
          'Content-Type': contentType,
          'Cache-Control': ext === '.map' ? 'no-cache' : 'public, max-age=31536000, immutable'
        });
        res.end(fs.readFileSync(fullPath));
        return;
      } else {
        console.warn(`[ASSET] File not found: ${pathname} -> ${fullPath} (exists: ${fs.existsSync(fullPath)})`);
        // Try to list directory contents for debugging
        if (fs.existsSync(path.dirname(fullPath))) {
          const dirContents = fs.readdirSync(path.dirname(fullPath));
          console.warn(`[ASSET] Directory contents: ${dirContents.join(', ')}`);
        }
      }
    } else {
      console.warn(`[ASSET] Build directory not found: ${buildDir}`);
    }
    
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
    
    console.warn(`[WARN] Route not found: ${pathname}`);
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

