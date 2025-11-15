// Script to fetch elocal data for 2025-11-14 and save all HTML responses for debugging
import { createConfig } from './src/index.js';
import { initializeDatabase } from './src/database/sqlite-operations.js';
import { formatDateForElocal, formatDateForURL } from './src/utils/date-utils.js';
import * as TE from 'fp-ts/lib/TaskEither.js';
import * as E from 'fp-ts/lib/Either.js';
import { optimizedConfig } from './src/config/optimized-config.js';
import { readSession, isSessionValid } from './src/auth/session-store.js';
import { fetchCampaignResultsHtmlWithSavedSession } from './src/http/elocal-client.js';
import { detectPagination } from './src/scrapers/html-extractor.js';
import { extractCampaignCallsFromHtml, extractAdjustmentDetailsFromHtml } from './src/scrapers/html-extractor.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TARGET_DATE = '2025-11-14';
const DEBUG_DIR = path.join(__dirname, 'debug-html-responses', TARGET_DATE);

// Ensure debug directory exists
const ensureDebugDir = async (category) => {
  const categoryDir = path.join(DEBUG_DIR, category.toLowerCase());
  await fs.mkdir(categoryDir, { recursive: true });
  return categoryDir;
};

// Save HTML response to file
const saveHtmlResponse = async (category, page, html, url, callsCount, adjustmentsCount) => {
  const categoryDir = await ensureDebugDir(category);
  const filename = `page-${String(page).padStart(3, '0')}_calls-${callsCount}_adjustments-${adjustmentsCount}.html`;
  const filepath = path.join(categoryDir, filename);
  
  // Create a metadata file with URL and stats
  const metadata = {
    category,
    page,
    url,
    callsCount,
    adjustmentsCount,
    timestamp: new Date().toISOString(),
    htmlSize: html.length
  };
  
  await fs.writeFile(filepath, html, 'utf8');
  await fs.writeFile(
    path.join(categoryDir, `page-${String(page).padStart(3, '0')}_metadata.json`),
    JSON.stringify(metadata, null, 2),
    'utf8'
  );
  
  console.log(`[DEBUG] Saved HTML: ${filepath}`);
  return filepath;
};

