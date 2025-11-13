// Service to fetch all calls with payout and revenue filtered by targetId from Ringba API
import * as TE from 'fp-ts/lib/TaskEither.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const RINGBA_BASE_URL = 'https://api.ringba.com/v2';

// Global target IDs configuration
// Add new target IDs here for easy management
export const TARGET_IDS = {
  'TA48aa3e3f5a0544af8549703f76a24faa': 'Elocal - Appliance repair - Static Line',
  'PI1175ac62aa1c4748b21216666b398135': 'Elocal - Appliance Repair'
};

// Helper function to get target name by ID
export const getTargetName = (targetId) => {
  return TARGET_IDS[targetId] || targetId;
};

// Helper function to list all available target IDs
export const listTargetIds = () => {
  return Object.entries(TARGET_IDS).map(([id, name]) => ({ id, name }));
};

// Helper function to determine category from target ID
// Based on target name: "Static Line" -> STATIC, otherwise -> API
export const getCategoryFromTargetId = (targetId) => {
  const targetName = getTargetName(targetId);
  if (targetName && targetName.toLowerCase().includes('static')) {
    return 'STATIC';
  }
  return 'API';
};

/**
 * Fetch all calls with payout and revenue for a specific target ID
 * 
 * @param {string} accountId - Ringba account ID
 * @param {string} apiToken - Ringba API token
 * @param {string} targetId - The target ID to filter by
 * @param {Object} options - Optional parameters
 * @param {string} options.startDate - Start date (ISO string or Date)
 * @param {string} options.endDate - End date (ISO string or Date)
 * @param {number} options.pageSize - Number of records per page (default: 100, max: 1000)
 * @returns {Promise<Either<Error, {calls, summary}>>}
 */
