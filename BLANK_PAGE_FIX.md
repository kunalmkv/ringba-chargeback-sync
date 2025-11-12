# Blank Page Fix Guide - Comprehensive Troubleshooting

## Problem
React dashboard shows blank white page on server, but works perfectly locally.

## Root Causes (Most Common)

### 1. Build Directory Missing on Server
**Symptom:** Blank page, no console errors, `/api/debug` shows `build.exists: false`

**Fix:**
```bash
# On server, rebuild the React app
npm run dashboard:build

# Verify build exists
ls -la dashboard-build/
ls -la dashboard-build/assets/
```

### 2. Assets Not Loading (404 Errors)
**Symptom:** Browser console shows 404 errors for `.js` and `.css` files

**Check:**
```bash
# Test asset directly
curl -I http://localhost:3000/assets/index-*.js
# (Replace * with actual hash from dashboard-build/assets/)

# Check if assets exist
ls -la dashboard-build/assets/
```

**Fix:**
- Rebuild: `npm run dashboard:build`
- Check file permissions: `chmod -R 755 dashboard-build/`
- Verify nginx rewrite is working: Check nginx access logs

### 3. API Calls Failing
**Symptom:** Network tab shows failed API requests, console shows fetch errors

**Check:**
```bash
# Test API directly
curl http://localhost:3000/api/health

# Test through nginx
curl http://your-domain/ringba-sync-dashboard/api/health
```

**Fix:**
- Ensure backend is running: `pm2 status`
- Check nginx config: `sudo nginx -t`
- Verify API path rewrite in nginx

### 4. JavaScript Errors
**Symptom:** Browser console shows JavaScript errors

**Check:**
1. Open browser DevTools (F12)
2. Check Console tab
3. Look for:
   - Syntax errors
   - Import errors
   - API errors
   - CORS errors

**Fix:**
- Check error message for specific issue
- Verify all dependencies are installed: `npm install` in `dashboard-react/`
- Rebuild: `npm run dashboard:build`

### 5. Base Path Mismatch
**Symptom:** Assets load but React app doesn't render

**Check:**
```bash
# Check index.html base tag
grep "base href" dashboard-build/index.html

# Should show: <base href="/ringba-sync-dashboard/">
```

**Fix:**
- Verify `vite.config.js` has: `base: '/ringba-sync-dashboard/'`
- Rebuild: `npm run dashboard:build`

### 6. Nginx Configuration Issues
**Symptom:** Works locally but not through nginx

**Check:**
```bash
# Test nginx config
sudo nginx -t

# Check nginx error logs
sudo tail -f /var/log/nginx/error.log

# Check nginx access logs
sudo tail -f /var/log/nginx/access.log
```

**Fix:**
- Ensure `/ringba-sync-dashboard` location is BEFORE root location
- Verify rewrite rule: `rewrite ^/ringba-sync-dashboard/?(.*)$ /$1 break;`
- Reload nginx: `sudo nginx -s reload`

## Step-by-Step Debugging

### Step 1: Run Debug Script
```bash
./debug-dashboard.sh your-domain.com
```

This will test:
- Backend health
- Build directory existence
- Asset files
- Nginx routing
- API endpoints

### Step 2: Check Debug Endpoint
```bash
curl http://localhost:3000/api/debug | python3 -m json.tool
```

Or in browser:
```
http://your-domain/ringba-sync-dashboard/api/debug
```

This shows:
- Server working directory
- Build directory status
- File listings
- Asset directory status

### Step 3: Check Browser Console
1. Open: `http://your-domain/ringba-sync-dashboard/`
2. Press F12 (Developer Tools)
3. **Console Tab:**
   - Look for red error messages
   - Check for JavaScript errors
   - Note any failed imports

4. **Network Tab:**
   - Look for requests with red status (404, 500, etc.)
   - Check which files are failing to load
   - Verify Content-Type headers

### Step 4: Verify Build on Server
```bash
# Check if build exists
ls -la dashboard-build/

# Should show:
# - index.html
# - assets/ directory

# Check assets
ls -la dashboard-build/assets/

# Should show:
# - index-*.js (React bundle)
# - index-*.css (Styles)
```

### Step 5: Test Direct Backend Access
```bash
# Test HTML
curl http://localhost:3000/ | head -20

# Test API
curl http://localhost:3000/api/health

# Test assets (replace * with actual hash)
curl -I http://localhost:3000/assets/index-*.js
```

