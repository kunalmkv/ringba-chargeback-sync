import { load as cheerioLoad } from 'cheerio';

export const extractCampaignCallsFromHtml = (html) => {
  const $ = cheerioLoad(html);
  const tables = $('table').toArray();
  let callsTable = null;
  let headerMap = null;

  const getHeaders = (table) => $(table).find('th').toArray().map(th => $(th).text().trim());

  for (let i = 0; i < tables.length; i++) {
    const headers = getHeaders(tables[i]);
    const isAdjustment = headers.some(h => h.includes('Adjustment Time') || h.includes('Adjustment'));
    const isSummary = headers.some(h => h.includes('Total')) && !headers.some(h => h.includes('Date') || h.includes('Time'));
    if (isAdjustment || isSummary) continue;

    // Look for either "payout" or "call price" column (API category uses "call price")
    const payoutIndex = headers.findIndex(h => /payout/i.test(h) || /call\s*price/i.test(h) || /price/i.test(h));
    if (payoutIndex === -1) continue;

    const dateIndex = headers.findIndex(h => /(Date|Time)/i.test(h));
    let callerIdIndex = headers.findIndex(h => /Caller ID/i.test(h));
    let campaignPhoneIndex = headers.findIndex(h => /(Campaign Phone|Campaign Ph)/i.test(h));
    if (callerIdIndex === -1 && campaignPhoneIndex === -1) {
      const combinedIndex = headers.findIndex(h => /Campaign Phone/i.test(h) && /Caller ID/i.test(h));
      if (combinedIndex !== -1) {
        callerIdIndex = combinedIndex;
        campaignPhoneIndex = combinedIndex;
      }
    }

    callsTable = tables[i];
    headerMap = { dateIndex: dateIndex !== -1 ? dateIndex : 0, callerIdIndex, campaignPhoneIndex, payoutIndex };
    break;
  }

  if (!callsTable || !headerMap) return [];

  const rows = $(callsTable).find('tbody tr').toArray();
  const calls = [];
  for (const row of rows) {
    const cells = $(row).find('td').toArray().map(td => $(td).text().trim());
    const dateOfCall = cells[headerMap.dateIndex] || '';
    const payoutStr = cells[headerMap.payoutIndex] || '$0.00';
    const payout = parseFloat(payoutStr.replace(/[$,]/g, '')) || 0;

    // Derive other columns by header guesses
    const callerCol = headerMap.callerIdIndex !== -1 ? cells[headerMap.callerIdIndex] || '' : '';
    const categoryCol = cells[2] || '';
    const durationCol = cells[3] || '';
    const assessmentCol = cells[5] || '';

    let callerId = '';
    let campaignPhone = '';
    if (headerMap.callerIdIndex === headerMap.campaignPhoneIndex && headerMap.callerIdIndex !== -1) {
      const combined = cells[headerMap.callerIdIndex] || '';
      const phones = combined.match(/\([0-9]{3}\)\s[0-9]{3}-[0-9]{4}/g) || [];
      if (phones.length >= 2) { campaignPhone = phones[0]; callerId = phones[1]; }
      else if (phones.length === 1) { callerId = phones[0]; }
    } else {
      if (headerMap.callerIdIndex !== -1) {
        const ci = cells[headerMap.callerIdIndex] || '';
        const m = ci.match(/\([0-9]{3}\)\s[0-9]{3}-[0-9]{4}/g);
        if (m && m.length) callerId = m[m.length - 1];
      }
      if (headerMap.campaignPhoneIndex !== -1) {
        const pi = cells[headerMap.campaignPhoneIndex] || '';
        const m = pi.match(/\([0-9]{3}\)\s[0-9]{3}-[0-9]{4}/g);
        if (m && m.length) campaignPhone = m[0];
      }
    }
    if (!campaignPhone) campaignPhone = '(877) 834-1273';
    if (!callerId) continue;

    // Parse category/city_state/zip from multiline categoryCol
    const catLines = categoryCol.split(/\n+/).map(s => s.trim()).filter(Boolean);
    const category = catLines[0] || '';
    const cityState = catLines[1] || '';
    const zipCode = catLines[2] || '';

    // Parse durations: "screen, post, total"
    let screenDuration = null, postScreenDuration = null, totalDuration = null;
    const durNums = durationCol.split(/[,\n]/).map(s => parseInt(s.trim())).filter(n => !Number.isNaN(n));
    if (durNums.length >= 3) {
      screenDuration = durNums[0];
      postScreenDuration = durNums[1];
      totalDuration = durNums[2];
    }

    // Assessment and classification from assessmentCol (multiline)
    const assessLines = assessmentCol.split(/\n+/).map(s => s.trim()).filter(Boolean);
    const assessment = assessLines[0] || '';
    const classification = assessLines[1] || '';

    calls.push({
      dateOfCall,
      campaignPhone,
      callerId,
      payout,
      category,
      cityState,
      zipCode,
      screenDuration,
      postScreenDuration,
      totalDuration,
      assessment,
      classification
    });
  }
  return calls;
};

