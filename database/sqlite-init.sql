-- SQLite database initialization script for eLocal scraper
-- This script creates the database and tables for the eLocal scraper service

-- Create tables
CREATE TABLE IF NOT EXISTS campaign_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date_of_call TEXT NOT NULL,
    campaign_phone TEXT NOT NULL,
    caller_id TEXT NOT NULL,
    category TEXT,
    city TEXT,
    state TEXT,
    zip_code TEXT,
    screen_duration INTEGER DEFAULT 0,
    post_screen_duration INTEGER DEFAULT 0,
    total_duration INTEGER DEFAULT 0,
    call_screen TEXT,
    assessment TEXT,
    classification TEXT,
    payout REAL DEFAULT 0.00,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS adjustment_details (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time_of_call TEXT NOT NULL,
    adjustment_time TEXT NOT NULL,
    campaign_phone TEXT NOT NULL,
    caller_id TEXT NOT NULL,
    duration INTEGER NOT NULL,
    call_sid TEXT NOT NULL,
    amount REAL NOT NULL,
    classification TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scraping_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT UNIQUE NOT NULL,
    started_at TEXT DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    status TEXT DEFAULT 'running',
    calls_scraped INTEGER DEFAULT 0,
    adjustments_scraped INTEGER DEFAULT 0,
    error_message TEXT
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_campaign_calls_caller_id ON campaign_calls(caller_id);
CREATE INDEX IF NOT EXISTS idx_campaign_calls_date ON campaign_calls(date_of_call);
CREATE INDEX IF NOT EXISTS idx_campaign_calls_phone ON campaign_calls(campaign_phone);
CREATE INDEX IF NOT EXISTS idx_campaign_calls_payout ON campaign_calls(payout);

CREATE INDEX IF NOT EXISTS idx_adjustment_details_caller_id ON adjustment_details(caller_id);
CREATE INDEX IF NOT EXISTS idx_adjustment_details_time ON adjustment_details(time_of_call);
CREATE INDEX IF NOT EXISTS idx_adjustment_details_sid ON adjustment_details(call_sid);
CREATE INDEX IF NOT EXISTS idx_adjustment_details_amount ON adjustment_details(amount);

CREATE INDEX IF NOT EXISTS idx_sessions_id ON scraping_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON scraping_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON scraping_sessions(status);

-- Insert some sample data for testing (optional)
INSERT OR IGNORE INTO campaign_calls (
    date_of_call, campaign_phone, caller_id, category, city, state, zip_code,
    screen_duration, post_screen_duration, total_duration, call_screen,
    assessment, classification, payout
) VALUES (
    '2025-10-27T01:01:00Z', '(877) 834-1273', '(469) 256-1440', 'Appliance Repair',
    NULL, NULL, NULL, 0, 0, 0, 'IVR', 'Terminated - Timeout', 'Terminated - Timeout', 0.00
),
(
    '2025-10-27T09:13:00Z', '(877) 834-1273', '(609) 733-3819', 'Appliance Repair',
    'Beverly', 'NJ', '08010', 18, 42, 60, 'IVR', 'Transferred - Partner', 'Transferred - Partner (insufficient call duration)', 0.00
),
(
    '2025-10-27T09:20:00Z', '(877) 834-1273', '(973) 432-4946', 'Appliance Repair',
    'East Orange', 'NJ', NULL, 36, 23, 59, 'IVR', 'Transferred - Advertiser', 'Transferred - Advertiser (unbillable)', 0.00
);

INSERT OR IGNORE INTO adjustment_details (
    time_of_call, adjustment_time, campaign_phone, caller_id, duration,
    call_sid, amount, classification
) VALUES (
    '2025-10-24T15:16:00Z', '2025-10-27T09:23:00Z', '(877) 834-1273', '(704) 616-0774',
    140, 'CON-14206b4d-cf4a-481b-a1c8-caf50a53b081', -45.50, 'Wrong Number : Looking specific provider : Manufacturer'
),
(
    '2025-10-22T11:51:00Z', '2025-10-27T15:35:00Z', '(877) 834-1273', '(214) 854-5744',
    93, 'CON-8f61fa80-3777-4b09-a6b2-2339e3c76a70', -9.00, 'Wrong Number : Looking specific provider : National service provider'
),
(
    '2025-10-22T13:49:00Z', '2025-10-27T20:03:00Z', '(877) 834-1273', '(407) 717-3346',
    58, 'CON-ecd772aa-48b6-405a-a500-170946433950', -9.00, 'Non-serviceable : Warranty service requested : Manufacturer Warranty'
);

-- Show table structures
.schema campaign_calls
.schema adjustment_details
.schema scraping_sessions

-- Show sample data
SELECT 'Campaign Calls Sample:' as info;
SELECT * FROM campaign_calls LIMIT 5;

SELECT 'Adjustment Details Sample:' as info;
SELECT * FROM adjustment_details LIMIT 5;

SELECT 'Scraping Sessions Sample:' as info;
SELECT * FROM scraping_sessions LIMIT 5;

-- Show database statistics
SELECT 'Database Statistics:' as info;
SELECT 
    'campaign_calls' as table_name,
    COUNT(*) as total_records,
    COUNT(DISTINCT caller_id) as unique_callers,
    SUM(payout) as total_payout
FROM campaign_calls
UNION ALL
SELECT 
    'adjustment_details' as table_name,
    COUNT(*) as total_records,
    COUNT(DISTINCT caller_id) as unique_callers,
    SUM(amount) as total_amount
FROM adjustment_details
UNION ALL
SELECT 
    'scraping_sessions' as table_name,
    COUNT(*) as total_records,
    COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful_sessions,
    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_sessions
FROM scraping_sessions;

