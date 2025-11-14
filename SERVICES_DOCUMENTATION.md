# Services Documentation

This document provides a comprehensive description of all services in the eLocal Ringba Sync system, including their purpose, logic, and execution flow.

---

## 1. Historical Data Service (STATIC Category)

**Purpose:** Scrapes historical call data from eLocal for the STATIC campaign (past 10 days, excluding today).

**Schedule:** Daily at 12:00 AM IST

**Logic Flow:**
1. **Date Range Calculation:** Calculates past 10 days (excluding today)
2. **Campaign Selection:** Uses Campaign ID `50033` (STATIC category)
3. **Data Fetching:**
   - Uses saved authentication cookies (no Puppeteer needed)
   - Fetches HTML pages from eLocal with pagination support
   - Extracts call data from HTML tables
   - Extracts adjustment details (chargebacks, refunds, modifications)
4. **Data Processing:**
   - Parses call information (caller ID, date, payout, duration, etc.)
   - Parses adjustment details (time, amount, classification)
   - Matches adjustments to calls using fuzzy matching (same caller ID, within ±30 minutes on same day)
5. **Ringba Integration:** Not applicable for STATIC category
6. **Database Storage:**
   - Saves calls to `elocal_call_data` table with category='STATIC'
   - Saves adjustments to `adjustment_details` table
   - Updates scraping session status

**Key Features:**
- Handles pagination automatically
- Fuzzy matches adjustments to calls
- Creates unmatched adjustment rows if no matching call found
- Uses UPSERT logic to avoid duplicates

---

## 2. Current Day Service (STATIC Category)

**Purpose:** Scrapes call data for the current day only from eLocal for the STATIC campaign.

**Schedule:** Every 3 hours at 21:00, 00:00, 03:00, 06:00 IST

**Logic Flow:**
1. **Date Range Calculation:** Uses current day only
2. **Campaign Selection:** Uses Campaign ID `50033` (STATIC category)
3. **Data Fetching:** Same as Historical Service (STATIC)
4. **Data Processing:** Same as Historical Service (STATIC)
5. **Database Storage:** Same as Historical Service (STATIC)

**Key Features:**
- Runs more frequently to capture real-time data
- Same adjustment matching logic as historical service

---

## 3. Historical Data Service (API Category)

**Purpose:** Scrapes historical call data from eLocal for the API campaign (past 10 days, excluding today).

**Schedule:** Daily at 12:30 AM IST

