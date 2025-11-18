// Service to refresh auth cookies every 7 days using a one-time Puppeteer login
import * as TE from 'fp-ts/lib/TaskEither.js';
import puppeteer from 'puppeteer';
import { scrapingOps } from '../scrapers/elocal-scraper.js';
import { writeSession, createSessionFromCookies } from '../auth/session-store.js';

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

export const refreshAuthSession = (config) =>
  TE.tryCatch(
    async () => {
      console.log('[Auth Refresh] Starting auth session refresh...');
      
      // Launch browser in headless mode for Ubuntu server
      // Try to use system Chromium first, fallback to Puppeteer's bundled Chromium
      const fs = await import('fs');
      const possiblePaths = [
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/snap/bin/chromium'
      ];
      
      let executablePath = undefined;
      for (const path of possiblePaths) {
        try {
          if (fs.existsSync(path)) {
            executablePath = path;
            console.log(`[Auth Refresh] Using system browser: ${path}`);
            break;
          }
        } catch (e) {
          // Continue to next path
        }
      }
      
      if (!executablePath) {
        console.log('[Auth Refresh] Using Puppeteer bundled Chromium (system browser not found)');
      }
      
      const launchOptions = {
        headless: "new",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--disable-gpu",
        ],
      };
      
      // Only set executablePath if system browser found
      if (executablePath) {
        launchOptions.executablePath = executablePath;
      }
      
      const browser = await puppeteer.launch(launchOptions);
      
      try {
        const page = await browser.newPage();
        
        // Configure page
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setDefaultTimeout(config.timeoutMs || 20000);
        
        console.log('[Auth Refresh] Browser configured, navigating to login page...');
        
        // Use scraper's login function
        const scraper = scrapingOps(config);
        await TE.getOrElse(() => { 
          throw new Error('Login failed'); 
        })(scraper.loginToElocal(page))();

        console.log('[Auth Refresh] Login successful, capturing cookies...');

        // After login, capture cookies
        const cookies = await page.cookies();
        const session = createSessionFromCookies(cookies, THREE_DAYS_MS);
        await writeSession(session);
        
        console.log(`[Auth Refresh] Session saved. Expires at: ${new Date(session.expiresAt).toISOString()}`);
        
        return { success: true, expiresAt: session.expiresAt };
      } catch (error) {
        console.error(`[Auth Refresh] Error during login process: ${error.message}`);
        throw error;
      } finally {
        await browser.close();
        console.log('[Auth Refresh] Browser closed');
      }
    },
    (error) => {
      const errorMsg = `Auth session refresh failed: ${error.message}`;
      console.error(`[Auth Refresh] ${errorMsg}`);
      if (error.stack) {
        console.error(`[Auth Refresh] Stack trace: ${error.stack}`);
      }
      return new Error(errorMsg);
    }
  );


