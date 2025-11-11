// Utility functions for data processing and validation
import * as R from 'ramda';
import * as E from 'fp-ts/lib/Either.js';
import * as TE from 'fp-ts/lib/TaskEither.js';
import { CampaignCallSchema, AdjustmentDetailSchema } from '../types/schemas.js';

// Data validation utilities
export const validateCampaignCall = (data) =>
  E.tryCatch(
    () => CampaignCallSchema.decode(data),
    (error) => new Error(`Invalid campaign call data: ${JSON.stringify(error)}`)
  );

export const validateAdjustmentDetail = (data) =>
  E.tryCatch(
    () => AdjustmentDetailSchema.decode(data),
    (error) => new Error(`Invalid adjustment detail data: ${JSON.stringify(error)}`)
  );

// Data transformation utilities
export const parsePhoneNumber = (phoneStr) => {
  if (!phoneStr) return '';
  // Remove all non-digit characters and format
  const digits = phoneStr.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phoneStr;
};

export const parseCurrency = (currencyStr) => {
  if (!currencyStr) return 0;
  return parseFloat(currencyStr.replace(/[$,]/g, '')) || 0;
};

export const parseDateTime = (dateStr) => {
  if (!dateStr) return new Date().toISOString();
  try {
    return new Date(dateStr).toISOString();
  } catch {
    return new Date().toISOString();
  }
};

// Data cleaning utilities
export const cleanCallerId = (value) => {
  const str = typeof value === 'string' ? value : String(value || '');
  return parsePhoneNumber(R.trim(str));
};

export const cleanPayout = (value) => {
  if (typeof value === 'number') return value;
  const str = typeof value === 'string' ? value : String(value || '');
  return parseCurrency(R.trim(str));
};

export const cleanDateTime = (value) => {
  const str = typeof value === 'string' ? value : String(value || '');
  return parseDateTime(R.trim(str));
};

// Data filtering utilities
export const filterValidCalls = R.filter(
  R.allPass([
    R.propSatisfies(R.complement(R.isEmpty), 'callerId'),
    R.propSatisfies(R.complement(R.isEmpty), 'campaignPhone'),
    R.propSatisfies(R.complement(R.isEmpty), 'dateOfCall')
  ])
);

export const filterValidAdjustments = R.filter(
  R.allPass([
    R.propSatisfies(R.complement(R.isEmpty), 'callerId'),
    R.propSatisfies(R.complement(R.isEmpty), 'callSid'),
    R.propSatisfies(R.complement(R.isEmpty), 'timeOfCall')
  ])
);

// Data deduplication utilities
export const deduplicateCalls = R.uniqBy(R.prop('callerId'));
export const deduplicateAdjustments = R.uniqBy(R.prop('callSid'));

// Data processing pipeline (only required fields: dateOfCall, campaignPhone, callerId, payout)
export const processCampaignCalls = R.compose(
  filterValidCalls,
  deduplicateCalls,
  R.map(call => ({
    dateOfCall: cleanDateTime(call.dateOfCall),
    campaignPhone: cleanCallerId(call.campaignPhone),
    callerId: cleanCallerId(call.callerId),
    payout: cleanPayout(call.payout),
    category: call.category || null,
    cityState: call.cityState || null,
    zipCode: call.zipCode || null,
    screenDuration: typeof call.screenDuration === 'number' ? call.screenDuration : null,
    postScreenDuration: typeof call.postScreenDuration === 'number' ? call.postScreenDuration : null,
    totalDuration: typeof call.totalDuration === 'number' ? call.totalDuration : null,
    assessment: call.assessment || null,
    classification: call.classification || null
  }))
);

export const processAdjustmentDetails = R.compose(
  filterValidAdjustments,
  deduplicateAdjustments,
  R.map(adjustment => ({
    ...adjustment,
    callerId: cleanCallerId(adjustment.callerId),
    campaignPhone: cleanCallerId(adjustment.campaignPhone),
    amount: cleanPayout(adjustment.amount),
    timeOfCall: cleanDateTime(adjustment.timeOfCall),
    adjustmentTime: cleanDateTime(adjustment.adjustmentTime)
  }))
);

// Error handling utilities
export const handleScrapingError = (error) => {
  console.error('Scraping error:', error.message);
  return E.left(error);
};

export const handleDatabaseError = (error) => {
  console.error('Database error:', error.message);
  return E.left(error);
};

// Retry utilities
export const withRetry = (maxRetries) => (operation) =>
  TE.tryCatch(
    async () => {
      let lastError;
      for (let i = 0; i < maxRetries; i++) {
        try {
          return await operation();
        } catch (error) {
          lastError = error;
          if (i < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
          }
        }
      }
      throw lastError;
    },
    (error) => new Error(`Operation failed after ${maxRetries} retries: ${error.message}`)
  );

// Delay utility
export const delay = (ms) =>
  TE.fromTask(() => new Promise(resolve => setTimeout(resolve, ms)));

// Logging utilities
export const logInfo = (message) => (data) => {
  console.log(`[INFO] ${message}:`, data);
  return data;
};

export const logError = (message) => (error) => {
  console.error(`[ERROR] ${message}:`, error.message);
  return error;
};

export const logSuccess = (message) => (data) => {
  console.log(`[SUCCESS] ${message}:`, data);
  return data;
};

// Session management utilities
export const generateSessionId = () =>
  `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export const createSession = () => ({
  sessionId: generateSessionId(),
  startedAt: new Date().toISOString(),
  completedAt: null,
  status: 'running',
  callsScraped: 0,
  adjustmentsScraped: 0,
  errorMessage: null
});

// Data aggregation utilities
export const aggregateScrapingResults = (calls, adjustments) => ({
  totalCalls: calls.length,
  totalAdjustments: adjustments.length,
  totalPayout: R.sum(R.map(R.prop('payout'), calls)),
  totalAdjustmentAmount: R.sum(R.map(R.prop('amount'), adjustments)),
  uniqueCallers: R.uniq(R.map(R.prop('callerId'), [...calls, ...adjustments])).length
});

// Configuration validation
export const validateConfig = (config) => {
  const requiredFields = [
    'dbHost', 'dbPort', 'dbUser', 'dbPassword', 'dbName',
    'elocalBaseUrl', 'elocalUsername', 'elocalPassword'
  ];
  
  const missingFields = requiredFields.filter(field => !config[field]);
  
  if (missingFields.length > 0) {
    return E.left(new Error(`Missing required configuration fields: ${missingFields.join(', ')}`));
  }
  
  return E.right(config);
};
