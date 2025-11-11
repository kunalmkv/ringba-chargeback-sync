// Database schema for eLocal scraper
export const createTables = `
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
`;

export const dropTables = `
DROP TABLE IF EXISTS adjustment_details;
DROP TABLE IF EXISTS campaign_calls;
DROP TABLE IF EXISTS scraping_sessions;
`;

