// Date utility functions for eLocal scraper services
import * as R from 'ramda';

// Format date for eLocal website (MM/DD/YYYY)
export const formatDateForElocal = (date) => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
};

// Format date for URL parameters (YYYY-MM-DD)
export const formatDateForURL = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Get date range for past N days (excluding today)
export const getPastDaysRange = (days, excludeToday = true) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const endDate = excludeToday 
    ? new Date(today.getTime() - 24 * 60 * 60 * 1000) // Yesterday
    : today;
  
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (days - 1)); // Go back N days
  
  return {
    startDate,
    endDate,
    startDateFormatted: formatDateForElocal(startDate),
    endDateFormatted: formatDateForElocal(endDate),
    startDateURL: formatDateForURL(startDate),
    endDateURL: formatDateForURL(endDate),
    days: Math.ceil((endDate - startDate) / (24 * 60 * 60 * 1000)) + 1
  };
};

// Get current IST time
const getISTTime = () => {
  const now = new Date();
  // Convert to IST (UTC+5:30)
  const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
  const utcTime = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
  const istTime = new Date(utcTime + istOffset);
  return istTime;
};

// Get current day date range
// If service runs after 12:00 AM IST (midnight), use previous day (yesterday)
// This ensures we get complete data for the whole day since the date changes at midnight IST
// Logic:
// - If IST hour is 0-11 (12:00 AM to 11:59 AM): Use previous day (yesterday)
// - If IST hour is 12-23 (12:00 PM to 11:59 PM): Use current day (today)
export const getCurrentDayRange = () => {
  const istTime = getISTTime();
  const istHour = istTime.getHours();
  const istDateStr = istTime.toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata' });
  
  // If it's after midnight (12:00 AM) and before noon (12:00 PM) in IST, use previous day
  // This ensures we get complete data for the whole day since date changes at midnight IST
  let targetDate = new Date();
  
  if (istHour >= 0 && istHour < 12) {
    // It's between 12:00 AM and 11:59 AM IST, use previous day
    targetDate.setDate(targetDate.getDate() - 1);
    console.log(`[INFO] Current IST time: ${istDateStr} ${String(istHour).padStart(2, '0')}:${String(istTime.getMinutes()).padStart(2, '0')} - Using previous day (after midnight IST)`);
  } else {
    // It's 12:00 PM or later IST, use current day
    console.log(`[INFO] Current IST time: ${istDateStr} ${String(istHour).padStart(2, '0')}:${String(istTime.getMinutes()).padStart(2, '0')} - Using current day`);
  }
  
  targetDate.setHours(0, 0, 0, 0);
  
  const endDate = new Date(targetDate);
  endDate.setHours(23, 59, 59, 999); // End of the target day
  
  return {
    startDate: targetDate,
    endDate: endDate,
    startDateFormatted: formatDateForElocal(targetDate),
    endDateFormatted: formatDateForElocal(targetDate), // Same date for single day
    startDateURL: formatDateForURL(targetDate),
    endDateURL: formatDateForURL(targetDate),
    days: 1
  };
};

// Get past 10 days (excluding today)
export const getPast10DaysRange = () => getPastDaysRange(10, true);

// Check if date is within range
export const isDateInRange = (date, startDate, endDate) => {
  const checkDate = new Date(date);
  checkDate.setHours(0, 0, 0, 0);
  
  return checkDate >= startDate && checkDate <= endDate;
};

// Generate date range description
export const getDateRangeDescription = (dateRange) => {
  return `${dateRange.startDateFormatted} to ${dateRange.endDateFormatted} (${dateRange.days} days)`;
};

// Create date range for service
export const createServiceDateRange = (serviceType) => {
  switch (serviceType) {
    case 'historical':
      return getPast10DaysRange();
    case 'current':
      return getCurrentDayRange();
    default:
      throw new Error(`Unknown service type: ${serviceType}`);
  }
};

// Validate date range
export const validateDateRange = (dateRange) => {
  if (!dateRange.startDate || !dateRange.endDate) {
    return { valid: false, error: 'Missing start or end date' };
  }
  
  if (dateRange.startDate > dateRange.endDate) {
    return { valid: false, error: 'Start date is after end date' };
  }
  
  const daysDiff = Math.ceil((dateRange.endDate - dateRange.startDate) / (24 * 60 * 60 * 1000)) + 1;
  if (daysDiff > 30) {
    return { valid: false, error: 'Date range exceeds 30 days' };
  }
  
  return { valid: true };
};

// Format date for database (ISO string)
export const formatDateForDatabase = (date) => {
  return new Date(date).toISOString();
};

// Parse date from various formats
export const parseDate = (dateStr) => {
  if (!dateStr) return null;
  
  // Try parsing as ISO string
  let date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date;
  }
  
  // Try parsing as MM/DD/YYYY
  const mmddyyyy = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (mmddyyyy) {
    date = new Date(
      parseInt(mmddyyyy[3]), // year
      parseInt(mmddyyyy[1]) - 1, // month (0-indexed)
      parseInt(mmddyyyy[2]) // day
    );
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
  
  return null;
};

// Get service schedule info
export const getServiceScheduleInfo = (serviceType) => {
  switch (serviceType) {
    case 'historical':
      return {
        name: 'Historical Data Service',
        description: 'Fetches data for past 10 days (excluding today)',
        cronExpression: '0 2 * * *', // Every day at 2 AM
        interval: '24 hours',
        dateRange: getPast10DaysRange()
      };
    case 'current':
      return {
        name: 'Current Day Service',
        description: 'Fetches data for current day only',
        cronExpression: '0 */3 * * *', // Every 3 hours
        interval: '3 hours',
        dateRange: getCurrentDayRange()
      };
    default:
      throw new Error(`Unknown service type: ${serviceType}`);
  }
};

// Export utilities
export const dateUtils = {
  formatDateForElocal,
  getPastDaysRange,
  getCurrentDayRange,
  getPast10DaysRange,
  isDateInRange,
  getDateRangeDescription,
  createServiceDateRange,
  validateDateRange,
  formatDateForDatabase,
  parseDate,
  getServiceScheduleInfo
};
