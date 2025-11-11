# eLocal Scraper Dashboard

A modern, responsive dashboard to monitor and track the health status of eLocal scraper services.

## 🚀 Quick Start

### Start the Dashboard Server

```bash
npm run dashboard
```

The dashboard will be available at: **http://localhost:3000**

### Access the Dashboard

Open your browser and navigate to:
```
http://localhost:3000
```

## 📊 Features

### 1. **Service Health Status**
- Real-time health monitoring for all services:
  - Historical Data Service
  - Current Day Service
  - Ringba Sync Service
  - Auth Service
- Last run times and status indicators
- Color-coded status badges (Success/Error/Warning)

### 2. **Statistics Overview**
- Total calls scraped
- Total payout amount
- Total adjustments
- Success rate percentage
- Calls today and this week
- Recent activity metrics

### 3. **Ringba Sync Status**
- Total synced calls
- Successful syncs
- Failed syncs
- Pending syncs
- Success rate

### 4. **Service History**
- Complete history of all service runs
- Filter by service type (Historical/Current)
- Adjustable limit for results
- Status tracking (Completed/Failed/Running)
- Calls and adjustments scraped per session

### 5. **Recent Activity**
- Recent calls tab
- Recent adjustments tab
- Recent sessions tab
- Real-time updates

### 6. **Top Callers**
- Top 10 callers by call count
- Total payout per caller
- Ranked display with badges

## 🎨 Dashboard Features

### Auto-Refresh
- Automatically refreshes every 30 seconds
- Manual refresh button available
- Status indicator shows connection health

### Responsive Design
- Works on desktop, tablet, and mobile devices
- Modern, clean UI with smooth animations
- Color-coded status indicators

### Real-Time Updates
- Live data from database
- Last updated timestamp
- Connection status monitoring

## 🔧 Configuration

### Environment Variables

You can configure the dashboard server using environment variables:

```bash
# Dashboard port (default: 3000)
DASHBOARD_PORT=3000

# Database path (default: ./data/elocal_scraper.db)
DB_PATH=./data/elocal_scraper.db
```

### Custom Port

To run the dashboard on a different port:

```bash
DASHBOARD_PORT=8080 npm run dashboard
```

## 📡 API Endpoints

The dashboard server provides the following API endpoints:

### Health Status
```
GET /api/health
```
Returns service health status, last run times, and success rates.

### Statistics
```
GET /api/stats
```
Returns overall statistics including total calls, payout, adjustments, and top callers.

### Service History
```
GET /api/history?service=historical&limit=50
```
Returns service execution history with optional filtering.

### Ringba Sync Logs
```
GET /api/ringba-logs?status=success&limit=50
```
Returns Ringba sync logs with optional status filtering.

### Recent Activity
```
GET /api/activity?limit=20
```
Returns recent calls, adjustments, and sessions.

## 🛠️ Development

### File Structure

```
dashboard-server.js    # Backend API server
dashboard.html         # Dashboard HTML
dashboard.css          # Dashboard styles
dashboard.js           # Dashboard JavaScript
```

### Making Changes

1. **Backend (API)**: Edit `dashboard-server.js`
2. **Frontend (UI)**: Edit `dashboard.html`, `dashboard.css`, or `dashboard.js`
3. **Restart server**: Stop and restart `npm run dashboard`

## 📱 Mobile Support

The dashboard is fully responsive and works on:
- Desktop browsers
- Tablets
- Mobile phones

## 🔍 Monitoring

### Health Indicators

- 🟢 **Green**: Service is healthy and running
- 🟡 **Yellow**: Service is running or pending
- 🔴 **Red**: Service has failed or error

### Status Badges

- **Completed**: Service completed successfully
- **Failed**: Service encountered an error
- **Running**: Service is currently executing
- **Pending**: Service is waiting to run

## 🚨 Troubleshooting

### Dashboard Not Loading

1. **Check if server is running**:
   ```bash
   npm run dashboard
   ```

2. **Check port availability**:
   ```bash
   lsof -i :3000
   ```

3. **Check database connection**:
   - Ensure database file exists
   - Check database path in environment variables

### API Errors

1. **Check browser console** for JavaScript errors
2. **Check server logs** for backend errors
3. **Verify database** is accessible and has data

### Data Not Updating

1. **Check auto-refresh** is enabled
2. **Click refresh button** manually
3. **Check network tab** in browser dev tools
4. **Verify API endpoints** are responding

## 📊 Best Practices

1. **Regular Monitoring**: Check dashboard daily for service health
2. **Review History**: Check service history for patterns or issues
3. **Monitor Success Rates**: Track success rates over time
4. **Check Top Callers**: Identify high-value callers
5. **Review Recent Activity**: Stay updated on latest scrapes

## 🔐 Security Notes

- Dashboard runs on localhost by default
- For production, add authentication
- Consider using HTTPS
- Restrict access to authorized users

## 📝 Notes

- Dashboard requires database to be initialized
- Services must have run at least once to show data
- Auto-refresh interval: 30 seconds
- All times are displayed in local browser timezone

## 🎯 Future Enhancements

Potential features to add:
- Email alerts for service failures
- Export data to CSV/Excel
- Charts and graphs for trends
- User authentication
- Customizable refresh intervals
- Service scheduling visualization
- Error log viewer
- Performance metrics

