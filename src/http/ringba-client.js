// Ringba API client for call lookup and payment updates
import * as TE from 'fp-ts/lib/TaskEither.js';

const RINGBA_BASE_URL = 'https://api.ringba.com/v2';

// Column key cache by accountId
const columnKeyCache = {};

// Get column names from Ringba and build a map from UI label -> API key
export const getColumnKeyMap = (accountId, apiToken) =>
  TE.tryCatch(
    async () => {
      // Return cached if available
      if (columnKeyCache[accountId]) {
        return columnKeyCache[accountId];
      }

      const url = `${RINGBA_BASE_URL}/${accountId}/calllogs/columns`;
      const headers = {
        'Authorization': `Token ${apiToken}`
      };

      const response = await fetch(url, {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unable to read error response');
        throw new Error(`Get Column Names failed: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      
      // Handle different response formats
      let columns = [];
      if (Array.isArray(data)) {
        columns = data;
      } else if (Array.isArray(data.columns)) {
        columns = data.columns;
      } else if (data.data && Array.isArray(data.data)) {
        columns = data.data;
      } else {
        // Try to find columns in nested structure
        console.warn(`[Ringba] Unexpected column names response format:`, JSON.stringify(data).substring(0, 500));
        columns = [];
      }

      console.log(`[Ringba] Column discovery returned ${columns.length} columns`);
      
      // Debug: log first column structure to understand format
      if (columns.length > 0) {
        console.log(`[Ringba] Sample column structure:`, JSON.stringify(columns[0]).substring(0, 200));
      }

      // Build a case-insensitive lookup by UI label and by column id itself
      // Filter by role availability - check if column is available for admin role
      const map = {};
      const currentRole = 'admin'; // API token role
      
      for (const col of columns) {
        // Check if column is available for current role
        if (col.roles && Array.isArray(col.roles) && !col.roles.includes(currentRole)) {
          continue; // Skip columns not available for this role
        }
        // Handle different column formats
        // Ringba format: { id: "...", title: "...", ... }
        // Legacy format: { column: "...", displayName: "..." }
        // Other formats: { name: "...", label: "..." } or string
        const columnKey = col.id || col.column || col.name || col.key || col;
        if (!columnKey || typeof columnKey !== 'string') continue;
        
        // Map exact key (case-insensitive)
        map[columnKey.toLowerCase()] = columnKey;
        
        // Map by display name if available (handle different field names)
        // Ringba uses "title", others might use "displayName", "label", etc.
        const displayName = col.title || col.displayName || col.label || col.display;
        if (displayName && typeof displayName === 'string') {
          map[displayName.toLowerCase()] = columnKey;
        }
        
        // Map common aliases
        if (col.description) {
          const descLower = col.description.toLowerCase();
          if (descLower.includes('revenue')) {
            map['revenue'] = columnKey;
            map['rev'] = columnKey;
          }
          if (descLower.includes('payout')) {
            map['payout'] = columnKey;
            map['pay'] = columnKey;
          }
        }
      }

      // Also search for revenue/payout columns by title and description
      for (const col of columns) {
        // Check if column is available for current role
        if (col.roles && Array.isArray(col.roles) && !col.roles.includes(currentRole)) {
          continue;
        }
        
        const columnKey = col.id || col.column || col.name || col.key;
        if (!columnKey || typeof columnKey !== 'string') continue;
        
        const keyLower = columnKey.toLowerCase();
        const titleLower = (col.title || col.displayName || '').toLowerCase();
        const descLower = (col.description || '').toLowerCase();
        
        // Search for revenue columns
        if ((keyLower.includes('revenue') || keyLower.includes('rev') || 
             titleLower.includes('revenue') || descLower.includes('revenue') ||
             keyLower === 'conversionamount') &&
            !map['revenue']) {
          map['revenue'] = columnKey;
          console.log(`[Ringba] Found revenue column: ${columnKey} (${col.title || 'no title'})`);
        }
        
        // Search for payout columns - try multiple variations
        if ((keyLower.includes('payout') || keyLower.includes('pay') ||
             titleLower.includes('payout') || descLower.includes('payout') ||
             titleLower.includes('buyer') || descLower.includes('buyer')) &&
            !map['payout']) {
          map['payout'] = columnKey;
          console.log(`[Ringba] Found payout column: ${columnKey} (${col.title || 'no title'})`);
        }
        
        // Search for inbound call id
        if ((keyLower.includes('callid') || keyLower === 'inboundcallid') &&
            !map['inboundcallid']) {
          map['inboundcallid'] = columnKey;
          map['inbound call id'] = columnKey;
        }
        
        // Search for call date
        if ((keyLower.includes('calldt') || keyLower.includes('calldate')) &&
            !map['calldt']) {
          map['calldt'] = columnKey;
          map['call date'] = columnKey;
        }
      }

      // Cache the map
      columnKeyCache[accountId] = map;
      
      // Debug: log some mappings for troubleshooting
      console.log(`[Ringba] Discovered ${Object.keys(map).length} column mappings. Sample: inboundCallId=${map['inboundcallid'] || map['inbound call id'] || 'not found'}, revenue=${map['revenue'] || 'not found'}, payout=${map['payout'] || 'not found'}`);
      
      return map;
    },
    (error) => new Error(`Failed to get Ringba column keys: ${error.message}`)
  );

// Resolve column key from map (try by UI label, fall back to literal if already a key)
const resolveKey = (map, labelOrKey, fallback = null) => {
  if (!map || !labelOrKey) return fallback || labelOrKey;
  const resolved = map[labelOrKey.toLowerCase()];
  // If found in map, return it (even if it matches the input)
  // If not found and we have a fallback, use it
  // Otherwise return the original input
  return resolved || fallback || labelOrKey;
};

// Convert phone number to E.164 format (+1XXXXXXXXXX)
const toE164 = (raw) => {
  if (!raw) return null;
  const digits = (raw || '').replace(/\D/g, '');
  if (!digits) return null;
  // If already in E.164 format (starts with +), return as-is
  if (raw.startsWith('+')) return raw;
  // 11 digits starting with 1 (US with country code)
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  // 10 digits (US without country code)
  if (digits.length === 10) return `+1${digits}`;
  // Last resort: try to format as E.164
  return digits.length > 0 ? `+${digits}` : null;
};

// Find call by callerId and time window using Ringba Call Logs API
// Optionally matches by payout value to ensure correct call identification
export const findCallByCallerIdAndTime = (accountId, apiToken) => (callerId, callDate, windowMinutes = 60, expectedPayout = null) =>
  TE.tryCatch(
    async () => {
      const e164Phone = toE164(callerId);
      if (!e164Phone) {
        throw new Error(`Invalid caller ID format: ${callerId}`);
      }

      // Create time window around call date
      const callDt = new Date(callDate);
      const start = new Date(callDt.getTime() - windowMinutes * 60 * 1000);
      const end = new Date(callDt.getTime() + windowMinutes * 60 * 1000);

      const url = `${RINGBA_BASE_URL}/${accountId}/calllogs`;
      const headers = {
        'Authorization': `Token ${apiToken}`,
        'Content-Type': 'application/json'
      };

      const body = {
        reportStart: start.toISOString(),
        reportEnd: end.toISOString(),
        offset: 0,
        size: 20, // Get more records to find best match by payout
        orderByColumns: [
          { column: 'callDt', direction: 'desc' }
        ],
        valueColumns: [
          { column: 'inboundCallId' },
          { column: 'tag:InboundNumber:Number' }, // Caller phone number (E.164)
          { column: 'inboundPhoneNumber' }, // Dialed number
          { column: 'callDt' } // Call timestamp
        ],
        filters: [
          {
            anyConditionToMatch: [
              {
                column: 'tag:InboundNumber:Number', // Use tag column, not "callerId"
                comparisonType: 'EQUALS',
                value: e164Phone, // E.164 format
                isNegativeMatch: false
              }
            ]
          }
        ],
        formatDateTime: true
        // formatTimeZone: 'UTC' // Removed - may cause "Invalid IANA TimeZone" error with some accounts
      };

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unable to read error response');
        throw new Error(`Ringba API error ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const records = data.report?.records || [];

      if (records.length === 0) {
        return null; // No call found
      }

      // If expectedPayout is provided, fetch payout details for all matching calls
      // and match by payout first, then by time
      const targetTime = callDt.getTime();
      const payoutTolerance = 0.01; // Allow 1 cent difference for floating point precision
      const expectedPayoutNum = expectedPayout !== null ? Number(expectedPayout) : null;

      if (expectedPayoutNum !== null && !isNaN(expectedPayoutNum)) {
        console.log(`[Ringba] Matching by payout: expected=$${expectedPayoutNum}, found ${records.length} calls`);
        
        // Fetch payout details for all matching calls
        const callsWithPayout = [];
        for (const record of records) {
          try {
            const detailsEither = await getCallDetails(accountId, apiToken)(record.inboundCallId)();
            if (detailsEither._tag === 'Right') {
              const details = detailsEither.right;
              const recordTime = new Date(record.callDt).getTime();
              const timeDiff = Math.abs(recordTime - targetTime);
              const payoutDiff = Math.abs(details.payout - expectedPayoutNum);
              
              callsWithPayout.push({
                record,
                details,
                timeDiff,
                payoutDiff,
                payoutMatch: payoutDiff <= payoutTolerance
              });
            }
          } catch (error) {
            console.warn(`[Ringba] Could not fetch details for ${record.inboundCallId}: ${error.message}`);
            // Continue with other calls
          }
        }

        if (callsWithPayout.length === 0) {
          console.warn(`[Ringba] Could not fetch payout details for any matching calls`);
          // Fall back to time-based matching
        } else {
          // Prioritize: exact payout match first, then closest payout, then closest time
          callsWithPayout.sort((a, b) => {
            // First: exact payout matches
            if (a.payoutMatch && !b.payoutMatch) return -1;
            if (!a.payoutMatch && b.payoutMatch) return 1;
            
            // Second: closest payout (if both match or both don't match)
            if (a.payoutMatch && b.payoutMatch) {
              // Both match payout - prefer closer time
              return a.timeDiff - b.timeDiff;
            } else {
              // Neither matches payout exactly - prefer closer payout
              const payoutDiff = a.payoutDiff - b.payoutDiff;
              if (Math.abs(payoutDiff) > payoutTolerance) {
                return payoutDiff;
              }
              // If payout difference is similar, prefer closer time
              return a.timeDiff - b.timeDiff;
            }
          });

          const bestMatch = callsWithPayout[0];
          const payoutMatchInfo = bestMatch.payoutMatch 
            ? `exact payout match ($${bestMatch.details.payout})`
            : `payout diff=$${bestMatch.payoutDiff.toFixed(2)} (Ringba=$${bestMatch.details.payout}, expected=$${expectedPayoutNum})`;
          
          console.log(`[Ringba] Best match: ${bestMatch.record.inboundCallId} - ${payoutMatchInfo}, time diff=${Math.round(bestMatch.timeDiff / 60000)} min`);

          return {
            inboundCallId: bestMatch.record.inboundCallId,
            callDt: bestMatch.record.callDt,
            callerId: bestMatch.record['tag:InboundNumber:Number'] || e164Phone,
            inboundPhoneNumber: bestMatch.record.inboundPhoneNumber,
            timeDiffMinutes: Math.round(bestMatch.timeDiff / 60000),
            payout: bestMatch.details.payout,
            payoutMatch: bestMatch.payoutMatch,
            payoutDiff: bestMatch.payoutDiff,
            expectedPayout: expectedPayoutNum
          };
        }
      }

      // Fallback: Find closest match by time only (if no payout matching or payout details unavailable)
      console.log(`[Ringba] Matching by time only (no payout matching or details unavailable)`);
      let bestMatch = null;
      let bestDiff = Infinity;

      for (const record of records) {
        const recordTime = new Date(record.callDt).getTime();
        const diff = Math.abs(recordTime - targetTime);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestMatch = record;
        }
      }

      return bestMatch ? {
        inboundCallId: bestMatch.inboundCallId,
        callDt: bestMatch.callDt,
        callerId: bestMatch['tag:InboundNumber:Number'] || e164Phone,
        inboundPhoneNumber: bestMatch.inboundPhoneNumber,
        timeDiffMinutes: Math.round(bestDiff / 60000),
        payoutMatch: false,
        payout: null
      } : null;
    },
    (error) => new Error(`Failed to lookup Ringba call: ${error.message}`)
  );

// Get call details by inboundCallId using Ringba by-ID details endpoint
// Uses /calllogs/detail endpoint designed for looking up specific calls
export const getCallDetails = (accountId, apiToken) => (inboundCallId) =>
  TE.tryCatch(
    async () => {
      if (!inboundCallId) {
        throw new Error('inboundCallId is required');
      }

      const url = `${RINGBA_BASE_URL}/${accountId}/calllogs/detail`;
      const headers = {
        'Authorization': `Token ${apiToken}`,
        'Content-Type': 'application/json'
      };

      // Use by-ID details endpoint - include columns to check connection status
      const body = {
        inboundCallIds: [inboundCallId],
        columns: [
          'inboundCallId', 
          'callDt', 
          'conversionAmount', 
          'payoutAmount',
          'connected', // Boolean: true if call connected
          'callDuration', // Duration in seconds
          'reroutedFromInboundCallId', // Original leg pointer (if rerouted)
          'rootInboundCallId' // Root call ID (for grouped/transferred calls)
        ]
      };

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });

      const json = await response.json().catch(() => ({}));
      
      if (!response.ok || json.isSuccessful === false) {
        const errorText = json.message || JSON.stringify(json);
        throw new Error(`Ringba Details ${response.status}: ${errorText}`);
      }

      // Handle both response structures: report.records[0] or callLog.data[0]
      const row = json?.report?.records?.[0] || json?.callLog?.data?.[0];
      
      if (!row) {
        throw new Error(`Call not found in Ringba: ${inboundCallId}`);
      }

      // Determine if call connected using multiple signals
      // Priority: explicit 'connected' field > callDuration > conversionAmount presence
      let isConnected = false;
      if (row.connected !== undefined && row.connected !== null) {
        isConnected = !!row.connected;
      } else if (row.callDuration !== undefined && row.callDuration !== null) {
        // If call duration > 0, it likely connected
        isConnected = Number(row.callDuration) > 0;
      } else if (row.conversionAmount !== undefined && row.conversionAmount !== null) {
        // If there's revenue, it probably connected
        isConnected = Number(row.conversionAmount) > 0;
      }

      return {
        inboundCallId: row.inboundCallId || inboundCallId,
        revenue: Number(row.conversionAmount || 0),
        payout: Number(row.payoutAmount || 0),
        callDt: row.callDt,
        connected: isConnected,
        callDuration: Number(row.callDuration || 0),
        reroutedFromInboundCallId: row.reroutedFromInboundCallId || null,
        rootInboundCallId: row.rootInboundCallId || null
      };
    },
    (error) => new Error(`Failed to get Ringba call details: ${error.message}`)
  );