// Fetch all pages with HTML saving
const fetchAllPagesWithDebug = async (config, dateRange, campaignId, category, includeAdjustments) => {
  const session = await readSession();
  if (!isSessionValid(session)) {
    throw new Error('Saved auth session is missing or expired');
  }

  const allCalls = [];
  const allAdjustments = [];
  let currentPage = 1;
  let totalPages = null;
  let hasMorePages = true;
  let consecutiveEmptyPages = 0;
  const MAX_CONSECUTIVE_EMPTY_PAGES = 3;
  
  const savedFiles = [];

  console.log(`\n[INFO] Starting paginated data fetch for ${category} category (Campaign ${campaignId})...`);
  console.log(`[INFO] Include adjustments: ${includeAdjustments}`);
  console.log(`[INFO] Debug directory: ${path.join(DEBUG_DIR, category.toLowerCase())}\n`);

  while (hasMorePages) {
    try {
      console.log(`[INFO] Fetching page ${currentPage}...`);
      const fetched = await fetchCampaignResultsHtmlWithSavedSession(config, dateRange, campaignId, currentPage);
      
      // Extract data from current page
      const pageCalls = extractCampaignCallsFromHtml(fetched.html);
      const pageAdjustments = includeAdjustments ? extractAdjustmentDetailsFromHtml(fetched.html) : [];
      
      // Save HTML response
      const savedFile = await saveHtmlResponse(
        category,
        currentPage,
        fetched.html,
        fetched.url,
        pageCalls.length,
        pageAdjustments.length
      );
      savedFiles.push(savedFile);
      
      // Detect pagination from first page
      if (currentPage === 1) {
        const paginationInfo = detectPagination(fetched.html);
        totalPages = paginationInfo.totalPages;
        console.log(`[INFO] Detected pagination: ${paginationInfo.hasPagination ? `${totalPages} pages` : 'single page'}`);
        
        if (!paginationInfo.hasPagination && totalPages === 1) {
          totalPages = null;
        }
      }
      
      const isPageEmptyForCalls = pageCalls.length === 0;
      
      console.log(`[INFO] Page ${currentPage}: Found ${pageCalls.length} calls${includeAdjustments ? `, ${pageAdjustments.length} adjustments` : ' (adjustments skipped)'}`);
      
      if (isPageEmptyForCalls) {
        consecutiveEmptyPages++;
        console.log(`[INFO] Page ${currentPage} has no calls (${consecutiveEmptyPages} consecutive page${consecutiveEmptyPages !== 1 ? 's' : ''} without calls)`);
      } else {
        consecutiveEmptyPages = 0;
        allCalls.push(...pageCalls);
        if (includeAdjustments) {
          allAdjustments.push(...pageAdjustments);
        }
      }

      // Check if we should continue
      if (totalPages !== null) {
        if (currentPage >= totalPages) {
          hasMorePages = false;
        } else if (consecutiveEmptyPages >= MAX_CONSECUTIVE_EMPTY_PAGES) {
          console.log(`[INFO] Stopping pagination: Found ${consecutiveEmptyPages} consecutive empty pages`);
          hasMorePages = false;
        } else {
          currentPage++;
        }
      } else {
        if (consecutiveEmptyPages >= MAX_CONSECUTIVE_EMPTY_PAGES) {
          console.log(`[INFO] Stopping pagination: Found ${consecutiveEmptyPages} consecutive empty pages`);
          hasMorePages = false;
        } else {
          currentPage++;
          if (currentPage > 100) {
            console.warn('[WARN] Reached safety limit of 100 pages. Stopping pagination.');
            hasMorePages = false;
          }
        }
      }

      // Small delay between page requests
      if (hasMorePages) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error(`[ERROR] Failed to fetch page ${currentPage}:`, error.message);
      if (currentPage === 1) {
        throw error;
      }
      hasMorePages = false;
    }
  }

  console.log(`\n[INFO] Completed paginated fetch: ${currentPage - 1} page(s), ${allCalls.length} total calls, ${allAdjustments.length} total adjustments`);
  console.log(`[INFO] Saved ${savedFiles.length} HTML files for debugging\n`);

  return {
    calls: allCalls,
    adjustments: allAdjustments,
    pagesFetched: currentPage - 1,
    savedFiles
  };
};

// Get date range for 2025-11-14
const getDateRange = () => {
  const date = new Date(TARGET_DATE);
  date.setHours(0, 0, 0, 0);
  
  const endDate = new Date(date);
  endDate.setHours(23, 59, 59, 999);
  
  return {
    startDate: date,
    endDate: endDate,
    startDateFormatted: formatDateForElocal(date),
    endDateFormatted: formatDateForElocal(date),
    startDateURL: formatDateForURL(date),
    endDateURL: formatDateForURL(date),
    days: 1
  };
};

// Create summary file
const createSummary = async (category, results, dateRange) => {
  const categoryDir = await ensureDebugDir(category);
  const summary = {
    category,
    date: TARGET_DATE,
    dateRange: {
      start: dateRange.startDateFormatted,
      end: dateRange.endDateFormatted
    },
    campaignId: category === 'API' ? '46775' : '50033',
    pagesFetched: results.pagesFetched,
    totalCalls: results.calls.length,
    totalAdjustments: results.adjustments.length,
    totalPayout: results.calls.reduce((sum, call) => sum + (parseFloat(call.payout) || 0), 0),
    savedFiles: results.savedFiles.map(f => path.basename(f)),
    calls: results.calls.map(call => ({
      caller_id: call.callerId,
      date_of_call: call.dateOfCall,
      payout: call.payout,
      classification: call.classification,
      city_state: call.cityState
    })),
    adjustments: results.adjustments.map(adj => ({
      caller_id: adj.callerId,
      date_of_call: adj.dateOfCall,
      adjustment_amount: adj.adjustmentAmount,
      adjustment_classification: adj.adjustmentClassification
    }))
  };
  
  const summaryPath = path.join(categoryDir, 'summary.json');
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`[DEBUG] Saved summary: ${summaryPath}`);
  
  return summaryPath;
};

