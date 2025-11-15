# Complete Flow: `npm start multi-scheduler`

This document explains in detail what happens when you run `npm start multi-scheduler`.

---

## 📋 **Step 1: Command Execution**

### 1.1 Package.json Script Resolution
```bash
npm start multi-scheduler
```
- **Resolves to:** `node src/index.js multi-scheduler`
- The `start` script in `package.json` maps to `node src/index.js`
- The argument `multi-scheduler` is passed as a command

---

## 📋 **Step 2: Entry Point (src/index.js)**

### 2.1 Module Initialization
1. **Environment Loading:**
   - `dotenv.config()` loads environment variables from `.env` file
   - Configures database paths, API credentials, etc.

2. **Imports:**
   - Functional programming libraries (`fp-ts`, `ramda`)
   - Database operations (`sqlite-operations.js`)
   - Scraping operations (`elocal-scraper.js`)
   - Service functions (`elocal-services.js`)
   - **Multi-scheduler** (`multi-scheduler.js`)

3. **Config Creation:**
   - `createConfig()` creates configuration object from environment variables
   - Includes: database path, Ringba credentials, eLocal credentials, etc.

### 2.2 Command Parsing
- The `main()` function checks `process.argv[2]` for the command
- Command detected: `'multi-scheduler'`
- Calls `runMultiSchedulerService()`

---

## 📋 **Step 3: Multi-Scheduler Service Initialization**

### 3.1 Database Initialization
```javascript
await initializeDatabase(config)();
```
- Creates SQLite database if it doesn't exist
- Creates/updates all required tables:
  - `elocal_call_data` (main call data)
  - `adjustment_details` (chargebacks, refunds)
  - `scraping_sessions` (service execution logs)
  - `ringba_sync_logs` (Ringba sync history)
  - `revenue_summary` (aggregated revenue data)
  - `ringba_cost_data` (Ringba cost information)

### 3.2 Multi-Scheduler Instance Creation
```javascript
const scheduler = createMultiScheduler(config);
```
- Creates a new `MultiScheduler` instance
- Initializes:
  - `this.config` - Configuration object
  - `this.logger` - Logger for tracking events
  - `this.scheduledTasks` - Map to store cron tasks
  - `this.jobStats` - Map to track job statistics
  - `this.isRunning` - Boolean flag

### 3.3 Scheduler Initialization
```javascript
scheduler.initialize();
```
- Logs initialization message
- Returns `Either.Right(this)` (functional programming pattern)

---

## 📋 **Step 4: Service Scheduling (8 Services)**

The scheduler registers **8 different services** with their cron schedules:

### 4.1 Historical Service (STATIC)
- **Schedule:** `'0 0 * * *'` - Daily at 12:00 AM IST (midnight)
- **Function:** `scheduleHistoricalService()`
- **Job Runner:** `runHistoricalJob()`
- **Service Function:** `scrapeHistoricalData(config)`
- **What it does:**
  - Fetches past 10 days of data (excluding today)
  - Campaign ID: `50033` (STATIC)
  - Includes adjustments (chargebacks, refunds)
  - Verifies payout with Ringba
  - Saves to `elocal_call_data` table

### 4.2 Current Day Service (STATIC)
- **Schedule:** `'0 21,0,3,6 * * *'` - Every 3 hours at 21:00, 00:00, 03:00, 06:00 IST
- **Function:** `scheduleCurrentDayService()`
- **Job Runner:** `runCurrentDayJob()`
- **Service Function:** `scrapeCurrentDayData(config)`
- **What it does:**
  - Uses `getCurrentDayRange()` which:
    - If IST time is 0-11 (midnight to 11:59 AM): Uses **previous day**
    - If IST time is 12-23 (noon to 11:59 PM): Uses **current day**
  - Campaign ID: `50033` (STATIC)
  - Includes adjustments
  - Verifies payout with Ringba

