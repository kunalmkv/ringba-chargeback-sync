#!/bin/bash

# Test script to verify nginx configuration is working correctly

DOMAIN="${1:-insidefi.co}"
BASE_URL="http://${DOMAIN}"

echo "================================================================================
🧪 NGINX CONFIGURATION TEST
================================================================================
"

echo "Testing domain: ${BASE_URL}"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Test 1: Nginx config syntax
echo "1. Testing Nginx Configuration Syntax:"
if sudo nginx -t 2>&1 | grep -q "syntax is ok"; then
    echo -e "${GREEN}✅ Nginx configuration is valid${NC}"
else
    echo -e "${RED}❌ Nginx configuration has errors${NC}"
    sudo nginx -t
    exit 1
fi
echo ""

# Test 2: Backend direct access
echo "2. Testing Backend Direct Access (bypass nginx):"
if curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Backend is running on port 3000${NC}"
    echo "Response:"
    curl -s http://localhost:3000/api/health | head -3
else
    echo -e "${RED}❌ Backend is NOT running on port 3000${NC}"
    echo "Start it with: npm run dashboard:pm2"
fi
echo ""

# Test 3: Root path through nginx
echo "3. Testing Root Path Through Nginx:"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/ringba-sync-dashboard/")
if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Root path returns 200${NC}"
    echo "First 200 chars of response:"
    curl -s "${BASE_URL}/ringba-sync-dashboard/" | head -c 200
    echo ""
else
    echo -e "${RED}❌ Root path returns ${HTTP_CODE}${NC}"
    echo "Response:"
    curl -s "${BASE_URL}/ringba-sync-dashboard/" | head -5
fi
echo ""

# Test 4: API through nginx
echo "4. Testing API Through Nginx:"
if curl -s "${BASE_URL}/ringba-sync-dashboard/api/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ API path works through nginx${NC}"
    echo "Response:"
    curl -s "${BASE_URL}/ringba-sync-dashboard/api/health" | head -3
else
    echo -e "${RED}❌ API path failed through nginx${NC}"
fi
echo ""

# Test 5: Debug endpoint
echo "5. Testing Debug Endpoint:"
if curl -s "${BASE_URL}/ringba-sync-dashboard/api/debug" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Debug endpoint accessible${NC}"
    echo "Build status:"
    curl -s "${BASE_URL}/ringba-sync-dashboard/api/debug" | grep -E "(exists|path)" | head -5
else
    echo -e "${RED}❌ Debug endpoint not accessible${NC}"
fi
echo ""

# Test 6: Check for assets (if build exists)
echo "6. Testing Asset Paths:"
if [ -d "dashboard-build/assets" ]; then
    JS_FILE=$(ls dashboard-build/assets/*.js 2>/dev/null | head -1 | xargs basename)
    CSS_FILE=$(ls dashboard-build/assets/*.css 2>/dev/null | head -1 | xargs basename)
    
    if [ -n "$JS_FILE" ]; then
        echo "Testing JS file: ${JS_FILE}"
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/ringba-sync-dashboard/assets/${JS_FILE}")
        if [ "$HTTP_CODE" = "200" ]; then
            echo -e "${GREEN}✅ JS asset accessible${NC}"
        else
            echo -e "${RED}❌ JS asset returns ${HTTP_CODE}${NC}"
        fi
    fi
    
    if [ -n "$CSS_FILE" ]; then
        echo "Testing CSS file: ${CSS_FILE}"
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/ringba-sync-dashboard/assets/${CSS_FILE}")
        if [ "$HTTP_CODE" = "200" ]; then
            echo -e "${GREEN}✅ CSS asset accessible${NC}"
        else
            echo -e "${RED}❌ CSS asset returns ${HTTP_CODE}${NC}"
        fi
    fi
else
    echo -e "${YELLOW}⚠️  Build directory not found locally (this is OK if testing on server)${NC}"
fi
echo ""

# Test 7: Check nginx error logs
echo "7. Recent Nginx Errors (last 3 lines):"
if [ -f "/var/log/nginx/error.log" ]; then
    ERRORS=$(sudo tail -3 /var/log/nginx/error.log 2>/dev/null | grep -i "ringba-sync-dashboard\|dashboard")
    if [ -n "$ERRORS" ]; then
        echo -e "${RED}❌ Found errors:${NC}"
        echo "$ERRORS"
    else
        echo -e "${GREEN}✅ No recent errors related to dashboard${NC}"
    fi
else
    echo "Cannot read nginx error log (need sudo or log path different)"
fi
echo ""

# Test 8: Check rewrite behavior
echo "8. Testing Rewrite Behavior:"
echo "   Request: /ringba-sync-dashboard/"
echo "   Expected: Proxied to http://127.0.0.1:3000/"
echo "   Actual:"
curl -s -I "${BASE_URL}/ringba-sync-dashboard/" | grep -E "(HTTP|Location|X-)" | head -3
echo ""

echo "================================================================================
📋 SUMMARY
================================================================================
"

echo "If all tests pass but you still see a blank page:"
echo "1. Check browser console (F12) for JavaScript errors"
echo "2. Check browser Network tab for failed requests"
echo "3. Verify build exists on server: ls -la dashboard-build/"
echo "4. Check backend logs: pm2 logs dashboard"
echo "5. Check debug endpoint: curl ${BASE_URL}/ringba-sync-dashboard/api/debug"
echo ""
echo "================================================================================
"

