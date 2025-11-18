# Ubuntu Server - Missing Chromium Dependencies

## Error
```
libatk-1.0.so.0: cannot open shared object file: No such file or directory
```

This means Puppeteer's bundled Chromium is missing required system libraries.

## Solution: Install Chromium Dependencies

Run these commands on your Ubuntu server:

```bash
sudo apt-get update
sudo apt-get install -y \
  ca-certificates \
  fonts-liberation \
  libappindicator3-1 \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libc6 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libexpat1 \
  libfontconfig1 \
  libgbm1 \
  libgcc1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libstdc++6 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  lsb-release \
  wget \
  xdg-utils
```

## Alternative: Install System Chromium

If you prefer to use system Chromium instead of Puppeteer's bundled version:

```bash
sudo apt-get update
sudo apt-get install -y chromium-browser
```

Then we can update the code to use system Chromium as a fallback.

## After Installing Dependencies

Try running the auth refresh service again:

```bash
npm run refresh-auth
```

## Verify Installation

To check if the dependencies are installed:

```bash
ldd /home/adityaharsh/.cache/puppeteer/chrome/linux-142.0.7444.61/chrome-linux64/chrome | grep "not found"
```

If this shows any "not found" libraries, those need to be installed.