// Resolve payment legs for multi-leg calls (reroutes/transfers)
// Returns { payoutLegId, revenueLegId, legs } where:
// - payoutLegId: the leg where payout should be updated (usually original leg)
// - revenueLegId: the leg where revenue should be updated (usually connected/buyer leg)
// - legs: array of all discovered legs with their details
export const resolvePaymentLegs = (accountId, apiToken) => (seedInboundCallId) =>
  TE.tryCatch(
    async () => {
      console.log(`[Ringba] Resolving payment legs for call ${seedInboundCallId}...`);
      
      // Fetch seed leg details
      const seedEither = await getCallDetails(accountId, apiToken)(seedInboundCallId)();
      
      if (seedEither._tag === 'Left') {
        throw new Error(`Failed to get seed leg details: ${seedEither.left.message}`);
      }
      
      const seed = seedEither.right;
      const legs = [seed];
      
      // Start with seed as both legs
      let payoutLegId = seed.inboundCallId;
      let revenueLegId = seed.inboundCallId;
      let payoutLeg = seed;
      let revenueLeg = seed;
      
      // If this leg was rerouted FROM another leg, fetch the original leg
      if (seed.reroutedFromInboundCallId) {
        console.log(`[Ringba] Call ${seedInboundCallId} was rerouted from ${seed.reroutedFromInboundCallId}, fetching original leg...`);
        const originalEither = await getCallDetails(accountId, apiToken)(seed.reroutedFromInboundCallId)();
        
        if (originalEither._tag === 'Right') {
          const original = originalEither.right;
          legs.push(original);
          
          // Payout typically lives on the original leg
          if (original.payout > 0 || seed.payout === 0) {
            payoutLegId = original.inboundCallId;
            payoutLeg = original;
            console.log(`[Ringba] Payout leg is original: ${payoutLegId} (payout=$${original.payout})`);
          }
          
          // Revenue typically lives on the connected/buyer leg (the seed in this case)
          if (seed.connected && seed.revenue > 0) {
            revenueLegId = seed.inboundCallId;
            revenueLeg = seed;
            console.log(`[Ringba] Revenue leg is rerouted (connected): ${revenueLegId} (revenue=$${seed.revenue})`);
          } else if (original.revenue > 0) {
            revenueLegId = original.inboundCallId;
            revenueLeg = original;
            console.log(`[Ringba] Revenue leg is original: ${revenueLegId} (revenue=$${original.revenue})`);
          }
        }
      }
      
      // If seed has no amounts but has a root ID, try fetching root
      if (seed.rootInboundCallId && seed.rootInboundCallId !== seed.inboundCallId && 
          seed.payout === 0 && seed.revenue === 0) {
        console.log(`[Ringba] Seed has no amounts, checking root leg ${seed.rootInboundCallId}...`);
        const rootEither = await getCallDetails(accountId, apiToken)(seed.rootInboundCallId)();
        
        if (rootEither._tag === 'Right') {
          const root = rootEither.right;
          const isNewLeg = !legs.find(l => l.inboundCallId === root.inboundCallId);
          if (isNewLeg) legs.push(root);
          
          if (root.payout > 0 && payoutLeg.payout === 0) {
            payoutLegId = root.inboundCallId;
            payoutLeg = root;
            console.log(`[Ringba] Payout leg is root: ${payoutLegId} (payout=$${root.payout})`);
          }
          
          if (root.revenue > 0 && revenueLeg.revenue === 0) {
            revenueLegId = root.inboundCallId;
            revenueLeg = root;
            console.log(`[Ringba] Revenue leg is root: ${revenueLegId} (revenue=$${root.revenue})`);
          }
        }
      }
      
      // If still no clear revenue leg, use the connected leg (if any)
      const connectedLeg = legs.find(l => l.connected);
      if (connectedLeg && revenueLeg.revenue === 0 && !revenueLeg.connected) {
        revenueLegId = connectedLeg.inboundCallId;
        revenueLeg = connectedLeg;
        console.log(`[Ringba] Using connected leg for revenue: ${revenueLegId}`);
      }
      
      // Summary
      console.log(`[Ringba] Resolved payment legs: payout=${payoutLegId} (connected=${payoutLeg.connected}, $${payoutLeg.payout}), revenue=${revenueLegId} (connected=${revenueLeg.connected}, $${revenueLeg.revenue})`);
      
      return {
        payoutLegId,
        revenueLegId,
        payoutLeg,
        revenueLeg,
        legs,
        isMultiLeg: legs.length > 1
      };
    },
    (error) => new Error(`Failed to resolve payment legs: ${error.message}`)
  );

