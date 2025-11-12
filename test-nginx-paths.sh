#!/bin/bash
# Test script to verify nginx paths are working

echo "Testing dashboard paths..."
echo ""

echo "1. Testing root path:"
curl -I http://localhost/ringba-sync-dashboard/ 2>&1 | head -5
echo ""

echo "2. Testing API health:"
curl -s http://localhost/ringba-sync-dashboard/api/health 2>&1 | head -3
echo ""

echo "3. Testing assets path (example):"
curl -I http://localhost/ringba-sync-dashboard/assets/index-Brf2LUW9.css 2>&1 | head -5
echo ""

echo "4. Testing direct backend (bypass nginx):"
curl -s http://localhost:3000/api/health 2>&1 | head -3
echo ""

echo "Done!"
