# Static Dashboard Serving Setup Guide

This guide shows how to serve the React dashboard statically using Nginx instead of the Node.js server.

## Step 1: Build the React App

```bash
cd dashboard-react
npm install  # (if not already done)
npm run build
```

This creates the build files in `dashboard-build/` directory.

## Step 2: Create Directory on Server

```bash
# Create the directory
sudo mkdir -p /var/www/ringba-sync-dashboard

# Set ownership (replace $USER with your username)
sudo chown -R $USER:$USER /var/www/ringba-sync-dashboard
```

## Step 3: Copy Build Files to Server

### Option A: Using SCP (from local machine)
```bash
scp -r dashboard-build/* user@server:/var/www/ringba-sync-dashboard/
```

### Option B: On the server (if files are already there)
```bash
# Navigate to your project directory
cd /path/to/ringba-chargeback-sync

# Copy build files
cp -r dashboard-build/* /var/www/ringba-sync-dashboard/
```

## Step 4: Set Permissions

```bash
# Set ownership to web server user (usually www-data or nginx)
sudo chown -R www-data:www-data /var/www/ringba-sync-dashboard

# Set permissions
sudo chmod -R 755 /var/www/ringba-sync-dashboard
```

## Step 5: Update Nginx Configuration

Edit your Nginx config file (usually `/etc/nginx/sites-enabled/insidefi.co`):

```nginx
server {
    listen 80;
    server_name insidefi.co;

    # Static dashboard files
    location /ringba-sync-dashboard {
        alias /var/www/ringba-sync-dashboard;
        index index.html;
        try_files $uri $uri/ /ringba-sync-dashboard/index.html;
        
        # Cache static assets
        location ~* \.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf)$ {
            expires 7d;
            add_header Cache-Control "public, immutable";
            access_log off;
        }
        
        # Don't cache HTML
        location ~* \.html$ {
            add_header Cache-Control "no-cache, no-store, must-revalidate";
            add_header Pragma "no-cache";
            add_header Expires "0";
        }
    }

    # API routes - proxy to Node.js server
    location /ringba-sync-dashboard/api {
        rewrite ^/ringba-sync-dashboard/api(/.*)$ /api$1 break;
        proxy_pass http://ringba-sync-dashboard;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Other locations...
}
```

## Step 6: Test and Reload Nginx

```bash
# Test configuration
sudo nginx -t

# If test passes, reload Nginx
sudo systemctl reload nginx
```

## Step 7: Verify

1. Check if files are accessible:
   ```bash
   ls -la /var/www/ringba-sync-dashboard/
   ```

2. Test in browser:
   - Visit: `http://insidefi.co/ringba-sync-dashboard`
   - Check browser console (F12) for errors
   - Check Network tab for asset loading

3. Test API:
   - Visit: `http://insidefi.co/ringba-sync-dashboard/api/health`
   - Should return JSON response

## Troubleshooting

### Files not found (404)
- Check file permissions: `ls -la /var/www/ringba-sync-dashboard/`
- Check Nginx error log: `sudo tail -f /var/log/nginx/error.log`
- Verify path in Nginx config matches actual directory

### Blank page
- Check browser console (F12) for JavaScript errors
- Verify assets are loading (Network tab)
- Check if base tag is correct in index.html

### API not working
- Verify Node.js server is running: `pm2 status`
- Check proxy_pass URL in Nginx config
- Test API directly: `curl http://localhost:3000/api/health`

## Maintenance

### Update Dashboard
When you update the dashboard:

```bash
# 1. Rebuild
cd dashboard-react
npm run build

# 2. Copy new files
cp -r dashboard-build/* /var/www/ringba-sync-dashboard/

# 3. Set permissions (if needed)
sudo chown -R www-data:www-data /var/www/ringba-sync-dashboard
```

### Backup
```bash
# Backup current build
sudo cp -r /var/www/ringba-sync-dashboard /var/www/ringba-sync-dashboard.backup
```

