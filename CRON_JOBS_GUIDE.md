# Cron Jobs Setup Guide for eLocal Scraper Services

This guide explains how to set up system cron jobs to run the eLocal scraper services at scheduled intervals.

## 📋 Overview

Instead of using the Node.js scheduler (`npm start multi-scheduler`), you can use system cron jobs to run each service independently. This gives you more control and flexibility.

## 🕐 Service Schedules (IST - Indian Standard Time)

1. **Auth Refresh Service**: Once a week on Sunday at 2:00 AM IST
2. **Historical Data Service**: Daily at 12:00 AM IST (midnight)
3. **Current Day Service**: Every 3 hours from 9 PM to 6 AM IST (21:00, 00:00, 03:00, 06:00)
4. **Ringba Sync Service**: Daily at 6:00 AM IST

## 🚀 Quick Setup

### Option 1: Automated Setup (Recommended)

```bash
# Run the setup script
./setup-cron.sh
```

This script will:
- Detect your project directory and Node.js path
- Create a crontab file with correct paths
- Optionally install the cron jobs
- Backup your existing crontab

### Option 2: Manual Setup

1. **Get your project path and Node.js path:**
   ```bash
   cd /Users/rajeev/Desktop/adstia/elocal
   pwd  # Copy this path
   which node  # Copy this path
   ```

2. **Create crontab file:**
   ```bash
   cp crontab.example crontab.local
   nano crontab.local  # Edit and update PROJECT_DIR and NODE_PATH
   ```

3. **Install cron jobs:**
   ```bash
   crontab crontab.local
   ```

4. **Verify installation:**
   ```bash
   crontab -l
   ```

## 📝 Cron Job Entries

Here are the cron job entries you need:

```bash
# Set environment variables
PROJECT_DIR=/Users/rajeev/Desktop/adstia/elocal
NODE_PATH=/Users/rajeev/.nvm/versions/node/v18.20.4/bin/node
PATH=/usr/local/bin:/usr/bin:/bin
TZ=Asia/Kolkata

# Log file directory
LOG_DIR=$PROJECT_DIR/logs
mkdir -p $LOG_DIR

# 1. Auth Refresh Service - Sunday at 2:00 AM IST
0 2 * * 0 cd $PROJECT_DIR && $NODE_PATH src/index.js refresh-auth >> $LOG_DIR/cron-auth-refresh.log 2>&1

# 2. Historical Data Service - Daily at 12:00 AM IST
0 0 * * * cd $PROJECT_DIR && $NODE_PATH src/index.js historical >> $LOG_DIR/cron-historical.log 2>&1

# 3. Current Day Service - Every 3 hours (9 PM, 12 AM, 3 AM, 6 AM IST)
0 21,0,3,6 * * * cd $PROJECT_DIR && $NODE_PATH src/index.js current >> $LOG_DIR/cron-current.log 2>&1

# 4. Ringba Sync Service - Daily at 6:00 AM IST
0 6 * * * cd $PROJECT_DIR && $NODE_PATH src/index.js ringba-sync >> $LOG_DIR/cron-ringba-sync.log 2>&1
```

## 🔧 Cron Commands

### View Current Cron Jobs
```bash
crontab -l
```

### Edit Cron Jobs
```bash
crontab -e
```

### Remove All Cron Jobs
```bash
crontab -r
```

### Remove Specific Cron Job
```bash
crontab -e  # Then delete the line you want to remove
```

## 📊 Monitoring Cron Jobs

### View Logs
```bash
# View auth refresh logs
tail -f logs/cron-auth-refresh.log

# View historical service logs
tail -f logs/cron-historical.log

# View current day service logs
tail -f logs/cron-current.log

# View Ringba sync logs
tail -f logs/cron-ringba-sync.log
```

### Check Cron Job Status
```bash
# View system cron logs (macOS)
log show --predicate 'process == "cron"' --last 1h

# View system cron logs (Linux)
grep CRON /var/log/syslog
```

## ⚙️ Customizing Schedules

### Cron Format
```
* * * * * command
│ │ │ │ │
│ │ │ │ └─── Day of week (0-7, 0 and 7 = Sunday)
│ │ │ └───── Month (1-12)
│ │ └─────── Day of month (1-31)
│ └───────── Hour (0-23)
└─────────── Minute (0-59)
```

