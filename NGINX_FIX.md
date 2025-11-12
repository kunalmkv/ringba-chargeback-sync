# Nginx Configuration Fix for Blank Page Issue

## Problem
The React dashboard shows a blank page when accessed through nginx, but works fine locally.

## Root Cause
The nginx rewrite rule may not be handling all paths correctly, especially:
1. Root path `/ringba-sync-dashboard/` 
2. Asset paths `/ringba-sync-dashboard/assets/...`
3. API paths `/ringba-sync-dashboard/api/...`

## Solution

### Step 1: Update Nginx Configuration

Replace the existing `/ringba-sync-dashboard` location block in your nginx config with:

```nginx
location /ringba-sync-dashboard {
    # Strip the /ringba-sync-dashboard prefix before proxying
    rewrite ^/ringba-sync-dashboard/?(.*)$ /$1 break;
    
    proxy_pass http://ringba-sync-dashboard;
    proxy_http_version 1.1;
    
    # WebSocket support
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    
    # Standard proxy headers
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Port $server_port;
    
    # Timeouts
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
    
    # Don't buffer responses
    proxy_buffering off;
}
```

**Important:** Place this location block **BEFORE** the root location (`location /`) block in your nginx config.

### Step 2: Test the Configuration

```bash
# Test nginx config syntax
sudo nginx -t

# If syntax is OK, reload nginx
sudo nginx -s reload
# OR
sudo systemctl reload nginx
```

### Step 3: Verify Backend is Running

```bash
# Check if dashboard server is running on port 3000
curl http://localhost:3000/api/health

# Check PM2 status
pm2 status

# View dashboard logs
pm2 logs dashboard
```

### Step 4: Test Through Nginx

```bash
# Test root path
curl -I http://your-domain/ringba-sync-dashboard/

# Test API
curl http://your-domain/ringba-sync-dashboard/api/health

# Test assets (check actual asset name in dashboard-build/assets/)
curl -I http://your-domain/ringba-sync-dashboard/assets/index-*.js
```

### Step 5: Check Browser Console

Open browser developer tools (F12) and check:
1. **Console tab** - Look for JavaScript errors
2. **Network tab** - Check for failed requests (404, 500, CORS errors)
3. **Application tab** - Verify assets are loading

## Common Issues

### Issue 1: Assets Return 404

**Symptom:** Browser console shows 404 errors for `.js` and `.css` files

**Fix:** 
- Verify the rewrite rule is correct
- Check that `dashboard-build/assets/` directory exists on server
- Ensure file permissions are correct: `chmod -R 755 dashboard-build/`

### Issue 2: API Calls Fail

**Symptom:** Network tab shows failed API requests

**Fix:**
- Verify backend is running: `curl http://localhost:3000/api/health`
- Check nginx error logs: `sudo tail -f /var/log/nginx/error.log`
- Verify the API path rewrite is working

### Issue 3: CORS Errors

**Symptom:** Browser console shows CORS errors

**Fix:**
- The backend already sets CORS headers, but you can add them in nginx too (see config above)
- Ensure `Access-Control-Allow-Origin` is set correctly

### Issue 4: Blank Page with No Errors

**Symptom:** Page loads but shows blank, no console errors

**Fix:**
- Check if React app is actually rendering: Look for `<div id="root">` in page source
- Verify the base path in `dashboard-build/index.html` is `/ringba-sync-dashboard/`
- Check if JavaScript is executing: Add `console.log` in browser console

## Debugging Commands

```bash
# Check nginx error logs
sudo tail -f /var/log/nginx/error.log

# Check nginx access logs
sudo tail -f /var/log/nginx/access.log

# Test backend directly
curl -v http://localhost:3000/

# Test through nginx
curl -v http://your-domain/ringba-sync-dashboard/

# Check PM2 logs
pm2 logs dashboard --lines 50

# Verify build exists
ls -la dashboard-build/
ls -la dashboard-build/assets/
```

## Complete Nginx Server Block Example

```nginx
upstream ringba-sync-dashboard {
    server 127.0.0.1:3000;
}

server {
    listen 80;
    server_name your-domain.com;

    # Ringba Sync Dashboard - MUST be before root location
    location /ringba-sync-dashboard {
        rewrite ^/ringba-sync-dashboard/?(.*)$ /$1 break;
        proxy_pass http://ringba-sync-dashboard;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
    }

    # Your other locations...
    location / {
        # Your root location
    }
}
```

## Verification Checklist

- [ ] Nginx config syntax is valid (`nginx -t`)
- [ ] Nginx reloaded successfully
- [ ] Backend server is running on port 3000
- [ ] `dashboard-build/` directory exists
- [ ] Assets are accessible: `curl http://localhost:3000/assets/...`
- [ ] API works: `curl http://localhost:3000/api/health`
- [ ] Through nginx: `curl http://your-domain/ringba-sync-dashboard/api/health`
- [ ] Browser console shows no errors
- [ ] Network tab shows all assets loading (200 status)

## Still Not Working?

1. **Check server logs:**
   ```bash
   pm2 logs dashboard
   sudo tail -f /var/log/nginx/error.log
   ```

2. **Verify build:**
   ```bash
   # Rebuild on server
   npm run dashboard:build
   ```

3. **Test direct access:**
   ```bash
   # Bypass nginx, test backend directly
   curl http://localhost:3000/
   ```

4. **Check file permissions:**
   ```bash
   ls -la dashboard-build/
   chmod -R 755 dashboard-build/
   ```

5. **Clear browser cache:**
   - Hard refresh: Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac)
   - Or use incognito/private mode