export const getCallsByTargetId = (accountId, apiToken) => (targetId, options = {}) =>
  TE.tryCatch(
    async () => {
      if (!targetId) {
        throw new Error('targetId is required');
      }

      if (!accountId || !apiToken) {
        throw new Error('Ringba accountId and apiToken are required');
      }

      // Get target name from global config if available
      const targetName = getTargetName(targetId);

      // Parse date range
      let startDate, endDate;
      if (options.startDate) {
        startDate = options.startDate instanceof Date ? options.startDate : new Date(options.startDate);
      } else {
        // Default to last 30 days if not specified
        endDate = new Date();
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
      }

      if (options.endDate) {
        endDate = options.endDate instanceof Date ? options.endDate : new Date(options.endDate);
      } else if (!startDate) {
        endDate = new Date();
      }

      const pageSize = Math.min(options.pageSize || 100, 1000); // Max 1000 per page
      const allCalls = [];
      let offset = 0;
      let hasMore = true;
      let totalRecords = 0;

      console.log(`[Ringba] Fetching calls for target ID: "${targetId}"`);
      console.log(`[Ringba] Target Name: "${targetName}"`);
      console.log(`[Ringba] Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);

      while (hasMore) {
        const url = `${RINGBA_BASE_URL}/${accountId}/calllogs`;
        const headers = {
          'Authorization': `Token ${apiToken}`,
          'Content-Type': 'application/json'
        };

        const body = {
          reportStart: startDate.toISOString(),
          reportEnd: endDate.toISOString(),
          offset: offset,
          size: pageSize,
          orderByColumns: [
            { column: 'callDt', direction: 'desc' }
          ],
          valueColumns: [
            { column: 'inboundCallId' },
            { column: 'callDt' },
            { column: 'targetName' },
            { column: 'targetId' },
            { column: 'conversionAmount' },  // Revenue
            { column: 'payoutAmount' },      // Payout (this is what we pay to Ringba - the cost)
            { column: 'inboundPhoneNumber' },
            { column: 'tag:InboundNumber:Number' }, // Caller ID
            { column: 'campaignName' },
            { column: 'publisherName' }
          ],
          filters: [
            {
              anyConditionToMatch: [
                {
                  column: 'targetId',
                  comparisonType: 'EQUALS',
                  value: targetId,
                  isNegativeMatch: false
                }
              ]
            }
          ],
          formatDateTime: true
        };

        console.log(`[Ringba] Fetching page: offset=${offset}, size=${pageSize}`);

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
        const totalCount = data.report?.totalCount || data.report?.total || records.length;

        console.log(`[Ringba] Retrieved ${records.length} calls (total available: ${totalCount})`);

        // Process records
        for (const record of records) {
          const revenue = record.conversionAmount !== undefined && record.conversionAmount !== null 
            ? Number(record.conversionAmount) 
            : 0;
          const payout = record.payoutAmount !== undefined && record.payoutAmount !== null 
            ? Number(record.payoutAmount) 
            : 0;
          
          // Ringba cost is what Ringba charges us for the call
          // In Ringba's model: payoutAmount is what we pay to the publisher/affiliate
          // The cost to us (Ringba's charge) is typically the payoutAmount itself
          // However, if there's a difference between revenue and payout, that might be Ringba's margin
          // For now, we'll use payoutAmount as the Ringba cost (what we pay)
          // Note: This is the cost incurred/charged by Ringba for this call
          const ringbaCost = payout; // Payout is the cost we pay to Ringba
          
          const call = {
            inboundCallId: record.inboundCallId || null,
            callDate: record.callDt || null,
            targetId: record.targetId || targetId,
            targetName: record.targetName || targetName,
            revenue: revenue,
            payout: payout,
            ringbaCost: ringbaCost, // Cost charged by Ringba (what we pay for this call)
            connected: null, // Not available in API response
            callDuration: record.callDuration ? Number(record.callDuration) : null,
            inboundPhoneNumber: record.inboundPhoneNumber || null,
            callerId: record['tag:InboundNumber:Number'] || null,
            campaignName: record.campaignName || null,
            publisherName: record.publisherName || null
          };

          allCalls.push(call);
        }

        // Check if there are more records
        totalRecords = totalCount;
        if (records.length < pageSize || allCalls.length >= totalRecords) {
          hasMore = false;
        } else {
          offset += pageSize;
        }

        // Add a small delay to avoid rate limiting
        if (hasMore) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      console.log(`[Ringba] Total calls retrieved: ${allCalls.length}`);

      // Calculate summary statistics
      const summary = {
        targetId,
        targetName,
        totalCalls: allCalls.length,
        totalRevenue: allCalls.reduce((sum, call) => sum + call.revenue, 0),
        totalPayout: allCalls.reduce((sum, call) => sum + call.payout, 0),
        totalRingbaCost: allCalls.reduce((sum, call) => sum + (call.ringbaCost || 0), 0), // Total cost charged by Ringba
        connectedCalls: allCalls.filter(call => call.connected === true).length,
        totalCallDuration: allCalls.reduce((sum, call) => sum + (call.callDuration || 0), 0),
        averageRevenue: allCalls.length > 0 
          ? allCalls.reduce((sum, call) => sum + call.revenue, 0) / allCalls.length 
          : 0,
        averagePayout: allCalls.length > 0 
          ? allCalls.reduce((sum, call) => sum + call.payout, 0) / allCalls.length 
          : 0,
        averageRingbaCost: allCalls.length > 0 
          ? allCalls.reduce((sum, call) => sum + (call.ringbaCost || 0), 0) / allCalls.length 
          : 0,
        callsWithRevenue: allCalls.filter(call => call.revenue > 0).length,
        callsWithPayout: allCalls.filter(call => call.payout > 0).length,
        callsWithRingbaCost: allCalls.filter(call => (call.ringbaCost || 0) > 0).length,
        dateRange: {
          start: startDate.toISOString(),
          end: endDate.toISOString()
        }
      };

      return {
        targetId,
        targetName,
        calls: allCalls,
        summary
      };
    },
    (error) => new Error(`Failed to fetch calls by target name: ${error.message}`)
  );

/**
 * Standalone script to fetch calls by target ID
 * Usage: node src/http/ringba-target-calls.js <targetId> [startDate] [endDate]
 */
export const getCallsByTargetIdScript = async (targetId, startDate = null, endDate = null) => {
  const accountId = process.env.RINGBA_ACCOUNT_ID;
  const apiToken = process.env.RINGBA_API_TOKEN;

  if (!accountId || !apiToken) {
    console.error('❌ Error: RINGBA_ACCOUNT_ID and RINGBA_API_TOKEN must be set in .env file');
    process.exit(1);
  }

  if (!targetId) {
    console.error('❌ Error: targetId is required');
    console.log('Usage: node src/http/ringba-target-calls.js <targetId> [startDate] [endDate]');
    console.log('');
    console.log('Available Target IDs:');
    listTargetIds().forEach(({ id, name }) => {
      console.log(`  ${id}: ${name}`);
    });
    console.log('');
    console.log('Example: node src/http/ringba-target-calls.js TA48aa3e3f5a0544af8549703f76a24faa "2025-11-01" "2025-11-12"');
    process.exit(1);
  }

  const targetName = getTargetName(targetId);

  console.log('========================================');
  console.log('Ringba Calls by Target ID');
  console.log('========================================');
  console.log(`Target ID: ${targetId}`);
  console.log(`Target Name: ${targetName}`);
  console.log(`Account ID: ${accountId}`);
  if (startDate) console.log(`Start Date: ${startDate}`);
  if (endDate) console.log(`End Date: ${endDate}`);
  console.log('');

  const options = {};
  if (startDate) options.startDate = startDate;
  if (endDate) options.endDate = endDate;

  const resultEither = await getCallsByTargetId(accountId, apiToken)(targetId, options)();

  if (resultEither._tag === 'Right') {
    const result = resultEither.right;
    const { calls, summary } = result;

    console.log('========================================');
    console.log('✅ Calls Retrieved Successfully');
    console.log('========================================');
    console.log(`Target ID: ${summary.targetId || targetId}`);
    console.log(`Target Name: ${summary.targetName || targetName}`);
    console.log(`Total Calls: ${summary.totalCalls}`);
    console.log(`Connected Calls: ${summary.connectedCalls}`);
    console.log(`Calls with Revenue: ${summary.callsWithRevenue}`);
    console.log(`Calls with Payout: ${summary.callsWithPayout}`);
    console.log(`Calls with Ringba Cost: ${summary.callsWithRingbaCost}`);
    console.log('');
    console.log('Financial Summary:');
    console.log(`  Total Revenue: $${summary.totalRevenue.toFixed(2)}`);
    console.log(`  Total Payout: $${summary.totalPayout.toFixed(2)}`);
    console.log(`  Total Ringba Cost: $${summary.totalRingbaCost.toFixed(2)}`);
    console.log(`  Average Revenue: $${summary.averageRevenue.toFixed(2)}`);
    console.log(`  Average Payout: $${summary.averagePayout.toFixed(2)}`);
    console.log(`  Average Ringba Cost: $${summary.averageRingbaCost.toFixed(2)}`);
    console.log(`  Total Call Duration: ${Math.round(summary.totalCallDuration / 60)} minutes`);
    console.log('');
    console.log(`Date Range: ${summary.dateRange.start} to ${summary.dateRange.end}`);
    console.log('');

    // Show first 10 calls as sample
    if (calls.length > 0) {
      console.log('========================================');
      console.log(`Sample Calls (showing first ${Math.min(10, calls.length)} of ${calls.length}):`);
      console.log('========================================');
      calls.slice(0, 10).forEach((call, index) => {
        console.log(`\n${index + 1}. Call ID: ${call.inboundCallId}`);
        console.log(`   Date: ${call.callDate || 'N/A'}`);
        console.log(`   Revenue: $${call.revenue.toFixed(2)}`);
        console.log(`   Payout: $${call.payout.toFixed(2)}`);
        console.log(`   Ringba Cost: $${(call.ringbaCost || 0).toFixed(2)}`);
        console.log(`   Connected: ${call.connected !== null ? (call.connected ? 'Yes' : 'No') : 'N/A'}`);
        console.log(`   Duration: ${call.callDuration ? call.callDuration + ' seconds' : 'N/A'}`);
        if (call.callerId) console.log(`   Caller: ${call.callerId}`);
        if (call.campaignName) console.log(`   Campaign: ${call.campaignName}`);
      });

      if (calls.length > 10) {
        console.log(`\n... and ${calls.length - 10} more calls`);
      }
    }

    console.log('');
    console.log('========================================');
    console.log('Full Results (JSON):');
    console.log('========================================');
    console.log(JSON.stringify(result, null, 2));
    console.log('========================================');

    return result;
  } else {
    const error = resultEither.left;
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
};

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.includes('ringba-target-calls.js')) {
  const targetId = process.argv[2];
  const startDate = process.argv[3] || null;
  const endDate = process.argv[4] || null;
  getCallsByTargetIdScript(targetId, startDate, endDate).catch(error => {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  });
}

