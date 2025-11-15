# Multi-Scheduler Service: Complete Explanation

## 🚀 **Command to Run**

```bash
npm start multi-scheduler
# OR
npm run multi
```

Both commands execute: `node src/index.js multi-scheduler`

---

## 📋 **What Happens When You Run It**

### **Step 1: Initialization**
1. **Loads Configuration** - Reads `.env` file for database paths, API credentials, etc.
2. **Initializes Database** - Creates/updates all SQLite tables:
   - `elocal_call_data` - Main call data
   - `adjustment_details` - Chargebacks/refunds
   - `scraping_sessions` - Service execution logs
   - `ringba_sync_logs` - Ringba sync history
   - `revenue_summary` - Aggregated revenue by date/category
   - `ringba_cost_data` - Ringba cost information

3. **Creates Scheduler Instance** - Initializes the `MultiScheduler` class

### **Step 2: Schedules 8 Services**
The scheduler registers all services with their cron schedules (all times in **IST - Asia/Kolkata**)

### **Step 3: Starts All Services**
- All cron tasks are started (but not executed immediately)
- Process stays alive, waiting for scheduled times
- Services run automatically at their scheduled times

---

## 🕐 **All 8 Services & Their Schedules**

### **1. Historical Service (STATIC)**
- **Schedule:** `0 0 * * *` → **Daily at 12:00 AM IST (midnight)**
- **Campaign ID:** `50033` (STATIC category)
- **What it does:**
  - Fetches past 10 days of data (excluding today)
  - Includes adjustments (chargebacks, refunds)
  - Verifies payout with Ringba (keeps eLocal values)
  - Saves to `elocal_call_data` table

---

