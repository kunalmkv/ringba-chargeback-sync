#!/usr/bin/env node

// Setup script for eLocal scraper service
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

const log = (message, color = colors.reset) => {
  console.log(`${color}${message}${colors.reset}`);
};

const logStep = (step, message) => {
  log(`\n${colors.cyan}[${step}]${colors.reset} ${message}`);
};

const logSuccess = (message) => {
  log(`${colors.green}✅${colors.reset} ${message}`);
};

const logError = (message) => {
  log(`${colors.red}❌${colors.reset} ${message}`);
};

const logWarning = (message) => {
  log(`${colors.yellow}⚠️${colors.reset} ${message}`);
};

const logInfo = (message) => {
  log(`${colors.blue}ℹ️${colors.reset} ${message}`);
};

// Check if Node.js version is compatible
const checkNodeVersion = () => {
  logStep('1', 'Checking Node.js version...');
  
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
  
  if (majorVersion < 18) {
    logError(`Node.js version ${nodeVersion} is not supported. Please upgrade to Node.js 18 or higher.`);
    process.exit(1);
  }
  
  logSuccess(`Node.js version ${nodeVersion} is compatible`);
};

// Install dependencies
const installDependencies = () => {
  logStep('2', 'Installing dependencies...');
  
  try {
    execSync('npm install', { stdio: 'inherit' });
    logSuccess('Dependencies installed successfully');
  } catch (error) {
    logError('Failed to install dependencies');
    process.exit(1);
  }
};

// Create necessary directories
const createDirectories = () => {
  logStep('3', 'Creating necessary directories...');
  
  const directories = [
    'data',
    'logs',
    'src/database',
    'src/scrapers',
    'src/utils',
    'src/types',
    'src/services',
    'src/config'
  ];
  
  directories.forEach(async (dir) => {
    try {
      await fs.mkdir(dir, { recursive: true });
      logInfo(`Created directory: ${dir}`);
    } catch (error) {
      logWarning(`Directory ${dir} already exists or could not be created`);
    }
  });
  
  logSuccess('Directories created successfully');
};

// Create environment file
const createEnvFile = () => {
  logStep('4', 'Creating environment configuration...');
  
  const envContent = `# Environment Configuration
# Copy this file to .env and fill in your actual values

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
`;

  try {
    fs.writeFile('.env', envContent);
    logSuccess('Environment file created');
    logWarning('Please update .env file with your actual credentials');
  } catch (error) {
    logError('Failed to create environment file');
  }
};

// Initialize SQLite database
const initializeDatabase = () => {
  logStep('5', 'Initializing SQLite database...');
  
  try {
    // Check if sqlite3 is available
    execSync('sqlite3 --version', { stdio: 'pipe' });
    
    // Create database file
    execSync('sqlite3 data/elocal_scraper.db < database/sqlite-init.sql', { stdio: 'inherit' });
    
    logSuccess('SQLite database initialized successfully');
  } catch (error) {
    logWarning('SQLite3 not found or database initialization failed');
    logInfo('You can initialize the database manually later using:');
    logInfo('sqlite3 data/elocal_scraper.db < database/sqlite-init.sql');
  }
};

// Run tests
const runTests = () => {
  logStep('6', 'Running tests...');
  
  try {
    execSync('npm test', { stdio: 'inherit' });
    logSuccess('All tests passed');
  } catch (error) {
    logWarning('Some tests failed - this is normal if credentials are not configured');
  }
};

// Display completion message
const displayCompletion = () => {
  logStep('7', 'Setup completed!');
  
  log('\n' + '='.repeat(60));
  log(`${colors.bright}${colors.green}eLocal Scraper Service Setup Complete!${colors.reset}`);
  log('='.repeat(60));
  
  log('\n📋 Next Steps:');
  log('1. Update your credentials in the .env file');
  log('2. Test the scraper: npm run scrape');
  log('3. Start the scheduler: npm run schedule');
  
  log('\n📚 Available Commands:');
  log('• npm start          - Run scraper once');
  log('• npm run scrape     - Run scraper once');
  log('• npm run schedule   - Start scheduler service');
  log('• npm run dev        - Development mode');
  log('• npm test           - Run tests');
  
  log('\n📖 Documentation:');
  log('• README.md          - Complete documentation');
  log('• examples.js         - Usage examples');
  
  log('\n🔧 Configuration:');
  log('• .env               - Environment variables');
  log('• database/          - SQLite database files');
  log('• logs/              - Log files');
  
  log('\n' + '='.repeat(60));
};

// Main setup function
const main = async () => {
  try {
    log(`${colors.bright}${colors.magenta}🚀 eLocal Scraper Service Setup${colors.reset}`);
    log('This script will set up your eLocal scraper service...\n');
    
    checkNodeVersion();
    installDependencies();
    createDirectories();
    createEnvFile();
    initializeDatabase();
    runTests();
    displayCompletion();
    
  } catch (error) {
    logError(`Setup failed: ${error.message}`);
    process.exit(1);
  }
};

// Run setup
main();