**Logic Flow:**
1. **Date Range Calculation:** Calculates past 10 days (excluding today)
2. **Campaign Selection:** Uses Campaign ID `46775` (API category)
3. **Data Fetching:**
   - Uses saved authentication cookies
   - Fetches HTML pages with pagination
   - Extracts call data from HTML tables
   - **No adjustment table** (API category doesn't have adjustments)
4. **Data Processing:**
   - Parses call information
   - Extracts "call price" from eLocal (not "payout")
   - **Ringba Lookup:** For each call, looks up actual payout from Ringba API:
     - Searches by caller ID and call time (60-minute window)
     - Retrieves call details to get actual payout
     - Updates call payout with Ringba value
     - Stores Ringba inbound call ID for future reference
5. **Database Storage:**
   - Saves calls to `elocal_call_data` table with category='API'
   - No adjustment data saved

**Key Features:**
- Real-time Ringba payout lookup during scraping
- Handles anonymous/invalid caller IDs gracefully
- Skips calls that can't be found in Ringba (keeps eLocal "call price")
- Rate limiting (300ms delay between Ringba API calls)

---

## 4. Current Day Service (API Category)

**Purpose:** Scrapes call data for the current day only from eLocal for the API campaign.

**Schedule:** Every 3 hours at 21:15, 00:15, 03:15, 06:15 IST

**Logic Flow:**
1. **Date Range Calculation:** Uses current day only
2. **Campaign Selection:** Uses Campaign ID `46775` (API category)
3. **Data Fetching:** Same as Historical Service (API)
4. **Data Processing:** Same as Historical Service (API)
5. **Database Storage:** Same as Historical Service (API)

**Key Features:**
- Runs more frequently to capture real-time data
- Same Ringba payout lookup logic as historical API service

---

## 5. Ringba Sync Service

**Purpose:** Synchronizes adjustment data (chargebacks, refunds, modifications) from eLocal to Ringba API.

**Schedule:** Every 3 hours at 22:00, 01:00, 04:00, 07:00 IST

**Logic Flow:**
1. **Data Retrieval:**
   - **STATIC Category:** Fetches rows with `adjustment_amount IS NOT NULL` and status='pending' or 'failed'
   - **API Category:** Fetches all rows (to ensure payout matches Ringba)
2. **Call Lookup:**
   - For each row, searches Ringba API by caller ID and call time
   - Uses 60-minute time window for matching
   - Prioritizes matches by payout amount, then by time proximity
3. **Payout Verification (API Category Only):**
   - Compares eLocal payout with Ringba payout
   - If matches, marks as skipped (no update needed)
   - If different, proceeds with update
4. **Payment Leg Resolution:**
   - Retrieves call details from Ringba
   - Identifies payment legs (revenue, payout, conversion)
   - Determines which leg to update based on adjustment classification
5. **Update Execution:**
   - Updates appropriate payment leg in Ringba
   - Handles single-leg and multi-leg scenarios
   - Updates revenue, payout, or conversion amount based on adjustment type
6. **Status Update:**
   - Marks as 'synced' on success
   - Marks as 'failed' on error with error message
   - Marks as 'not_found' if call not found in Ringba
   - Marks as 'cannot_sync' for anonymous/invalid caller IDs

**Key Features:**
- Handles both STATIC (adjustment-based) and API (payout verification) categories
- Intelligent call matching with payout prioritization
- Automatic payment leg identification
- Comprehensive error handling and logging
- Rate limiting (500ms delay between requests)

---

## 6. Revenue Sync Service

**Purpose:** Aggregates and syncs revenue data from both Ringba and eLocal, separated by category (STATIC/API) and date.

**Schedule:** Every 3 hours at 21:50, 00:50, 03:50, 06:50 IST

**Logic Flow:**
1. **Data Retrieval:**
   - Fetches Ringba cost data from `ringba_cost_data` table (SQLite)
   - Fetches Elocal call data from `elocal_call_data` table (SQLite)
   - Default date range: Last 10 days (configurable)
2. **Data Aggregation:**
   - **Ringba Data:** Groups by date and category, sums cost values
   - **Elocal Data:** Groups by date and category, sums payout values
   - Handles date format conversion (MM/DD/YYYY to YYYY-MM-DD)
3. **Data Combination:**
   - Combines Ringba and Elocal data by date
   - Creates daily summary with 4 columns:
     - `ringbaStatic`: Total Ringba cost for STATIC category
     - `ringbaApi`: Total Ringba cost for API category
     - `elocalStatic`: Total Elocal payout for STATIC category
     - `elocalApi`: Total Elocal payout for API category
4. **Database Storage:**
   - Upserts data into `revenue_summary` table (SQLite)
   - One row per date with aggregated values
   - Continues processing even if individual days fail

**Key Features:**
- Aggregates data from two sources (Ringba and Elocal)
- Separates by category (STATIC/API) for comparison
- Handles date format inconsistencies
- Error-resilient (continues processing on individual failures)
- Provides daily revenue comparison

---

## 7. Ringba Cost Sync Service

**Purpose:** Fetches call cost and revenue data from Ringba API and saves it to local database, categorized by STATIC/API.

**Schedule:** Every 3 hours at 21:45, 00:45, 03:45, 06:45 IST

**Logic Flow (Current Day Mode - Scheduled):**
1. **Date Selection:** Processes current day only
2. **Existing Data Check:**
   - Queries database for existing calls for today
   - Creates a Set of `inbound_call_id + category` combinations
3. **Target Processing:**
   - Iterates through configured Ringba target IDs:
     - `TA48aa3e3f5a0544af8549703f76a24faa` → STATIC category
     - `PI1175ac62aa1c4748b21216666b398135` → API category
4. **Data Fetching:**
   - Calls Ringba API `/calllogs` endpoint for each target
   - Fetches calls for current day only
   - Handles pagination automatically
5. **Data Filtering:**
   - Filters calls to current day only
   - **Skips calls that already exist** in database (by `inbound_call_id + category`)
   - Prevents duplicate saves and updates
6. **Data Transformation:**
   - Extracts: inbound call ID, target ID, category, call date, caller ID
   - Extracts: revenue, cost (Ringba cost or payout)
   - Extracts: campaign name, publisher name, phone number
7. **Database Storage:**
   - Uses `INSERT OR IGNORE` to prevent updates
   - Only inserts new calls, never updates existing ones
   - Saves to `ringba_cost_data` table

**Logic Flow (Date Range Mode - Manual):**
- Similar to above but processes date range
- Can update existing records if needed (for backfill operations)

**Key Features:**
- **Current day only** for scheduled runs
- **No duplicate saves:** Skips calls that already exist
- **No updates:** Never modifies existing records in scheduled mode
- Categorizes automatically by target ID
- Handles multiple targets with error resilience
- Provides detailed summary by category and target

---

## 8. Auth Refresh Service

**Purpose:** Refreshes eLocal authentication cookies to maintain valid session for scraping services.

**Schedule:** Sunday at 2:00 AM IST

**Logic Flow:**
1. **Browser Launch:** Launches Puppeteer browser instance
2. **Page Configuration:** Sets up page with necessary settings
3. **Login:** Performs login to eLocal using credentials
4. **Cookie Capture:** Extracts authentication cookies from browser
5. **Session Creation:** Creates session object with 3-day expiration
6. **Session Storage:** Saves cookies to file system for reuse
7. **Browser Cleanup:** Closes browser instance

**Key Features:**
- Runs weekly to refresh authentication
- Uses Puppeteer for one-time login
- Saves cookies for cookie-based authentication in other services
- 3-day expiration ensures fresh sessions

---

## Multi-Scheduler Service

**Purpose:** Orchestrates and schedules all services using cron jobs.

**Schedule:** Runs continuously, managing all service schedules

**Logic Flow:**
1. **Initialization:**
   - Creates cron job for each service
   - Sets timezone to Asia/Kolkata (IST)
   - Tracks job statistics (runs, successes, failures)
2. **Job Execution:**
   - Executes services at their scheduled times
   - Logs execution start, completion, and errors
   - Updates job statistics
   - Handles errors gracefully (doesn't stop scheduler)
3. **Status Tracking:**
   - Tracks last run time for each service
   - Tracks success/failure rates
   - Calculates next run time
   - Provides status API for dashboard

**Scheduled Services:**
- Historical (STATIC): Daily at 12:00 AM IST
- Historical (API): Daily at 12:30 AM IST
- Current Day (STATIC): Every 3 hours at 21:00, 00:00, 03:00, 06:00 IST
- Current Day (API): Every 3 hours at 21:15, 00:15, 03:15, 06:15 IST
- Ringba Cost Sync: Every 3 hours at 21:45, 00:45, 03:45, 06:45 IST
- Revenue Sync: Every 3 hours at 21:50, 00:50, 03:50, 06:50 IST
- Ringba Sync: Every 3 hours at 22:00, 01:00, 04:00, 07:00 IST
- Auth Refresh: Sunday at 2:00 AM IST

**Key Features:**
- Centralized scheduling for all services
- IST timezone support
- Comprehensive logging and error handling
- Job statistics tracking
- Graceful error recovery

---

## Data Flow Summary

```
┌─────────────────┐
│  eLocal Website │
│  (Scraping)     │
└────────┬────────┘
         │
         ├─── STATIC Category ───┐
         │                        │
         └─── API Category ──────┤
                                  │
                    ┌─────────────▼─────────────┐
                    │   elocal_call_data         │
                    │   (SQLite)                 │
                    └─────────────┬─────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Ringba Sync    │    │  Revenue Sync    │    │ Ringba Cost Sync│
│  Service        │    │  Service         │    │  Service        │
└────────┬────────┘    └────────┬─────────┘    └────────┬────────┘
         │                     │                        │
         │                     │                        │
         ▼                     ▼                        ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Ringba API     │    │ revenue_summary  │    │ ringba_cost_data│
│  (Updates)      │    │  (SQLite)        │    │  (SQLite)       │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

---

## Error Handling Strategy

All services implement comprehensive error handling:

1. **Individual Item Failures:** Services continue processing even if individual items fail
2. **Error Logging:** All errors are logged with clear messages
3. **Partial Success:** Services return results even if some items fail
4. **Status Tracking:** Failed items are marked with error messages in database
5. **Retry Logic:** Failed items can be retried on next service run
6. **Graceful Degradation:** Services continue operating even with partial failures

---

## Database Tables

### `elocal_call_data`
- Stores call data from eLocal scraping
- Columns: caller_id, date_of_call, payout, category, adjustment_amount, etc.
- Unique constraint: (caller_id, date_of_call, campaign_phone, category)

### `ringba_cost_data`
- Stores Ringba call cost and revenue data
- Columns: inbound_call_id, target_id, category, call_date, revenue, cost, etc.
- Unique constraint: (inbound_call_id, category)

### `revenue_summary`
- Stores daily aggregated revenue by category
- Columns: date, ringbaStatic, ringbaApi, elocalStatic, elocalApi
- One row per date

### `adjustment_details`
- Stores adjustment/chargeback details
- Columns: time_of_call, adjustment_time, amount, classification, etc.

### `ringba_sync_logs`
- Tracks Ringba sync attempts and results
- Columns: sync_status, sync_attempted_at, error_message, etc.

### `scraping_sessions`
- Tracks scraping session status
- Columns: session_id, status, started_at, completed_at, error_message, etc.

---

## Command Line Usage

```bash
# Run individual services
npm start historical          # Historical (STATIC)
npm start current             # Current Day (STATIC)
npm start historical-api      # Historical (API)
npm start current-api         # Current Day (API)
npm start ringba-sync         # Ringba Sync
npm start revenue-sync        # Revenue Sync
npm start ringba-cost-sync --today  # Ringba Cost Sync (today only)

# Start scheduler
npm start multi-scheduler     # Start all scheduled services

# Manual operations
npm run refresh-auth          # Refresh auth cookies
```

---

## Notes

- All times are in IST (Indian Standard Time)
- Services use saved authentication cookies (no login needed for scraping)
- Ringba API calls include rate limiting to avoid throttling
- Database operations use UPSERT logic to handle duplicates
- All services support error recovery and continue processing on failures

