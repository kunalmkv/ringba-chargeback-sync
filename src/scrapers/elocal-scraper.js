// Web scraping utilities using functional programming
import puppeteer from 'puppeteer';
import * as R from 'ramda';
import * as E from 'fp-ts/lib/Either.js';
import * as TE from 'fp-ts/lib/TaskEither.js';
import { Config, CampaignCall, AdjustmentDetail } from '../types/schemas.js';

// Browser configuration
const createBrowser = (config) =>
  TE.tryCatch(
    () => puppeteer.launch({
      headless: config.headlessBrowser,
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    }),
    (error) => new Error(`Failed to launch browser: ${error.message}`)
  );

// Page configuration
const configurePage = (page) => (config) =>
  TE.tryCatch(
    async () => {
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
      await page.setDefaultTimeout(config.timeoutMs);
      return page;
    },
    (error) => new Error(`Failed to configure page: ${error.message}`)
  );

// Navigation with retry logic
const navigateWithRetry = (page) => (url) => (maxRetries) =>
  TE.tryCatch(
    async () => {
      let lastError;
      for (let i = 0; i < maxRetries; i++) {
        try {
          await page.goto(url, { waitUntil: 'networkidle2' });
          return page;
        } catch (error) {
          lastError = error;
          if (i < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
          }
        }
      }
      throw lastError;
    },
    (error) => new Error(`Navigation failed after ${maxRetries} retries: ${error.message}`)
  );

// Wait for element with timeout
const waitForElement = (page) => (selector) => (timeout) =>
  TE.tryCatch(
    () => page.waitForSelector(selector, { timeout }),
    (error) => new Error(`Element not found: ${selector} - ${error.message}`)
  );

