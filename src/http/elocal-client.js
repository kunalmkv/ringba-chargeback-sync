// HTTP client to fetch campaign results HTML using saved cookies
import { readSession, isSessionValid } from '../auth/session-store.js';
import { detectPagination } from '../scrapers/html-extractor.js';

const defaultHeaders = (referer) => ({
  'User-Agent': 'Mozilla/5.0',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Referer': referer,
});

export const buildCampaignResultsUrl = (baseUrl, dateRange, campaignId = '50033', page = 1) =>
  `${baseUrl}/partner_users/campaign_results?caller_phone_number=&end_date=${dateRange.endDateURL}&id=${campaignId}&page=${page}&start_date=${dateRange.startDateURL}`;

export const fetchCampaignResultsHtmlWithSavedSession = async (config, dateRange, campaignId = '50033', page = 1) => {
  const session = await readSession();
  if (!isSessionValid(session)) {
    const err = new Error('Saved auth session is missing or expired');
    err.code = 'SESSION_INVALID';
    throw err;
  }

  const url = buildCampaignResultsUrl(config.elocalBaseUrl, dateRange, campaignId, page);
  const headers = {
    ...defaultHeaders(`${config.elocalBaseUrl}/partner_users/campaign_results?id=${campaignId}`),
    Cookie: session.cookieHeader,
  };

  const res = await fetch(url, { method: 'GET', headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status} ${res.statusText}`);
    err.details = text.slice(0, 300);
    throw err;
  }
  return { url, html: await res.text(), page };
};

// Fetch all pages of campaign results
export const fetchAllCampaignResultsPages = async (config, dateRange, campaignId = '50033', includeAdjustments = true) => {
  const session = await readSession();
  if (!isSessionValid(session)) {
    const err = new Error('Saved auth session is missing or expired');
    err.code = 'SESSION_INVALID';
    throw err;
  }

  const allCalls = [];
  const allAdjustments = [];
  let currentPage = 1;
  let totalPages = null;
  let hasMorePages = true;
  let consecutiveEmptyPages = 0;
  const MAX_CONSECUTIVE_EMPTY_PAGES = 3;

  console.log(`[INFO] Starting paginated data fetch for campaign ${campaignId}${includeAdjustments ? ' (with adjustments)' : ' (no adjustments)'}...`);

  while (hasMorePages) {
    try {
      console.log(`[INFO] Fetching page ${currentPage}...`);
      const fetched = await fetchCampaignResultsHtmlWithSavedSession(config, dateRange, campaignId, currentPage);
      
      // Detect pagination from first page
      if (currentPage === 1) {
        const paginationInfo = detectPagination(fetched.html);
        totalPages = paginationInfo.totalPages;
        console.log(`[INFO] Detected pagination: ${paginationInfo.hasPagination ? `${totalPages} pages` : 'single page'}`);
        
        // If no pagination detected and totalPages is 1, we'll still try page 2
        // to be safe (in case pagination detection missed it)
        // We'll stop if page 2 has no data
        if (!paginationInfo.hasPagination && totalPages === 1) {
          // Don't set hasMorePages to false yet - try page 2 first
          totalPages = null; // Will be discovered dynamically
        }
      }

      // Extract data from current page
      const { extractCampaignCallsFromHtml, extractAdjustmentDetailsFromHtml } = await import('../scrapers/html-extractor.js');
      const pageCalls = extractCampaignCallsFromHtml(fetched.html);
      const pageAdjustments = includeAdjustments ? extractAdjustmentDetailsFromHtml(fetched.html) : [];
      
      // A page is considered "empty" if it has no calls
      // For STATIC category, we still collect adjustments, but we stop pagination based on calls
      // For API category, we only care about calls
      const isPageEmptyForCalls = pageCalls.length === 0;
      
      console.log(`[INFO] Page ${currentPage}: Found ${pageCalls.length} calls${includeAdjustments ? `, ${pageAdjustments.length} adjustments` : ' (adjustments skipped)'}`);
      
      // Track consecutive empty pages (based on calls only)
      // Stop pagination if we hit 3 consecutive pages with no calls
      if (isPageEmptyForCalls) {
        consecutiveEmptyPages++;
        console.log(`[INFO] Page ${currentPage} has no calls (${consecutiveEmptyPages} consecutive page${consecutiveEmptyPages !== 1 ? 's' : ''} without calls)`);
      } else {
        // Reset counter if page has calls
        consecutiveEmptyPages = 0;
        allCalls.push(...pageCalls);
        if (includeAdjustments) {
          allAdjustments.push(...pageAdjustments);
        }
      }

      // Check if we should continue
      if (totalPages !== null) {
        // We know the total number of pages
        if (currentPage >= totalPages) {
          hasMorePages = false;
        } else if (consecutiveEmptyPages >= MAX_CONSECUTIVE_EMPTY_PAGES) {
          // Stop if we hit 3 consecutive empty pages (even if totalPages suggests more)
          console.log(`[INFO] Stopping pagination: Found ${consecutiveEmptyPages} consecutive empty pages`);
          hasMorePages = false;
        } else {
          currentPage++;
        }
      } else {
        // We don't know total pages - check consecutive empty pages
        if (consecutiveEmptyPages >= MAX_CONSECUTIVE_EMPTY_PAGES) {
          // Stop after 3 consecutive empty pages
          console.log(`[INFO] Stopping pagination: Found ${consecutiveEmptyPages} consecutive empty pages`);
          hasMorePages = false;
        } else {
          // Try next page
          currentPage++;
          // Safety limit: don't fetch more than 100 pages
          if (currentPage > 100) {
            console.warn('[WARN] Reached safety limit of 100 pages. Stopping pagination.');
            hasMorePages = false;
          }
        }
      }

      // Small delay between page requests to avoid rate limiting
      if (hasMorePages) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error(`[ERROR] Failed to fetch page ${currentPage}:`, error.message);
      // If it's the first page, throw the error
      if (currentPage === 1) {
        throw error;
      }
      // Otherwise, assume we've reached the end
      hasMorePages = false;
    }
  }

  console.log(`[INFO] Completed paginated fetch: ${currentPage - 1} page(s), ${allCalls.length} total calls, ${allAdjustments.length} total adjustments`);

  return {
    calls: allCalls,
    adjustments: allAdjustments,
    pagesFetched: currentPage - 1
  };
};