// Serialize amount to fixed-2 decimal string (e.g., "9.00", "0.00")
const toAmountString = (value) => {
  if (value === null || value === undefined || isNaN(value)) return undefined;
  const num = typeof value === 'number' ? value : parseFloat(value);
  return num.toFixed(2);
};

// Update call payment/revenue using Ringba Payments API (absolute override)
// Accepts an object with optional fields: newConversionAmount, newPayoutAmount, reason
// For non-connected calls, omit newConversionAmount (only send newPayoutAmount)
export const updateCallPayment = (accountId, apiToken) => (inboundCallId, { newConversionAmount, newPayoutAmount, reason }) =>
  TE.tryCatch(
    async () => {
      if (!inboundCallId) {
        throw new Error('inboundCallId is required');
      }

      if (newConversionAmount === undefined && newPayoutAmount === undefined) {
        throw new Error('At least one of newConversionAmount or newPayoutAmount must be provided');
      }

      // Use the correct /calls/payments/override endpoint
      const url = `${RINGBA_BASE_URL}/${accountId}/calls/payments/override`;
      const headers = {
        'Authorization': `Token ${apiToken}`,
        'Content-Type': 'application/json'
      };

      const body = { 
        inboundCallId,
        reason: reason || 'Call payments adjusted by eLocal sync service.'
      };

      // Set adjustConversion and adjustPayout flags based on what we're updating
      if (newConversionAmount !== undefined) {
        body.adjustConversion = true;
        body.newConversionAmount = typeof newConversionAmount === 'string' 
          ? parseFloat(newConversionAmount) 
          : Number(newConversionAmount);
      } else {
        body.adjustConversion = false;
      }

      if (newPayoutAmount !== undefined) {
        body.adjustPayout = true;
        body.newPayoutAmount = typeof newPayoutAmount === 'string'
          ? parseFloat(newPayoutAmount)
          : Number(newPayoutAmount);
      } else {
        body.adjustPayout = false;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });

      const text = await response.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
      
      if (!response.ok) {
        throw new Error(`Ringba API error ${response.status}: ${text}`);
      }
      
      return json;
    },
    (error) => new Error(`Failed to update Ringba payment: ${error.message}`)
  );

// Void a call (zero out revenue/payout) using Ringba Void API
export const voidCall = (accountId, apiToken) => (inboundCallId, voidReason) =>
  TE.tryCatch(
    async () => {
      if (!inboundCallId) {
        throw new Error('inboundCallId is required');
      }

      const url = `${RINGBA_BASE_URL}/${accountId}/calls/void`;
      const headers = {
        'Authorization': `Token ${apiToken}`,
        'Content-Type': 'application/json'
      };

      const body = {
        inboundCallId: inboundCallId,
        voidReason: voidReason || 'Voided by eLocal sync job'
      };

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });

      const text = await response.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
      
      if (!response.ok) {
        throw new Error(`Ringba API error ${response.status}: ${text}`);
      }
      
      return json;
    },
    (error) => new Error(`Failed to void Ringba call: ${error.message}`)
  );

