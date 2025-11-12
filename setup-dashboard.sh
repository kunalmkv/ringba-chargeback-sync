#!/bin/bash

# Dashboard Setup Script
# This script automates the setup and build process for the React dashboard

set -e  # Exit on error

echo "================================================================================
🚀 REACT DASHBOARD SETUP SCRIPT
================================================================================
"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Step 1: Check Node.js
echo -e "${YELLOW}Step 1: Checking Node.js version...${NC}"
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed. Please install Node.js v18 or higher.${NC}"
    exit 1
fi

NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}❌ Node.js version is too old. Please install Node.js v18 or higher.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Node.js $(node --version) detected${NC}"
echo ""

# Step 2: Install main dependencies
echo -e "${YELLOW}Step 2: Installing main dependencies...${NC}"
npm install
echo -e "${GREEN}✅ Main dependencies installed${NC}"
echo ""

# Step 3: Install React dashboard dependencies
echo -e "${YELLOW}Step 3: Installing React dashboard dependencies...${NC}"
cd dashboard-react
npm install
cd ..
echo -e "${GREEN}✅ React dashboard dependencies installed${NC}"
echo ""

# Step 4: Build React dashboard
echo -e "${YELLOW}Step 4: Building React dashboard...${NC}"
npm run dashboard:build
echo -e "${GREEN}✅ React dashboard built successfully${NC}"
echo ""

# Step 5: Check if build directory exists
if [ ! -d "dashboard-build" ]; then
    echo -e "${RED}❌ Build directory not found. Build may have failed.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Build directory created: dashboard-build/${NC}"
echo ""

# Step 6: Check PM2
echo -e "${YELLOW}Step 5: Checking PM2...${NC}"
if command -v pm2 &> /dev/null; then
    echo -e "${GREEN}✅ PM2 is installed${NC}"
    USE_PM2=true
else
    echo -e "${YELLOW}⚠️  PM2 is not installed. You can install it with: npm install -g pm2${NC}"
    USE_PM2=false
fi
echo ""

# Summary
echo "================================================================================
✅ SETUP COMPLETE!
================================================================================
"

echo "Next steps:"
echo ""
if [ "$USE_PM2" = true ]; then
    echo "To start the dashboard with PM2:"
    echo "  npm run dashboard:pm2"
    echo ""
    echo "Or:"
    echo "  pm2 start ecosystem.config.js"
    echo ""
else
    echo "To start the dashboard:"
    echo "  npm run dashboard"
    echo ""
    echo "Or:"
    echo "  node dashboard-server.js"
    echo ""
fi

echo "Verify it's running:"
echo "  curl http://localhost:3000/api/health"
echo ""
echo "Access dashboard:"
echo "  http://localhost:3000"
echo ""
echo "================================================================================
"