### 4.3 Historical Service (API)
- **Schedule:** `'30 0 * * *'` - Daily at 12:30 AM IST (30 minutes after STATIC)
- **Function:** `scheduleHistoricalAPIService()`
- **Job Runner:** `runHistoricalAPIJob()`
- **Service Function:** `scrapeHistoricalDataAPI(config)`
- **What it does:**
  - Fetches past 10 days of data (excluding today)
  - Campaign ID: `46775` (API)
  - **No adjustments table** (API category doesn't have adjustments)
  - Fetches payout from Ringba (overwrites "call price" from eLocal)

### 4.4 Current Day Service (API)
- **Schedule:** `'15 21,0,3,6 * * *'` - Every 3 hours at 21:15, 00:15, 03:15, 06:15 IST
- **Function:** `scheduleCurrentDayAPIService()`
- **Job Runner:** `runCurrentDayAPIJob()`
- **Service Function:** `scrapeCurrentDayDataAPI(config)`
- **What it does:**
  - Uses `getCurrentDayRange()` (same logic as STATIC)
  - Campaign ID: `46775` (API)
  - No adjustments
  - Fetches payout from Ringba

### 4.5 Auth Refresh Service
- **Schedule:** `'0 2 * * 0'` - Every Sunday at 2:00 AM IST
- **Function:** `scheduleAuthRefresh()`
- **Service Function:** `refreshAuthSession(config)`
- **What it does:**
  - Refreshes eLocal authentication session
  - Saves cookies to `data/session.json`
  - Prevents session expiration (3-day TTL)

### 4.6 Ringba Cost Sync Service
- **Schedule:** `'45 21,0,3,6 * * *'` - Every 3 hours at 21:45, 00:45, 03:45, 06:45 IST
- **Function:** `scheduleRingbaCostSync()`
- **Job Runner:** `runRingbaCostSyncJob()`
- **Service Function:** `syncRingbaCostDataForToday(config)`
- **What it does:**
  - Fetches Ringba call data for **current day only**
  - Gets revenue and cost (payout) from Ringba API
  - Determines category (STATIC/API) based on target ID
  - Saves to `ringba_cost_data` table
  - **Skips calls that already exist** (idempotent)

### 4.7 Revenue Sync Service
- **Schedule:** `'50 21,0,3,6 * * *'` - Every 3 hours at 21:50, 00:50, 03:50, 06:50 IST
- **Function:** `scheduleRevenueSync()`
- **Job Runner:** `runRevenueSyncJob()`
- **Service Function:** `syncRevenueForLastDays(config)(10)`
- **What it does:**
  - Aggregates revenue from last **10 days**
  - Fetches Ringba cost data from `ringba_cost_data` table
  - Fetches Elocal call data from `elocal_call_data` table
  - Matches by date and category (STATIC/API)
  - Aggregates by date and category
  - Saves to `revenue_summary` table

### 4.8 Ringba Sync Service
- **Schedule:** `'0 22,1,4,7 * * *'` - Every 3 hours at 22:00, 01:00, 04:00, 07:00 IST
- **Function:** `scheduleRingbaSync()`
- **Job Runner:** `runRingbaSyncJob()`
- **Service Function:** `syncAdjustmentsToRingba(config)(null)` - null = all categories
- **What it does:**
  - Finds calls with adjustments OR payout mismatches
  - For STATIC: Syncs if adjustment exists OR payout doesn't match Ringba
  - For API: Syncs if payout doesn't match Ringba
  - Updates Ringba API with correct payout
  - Logs all sync attempts to `ringba_sync_logs` table

---

## 📋 **Step 5: Starting All Services**

### 5.1 Service Registration
```javascript
scheduler.start();
```

For each service:
1. **Validates cron expression** using `cron.validate()`
2. **Creates cron task** using `cron.schedule()`:
   - Cron expression
   - Callback function (job runner)
   - Options: `{ scheduled: false, timezone: 'Asia/Kolkata' }`
3. **Stores task** in `this.scheduledTasks` Map
4. **Initializes stats** in `this.jobStats` Map:
   - `totalRuns: 0`
   - `successfulRuns: 0`
   - `failedRuns: 0`
   - `lastRun: null`
   - `nextRun: <calculated next run time>`
5. **Logs scheduling info** with logger

### 5.2 Starting Cron Tasks
```javascript
for (const [name, task] of this.scheduledTasks.entries()) {
  task.start();
  this.logger.info(`Started ${name} service`);
}
```

- Each cron task is started (but not executed immediately)
- Tasks wait for their scheduled time
- All tasks run in IST timezone (`Asia/Kolkata`)

### 5.3 Running State
```javascript
this.isRunning = true;
this.logger.info('Multi-scheduler started successfully');
```

- Scheduler is now active and waiting for scheduled times

---

## 📋 **Step 6: Continuous Operation**

### 6.1 Process Keeps Running
- The Node.js process **does not exit**
- It stays alive, waiting for cron triggers
- All services run in the **same process**

### 6.2 When a Service Triggers

Example: **Current Day Service (STATIC)** at 21:00 IST:

1. **Cron triggers** `runCurrentDayJob()`
2. **Job ID generated:** `current_<timestamp>`
3. **Stats updated:**
   - `totalRuns++`
   - `lastRun = new Date().toISOString()`
4. **Service execution:**
   ```javascript
   executeJob(config)(logger)(jobId)(scrapeCurrentDayData)
   ```
5. **Inside executeJob:**
   - Logs: `"Starting job: current_<timestamp>"`
   - Calls: `scrapeCurrentDayData(config)()`
   - Measures execution time
   - Logs success/failure
6. **Stats updated:**
   - If success: `successfulRuns++`
   - If failure: `failedRuns++`
7. **Result logged** with duration, calls scraped, etc.

### 6.3 Service Execution Flow (Example: Current Day STATIC)

When `scrapeCurrentDayData(config)()` is called:

1. **Date Range Calculation:**
   - Calls `getCurrentDayRange()`
   - Checks current IST time
   - If 0-11 hours: Uses previous day
   - If 12-23 hours: Uses current day

2. **Session Creation:**
   - Creates scraping session with unique ID
   - Saves to `scraping_sessions` table

3. **Data Fetching:**
   - Uses saved authentication cookies
   - Fetches HTML from eLocal (Campaign ID: 50033)
   - Handles pagination automatically
   - Extracts calls and adjustments from HTML

4. **Data Processing:**
   - Parses call data (caller ID, date, payout, etc.)
   - Parses adjustment data (chargebacks, refunds)
   - Sets category: `'STATIC'`

5. **Ringba Verification:**
   - For each call, looks up in Ringba API
   - Compares eLocal payout with Ringba payout
   - If mismatch: Marks for sync (keeps eLocal payout)
   - If match: Logs match

6. **Database Storage:**
   - Upserts calls to `elocal_call_data` table
   - Applies adjustments to matching calls
   - Updates session status

7. **Return Result:**
   - Returns summary with:
     - `dateRange`
     - `summary.totalCalls`
     - `summary.totalPayout`
     - `summary.adjustmentsApplied`
     - `databaseResults.inserted/updated`

---

## 📋 **Step 7: Service Interdependencies**

### 7.1 Execution Order (Typical Day)

**00:00 IST (Midnight):**
1. Historical (STATIC) - 00:00
2. Historical (API) - 00:30
3. Current Day (STATIC) - 00:00
4. Current Day (API) - 00:15
5. Ringba Cost Sync - 00:45
6. Revenue Sync - 00:50
7. Ringba Sync - 01:00

**03:00 IST:**
1. Current Day (STATIC) - 03:00
2. Current Day (API) - 03:15
3. Ringba Cost Sync - 03:45
4. Revenue Sync - 03:50
5. Ringba Sync - 04:00

**06:00 IST:**
1. Current Day (STATIC) - 06:00
2. Current Day (API) - 06:15
3. Ringba Cost Sync - 06:45
4. Revenue Sync - 06:50
5. Ringba Sync - 07:00

**21:00 IST (9 PM):**
1. Current Day (STATIC) - 21:00
2. Current Day (API) - 21:15
3. Ringba Cost Sync - 21:45
4. Revenue Sync - 21:50
5. Ringba Sync - 22:00

**Sunday 02:00 IST:**
- Auth Refresh - 02:00

### 7.2 Data Flow

```
┌─────────────────┐
│  eLocal Website │
│  (Scraping)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ elocal_call_data│
│   (SQLite)      │
└────────┬────────┘
         │
         ├─────────────────┐
         ▼                 ▼
┌─────────────────┐  ┌─────────────────┐
│ Ringba Cost Sync│  │  Ringba Sync    │
│  (Ringba API)   │  │  (Ringba API)   │
└────────┬────────┘  └────────┬────────┘
         │                     │
         ▼                     ▼
┌─────────────────┐  ┌─────────────────┐
│ringba_cost_data │  │ringba_sync_logs │
│   (SQLite)      │  │   (SQLite)      │
└────────┬────────┘  └─────────────────┘
         │
         ▼
┌─────────────────┐
│ Revenue Sync    │
│  (Aggregation)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│revenue_summary  │
│   (SQLite)      │
└─────────────────┘
```

---

## 📋 **Step 8: Error Handling**

### 8.1 Service-Level Errors
- Each service has `try-catch` blocks
- Errors are logged but **don't stop the scheduler**
- Failed jobs increment `failedRuns` counter
- Success rate is tracked: `(successfulRuns / totalRuns) * 100`

### 8.2 Individual Item Errors
- If a single call fails during scraping, processing continues
- If a single Ringba API call fails, other calls continue
- Errors are logged with context (caller ID, date, etc.)

### 8.3 Database Errors
- Database operations use `TaskEither` (functional error handling)
- Errors are logged and returned as `Either.Left`
- Services handle `Left` results gracefully

---

## 📋 **Step 9: Logging and Monitoring**

### 9.1 Logger
- Uses `createLogger(config)` from `utils/error-handling.js`
- Logs to console with timestamps
- Logs include:
  - Service start/completion
  - Job IDs
  - Execution duration
  - Success/failure status
  - Data counts (calls, adjustments, etc.)

### 9.2 Job Statistics
- Tracked in `this.jobStats` Map
- Each service has:
  - `totalRuns` - Total number of executions
  - `successfulRuns` - Successful executions
  - `failedRuns` - Failed executions
  - `lastRun` - ISO timestamp of last run
  - `nextRun` - Calculated next run time

### 9.3 Database Logs
- `scraping_sessions` - All scraping service runs
- `ringba_sync_logs` - All Ringba sync attempts
- Both tables track:
  - Status (success/failed)
  - Error messages
  - Execution timestamps
  - Data counts

---

## 📋 **Step 10: Stopping the Scheduler**

### 10.1 Manual Stop
- Press `Ctrl+C` in terminal
- Process receives `SIGINT` signal
- Scheduler calls `scheduler.stop()`
- All cron tasks are stopped and destroyed
- Process exits

### 10.2 Graceful Shutdown
```javascript
scheduler.stop();
```
- Stops all cron tasks
- Clears `scheduledTasks` Map
- Sets `isRunning = false`
- Logs shutdown message

---

## 📋 **Summary: Complete Flow Diagram**

```
npm start multi-scheduler
         │
         ▼
src/index.js (main function)
         │
         ▼
runMultiSchedulerService()
         │
         ├─► initializeDatabase() ──► Creates/updates SQLite tables
         │
         ├─► createMultiScheduler() ──► Creates MultiScheduler instance
         │
         ├─► scheduler.initialize() ──► Initializes logger, maps
         │
         └─► scheduler.start() ──► Schedules 8 services:
              │
              ├─► Historical (STATIC) ──► Daily 00:00 IST
              ├─► Current Day (STATIC) ──► Every 3h: 21:00, 00:00, 03:00, 06:00 IST
              ├─► Historical (API) ──► Daily 00:30 IST
              ├─► Current Day (API) ──► Every 3h: 21:15, 00:15, 03:15, 06:15 IST
              ├─► Auth Refresh ──► Sunday 02:00 IST
              ├─► Ringba Cost Sync ──► Every 3h: 21:45, 00:45, 03:45, 06:45 IST
              ├─► Revenue Sync ──► Every 3h: 21:50, 00:50, 03:50, 06:50 IST
              └─► Ringba Sync ──► Every 3h: 22:00, 01:00, 04:00, 07:00 IST
                   │
                   └─► Process stays alive, waiting for cron triggers
                        │
                        └─► When triggered: Execute service → Update stats → Log results
```

---

## 🔑 **Key Points**

1. **Single Process:** All 8 services run in one Node.js process
2. **IST Timezone:** All schedules use `Asia/Kolkata` timezone
3. **Functional Programming:** Uses `fp-ts` for error handling (`TaskEither`, `Either`)
4. **Idempotent:** Services can be run multiple times safely (UPSERT logic)
5. **Error Resilient:** Individual failures don't stop the scheduler
6. **Database-Driven:** All data stored in SQLite for persistence
7. **Logging:** Comprehensive logging for debugging and monitoring
8. **Statistics:** Tracks success rates, run counts, last/next run times

---

This scheduler ensures continuous, automated data synchronization between eLocal and Ringba, with proper error handling and monitoring.