const main = async () => {
  try {
    console.log('========================================');
    console.log(`Debug Fetch for ${TARGET_DATE}`);
    console.log('========================================\n');
    console.log(`This script will fetch data for both STATIC and API categories`);
    console.log(`and save all HTML responses to: ${DEBUG_DIR}\n`);
    
    const config = createConfig();
    const validConfig = E.fold(
      (error) => {
        console.error('[ERROR] Configuration validation failed:', error.message);
        process.exit(1);
        return null;
      },
      (cfg) => cfg
    )(optimizedConfig.validate(config));
    
    if (!validConfig) {
      process.exit(1);
    }
    
    // Initialize database
    await TE.getOrElse(() => {
      throw new Error('Failed to initialize database');
    })(initializeDatabase(validConfig))();
    
    const dateRange = getDateRange();
    console.log(`[INFO] Date range: ${dateRange.startDateFormatted} to ${dateRange.endDateFormatted} (1 day)\n`);
    
    // Fetch STATIC category
    console.log('========================================');
    console.log('Fetching STATIC Category');
    console.log('========================================\n');
    
    const staticResults = await fetchAllPagesWithDebug(
      validConfig,
      dateRange,
      '50033',
      'STATIC',
      true // include adjustments
    );
    
    await createSummary('STATIC', staticResults, dateRange);
    
    console.log('\n✅ STATIC category completed');
    console.log(`   Total calls: ${staticResults.calls.length}`);
    console.log(`   Total adjustments: ${staticResults.adjustments.length}`);
    console.log(`   Total payout: $${staticResults.calls.reduce((sum, call) => sum + (parseFloat(call.payout) || 0), 0).toFixed(2)}`);
    console.log(`   Pages fetched: ${staticResults.pagesFetched}`);
    console.log(`   HTML files saved: ${staticResults.savedFiles.length}\n`);
    
    // Wait a bit between categories
    console.log('[INFO] Waiting 2 seconds before fetching API category...\n');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Fetch API category
    console.log('========================================');
    console.log('Fetching API Category');
    console.log('========================================\n');
    
    const apiResults = await fetchAllPagesWithDebug(
      validConfig,
      dateRange,
      '46775',
      'API',
      false // no adjustments
    );
    
    await createSummary('API', apiResults, dateRange);
    
    console.log('\n✅ API category completed');
    console.log(`   Total calls: ${apiResults.calls.length}`);
    console.log(`   Total adjustments: ${apiResults.adjustments.length}`);
    console.log(`   Total payout: $${apiResults.calls.reduce((sum, call) => sum + (parseFloat(call.payout) || 0), 0).toFixed(2)}`);
    console.log(`   Pages fetched: ${apiResults.pagesFetched}`);
    console.log(`   HTML files saved: ${apiResults.savedFiles.length}\n`);
    
    // Final summary
    console.log('========================================');
    console.log('Final Summary');
    console.log('========================================\n');
    console.log(`STATIC: ${staticResults.calls.length} calls, $${staticResults.calls.reduce((sum, call) => sum + (parseFloat(call.payout) || 0), 0).toFixed(2)} total`);
    console.log(`API: ${apiResults.calls.length} calls, $${apiResults.calls.reduce((sum, call) => sum + (parseFloat(call.payout) || 0), 0).toFixed(2)} total`);
    console.log(`\nAll HTML responses saved to: ${DEBUG_DIR}`);
    console.log(`\nYou can now inspect the HTML files to debug any data discrepancies.\n`);
    
    process.exit(0);
  } catch (error) {
    console.error('[ERROR] Script failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
};

main();

