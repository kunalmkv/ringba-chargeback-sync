#!/bin/bash

# Comprehensive Dashboard Debugging Script
# Run this on your server to diagnose blank page issues

echo "================================================================================
🔍 DASHBOARD DEBUGGING SCRIPT
================================================================================
"

DOMAIN="${1:-localhost}"
BASE_URL="http://${DOMAIN}"

echo "Testing domain: ${BASE_URL}"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Test 1: Backend Health
echo "1. Testing Backend Health (direct):"
if curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Backend is running on port 3000${NC}"
    curl -s http://localhost:3000/api/health | head -3
else
    echo -e "${RED}❌ Backend is NOT running on port 3000${NC}"
fi
echo ""

# Test 2: Debug Endpoint
echo "2. Testing Debug Endpoint:"
if curl -s http://localhost:3000/api/debug > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Debug endpoint accessible${NC}"
    curl -s http://localhost:3000/api/debug | python3 -m json.tool 2>/dev/null || curl -s http://localhost:3000/api/debug
else
    echo -e "${RED}❌ Debug endpoint not accessible${NC}"
fi
echo ""

# Test 3: Root Path (HTML)
echo "3. Testing Root Path (HTML):"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/)
if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Root path returns 200${NC}"
    echo "First 500 chars of HTML:"
    curl -s http://localhost:3000/ | head -c 500
    echo ""
else
    echo -e "${RED}❌ Root path returns ${HTTP_CODE}${NC}"
fi
echo ""

# Test 4: Assets Directory
echo "4. Checking Assets Directory:"
if [ -d "dashboard-build/assets" ]; then
    echo -e "${GREEN}✅ Assets directory exists${NC}"
    echo "Asset files:"
    ls -lh dashboard-build/assets/ | head -5
else
    echo -e "${RED}❌ Assets directory NOT found${NC}"
    echo "Current directory: $(pwd)"
    echo "Looking for: dashboard-build/assets/"
fi
echo ""

# Test 5: Through Nginx
echo "5. Testing Through Nginx:"
echo "   Root path:"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/ringba-sync-dashboard/")
if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Nginx root path returns 200${NC}"
else
    echo -e "${RED}❌ Nginx root path returns ${HTTP_CODE}${NC}"
fi

echo "   API health:"
if curl -s "${BASE_URL}/ringba-sync-dashboard/api/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Nginx API path works${NC}"
    curl -s "${BASE_URL}/ringba-sync-dashboard/api/health" | head -3
else
    echo -e "${RED}❌ Nginx API path failed${NC}"
fi
echo ""

# Test 6: Check PM2
echo "6. Checking PM2 Status:"
if command -v pm2 &> /dev/null; then
    pm2 status | grep dashboard || echo -e "${YELLOW}⚠️  Dashboard not found in PM2${NC}"
else
    echo -e "${YELLOW}⚠️  PM2 not installed${NC}"
fi
echo ""

# Test 7: Check Build Files
echo "7. Checking Build Files:"
if [ -f "dashboard-build/index.html" ]; then
    echo -e "${GREEN}✅ index.html exists${NC}"
    echo "File size: $(ls -lh dashboard-build/index.html | awk '{print $5}')"
    echo "First 10 lines:"
    head -10 dashboard-build/index.html
else
    echo -e "${RED}❌ index.html NOT found${NC}"
    echo "You may need to run: npm run dashboard:build"
fi
echo ""

# Test 8: Check Asset Files
echo "8. Checking Asset Files:"
if [ -d "dashboard-build/assets" ]; then
    ASSET_COUNT=$(ls -1 dashboard-build/assets/ 2>/dev/null | wc -l)
    echo -e "${GREEN}✅ Found ${ASSET_COUNT} asset files${NC}"
    
    # Try to find JS and CSS files
    JS_FILE=$(ls dashboard-build/assets/*.js 2>/dev/null | head -1)
    CSS_FILE=$(ls dashboard-build/assets/*.css 2>/dev/null | head -1)
    
    if [ -n "$JS_FILE" ]; then
        echo "   JS file: $(basename $JS_FILE)"
        echo "   Testing JS file through backend:"
        JS_PATH="/assets/$(basename $JS_FILE)"
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000${JS_PATH}")
        if [ "$HTTP_CODE" = "200" ]; then
            echo -e "   ${GREEN}✅ JS file accessible${NC}"
        else
            echo -e "   ${RED}❌ JS file returns ${HTTP_CODE}${NC}"
        fi
    fi
    
    if [ -n "$CSS_FILE" ]; then
        echo "   CSS file: $(basename $CSS_FILE)"
        echo "   Testing CSS file through backend:"
        CSS_PATH="/assets/$(basename $CSS_FILE)"
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000${CSS_PATH}")
        if [ "$HTTP_CODE" = "200" ]; then
            echo -e "   ${GREEN}✅ CSS file accessible${NC}"
        else
            echo -e "   ${RED}❌ CSS file returns ${HTTP_CODE}${NC}"
        fi
    fi
else
    echo -e "${RED}❌ Assets directory not found${NC}"
fi
echo ""

# Test 9: Nginx Logs
echo "9. Recent Nginx Errors (last 5 lines):"
if [ -f "/var/log/nginx/error.log" ]; then
    sudo tail -5 /var/log/nginx/error.log 2>/dev/null || echo "Cannot read nginx error log (need sudo)"
else
    echo "Nginx error log not found at /var/log/nginx/error.log"
fi
echo ""

# Test 10: Backend Logs
echo "10. Recent Backend Logs:"
if command -v pm2 &> /dev/null; then
    echo "Last 10 lines from PM2:"
    pm2 logs dashboard --lines 10 --nostream 2>/dev/null || echo "No PM2 logs available"
else
    echo "PM2 not available"
fi
echo ""

echo "================================================================================
📋 SUMMARY
================================================================================
"

echo "Next steps if issues found:"
echo "1. If build missing: npm run dashboard:build"
echo "2. If backend not running: npm run dashboard:pm2"
echo "3. If nginx issues: sudo nginx -t && sudo nginx -s reload"
echo "4. Check browser console (F12) for JavaScript errors"
echo "5. Check browser Network tab for failed requests"
echo ""
echo "Debug endpoint: http://localhost:3000/api/debug"
echo "================================================================================
"

