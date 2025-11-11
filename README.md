# eLocal Scraper Service

A Node.js service built with functional programming principles to automate data extraction from eLocal.com campaign results. The service scrapes caller IDs, payouts, and adjustment details from the "Clickdee (Appliance Repair) Revshare" campaign.

## Features

- **Functional Programming**: Built using fp-ts, Ramda, and functional composition
- **Web Scraping**: Automated browser interaction using Puppeteer
- **Data Validation**: Type-safe data validation using io-ts
- **Database Integration**: MySQL database with comprehensive schema
- **Error Handling**: Robust error handling with retry logic and circuit breakers
- **Logging**: Comprehensive logging with file and console output
- **Data Processing**: Data cleaning, validation, and deduplication

## Prerequisites

- Node.js 18+ 
- SQLite 3.x (included with Node.js)
- Chrome/Chromium browser (for Puppeteer)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd elocal-scraper
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp env.example .env
```

4. Configure your `.env` file:
```env
# Database Configuration (SQLite)
DB_PATH=./data/elocal_scraper.db

# Website Configuration
ELOCAL_BASE_URL=https://elocal.com
ELOCAL_USERNAME=your_email@example.com
ELOCAL_PASSWORD=your_password

# Scraping Configuration
HEADLESS_BROWSER=true
REQUEST_DELAY_MS=500
MAX_RETRIES=2
TIMEOUT_MS=20000

# Scheduling Configuration
SCHEDULE_ENABLED=true
SCHEDULE_CRON=0 */6 * * *
SCHEDULE_TIMEZONE=America/New_York

# Logging
LOG_LEVEL=info
LOG_FILE=logs/scraper.log
```

5. Initialize the SQLite database:
```bash
sqlite3 data/elocal_scraper.db < database/sqlite-init.sql
```

## Usage

### Running the Service

```bash
# Run scraper once
npm start
# or
npm run scrape

# Start scheduler service (runs every 6 hours by default)
npm run schedule

# Development mode with file watching
npm run dev
```

### Programmatic Usage

```javascript
import { scrapeElocalData, createConfig } from './src/index.js';

const config = createConfig();
const result = await scrapeElocalData(config)();
console.log(result);
```

## Database Schema (SQLite)

### Campaign Calls Table
Stores individual call records with caller information and payouts:

```sql
CREATE TABLE campaign_calls (
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
```

### Adjustment Details Table
Stores cost adjustments for failed calls:

```sql
CREATE TABLE adjustment_details (
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
```

### Scraping Sessions Table
Tracks scraping sessions and their status:

```sql
CREATE TABLE scraping_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT UNIQUE NOT NULL,
    started_at TEXT DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    status TEXT DEFAULT 'running',
    calls_scraped INTEGER DEFAULT 0,
    adjustments_scraped INTEGER DEFAULT 0,
    error_message TEXT
);
```

## Architecture

### Functional Programming Approach

The service is built using functional programming principles:

- **fp-ts**: Provides functional data types (Either, TaskEither, Task)
- **Ramda**: Functional utility library for data transformation
- **io-ts**: Runtime type validation and type safety
- **Composition**: Functions are composed using pipe and compose

### Key Components

1. **Database Operations** (`src/database/operations.js`)
   - Type-safe database operations using TaskEither
   - Batch insert operations for performance
   - Connection management and error handling

2. **Web Scraping** (`src/scrapers/elocal-scraper.js`)
   - Puppeteer-based browser automation
   - Element selection and data extraction
   - Navigation and interaction handling

3. **Data Processing** (`src/utils/helpers.js`)
   - Data validation and cleaning
   - Deduplication and filtering
   - Transformation pipelines

4. **Error Handling** (`src/utils/error-handling.js`)
   - Comprehensive error types and handling
   - Retry logic with exponential backoff
   - Circuit breaker pattern
   - Logging and monitoring

5. **Main Service** (`src/index.js`)
   - Orchestrates the entire scraping workflow
   - Session management
   - Result aggregation and reporting

## Data Flow

1. **Initialization**: Validate configuration and initialize database
2. **Authentication**: Login to eLocal.com
3. **Navigation**: Navigate to campaigns page and click target campaign
4. **Data Extraction**: Extract campaign calls and adjustment details
5. **Data Processing**: Clean, validate, and deduplicate data
6. **Database Storage**: Save processed data to MySQL
7. **Session Tracking**: Update session status and generate summary

## Error Handling

The service includes comprehensive error handling:

- **Retry Logic**: Automatic retry with exponential backoff
- **Circuit Breaker**: Prevents cascading failures
- **Error Classification**: Categorized error types for better handling
- **Logging**: Detailed error logging with context
- **Recovery**: Graceful degradation and recovery strategies

## Monitoring and Logging

- **Structured Logging**: JSON-formatted logs with timestamps
- **Log Levels**: ERROR, WARN, INFO, DEBUG
- **File Logging**: Persistent log files with rotation
- **Session Tracking**: Monitor scraping sessions and performance
- **Error Monitoring**: Track error patterns and thresholds

## Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `HEADLESS_BROWSER` | Run browser in headless mode | `true` |
| `REQUEST_DELAY_MS` | Delay between requests (ms) | `500` |
| `MAX_RETRIES` | Maximum retry attempts | `2` |
| `TIMEOUT_MS` | Request timeout (ms) | `20000` |
| `SCHEDULE_ENABLED` | Enable automatic scheduling | `true` |
| `SCHEDULE_CRON` | Cron expression for scheduling | `0 */6 * * *` (every 6 hours) |
| `SCHEDULE_TIMEZONE` | Timezone for scheduling | `America/New_York` |
| `LOG_LEVEL` | Logging level | `info` |

### Scheduling Options

The service supports flexible scheduling using cron expressions:

- `0 */6 * * *` - Every 6 hours
- `0 */12 * * *` - Every 12 hours  
- `0 0 * * *` - Daily at midnight
- `0 0 * * 0` - Weekly on Sunday
- `0 0 1 * *` - Monthly on the 1st

## Troubleshooting

### Common Issues

1. **Browser Launch Failure**
   - Ensure Chrome/Chromium is installed
   - Check system permissions
   - Verify Puppeteer installation

2. **Database Connection Issues**
   - Verify SQLite database file exists
   - Check file permissions
   - Ensure data directory exists

3. **Login Failures**
   - Verify eLocal credentials
   - Check for CAPTCHA or 2FA requirements
   - Monitor for rate limiting

4. **Data Extraction Issues**
   - Website structure changes
   - Element selectors may need updates
   - Check for JavaScript rendering issues

### Debug Mode

Enable debug logging for detailed troubleshooting:

```env
LOG_LEVEL=debug
HEADLESS_BROWSER=false
```

## Contributing

1. Follow functional programming principles
2. Use fp-ts for error handling
3. Maintain type safety with io-ts
4. Add comprehensive error handling
5. Include logging for debugging

## License

MIT License - see LICENSE file for details.