// Click element with retry
const clickElement = (page) => (selector) => (maxRetries) =>
  TE.tryCatch(
    async () => {
      let lastError;
      for (let i = 0; i < maxRetries; i++) {
        try {
          await page.waitForSelector(selector, { timeout: 5000 });
          await page.click(selector);
          await page.waitForTimeout(1000); // Wait for navigation/loading
          return true;
        } catch (error) {
          lastError = error;
          if (i < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
      throw lastError;
    },
    (error) => new Error(`Click failed for selector: ${selector} - ${error.message}`)
  );

// Extract text from element
const extractText = (page) => (selector) =>
  TE.tryCatch(
    () => page.$eval(selector, el => el.textContent?.trim() || ''),
    (error) => new Error(`Failed to extract text from: ${selector} - ${error.message}`)
  );

// Extract text from multiple elements
const extractTexts = (page) => (selector) =>
  TE.tryCatch(
    () => page.$$eval(selector, elements => 
      elements.map(el => el.textContent?.trim() || '')
    ),
    (error) => new Error(`Failed to extract texts from: ${selector} - ${error.message}`)
  );

// Extract table data
const extractTableData = (page) => (tableSelector) =>
  TE.tryCatch(
    async () => {
      const tableData = await page.evaluate((selector) => {
        const table = document.querySelector(selector);
        if (!table) return [];
        
        const rows = Array.from(table.querySelectorAll('tbody tr'));
        return rows.map(row => {
          const cells = Array.from(row.querySelectorAll('td'));
          return cells.map(cell => cell.textContent?.trim() || '');
        });
      }, tableSelector);
      
      return tableData;
    },
    (error) => new Error(`Failed to extract table data from: ${tableSelector} - ${error.message}`)
  );

// Login to eLocal
const loginToElocal = (page) => (config) =>
  TE.tryCatch(
    async () => {
      // Navigate to the correct login page
      await page.goto(`${config.elocalBaseUrl}/partner_users/login`, { waitUntil: 'networkidle2' });
      
      // Wait for login form to load
      await page.waitForSelector('input[name="partner_user[username]"]', { timeout: 10000 });
      
      // Fill login form with correct selectors
      const usernameField = await page.$('input[name="partner_user[username]"]');
      if (!usernameField) {
        throw new Error('Could not find username field');
      }
      
      console.log('Found username field');
      await usernameField.type(config.elocalUsername);
      
      // Find password field
      const passwordField = await page.$('input[name="partner_user[password]"]');
      if (!passwordField) {
        throw new Error('Could not find password field');
      }
      
      console.log('Found password field');
      await passwordField.type(config.elocalPassword);
      
      // Find submit button
      const submitButton = await page.$('button[type="submit"]');
      if (!submitButton) {
        throw new Error('Could not find submit button');
      }
      
      console.log('Found submit button');
      
      // Submit form
      await submitButton.click();
      
      // Wait for navigation to dashboard
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
      
      // Verify we're logged in by checking URL or page content
      const currentUrl = page.url();
      if (currentUrl.includes('login')) {
        throw new Error('Login failed - still on login page');
      }
      
      console.log(`Login successful! Redirected to: ${currentUrl}`);
      return page;
    },
    (error) => new Error(`Login failed: ${error.message}`)
  );

// Navigate to campaigns page
const navigateToCampaigns = (page) => (config) =>
  TE.tryCatch(
    async () => {
      await page.goto(`${config.elocalBaseUrl}/partner_users`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('table', { timeout: 10000 });
      return page;
    },
    (error) => new Error(`Failed to navigate to campaigns: ${error.message}`)
  );

// Setup download handling for CSV files
const setupDownloadHandler = (page) => (downloadPath) =>
  TE.tryCatch(
    async () => {
      // Set up download behavior
      const client = await page.target().createCDPSession();
      await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadPath
      });
      
      console.log(`Download handler set up. Files will be saved to: ${downloadPath}`);
      return { client, downloadPath };
    },
    (error) => new Error(`Failed to setup download handler: ${error.message}`)
  );

// Click Export Calls button and download CSV
const exportCallsToCSV = (page) => (config) =>
  TE.tryCatch(
    async () => {
      // Wait for the page to fully load
      await page.waitForTimeout(2000);
      
      // Use evaluate to find the button by text content and get its index/selector
      const buttonInfo = await page.evaluate(() => {
        const allElements = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"]'));
        for (let i = 0; i < allElements.length; i++) {
          const el = allElements[i];
          const text = el.textContent?.trim() || el.value?.trim() || '';
          if (text.includes('Export Calls') || (text.includes('Export') && text.includes('Call'))) {
            // Try to find a unique identifier
            const id = el.id || '';
            const className = el.className || '';
            const tagName = el.tagName.toLowerCase();
            return {
              found: true,
              index: i,
              tagName: tagName,
              id: id,
              className: className,
              text: text.substring(0, 50)
            };
          }
        }
        return { found: false };
      });
      
      if (!buttonInfo.found) {
        throw new Error('Could not find Export Calls button on the page');
      }
      
      console.log(`Found Export Calls button: ${buttonInfo.tagName}, text: "${buttonInfo.text}"`);
      
      // Click the button using evaluate (since we can't serialize DOM elements)
      await page.evaluate((index) => {
        const allElements = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"]'));
        if (allElements[index]) {
          allElements[index].click();
        }
      }, buttonInfo.index);
      
      console.log('Clicked Export Calls button');
      
      // Wait for download to start (check for file)
      await page.waitForTimeout(3000);
      
      return { success: true, message: 'Export button clicked successfully' };
    },
    (error) => new Error(`Failed to export calls: ${error.message}`)
  );

// Check if CSV file was downloaded
const checkDownloadedFile = (downloadPath) =>
  TE.tryCatch(
    async () => {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      // List files in download directory
      const files = await fs.readdir(downloadPath);
      
      // Find CSV files (usually named with "calls" or similar)
      const csvFiles = files.filter(file => 
        file.endsWith('.csv') && 
        (file.toLowerCase().includes('call') || file.toLowerCase().includes('campaign'))
      );
      
      if (csvFiles.length === 0) {
        // Check all CSV files
        const allCsvFiles = files.filter(file => file.endsWith('.csv'));
        if (allCsvFiles.length > 0) {
          console.log(`Found CSV files: ${allCsvFiles.join(', ')}`);
          return { 
            success: true, 
            files: allCsvFiles,
            message: 'CSV file(s) downloaded successfully'
          };
        }
        throw new Error('No CSV file found in download directory');
      }
      
      // Get the most recent CSV file
      const mostRecentFile = csvFiles[0];
      const filePath = path.join(downloadPath, mostRecentFile);
      const stats = await fs.stat(filePath);
      
      console.log(`Found downloaded CSV file: ${mostRecentFile} (${stats.size} bytes)`);
      
      return {
        success: true,
        file: mostRecentFile,
        filePath: filePath,
        size: stats.size,
        message: 'CSV file downloaded successfully'
      };
    },
    (error) => new Error(`Failed to check downloaded file: ${error.message}`)
  );

// Set date range on campaign results page
const setDateRange = (page) => (dateRange) => {
  // Capture dateRange in closure for error handler
  const capturedDateRange = dateRange;
  
  return TE.tryCatch(
    async () => {
      // Wait for page to load
      await page.waitForTimeout(2000);
      
      console.log(`Setting date range: ${dateRange.startDateFormatted} to ${dateRange.endDateFormatted}`);
      
      // Find date range inputs (they might be in an input field with calendar icon)
      const dateInputInfo = await page.evaluate((startDate, endDate) => {
        // Look for date input fields - common selectors
        const allInputs = Array.from(document.querySelectorAll('input[type="text"], input[type="date"]'));
        let found = false;
        let dateField = null;
        
        for (const input of allInputs) {
          const placeholder = input.placeholder || '';
          const name = input.name || '';
          const id = input.id || '';
          const className = input.className || '';
          
          // Look for date-related inputs
          if (
            placeholder.toLowerCase().includes('date') ||
            name.toLowerCase().includes('date') ||
            id.toLowerCase().includes('date') ||
            className.toLowerCase().includes('date')
          ) {
            dateField = {
              found: true,
              element: input,
              index: allInputs.indexOf(input),
              selector: input.id ? `#${input.id}` : input.className ? `.${input.className.split(' ')[0]}` : null
            };
            found = true;
            break;
          }
        }
        
        // Also try to find date range display (might be a span or div showing dates)
        const dateDisplays = Array.from(document.querySelectorAll('span, div, input')).filter(el => {
          const text = el.textContent || el.value || '';
          return text.match(/\d{2}\/\d{2}\/\d{4}/) && text.includes('-');
        });
        
        return {
          found: found,
          dateField: dateField,
          dateDisplays: dateDisplays.length,
          inputCount: allInputs.length
        };
      }, dateRange.startDateFormatted, dateRange.endDateFormatted);
      
      // Try to set dates using different methods
      let dateSet = false;
      
      // Method 1: Direct input field manipulation
      const dateInputs = await page.$$('input[type="text"], input[type="date"]');
      for (const input of dateInputs) {
        try {
          const placeholder = await page.evaluate(el => el.placeholder || '', input);
          const name = await page.evaluate(el => el.name || '', input);
          
          if (placeholder.toLowerCase().includes('date') || name.toLowerCase().includes('date')) {
            // Clear and set date
            await input.click({ clickCount: 3 }); // Select all
            await input.type(dateRange.startDateFormatted + ' - ' + dateRange.endDateFormatted);
            dateSet = true;
            console.log('Set date range via input field');
            break;
          }
        } catch (e) {
          // Continue trying other inputs
        }
      }
      
      // Method 2: Use evaluate to find and set date range
      if (!dateSet) {
        const result = await page.evaluate((startDate, endDate) => {
          // Look for date range input (often has format like "MM/DD/YYYY - MM/DD/YYYY")
          const inputs = Array.from(document.querySelectorAll('input'));
          
          for (const input of inputs) {
            const value = input.value || '';
            const placeholder = input.placeholder || '';
            
            // If it looks like a date range input
            if (value.includes('/') || placeholder.toLowerCase().includes('date')) {
              // Try to set the value
              input.value = `${startDate} - ${endDate}`;
              
              // Trigger input events
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              
              return { success: true, method: 'input-value' };
            }
          }
          
          // Try to find date picker button and click it
          const dateButtons = Array.from(document.querySelectorAll('button, a, span, div')).filter(el => {
            const text = el.textContent || '';
            const className = el.className || '';
            return text.match(/\d{2}\/\d{2}\/\d{4}/) || className.toLowerCase().includes('date') || className.toLowerCase().includes('calendar');
          });
          
          if (dateButtons.length > 0) {
            dateButtons[0].click();
            return { success: true, method: 'button-click' };
          }
          
          return { success: false };
        }, dateRange.startDateFormatted, dateRange.endDateFormatted);
        
        if (result.success) {
          dateSet = true;
          console.log(`Set date range via ${result.method}`);
        }
      }
      
      // If we set dates, wait for page to update
      if (dateSet) {
        await page.waitForTimeout(2000);
        
        // Try to trigger form submission or filter if there's a submit button
        // Find and click apply/submit button by text content
        const submitClicked = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"]'));
          const button = buttons.find(btn => {
            const text = btn.textContent?.trim() || btn.value?.trim() || '';
            return text.toLowerCase().includes('apply') || text.toLowerCase().includes('submit');
          });
          
          if (button) {
            button.click();
            return true;
          }
          return false;
        });
        
        if (submitClicked) {
          await page.waitForTimeout(2000);
        }
      } else {
        console.log('⚠️  Could not automatically set date range. The page may already have default dates or requires manual selection.');
        // Don't fail - continue with whatever dates are on the page
      }
      
      // Always return success - even if we couldn't set it automatically
      // The page might already have the correct dates or default dates
      return { success: true, dateSet: dateSet, dateRange };
    },
    (error) => {
      // Log the error but don't fail completely - continue with default dates
      console.warn(`⚠️  Date range setting encountered an issue: ${error.message}. Continuing with default dates.`);
      return { success: true, dateSet: false, dateRange: capturedDateRange, warning: error.message };
    }
  );
};

