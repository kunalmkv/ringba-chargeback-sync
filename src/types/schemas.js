// Type definitions for eLocal scraper using io-ts
import * as t from 'io-ts';

// Campaign call data structure
export const CampaignCallSchema = t.type({
  dateOfCall: t.string,
  campaignPhone: t.string,
  callerId: t.string,
  category: t.union([t.string, t.undefined]),
  city: t.union([t.string, t.undefined]),
  state: t.union([t.string, t.undefined]),
  zipCode: t.union([t.string, t.undefined]),
  screenDuration: t.number,
  postScreenDuration: t.number,
  totalDuration: t.number,
  callScreen: t.union([t.string, t.undefined]),
  assessment: t.union([t.string, t.undefined]),
  classification: t.union([t.string, t.undefined]),
  payout: t.number
});

// Adjustment detail data structure
export const AdjustmentDetailSchema = t.type({
  timeOfCall: t.string,
  adjustmentTime: t.string,
  campaignPhone: t.string,
  callerId: t.string,
  duration: t.number,
  callSid: t.string,
  amount: t.number,
  classification: t.union([t.string, t.undefined])
});

// Scraping session data structure
export const ScrapingSessionSchema = t.type({
  sessionId: t.string,
  startedAt: t.string,
  completedAt: t.union([t.string, t.null]),
  status: t.union([t.literal('running'), t.literal('completed'), t.literal('failed')]),
  callsScraped: t.number,
  adjustmentsScraped: t.number,
  errorMessage: t.union([t.string, t.null])
});

// Configuration schema
export const ConfigSchema = t.type({
  dbHost: t.string,
  dbPort: t.number,
  dbUser: t.string,
  dbPassword: t.string,
  dbName: t.string,
  elocalBaseUrl: t.string,
  elocalUsername: t.string,
  elocalPassword: t.string,
  headlessBrowser: t.boolean,
  requestDelayMs: t.number,
  maxRetries: t.number,
  timeoutMs: t.number,
  logLevel: t.string,
  logFile: t.string
});

// Type exports (using io-ts runtime types)
export const CampaignCall = CampaignCallSchema;
export const AdjustmentDetail = AdjustmentDetailSchema;
export const ScrapingSession = ScrapingSessionSchema;
export const Config = ConfigSchema;

// Database row types
export const CampaignCallRowSchema = t.type({
  id: t.number,
  date_of_call: t.string,
  campaign_phone: t.string,
  caller_id: t.string,
  category: t.union([t.string, t.null]),
  city: t.union([t.string, t.null]),
  state: t.union([t.string, t.null]),
  zip_code: t.union([t.string, t.null]),
  screen_duration: t.number,
  post_screen_duration: t.number,
  total_duration: t.number,
  call_screen: t.union([t.string, t.null]),
  assessment: t.union([t.string, t.null]),
  classification: t.union([t.string, t.null]),
  payout: t.number,
  created_at: t.string,
  updated_at: t.string
});

export const AdjustmentDetailRowSchema = t.type({
  id: t.number,
  time_of_call: t.string,
  adjustment_time: t.string,
  campaign_phone: t.string,
  caller_id: t.string,
  duration: t.number,
  call_sid: t.string,
  amount: t.number,
  classification: t.union([t.string, t.null]),
  created_at: t.string,
  updated_at: t.string
});

export const CampaignCallRow = CampaignCallRowSchema;
export const AdjustmentDetailRow = AdjustmentDetailRowSchema;
