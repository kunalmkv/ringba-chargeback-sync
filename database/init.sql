-- Database initialization script for eLocal scraper
-- Run this script to create the database and tables

-- Create database if it doesn't exist
CREATE DATABASE IF NOT EXISTS elocal_scraper CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Use the database
USE elocal_scraper;

-- Campaign calls table
CREATE TABLE IF NOT EXISTS campaign_calls (
    id INT AUTO_INCREMENT PRIMARY KEY,
    date_of_call DATETIME NOT NULL,
    campaign_phone VARCHAR(20) NOT NULL,
    caller_id VARCHAR(20) NOT NULL,
    category VARCHAR(100),
    city VARCHAR(100),
    state VARCHAR(10),
    zip_code VARCHAR(10),
    screen_duration INT DEFAULT 0,
    post_screen_duration INT DEFAULT 0,
    total_duration INT DEFAULT 0,
    call_screen VARCHAR(50),
    assessment VARCHAR(200),
    classification VARCHAR(200),
    payout DECIMAL(10,2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_caller_id (caller_id),
    INDEX idx_date_of_call (date_of_call),
    INDEX idx_campaign_phone (campaign_phone)
);

-- Adjustment details table
CREATE TABLE IF NOT EXISTS adjustment_details (
    id INT AUTO_INCREMENT PRIMARY KEY,
    time_of_call DATETIME NOT NULL,
    adjustment_time DATETIME NOT NULL,
    campaign_phone VARCHAR(20) NOT NULL,
    caller_id VARCHAR(20) NOT NULL,
    duration INT NOT NULL,
    call_sid VARCHAR(100) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    classification VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_caller_id (caller_id),
    INDEX idx_time_of_call (time_of_call),
    INDEX idx_adjustment_time (adjustment_time),
    INDEX idx_call_sid (call_sid)
);

-- Scraping sessions table for tracking
CREATE TABLE IF NOT EXISTS scraping_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_id VARCHAR(100) UNIQUE NOT NULL,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    status ENUM('running', 'completed', 'failed') DEFAULT 'running',
    calls_scraped INT DEFAULT 0,
    adjustments_scraped INT DEFAULT 0,
    error_message TEXT NULL,
    INDEX idx_session_id (session_id),
    INDEX idx_started_at (started_at)
);

-- Insert some sample data for testing (optional)
INSERT IGNORE INTO campaign_calls (
    date_of_call, campaign_phone, caller_id, category, city, state, zip_code,
    screen_duration, post_screen_duration, total_duration, call_screen,
    assessment, classification, payout
) VALUES (
    '2025-10-27 01:01:00', '(877) 834-1273', '(469) 256-1440', 'Appliance Repair',
    NULL, NULL, NULL, 0, 0, 0, 'IVR', 'Terminated - Timeout', 'Terminated - Timeout', 0.00
);

INSERT IGNORE INTO adjustment_details (
    time_of_call, adjustment_time, campaign_phone, caller_id, duration,
    call_sid, amount, classification
) VALUES (
    '2025-10-24 15:16:00', '2025-10-27 09:23:00', '(877) 834-1273', '(704) 616-0774',
    140, 'CON-14206b4d-cf4a-481b-a1c8-caf50a53b081', -45.50, 'Wrong Number : Looking specific provider : Manufacturer'
);

-- Show table structures
DESCRIBE campaign_calls;
DESCRIBE adjustment_details;
DESCRIBE scraping_sessions;

-- Show sample data
SELECT 'Campaign Calls Sample:' as info;
SELECT * FROM campaign_calls LIMIT 5;

SELECT 'Adjustment Details Sample:' as info;
SELECT * FROM adjustment_details LIMIT 5;

SELECT 'Scraping Sessions Sample:' as info;
SELECT * FROM scraping_sessions LIMIT 5;