// Navigate directly to campaign results page with date range parameters
const navigateToCampaignResults = (page) => (config) => (dateRange) => 
  TE.tryCatch(
    async () => {
      // Build URL with date parameters
      // Campaign ID is 50033 for Appliance Repair (from the URL you provided)
      const campaignId = '50033';
      const url = `${config.elocalBaseUrl}/partner_users/campaign_results?caller_phone_number=&end_date=${dateRange.endDateURL}&id=${campaignId}&page=1&start_date=${dateRange.startDateURL}`;
      
      console.log(`Navigating to campaign results with date range: ${dateRange.startDateURL} to ${dateRange.endDateURL}`);
      console.log(`URL: ${url}`);
      
      // Navigate directly to the URL with date parameters
      await page.goto(url, { waitUntil: 'networkidle2' });
      
      // Wait for the table to load
      await page.waitForSelector('table', { timeout: 10000 });
      
      console.log(`Successfully navigated to campaign results page`);
      
      return page;
    },
    (error) => new Error(`Failed to navigate to campaign results: ${error.message}`)
  );

// Build campaign results URL from date range
const buildCampaignResultsUrl = (config) => (dateRange) => {
  const campaignId = '50033';
  return `${config.elocalBaseUrl}/partner_users/campaign_results?caller_phone_number=&end_date=${dateRange.endDateURL}&id=${campaignId}&page=1&start_date=${dateRange.startDateURL}`;
};

