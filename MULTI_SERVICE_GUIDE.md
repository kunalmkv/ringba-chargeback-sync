# 🚀 eLocal Multi-Service Automation System

## Overview

I've successfully created a comprehensive automation system with **two independent scheduled services** that automatically scrape and save data from eLocal.com with different date ranges and schedules.

## 🎯 Two Automated Services

### 1. **Historical Data Service**
- **Purpose**: Fetches data for past 10 days (excluding today)
- **Schedule**: Runs every **24 hours at 2:00 AM**
- **Cron Expression**: `0 2 * * *`
- **Date Range**: Automatically calculates past 10 days (yesterday backwards)

### 2. **Current Day Service**
- **Purpose**: Fetches data for current day only
- **Schedule**: Runs every **3 hours**
- **Cron Expression**: `0 */3 * * *`
- **Date Range**: Current day only (today's date)

## 📋 Key Features

### ✅ Date Range Management
- Automatic date range calculation
- Format: MM/DD/YYYY for eLocal website
- Intelligent date range selection on the website

### ✅ Duplicate Prevention
- Database checks for existing records before inserting
- Campaign calls: Checks by `caller_id`, `date_of_call`, and `campaign_phone`
- Adjustment details: Checks by `call_sid` (unique identifier)
- Reports how many records were inserted vs skipped

### ✅ CSV Export Automation
- Automatically clicks "Export Calls" button
- Downloads CSV file to `downloads/` directory
- Verifies download completion
- File naming: `campaign_results.csv`

### ✅ Independent Scheduling
- Both services run independently
- Different schedules (24h vs 3h)
- No interference between services
- Individual statistics tracking

### ✅ Comprehensive Logging
- Service-specific logging
- Job statistics (success rate, runs, failures)
- Date range information
- Database operation results

## 🚀 Usage

### Run Individual Services

```bash
# Run historical data service once (past 10 days)
npm run historical

# Run current day service once
npm run current

# Run regular scraper (no date range filter)
npm start
```

### Start Multi-Scheduler (Recommended)

```bash
# Start both services with their schedules
npm run multi
# or
npm start multi-scheduler
```

This will:
- ✅ Start Historical Service: Runs daily at 2 AM
- ✅ Start Current Day Service: Runs every 3 hours
- ✅ Both services run independently
- ✅ Process continues running until stopped (Ctrl+C)

## 📊 Service Details

### Historical Data Service

**When it runs:**
- Every day at 2:00 AM (configurable)

**What it does:**
1. Calculates date range: Past 10 days (excluding today)
2. Logs into eLocal.com
3. Navigates to Appliance Repair campaign
4. Sets date range filter on the page
5. Exports calls data to CSV
6. Extracts and saves caller IDs and payouts
7. Extracts and saves adjustment details
8. Saves to SQLite database (skipping duplicates)

**Example Date Range:**
- If today is Oct 29, 2025
- Fetches: Oct 19, 2025 to Oct 28, 2025 (10 days)

### Current Day Service

**When it runs:**
- Every 3 hours (12:00 AM, 3:00 AM, 6:00 AM, 9:00 AM, 12:00 PM, 3:00 PM, 6:00 PM, 9:00 PM)

**What it does:**
1. Calculates date range: Current day only
2. Logs into eLocal.com
3. Navigates to Appliance Repair campaign
4. Sets date range filter to today's date
5. Exports calls data to CSV
6. Extracts and saves caller IDs and payouts
7. Extracts and saves adjustment details
8. Saves to SQLite database (skipping duplicates)

**Example Date Range:**
- If today is Oct 29, 2025
- Fetches: Oct 29, 2025 only

## 📁 File Structure

```
src/
├── services/
│   ├── elocal-services.js      # Service functions (historical & current)
│   ├── multi-scheduler.js      # Multi-scheduler system
│   └── scheduler.js            # Legacy scheduler
├── utils/
│   ├── date-utils.js           # Date range calculations
│   ├── helpers.js              # Data processing
│   └── error-handling.js       # Error handling
├── scrapers/
│   └── elocal-scraper.js       # Web scraping logic (with date range support)
└── database/
    └── sqlite-operations.js    # Database ops (with duplicate prevention)
```

## 🗄️ Database Schema

Both services save data to the same SQLite database:

### Campaign Calls Table
- Stores: Caller ID, Payout, Date, Duration, Assessment
- Duplicate Check: `caller_id` + `date_of_call` + `campaign_phone`

### Adjustment Details Table
- Stores: Time, Amount, Call SID, Classification
- Duplicate Check: `call_sid` (unique)

### Scraping Sessions Table
- Tracks: Each scraping run with status and statistics

## 🔧 Configuration

All configuration is in `.env` file:

```env
# Database
DB_PATH=./data/elocal_scraper.db

# Website Credentials
ELOCAL_USERNAME=your_email@example.com
ELOCAL_PASSWORD=your_password

# Scheduling (for multi-scheduler)
SCHEDULE_TIMEZONE=America/New_York
```

## 📊 Monitoring

### View Scheduler Status

When multi-scheduler is running, it logs status every minute:

```
[INFO] Multi-scheduler status:
  Historical Data Service: 100.00% success rate, Last run: 2025-10-29T02:00:00.000Z
  Current Day Service: 100.00% success rate, Last run: 2025-10-29T09:00:00.000Z
```

### Check Database

```bash
# View recent scraping sessions
sqlite3 data/elocal_scraper.db "SELECT * FROM scraping_sessions ORDER BY started_at DESC LIMIT 10;"

# View call statistics
sqlite3 data/elocal_scraper.db "SELECT COUNT(*) as total_calls, COUNT(DISTINCT caller_id) as unique_callers, SUM(payout) as total_payout FROM campaign_calls;"

# View adjustment statistics
sqlite3 data/elocal_scraper.db "SELECT COUNT(*) as total_adjustments, SUM(amount) as total_amount FROM adjustment_details;"
```

## 🔄 Service Workflow

### Historical Service Workflow
1. **Calculate Date Range**: Past 10 days (excluding today)
2. **Login**: Authenticate to eLocal.com
3. **Navigate**: Go to campaigns page
4. **Select Campaign**: Click "Appliance Repair" campaign
5. **Set Date Range**: Automatically sets date filter
6. **Export CSV**: Clicks "Export Calls" button
7. **Extract Data**: Scrapes table data
8. **Save to DB**: Inserts with duplicate checking
9. **Log Results**: Records statistics and session

### Current Day Service Workflow
1. **Calculate Date Range**: Current day only
2. **Login**: Authenticate to eLocal.com
3. **Navigate**: Go to campaigns page
4. **Select Campaign**: Click "Appliance Repair" campaign
5. **Set Date Range**: Automatically sets date filter to today
6. **Export CSV**: Clicks "Export Calls" button
7. **Extract Data**: Scrapes table data
8. **Save to DB**: Inserts with duplicate checking
9. **Log Results**: Records statistics and session

## 🛠️ Troubleshooting

### Service Not Running
- Check logs in `logs/scraper.log`
- Verify credentials in `.env` file
- Ensure Chrome browser is installed

### Duplicate Records
- Database automatically prevents duplicates
- Check statistics in logs: `inserted` vs `skipped`
- Duplicates are skipped, not errors

### Date Range Not Set
- The scraper attempts to set dates automatically
- If automatic setting fails, it proceeds with default dates
- Check logs for date range setting status

## 📝 Example Output

```
[INFO] Starting historical data service (past 10 days)...
[INFO] Historical Data Service: 10/19/2025 to 10/28/2025 (10 days)
[INFO] Setting date range: 10/19/2025 to 10/28/2025
[SUCCESS] CSV file downloaded: campaign_results.csv (2911 bytes)
[SUCCESS] Saved 145 campaign calls (23 duplicates skipped)
[SUCCESS] Saved 12 adjustment details (5 duplicates skipped)
```

## 🎉 Summary

You now have a fully automated system that:

✅ **Runs historical data collection** every 24 hours (past 10 days)
✅ **Runs current day collection** every 3 hours
✅ **Prevents duplicate data** automatically
✅ **Exports CSV files** automatically
✅ **Saves to SQLite database** with deduplication
✅ **Tracks statistics** and success rates
✅ **Logs everything** for monitoring

**To start both services:**
```bash
npm run multi
```

The system will run continuously until you stop it (Ctrl+C). Both services operate independently on their own schedules! 🚀