### Examples

**Run every hour:**
```bash
0 * * * * cd $PROJECT_DIR && $NODE_PATH src/index.js current
```

**Run every 30 minutes:**
```bash
*/30 * * * * cd $PROJECT_DIR && $NODE_PATH src/index.js current
```

**Run at specific times:**
```bash
# Run at 9 AM and 5 PM daily
0 9,17 * * * cd $PROJECT_DIR && $NODE_PATH src/index.js current
```

**Run on specific days:**
```bash
# Run only on weekdays (Monday-Friday)
0 0 * * 1-5 cd $PROJECT_DIR && $NODE_PATH src/index.js historical
```

## 🌍 Timezone Configuration

The cron jobs use `TZ=Asia/Kolkata` to ensure all times are in IST. If your system timezone is different, the cron jobs will still run at the correct IST times.

To verify timezone:
```bash
date
TZ=Asia/Kolkata date
```

## 🔍 Troubleshooting

### Cron Job Not Running

1. **Check if cron is running:**
   ```bash
   # macOS
   sudo launchctl list | grep cron
   
   # Linux
   systemctl status cron
   ```

2. **Check cron logs:**
   ```bash
   # macOS
   log show --predicate 'process == "cron"' --last 1h
   
   # Linux
   grep CRON /var/log/syslog | tail -20
   ```

3. **Verify paths:**
   ```bash
   # Test the command manually
   cd /Users/rajeev/Desktop/adstia/elocal
   /Users/rajeev/.nvm/versions/node/v18.20.4/bin/node src/index.js historical
   ```

4. **Check file permissions:**
   ```bash
   ls -la src/index.js
   chmod +x src/index.js  # If needed
   ```

### Environment Variables

If your services need environment variables (from `.env` file), make sure they're loaded. The `dotenv` package in your code should handle this, but you can also add them to crontab:

```bash
# Add to crontab
ELOCAL_USERNAME=your_username
ELOCAL_PASSWORD=your_password
RINGBA_ACCOUNT_ID=your_account_id
RINGBA_API_TOKEN=your_token
```

## 📋 Complete Cron Jobs File

Save this as `crontab.local` and install with `crontab crontab.local`:

```bash
# eLocal Scraper Services - Cron Jobs
# All times in IST (Asia/Kolkata)

PROJECT_DIR=/Users/rajeev/Desktop/adstia/elocal
NODE_PATH=/Users/rajeev/.nvm/versions/node/v18.20.4/bin/node
PATH=/usr/local/bin:/usr/bin:/bin
TZ=Asia/Kolkata

LOG_DIR=$PROJECT_DIR/logs
mkdir -p $LOG_DIR

# Auth Refresh - Sunday 2:00 AM IST
0 2 * * 0 cd $PROJECT_DIR && $NODE_PATH src/index.js refresh-auth >> $LOG_DIR/cron-auth-refresh.log 2>&1

# Historical Data - Daily 12:00 AM IST
0 0 * * * cd $PROJECT_DIR && $NODE_PATH src/index.js historical >> $LOG_DIR/cron-historical.log 2>&1

# Current Day - Every 3 hours (9 PM, 12 AM, 3 AM, 6 AM IST)
0 21,0,3,6 * * * cd $PROJECT_DIR && $NODE_PATH src/index.js current >> $LOG_DIR/cron-current.log 2>&1

# Ringba Sync - Daily 6:00 AM IST
0 6 * * * cd $PROJECT_DIR && $NODE_PATH src/index.js ringba-sync >> $LOG_DIR/cron-ringba-sync.log 2>&1
```

## ✅ Verification

After installing, verify the cron jobs are set up correctly:

```bash
# List all cron jobs
crontab -l

# Test a service manually
cd /Users/rajeev/Desktop/adstia/elocal
node src/index.js historical

# Check logs after a scheduled run
ls -lh logs/cron-*.log
```

## 🔄 Alternative: Using Node.js Scheduler

If you prefer to use the Node.js scheduler instead of system cron:

```bash
npm start multi-scheduler
```

This runs all services in a single Node.js process with their schedules managed by `node-cron`.