### **2. Historical Service (API)**
- **Schedule:** `30 0 * * *` → **Daily at 12:30 AM IST** (30 minutes after STATIC)
- **Campaign ID:** `46775` (API category)
- **What it does:**
  - Fetches past 10 days of data (excluding today)
  - **No adjustments** (API category doesn't have adjustments)
  - Uses eLocal "call price" values only (no Ringba lookup)
  - Saves to `elocal_call_data` table

---

### **3. Current Day Service (STATIC)**
- **Schedule:** `0 21,0,3,6 * * *` → **Every 3 hours at:**
  - **21:00 IST (9 PM)**
  - **00:00 IST (midnight)**
  - **03:00 IST (3 AM)**
  - **06:00 IST (6 AM)**
- **Campaign ID:** `50033` (STATIC category)
- **Date Logic:**
  - If IST time is **0-11 hours** (midnight to 11:59 AM): Uses **previous day**
  - If IST time is **12-23 hours** (noon to 11:59 PM): Uses **current day**
- **What it does:**
  - Fetches current/previous day data
  - Includes adjustments
  - Verifies payout with Ringba (keeps eLocal values)

---

### **4. Current Day Service (API)**
- **Schedule:** `15 21,0,3,6 * * *` → **Every 3 hours at:**
  - **21:15 IST (9:15 PM)**
  - **00:15 IST (12:15 AM)**
  - **03:15 IST (3:15 AM)**
  - **06:15 IST (6:15 AM)**
- **Campaign ID:** `46775` (API category)
- **Date Logic:** Same as STATIC (previous/current day based on time)
- **What it does:**
  - Fetches current/previous day data
  - No adjustments
  - Uses eLocal "call price" values only

---

### **5. Auth Refresh Service**
- **Schedule:** `0 2 * * 0` → **Every Sunday at 2:00 AM IST**
- **What it does:**
  - Refreshes eLocal authentication session
  - Saves cookies to `data/session.json`
  - Prevents session expiration (3-day TTL)
  - Ensures all scraping services have valid authentication

---

### **6. Ringba Cost Sync Service**
- **Schedule:** `45 21,0,3,6 * * *` → **Every 3 hours at:**
  - **21:45 IST (9:45 PM)**
  - **00:45 IST (12:45 AM)**
  - **03:45 IST (3:45 AM)**
  - **06:45 IST (6:45 AM)**
- **What it does:**
  - Fetches Ringba call data for **current day only**
  - Gets revenue and cost (payout) from Ringba API
  - Determines category (STATIC/API) based on target ID
  - Saves to `ringba_cost_data` table
  - **Skips calls that already exist** (idempotent)

---

### **7. Revenue Sync Service**
- **Schedule:** `50 21,0,3,6 * * *` → **Every 3 hours at:**
  - **21:50 IST (9:50 PM)**
  - **00:50 IST (12:50 AM)**
  - **03:50 IST (3:50 AM)**
  - **06:50 IST (6:50 AM)**
- **What it does:**
  - Aggregates revenue from last **10 days**
  - Fetches Ringba cost data from `ringba_cost_data` table
  - Fetches Elocal call data from `elocal_call_data` table
  - Matches by date and category (STATIC/API)
  - Aggregates by date and category
  - Saves to `revenue_summary` table with columns:
    - `ringbaStatic` - Ringba payout for STATIC category
    - `ringbaApi` - Ringba payout for API category
    - `elocalStatic` - Elocal payout for STATIC category
    - `elocalApi` - Elocal payout for API category

---

### **8. Ringba Sync Service**
- **Schedule:** `0 22,1,4,7 * * *` → **Every 3 hours at:**
  - **22:00 IST (10:00 PM)**
  - **01:00 IST (1:00 AM)**
  - **04:00 IST (4:00 AM)**
  - **07:00 IST (7:00 AM)**
- **What it does:**
  - Finds calls with adjustments OR payout mismatches
  - For STATIC: Syncs if adjustment exists OR payout doesn't match Ringba
  - For API: Syncs if payout doesn't match Ringba
  - Updates Ringba API with correct payout
  - Logs all sync attempts to `ringba_sync_logs` table

---

## 📅 **Daily Timeline (IST Timezone)**

### **21:00 (9 PM) - Evening Batch**
```
21:00 → Current Day (STATIC)
21:15 → Current Day (API)
21:45 → Ringba Cost Sync
21:50 → Revenue Sync
22:00 → Ringba Sync
```

### **00:00 (Midnight) - Night Batch**
```
00:00 → Historical (STATIC) + Current Day (STATIC)
00:15 → Current Day (API)
00:30 → Historical (API)
00:45 → Ringba Cost Sync
00:50 → Revenue Sync
01:00 → Ringba Sync
```

### **03:00 (3 AM) - Early Morning Batch**
```
03:00 → Current Day (STATIC)
03:15 → Current Day (API)
03:45 → Ringba Cost Sync
03:50 → Revenue Sync
04:00 → Ringba Sync
```

### **06:00 (6 AM) - Morning Batch**
```
06:00 → Current Day (STATIC)
06:15 → Current Day (API)
06:45 → Ringba Cost Sync
06:50 → Revenue Sync
07:00 → Ringba Sync
```

### **Sunday 02:00 (2 AM) - Weekly**
```
02:00 → Auth Refresh (only on Sundays)
```

---

## 🔄 **Data Flow Diagram**

```
┌─────────────────────────────────────────────────────────────┐
│                    eLocal Website (Scraping)                │
│  Campaign 50033 (STATIC) | Campaign 46775 (API)            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │  elocal_call_data     │
         │     (SQLite)          │
         │  - STATIC calls       │
         │  - API calls          │
         │  - Adjustments        │
         └───────────┬───────────┘
                     │
         ┌───────────┴───────────┐
         │                       │
         ▼                       ▼
┌──────────────────┐    ┌──────────────────┐
│ Ringba Cost Sync │    │  Ringba Sync     │
│  (Ringba API)    │    │  (Ringba API)    │
└────────┬─────────┘    └────────┬─────────┘
         │                       │
         ▼                       ▼
┌──────────────────┐    ┌──────────────────┐
│ringba_cost_data  │    │ringba_sync_logs  │
│   (SQLite)       │    │   (SQLite)       │
└────────┬─────────┘    └──────────────────┘
         │
         ▼
┌──────────────────┐
│  Revenue Sync    │
│  (Aggregation)   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ revenue_summary  │
│   (SQLite)       │
│ - ringbaStatic   │
│ - ringbaApi      │
│ - elocalStatic   │
│ - elocalApi      │
└──────────────────┘
```

---

## 🎯 **Service Execution Order (Typical 3-Hour Cycle)**

When services run every 3 hours (e.g., at 21:00, 00:00, 03:00, 06:00):

1. **First (00:00):** Current Day (STATIC) - Scrapes eLocal data
2. **Second (00:15):** Current Day (API) - Scrapes eLocal data
3. **Third (00:30):** Historical (API) - Scrapes past 10 days (only at midnight)
4. **Fourth (00:45):** Ringba Cost Sync - Fetches Ringba cost data
5. **Fifth (00:50):** Revenue Sync - Aggregates all data into summary
6. **Sixth (01:00):** Ringba Sync - Updates Ringba with adjustments/mismatches

**Note:** Historical (STATIC) runs only at midnight (00:00), not every 3 hours.

---

## 📊 **Service Statistics**

The scheduler tracks statistics for each service:
- **totalRuns** - Total number of executions
- **successfulRuns** - Successful executions
- **failedRuns** - Failed executions
- **successRate** - Percentage of successful runs
- **lastRun** - ISO timestamp of last execution
- **nextRun** - Calculated next run time

You can view these stats by checking the scheduler status (logged every minute).

---

## 🛑 **Stopping the Scheduler**

Press `Ctrl+C` in the terminal:
- Scheduler gracefully stops all cron tasks
- All services are stopped
- Process exits cleanly

---

## 🔑 **Key Points**

1. **Single Process:** All 8 services run in one Node.js process
2. **IST Timezone:** All schedules use `Asia/Kolkata` timezone
3. **Idempotent:** Services can be run multiple times safely (UPSERT logic)
4. **Error Resilient:** Individual failures don't stop the scheduler
5. **Database-Driven:** All data stored in SQLite for persistence
6. **Comprehensive Logging:** All operations are logged for debugging
7. **Statistics Tracking:** Success rates and run counts are tracked

---

## 📝 **Example: What Happens at Midnight (00:00 IST)**

```
00:00:00 → Historical (STATIC) starts
           - Fetches past 10 days of STATIC data
           - Includes adjustments
           - Verifies with Ringba
           - Saves to database

00:00:00 → Current Day (STATIC) starts (parallel)
           - Fetches previous day data (since it's midnight)
           - Includes adjustments
           - Saves to database

00:15:00 → Current Day (API) starts
           - Fetches previous day API data
           - No adjustments
           - Saves to database

00:30:00 → Historical (API) starts
           - Fetches past 10 days of API data
           - No adjustments
           - Saves to database

00:45:00 → Ringba Cost Sync starts
           - Fetches Ringba cost data for previous day
           - Determines STATIC/API category
           - Saves to ringba_cost_data table

00:50:00 → Revenue Sync starts
           - Aggregates last 10 days
           - Combines Ringba cost + Elocal data
           - Updates revenue_summary table

01:00:00 → Ringba Sync starts
           - Finds calls needing sync
           - Updates Ringba API
           - Logs to ringba_sync_logs
```

---

This scheduler ensures continuous, automated data synchronization between eLocal and Ringba, with proper error handling and monitoring.

