#!/bin/bash
# Setup script for eLocal Scraper Cron Jobs
# This script helps you install cron jobs for the eLocal scraper services

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_PATH=$(which node)

echo "=================================================================================="
echo "eLocal Scraper - Cron Jobs Setup"
echo "=================================================================================="
echo ""
echo "Project Directory: $PROJECT_DIR"
echo "Node Path: $NODE_PATH"
echo ""

# Create logs directory
mkdir -p "$PROJECT_DIR/logs"
echo "✓ Created logs directory: $PROJECT_DIR/logs"
echo ""

# Create crontab file with correct paths
CRONTAB_FILE="$PROJECT_DIR/crontab.local"

cat > "$CRONTAB_FILE" << EOF
# eLocal Scraper Services - Cron Jobs Configuration
# Generated on $(date)
# All times are in IST (Indian Standard Time - Asia/Kolkata)

# Set environment variables
PROJECT_DIR=$PROJECT_DIR
NODE_PATH=$NODE_PATH
PATH=/usr/local/bin:/usr/bin:/bin
TZ=Asia/Kolkata

# Log file directory
LOG_DIR=\$PROJECT_DIR/logs
mkdir -p \$LOG_DIR

# ============================================================================
# 1. AUTH REFRESH SERVICE
# ============================================================================
# Schedule: Once a week on Sunday at 2:00 AM IST
# ============================================================================
0 2 * * 0 cd \$PROJECT_DIR && \$NODE_PATH src/index.js refresh-auth >> \$LOG_DIR/cron-auth-refresh.log 2>&1

# ============================================================================
# 2. HISTORICAL DATA SERVICE
# ============================================================================
# Schedule: Daily at 12:00 AM IST (midnight)
# ============================================================================
0 0 * * * cd \$PROJECT_DIR && \$NODE_PATH src/index.js historical >> \$LOG_DIR/cron-historical.log 2>&1

# ============================================================================
# 3. CURRENT DAY SERVICE
# ============================================================================
# Schedule: Every 3 hours from 9 PM to 6 AM IST (21:00, 00:00, 03:00, 06:00)
# ============================================================================
0 21,0,3,6 * * * cd \$PROJECT_DIR && \$NODE_PATH src/index.js current >> \$LOG_DIR/cron-current.log 2>&1

# ============================================================================
# 4. RINGBA SYNC SERVICE
# ============================================================================
# Schedule: Daily at 6:00 AM IST
# ============================================================================
0 6 * * * cd \$PROJECT_DIR && \$NODE_PATH src/index.js ringba-sync >> \$LOG_DIR/cron-ringba-sync.log 2>&1
EOF

echo "✓ Created crontab file: $CRONTAB_FILE"
echo ""

# Ask user if they want to install
read -p "Do you want to install these cron jobs now? (y/n): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Backup existing crontab
    if crontab -l > /dev/null 2>&1; then
        BACKUP_FILE="$PROJECT_DIR/crontab.backup.$(date +%Y%m%d_%H%M%S)"
        crontab -l > "$BACKUP_FILE"
        echo "✓ Backed up existing crontab to: $BACKUP_FILE"
    fi
    
    # Install new crontab
    crontab "$CRONTAB_FILE"
    echo "✓ Cron jobs installed successfully!"
    echo ""
    echo "Installed cron jobs:"
    crontab -l | grep -E "^[0-9]|^# [0-9]|^# Schedule" | head -20
    echo ""
    echo "To view all cron jobs: crontab -l"
    echo "To remove all cron jobs: crontab -r"
    echo "To edit cron jobs: crontab -e"
else
    echo ""
    echo "Crontab file created but not installed."
    echo "To install manually, run: crontab $CRONTAB_FILE"
fi

echo ""
echo "=================================================================================="
echo "Setup Complete!"
echo "=================================================================================="

