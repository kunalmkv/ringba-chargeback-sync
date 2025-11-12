# Fixing 502 API Error

## Problem
Getting 502 Bad Gateway error when accessing:
`https://insidefi.co/ringba-sync-dashboard/api/history?limit=20`

## Root Cause
502 error means Nginx cannot reach the Node.js dashboard server.

## Solution Steps

### Step 1: Verify Dashboard Server is Running

```bash
# Check PM2 status
pm2 list

# Check dashboard logs
pm2 logs dashboard

# If not running, start it
pm2 start ecosystem.config.js --only dashboard
```

### Step 2: Test API Directly (Bypass Nginx)

```bash
# Test if Node.js server is responding
curl http://127.0.0.1:3000/api/health

# Should return JSON, not connection error
```

### Step 3: Check Server is Listening

```bash
# Check if port 3000 is listening
netstat -tlnp | grep 3000
# Or
ss -tlnp | grep 3000

# Should show: 127.0.0.1:3000 or 0.0.0.0:3000
```

### Step 4: Update Nginx Configuration

Edit `/etc/nginx/sites-enabled/insidefi.co` and update the API location block:

```nginx
# API routes - proxy to Node.js server
location /ringba-sync-dashboard/api {
    # Strip the /ringba-sync-dashboard prefix and proxy to Node.js
    rewrite ^/ringba-sync-dashboard/api(/.*)$ /api$1 break;
    proxy_pass http://127.0.0.1:3000;  # Direct IP:port instead of upstream
    proxy_http_version 1.1;
    
    # Standard proxy headers
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # Timeouts
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
    
    # Don't buffer responses
    proxy_buffering off;
}
```

### Step 5: Test and Reload Nginx

```bash
# Test configuration
sudo nginx -t

# If test passes, reload
sudo systemctl reload nginx

# Check error logs
sudo tail -f /var/log/nginx/error.log
```

### Step 6: Verify API Works

```bash
# Test through Nginx
curl http://localhost/ringba-sync-dashboard/api/health

# Should return JSON response
```

## Common Issues

### Issue 1: Server Not Running
**Solution:**
```bash
pm2 start ecosystem.config.js --only dashboard
pm2 save
```

### Issue 2: Wrong Port
**Check:** `dashboard-server.js` uses `process.env.DASHBOARD_PORT || 3000`
**Solution:** Ensure Nginx proxy_pass matches the port

### Issue 3: Connection Refused
**Check Nginx error log:**
```bash
sudo tail -f /var/log/nginx/error.log
```
**Look for:** `connect() failed (111: Connection refused)`

**Solution:** Start the dashboard server

### Issue 4: Timeout
**Check:** Server might be slow to respond
**Solution:** Increase timeouts in Nginx config

## Verification Checklist

- [ ] Dashboard server is running (`pm2 list`)
- [ ] Server is listening on port 3000 (`netstat -tlnp | grep 3000`)
- [ ] Direct API test works (`curl http://127.0.0.1:3000/api/health`)
- [ ] Nginx config is correct (`sudo nginx -t`)
- [ ] Nginx reloaded (`sudo systemctl reload nginx`)
- [ ] API works through Nginx (`curl http://localhost/ringba-sync-dashboard/api/health`)

## Quick Fix Command

```bash
# Restart dashboard server
pm2 restart dashboard

# Update Nginx and reload (if config changed)
sudo nginx -t && sudo systemctl reload nginx

# Test
curl http://localhost/ringba-sync-dashboard/api/health
```

