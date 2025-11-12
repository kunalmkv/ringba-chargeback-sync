# Dashboard Setup Guide

Complete step-by-step guide to build and start the React dashboard server.

## Prerequisites

- Node.js (v18 or higher)
- npm (comes with Node.js)
- PM2 (optional, for process management)

## Step-by-Step Setup

### 1. Clone the Repository (if not already done)

```bash
git clone <your-repo-url>
cd elocal
```

### 2. Install Main Dependencies

```bash
npm install
```

### 3. Install React Dashboard Dependencies

```bash
cd dashboard-react
npm install
cd ..
```

### 4. Build the React Dashboard

```bash
npm run dashboard:build
```

This command will:
- Install React dependencies (if not already installed)
- Build the React app
- Output the build to `dashboard-build/` directory

### 5. Configure Environment Variables (if needed)

Create or update `.env` file with required variables:

```bash
# Dashboard Configuration
DASHBOARD_PORT=3000

# Database Configuration
DB_PATH=./data/elocal_scraper.db

# Add other required variables as needed
```

### 6. Start the Dashboard Server

#### Option A: Using npm (Development)

```bash
npm run dashboard
```

#### Option B: Using PM2 (Production - Recommended)

```bash
# Start with PM2
npm run dashboard:pm2

# Or directly
pm2 start ecosystem.config.js
```

#### Option C: Direct Node.js

```bash
node dashboard-server.js
```

### 7. Verify Dashboard is Running

- Check if server is running: `curl http://localhost:3000/api/health`
- Open in browser: `http://localhost:3000`
- Via nginx: `http://your-domain/ringba-sync-dashboard/`

## PM2 Management Commands

If using PM2:

```bash
# View status
pm2 status

# View logs
pm2 logs dashboard

# Stop dashboard
pm2 stop dashboard

# Restart dashboard
pm2 restart dashboard

# Delete from PM2
pm2 delete dashboard

# Monitor (CPU, Memory)
pm2 monit

# Save process list
pm2 save

# Setup auto-start on system boot
pm2 startup
pm2 save
```

## Troubleshooting

### Dashboard shows blank page

1. Check browser console (F12) for errors
2. Verify React build exists: `ls -la dashboard-build/`
3. Check server logs: `pm2 logs dashboard` or check terminal output
4. Verify API endpoints: `curl http://localhost:3000/api/health`

### Build fails

1. Ensure Node.js version is 18+: `node --version`
2. Clear node_modules and reinstall:
   ```bash
   rm -rf node_modules dashboard-react/node_modules
   npm install
   cd dashboard-react && npm install && cd ..
   npm run dashboard:build
   ```

### Port already in use

1. Change port in `.env`: `DASHBOARD_PORT=3001`
2. Or stop existing process: `pm2 stop dashboard` or `pkill -f dashboard-server`

## Quick Start Script

For a complete setup in one go:

```bash
# 1. Install dependencies
npm install
cd dashboard-react && npm install && cd ..

# 2. Build React app
npm run dashboard:build

# 3. Start with PM2
npm run dashboard:pm2

# 4. Check status
pm2 status
pm2 logs dashboard
```

## File Structure

```
elocal/
├── dashboard-react/          # React source code
│   ├── src/
│   ├── package.json
│   └── vite.config.js
├── dashboard-build/           # Built React app (generated)
│   ├── index.html
│   └── assets/
├── dashboard-server.js        # Node.js server
├── ecosystem.config.js        # PM2 configuration
└── package.json
```

## Production Deployment Checklist

- [ ] Install all dependencies (`npm install` in root and `dashboard-react/`)
- [ ] Build React app (`npm run dashboard:build`)
- [ ] Configure `.env` file with correct settings
- [ ] Start with PM2 (`npm run dashboard:pm2`)
- [ ] Setup PM2 auto-start (`pm2 startup && pm2 save`)
- [ ] Configure nginx (if using reverse proxy)
- [ ] Verify dashboard is accessible
- [ ] Check logs for any errors