// Fetch campaign results HTML via HTTP using current session cookies
export const fetchCampaignResultsHtmlViaHttp = (page) => (config) => (dateRange) =>
  TE.tryCatch(
    async () => {
      const url = buildCampaignResultsUrl(config)(dateRange);
      const cookies = await page.cookies();
      const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

      const headers = {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Referer': `${config.elocalBaseUrl}/partner_users/campaign_results?id=50033`,
        'Cookie': cookieHeader,
      };

      const res = await fetch(url, { method: 'GET', headers });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0,200)}`);
      }
      const html = await res.text();
      return { url, html };
    },
    (error) => new Error(`Failed to fetch campaign results HTML: ${error.message}`)
  );

// Load provided HTML into the current page context for DOM-based extraction
export const loadHtmlIntoPage = (page) => (html) =>
  TE.tryCatch(
    async () => {
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      return true;
    },
    (error) => new Error(`Failed to load HTML into page: ${error.message}`)
  );

// Extract campaign calls data
const extractCampaignCalls = (page) =>
  TE.tryCatch(
    async () => {
      // Wait for calls table
      await page.waitForSelector('table', { timeout: 10000 });
      
      // Listen to console logs from page
      const debugInfo = [];
      page.on('console', msg => {
        const text = msg.text();
        if (text.includes('Found') || text.includes('Header map') || text.includes('No table')) {
          debugInfo.push(text);
        }
      });
      
      const callsData = await page.evaluate(() => {
        const tables = Array.from(document.querySelectorAll('table'));
        let callsTable = null;
        let headerMap = {};
        let debugLog = [];
        
        debugLog.push(`Total tables found: ${tables.length}`);
        
        // Find the calls table by looking for payout column
        for (let i = 0; i < tables.length; i++) {
          const table = tables[i];
          const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent?.trim());
          debugLog.push(`Table ${i} headers: ${headers.join(', ')}`);
          
          // Skip adjustment details table (has "Adjustment Time" header)
          const isAdjustmentTable = headers.some(h => 
            h.includes('Adjustment Time') || h.includes('Adjustment')
          );
          
          if (isAdjustmentTable) {
            debugLog.push(`Skipping table ${i} - adjustment details table (we only extract from main calls table)`);
            continue;
          }
          
          // Skip summary tables (they have headers like "Total", "Unique", "Converted" but no date/caller info)
          const isSummaryTable = headers.some(h => 
            h.includes('Total') && !h.includes('Duration') && !h.includes('Date') && !h.includes('Time')
          ) && !headers.some(h => h.includes('Date') || h.includes('Caller') || h.includes('Time of Call'));
          
          if (isSummaryTable) {
            debugLog.push(`Skipping table ${i} - appears to be summary table`);
            continue;
          }
          
          const payoutIndex = headers.findIndex(h => 
            h.includes('Payout') || h.includes('payout')
          );
          
          if (payoutIndex !== -1) {
            callsTable = table;
            
            // Map column indices
            const dateIndex = headers.findIndex(h => 
              h.includes('Date') || h.includes('Time') || h.includes('date') || h.includes('time')
            );
            const callerIdIndex = headers.findIndex(h => 
              h.includes('Caller ID') || h.includes('Caller') || h.includes('caller')
            );
            const campaignPhoneIndex = headers.findIndex(h => 
              h.includes('Campaign Phone') || h.includes('Campaign Ph') || 
              (h.includes('Phone') && !h.includes('Caller'))
            );
            
            headerMap = {
              dateIndex: dateIndex !== -1 ? dateIndex : 0,
              callerIdIndex: callerIdIndex !== -1 ? callerIdIndex : -1,
              campaignPhoneIndex: campaignPhoneIndex !== -1 ? campaignPhoneIndex : -1,
              payoutIndex: payoutIndex
            };
            
            // If callerId index not found, check if it's combined with campaign phone
            if (headerMap.callerIdIndex === -1) {
              const combinedIndex = headers.findIndex(h => 
                h.includes('Campaign Phone') && h.includes('Caller ID')
              );
              if (combinedIndex !== -1) {
                headerMap.callerIdIndex = combinedIndex;
                headerMap.campaignPhoneIndex = combinedIndex;
              }
            }
            
            debugLog.push(`Using table ${i} with header map: ${JSON.stringify(headerMap)}`);
            break;
          }
        }
        
        if (!callsTable) {
          return { calls: [], debug: debugLog };
        }
        
        const rows = Array.from(callsTable.querySelectorAll('tbody tr'));
        debugLog.push(`Found ${rows.length} rows in calls table`);
        
        const validCalls = rows.map((row, rowIdx) => {
          const cells = Array.from(row.querySelectorAll('td'));
          const data = cells.map(cell => {
            const text = cell.textContent || cell.innerText || '';
            return typeof text === 'string' ? text.trim() : String(text || '').trim();
          });
          
          // Extract date of call
          const dateOfCall = data[headerMap.dateIndex] || '';
          
          // Extract payout (remove $ and convert to number)
          const payoutStr = data[headerMap.payoutIndex] || '$0.00';
          const payout = parseFloat(payoutStr.replace(/[$,]/g, '')) || 0;
          
          // Extract caller ID and campaign phone
          let callerId = '';
          let campaignPhone = '';
          
          if (headerMap.callerIdIndex === headerMap.campaignPhoneIndex && headerMap.callerIdIndex !== -1) {
            // Combined column: extract both from same cell
            const combinedInfo = data[headerMap.callerIdIndex] || '';
            const phoneMatches = combinedInfo.match(/\([0-9]{3}\)\s[0-9]{3}-[0-9]{4}/g);
            if (phoneMatches && phoneMatches.length >= 2) {
              campaignPhone = phoneMatches[0];
              callerId = phoneMatches[1];
            } else if (phoneMatches && phoneMatches.length === 1) {
              // Only one number found, might be caller ID
              callerId = phoneMatches[0];
            }
          } else {
            // Separate columns
            if (headerMap.callerIdIndex !== -1) {
              const callerInfo = data[headerMap.callerIdIndex] || '';
              const callerMatches = callerInfo.match(/\([0-9]{3}\)\s[0-9]{3}-[0-9]{4}/g);
              if (callerMatches && callerMatches.length > 0) {
                callerId = callerMatches[callerMatches.length - 1]; // Last match is usually caller ID
              }
            }
            
            if (headerMap.campaignPhoneIndex !== -1) {
              const phoneInfo = data[headerMap.campaignPhoneIndex] || '';
              const phoneMatches = phoneInfo.match(/\([0-9]{3}\)\s[0-9]{3}-[0-9]{4}/g);
              if (phoneMatches && phoneMatches.length > 0) {
                campaignPhone = phoneMatches[0];
              }
            }
          }
          
          // Default campaign phone if not found (from URL or known value)
          if (!campaignPhone) {
            campaignPhone = '(877) 834-1273'; // Default for Appliance Repair campaign
          }
          
          // Only return rows with valid caller ID
          if (!callerId) {
            return null;
          }
          
          return {
            dateOfCall,
            campaignPhone,
            callerId,
            payout
          };
        }).filter(row => row !== null); // Remove invalid rows
        
        return { calls: validCalls, debug: debugLog };
      });
      
      // Log debug info
      if (callsData.debug && callsData.debug.length > 0) {
        console.log('[DEBUG] Table extraction:', callsData.debug.join('\n'));
      }
      
      return callsData.calls || [];
    },
    (error) => new Error(`Failed to extract campaign calls: ${error.message}`)
  );

// Scraping operations composition
export const scrapingOps = (config) => ({
  createBrowser: () => createBrowser(config),
  configurePage: configurePage,
  navigateWithRetry: navigateWithRetry,
  waitForElement: waitForElement,
  clickElement: clickElement,
  extractText: extractText,
  extractTexts: extractTexts,
  extractTableData: extractTableData,
  loginToElocal: (page) => loginToElocal(page)(config),
  navigateToCampaigns: (page) => navigateToCampaigns(page)(config),
  navigateToCampaignResults: (page) => (dateRange) => navigateToCampaignResults(page)(config)(dateRange),
  clickApplianceRepairCampaign: (page) => clickApplianceRepairCampaign(page)(config),
  setDateRange: setDateRange,
  extractCampaignCalls: extractCampaignCalls,
  setupDownloadHandler: setupDownloadHandler,
  exportCallsToCSV: (page) => exportCallsToCSV(page)(config),
  checkDownloadedFile: checkDownloadedFile,
  captureExportCsvRequest: captureExportCsvRequest,
  downloadCsvViaHttp: downloadCsvViaHttp,
  fetchCampaignResultsHtmlViaHttp: (page) => (dateRange) => fetchCampaignResultsHtmlViaHttp(page)(config)(dateRange),
  loadHtmlIntoPage: (page) => (html) => loadHtmlIntoPage(page)(html),
});

// Capture the CSV request triggered by the Export Calls button and return URL+headers
export const captureExportCsvRequest = (page) =>
  TE.tryCatch(
    async () => {
      let captured = null;
      const csvPredicate = (url) => url.includes('.csv') && url.includes('campaign_results');

      const onRequest = (req) => {
        const url = req.url();
        if (csvPredicate(url)) {
          captured = { url, method: req.method(), headers: req.headers() };
        }
      };

      page.on('request', onRequest);
      // Wait briefly for any in-flight requests (the caller should click the button before calling this)
      const waitForCapture = async () => {
        const started = Date.now();
        while (!captured && Date.now() - started < 10000) {
          await new Promise((r) => setTimeout(r, 200));
        }
        return captured;
      };

      const result = await waitForCapture();
      page.off('request', onRequest);

      if (!result) throw new Error('CSV request was not observed');
      return result;
    },
    (error) => new Error(`Failed to capture CSV request: ${error.message}`)
  );

// Download CSV directly via HTTP using the cookies from the current page/session
export const downloadCsvViaHttp = (page) => (downloadPath) => (csvRequest) =>
  TE.tryCatch(
    async () => {
      const fs = await import('fs');
      const path = await import('path');

      const cookies = await page.cookies();
      const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

      const headers = {
        ...(csvRequest.headers || {}),
        Cookie: cookieHeader,
        // Ensure reasonable defaults
        'User-Agent': csvRequest.headers?.['user-agent'] || 'Mozilla/5.0',
        Accept: 'text/csv,application/octet-stream,*/*;q=0.8',
      };

      // Use global fetch (Node 18+). If unavailable, we'd switch to https/axios.
      const res = await fetch(csvRequest.url, { method: 'GET', headers });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} when downloading CSV`);
      }

      // Ensure download dir exists
      await fs.promises.mkdir(downloadPath, { recursive: true });
      const fileName = `campaign_results_${Date.now()}.csv`;
      const filePath = path.join(downloadPath, fileName);

      const fileStream = fs.createWriteStream(filePath);
      await new Promise((resolve, reject) => {
        res.body.pipe(fileStream);
        res.body.on('error', reject);
        fileStream.on('finish', resolve);
      });

      const stat = await fs.promises.stat(filePath);
      return { file: fileName, size: stat.size, path: filePath };
    },
    (error) => new Error(`Direct CSV download failed: ${error.message}`)
  );