export const extractAdjustmentDetailsFromHtml = (html) => {
  const $ = cheerioLoad(html);
  const tables = $('table').toArray();
  let adjTable = null;
  const getHeaders = (table) => $(table).find('th').toArray().map(th => $(th).text().trim());
  for (const table of tables) {
    const headers = getHeaders(table);
    if (headers.includes('Adjustment Time') || headers.includes('Call SID')) {
      adjTable = table; break;
    }
  }
  if (!adjTable) return [];
  const rows = $(adjTable).find('tbody tr').toArray();
  const results = [];
  for (const row of rows) {
    const cells = $(row).find('td').toArray().map(td => $(td).text().trim());
    // Expected columns: Time of Call, Adjustment Time, Campaign Ph#, Caller ID, Duration, Call SID, Amount, Classification
    const timeOfCall = cells[0] || '';
    const adjustmentTime = cells[1] || '';
    const campaignPhone = cells[2] || '';
    const callerId = cells[3] || '';
    const duration = parseInt(cells[4]) || 0;
    const callSid = cells[5] || '';
    const amount = parseFloat((cells[6] || '$0').replace(/[$,]/g, '')) || 0;
    const classification = cells[7] || '';
    results.push({ timeOfCall, adjustmentTime, campaignPhone, callerId, duration, callSid, amount, classification });
  }
  return results;
};

// Detect pagination from HTML - looks for pagination controls
export const detectPagination = (html) => {
  const $ = cheerioLoad(html);
  
  // Look for pagination controls - common patterns:
  // 1. Links with "page" in href or query params
  // 2. Pagination divs/ul with page numbers
  // 3. "Next" or "Previous" links
  // 4. Page number indicators like "Page 1 of 5"
  
  let totalPages = 1;
  let currentPage = 1;
  
  // Method 1: Look for pagination links with page numbers
  const paginationLinks = $('a[href*="page="], a[href*="page_"]').toArray();
  const pageNumbers = new Set();
  
  for (const link of paginationLinks) {
    const href = $(link).attr('href') || '';
    const text = $(link).text().trim();
    
    // Extract page number from href
    const pageMatch = href.match(/[?&]page[=_](\d+)/i);
    if (pageMatch) {
      pageNumbers.add(parseInt(pageMatch[1]));
    }
    
    // Extract page number from text if it's a number
    const textNum = parseInt(text);
    if (!isNaN(textNum) && textNum > 0) {
      pageNumbers.add(textNum);
    }
  }
  
  // Method 2: Look for pagination text like "Page 1 of 5" or "Showing 1-50 of 200"
  const paginationText = $('*').text();
  const pageOfMatch = paginationText.match(/page\s+(\d+)\s+of\s+(\d+)/i);
  if (pageOfMatch) {
    currentPage = parseInt(pageOfMatch[1]) || 1;
    totalPages = parseInt(pageOfMatch[2]) || 1;
  } else {
    const showingMatch = paginationText.match(/showing\s+\d+[-–]\d+\s+of\s+(\d+)/i);
    if (showingMatch) {
      // Estimate pages based on total records (assuming ~50 per page)
      const totalRecords = parseInt(showingMatch[1]) || 0;
      totalPages = Math.ceil(totalRecords / 50);
    }
  }
  
  // Method 3: If we found page numbers in links, use the max
  if (pageNumbers.size > 0) {
    totalPages = Math.max(...Array.from(pageNumbers));
  }
  
  // Method 4: Look for "Next" link - if it exists, there are more pages
  const hasNext = $('a:contains("Next"), a:contains(">"), a:contains("»")').length > 0;
  if (hasNext && totalPages === 1) {
    // If we have a Next link but couldn't determine total pages, start with page 2
    // We'll discover the total by trying to fetch pages until we get an empty result
    totalPages = 2; // Will be discovered dynamically
  }
  
  return {
    totalPages: Math.max(1, totalPages),
    currentPage: Math.max(1, currentPage),
    hasPagination: totalPages > 1 || hasNext
  };
};