### Step 6: Test Through Nginx
```bash
# Test HTML
curl -I http://your-domain/ringba-sync-dashboard/

# Test API
curl http://your-domain/ringba-sync-dashboard/api/health

# Test assets
curl -I http://your-domain/ringba-sync-dashboard/assets/index-*.js
```

## Complete Fix Procedure

If you're still seeing a blank page, follow these steps in order:

### 1. Verify Backend is Running
```bash
pm2 status
# Should show "dashboard" as "online"

# If not running:
npm run dashboard:pm2
```

### 2. Rebuild React App
```bash
# Make sure you're in project root
cd /path/to/elocal

# Rebuild
npm run dashboard:build

# Verify build
ls -la dashboard-build/
ls -la dashboard-build/assets/
```

### 3. Check File Permissions
```bash
# Ensure files are readable
chmod -R 755 dashboard-build/
```

### 4. Test Backend Directly
```bash
# Test HTML
curl http://localhost:3000/ | grep -E "(script|link|root)"

# Should show React script and link tags

# Test API
curl http://localhost:3000/api/health

# Should return JSON with status
```

### 5. Verify Nginx Configuration
```bash
# Test config
sudo nginx -t

# If OK, reload
sudo nginx -s reload
```

### 6. Check Nginx Logs
```bash
# Error logs
sudo tail -f /var/log/nginx/error.log

# Access logs
sudo tail -f /var/log/nginx/access.log
```

### 7. Test Through Nginx
```bash
# Test root
curl -I http://your-domain/ringba-sync-dashboard/

# Should return 200

# Test API
curl http://your-domain/ringba-sync-dashboard/api/health

# Should return JSON
```

### 8. Browser Testing
1. Open: `http://your-domain/ringba-sync-dashboard/`
2. Open DevTools (F12)
3. **Console Tab:**
   - Should show: `[Dashboard] Base path: /ringba-sync-dashboard`
   - Should show: `[Dashboard] API base URL: http://your-domain/ringba-sync-dashboard`
   - Should NOT show red errors

4. **Network Tab:**
   - All requests should be 200 (green)
   - Check that assets load: `index-*.js` and `index-*.css`
   - Check that API calls succeed: `/api/health`, `/api/stats`, etc.

## Quick Diagnostic Checklist

- [ ] Backend running: `pm2 status` shows dashboard online
- [ ] Build exists: `ls dashboard-build/index.html` exists
- [ ] Assets exist: `ls dashboard-build/assets/` shows files
- [ ] Backend serves HTML: `curl http://localhost:3000/` returns HTML
- [ ] Backend serves assets: `curl http://localhost:3000/assets/...` returns file
- [ ] Backend API works: `curl http://localhost:3000/api/health` returns JSON
- [ ] Nginx config valid: `sudo nginx -t` passes
- [ ] Nginx serves HTML: `curl http://your-domain/ringba-sync-dashboard/` returns HTML
- [ ] Nginx serves API: `curl http://your-domain/ringba-sync-dashboard/api/health` returns JSON
- [ ] Browser console: No red errors
- [ ] Browser network: All requests 200

## Still Not Working?

If you've tried everything above:

1. **Share the debug output:**
   ```bash
   ./debug-dashboard.sh > debug-output.txt
   cat debug-output.txt
   ```

2. **Share browser console errors:**
   - Screenshot of Console tab
   - Screenshot of Network tab (showing failed requests)

3. **Share server logs:**
   ```bash
   pm2 logs dashboard --lines 50 > server-logs.txt
   cat server-logs.txt
   ```

4. **Check the debug endpoint:**
   ```bash
   curl http://localhost:3000/api/debug | python3 -m json.tool > debug-api.json
   cat debug-api.json
   ```

## Most Likely Issues (Priority Order)

1. **Build directory missing on server** (90% of cases)
   - Fix: `npm run dashboard:build` on server

2. **Assets not accessible** (5% of cases)
   - Fix: Check file permissions, rebuild

3. **Nginx rewrite not working** (3% of cases)
   - Fix: Verify nginx config, check location block order

4. **JavaScript errors** (2% of cases)
   - Fix: Check browser console, fix code issues

Start with #1 - it's the most common issue!

